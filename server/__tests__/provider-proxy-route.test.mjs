import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import express from 'express';
import { promises as fs } from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import providerProxyRoutes from '../routes/providerProxy.js';
import { ProviderService } from '../services/providerService.js';

let upstreamServer;
let proxyServer;
let upstreamBaseUrl;
let proxyBaseUrl;
let lastUpstreamBody;
let upstreamRequestCount;
let lastUpstreamUrl;
let lastUpstreamHeaders;
let tempDir;
let previousProviderDir;

beforeAll(async () => {
  upstreamServer = http.createServer(async (req, res) => {
    upstreamRequestCount += 1;
    lastUpstreamUrl = req.url;
    lastUpstreamHeaders = req.headers;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    lastUpstreamBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (req.url.startsWith('/openai/responses')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'azure-response-1',
        object: 'response',
        model: 'azure-deployment',
        status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'azure-proxied' }] }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      }));
      return;
    }
    if (lastUpstreamBody.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"id":"chat-stream","model":"mock-model","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n');
      res.write('data: {"id":"chat-stream","model":"mock-model","choices":[{"delta":{"content":"streamed"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chat-1',
      object: 'chat.completion',
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'proxied' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }));
  });
  await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));
  upstreamBaseUrl = `http://127.0.0.1:${upstreamServer.address().port}`;

  const app = express();
  app.use(express.json());
  app.use('/proxy', providerProxyRoutes);
  proxyServer = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`;
});

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-provider-proxy-route-'));
  previousProviderDir = process.env.MEDAUTODATA_PROVIDER_DIR;
  process.env.MEDAUTODATA_PROVIDER_DIR = tempDir;
  lastUpstreamBody = null;
  upstreamRequestCount = 0;
  lastUpstreamUrl = null;
  lastUpstreamHeaders = null;
});

afterEach(async () => {
  if (previousProviderDir === undefined) delete process.env.MEDAUTODATA_PROVIDER_DIR;
  else process.env.MEDAUTODATA_PROVIDER_DIR = previousProviderDir;
  await fs.rm(tempDir, { recursive: true, force: true });
});

afterAll(async () => {
  await Promise.all([upstreamServer, proxyServer].map((server) => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

async function createProvider() {
  return new ProviderService().addProvider({
    presetId: 'custom',
    name: 'Mock OpenAI Chat',
    apiKey: 'mock-key',
    authStrategy: 'api_key',
    baseUrl: upstreamBaseUrl,
    apiFormat: 'openai_chat',
    models: { main: 'mock-model', haiku: 'mock-model', sonnet: 'mock-model', opus: 'mock-model' },
  });
}

describe('provider proxy route', () => {
  test('executes the full non-streaming Anthropic → OpenAI → Anthropic round trip', async () => {
    const provider = await createProvider();
    const response = await fetch(`${proxyBaseUrl}/proxy/providers/${provider.id}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-model[1m]',
        max_tokens: 100,
        system: 'Be concise',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [{ name: 'lookup', description: 'Lookup', input_schema: { type: 'object' } }],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      type: 'message',
      model: 'mock-model',
      content: [{ type: 'text', text: 'proxied' }],
      usage: { input_tokens: 3, output_tokens: 2 },
    });
    expect(lastUpstreamBody).toMatchObject({ model: 'mock-model', stream: false });
    expect(lastUpstreamBody.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
    expect(lastUpstreamBody.tools[0].function.name).toBe('lookup');
  });

  test('executes and translates the streaming round trip', async () => {
    const provider = await createProvider();
    const response = await fetch(`${proxyBaseUrl}/proxy/providers/${provider.id}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mock-model', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const output = await response.text();
    expect(output).toContain('event: message_start');
    expect(output).toContain('"text":"streamed"');
    expect(output).toContain('event: message_stop');
    expect(lastUpstreamBody.stream_options).toEqual({ include_usage: true });
  });

  test('provider test verifies direct connectivity and a second full proxy pipeline request', async () => {
    const provider = await createProvider();
    const result = await new ProviderService().testProvider(provider.id);
    expect(result).toMatchObject({
      connectivity: { success: true, httpStatus: 200 },
      proxy: { success: true, httpStatus: 200 },
    });
    expect(upstreamRequestCount).toBe(2);
  });

  test('supports Azure OpenAI Responses endpoint normalization and api-key authentication', async () => {
    const provider = await new ProviderService().addProvider({
      presetId: 'custom',
      name: 'Azure OpenAI',
      apiKey: 'azure-key',
      authStrategy: 'azure_api_key',
      baseUrl: upstreamBaseUrl,
      apiFormat: 'azure_openai_responses',
      models: { main: 'azure-deployment', haiku: 'azure-deployment', sonnet: 'azure-deployment', opus: 'azure-deployment' },
    });
    const response = await fetch(`${proxyBaseUrl}/proxy/providers/${provider.id}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-claude-code-session-id': 'fallback-session' },
      body: JSON.stringify({
        model: 'azure-deployment',
        max_tokens: 100,
        metadata: { user_id: 'account_session_cache-session' },
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      type: 'message',
      content: [{ type: 'text', text: 'azure-proxied' }],
    });
    expect(lastUpstreamUrl).toBe('/openai/responses?api-version=2025-04-01-preview');
    expect(lastUpstreamHeaders['api-key']).toBe('azure-key');
    expect(lastUpstreamHeaders.authorization).toBeUndefined();
    expect(lastUpstreamBody.prompt_cache_key).toBe('cache-session');
  });
});
