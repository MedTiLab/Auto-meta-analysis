import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import express from 'express';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import providersRoutes from '../routes/providers.js';

let server;
let baseUrl;
let tempDir;
let previousProviderDir;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/providers', providersRoutes);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-providers-api-'));
  previousProviderDir = process.env.MEDAUTODATA_PROVIDER_DIR;
  process.env.MEDAUTODATA_PROVIDER_DIR = tempDir;
});

afterEach(async () => {
  if (previousProviderDir === undefined) delete process.env.MEDAUTODATA_PROVIDER_DIR;
  else process.env.MEDAUTODATA_PROVIDER_DIR = previousProviderDir;
  await fs.rm(tempDir, { recursive: true, force: true });
});

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
  });
  return { response, body: await response.json() };
}

describe('providers REST API', () => {
  test('exposes the full preset catalog and complete provider lifecycle', async () => {
    const presets = await request('/api/providers/presets');
    expect(presets.response.status).toBe(200);
    expect(presets.body.presets).toHaveLength(11);

    const savedSettings = await request('/api/providers/settings', {
      method: 'PUT',
      body: JSON.stringify({ env: { API_TIMEOUT_MS: '120000' }, model: 'gpt-main' }),
    });
    expect(savedSettings.body).toMatchObject({ ok: true, settings: { model: 'gpt-main' } });
    expect((await request('/api/providers/settings')).body).toEqual({
      env: { API_TIMEOUT_MS: '120000' },
      model: 'gpt-main',
    });

    const created = await request('/api/providers', {
      method: 'POST',
      body: JSON.stringify({
        presetId: 'custom',
        name: 'OpenAI Gateway',
        apiKey: 'gateway-key',
        authStrategy: 'api_key',
        baseUrl: 'https://gateway.example.test',
        apiFormat: 'openai_responses',
        models: { main: 'gpt-main', haiku: 'gpt-fast', sonnet: 'gpt-main', opus: 'gpt-main' },
      }),
    });
    expect(created.response.status).toBe(201);
    const providerId = created.body.provider.id;
    expect(created.body.provider).toMatchObject({ apiKey: '', hasApiKey: true, apiKeyLast4: '-key' });

    expect((await request('/api/providers')).body).toMatchObject({ activeId: null });
    expect((await request('/api/providers')).body.providers).toHaveLength(1);

    expect((await request(`/api/providers/${providerId}/activate`, { method: 'POST' })).response.status).toBe(200);
    const { ProviderService } = await import('../services/providerService.js');
    const runtime = { body: { env: await new ProviderService().getProviderRuntimeEnv(providerId) } };
    expect(runtime.body.env).toMatchObject({
      ANTHROPIC_API_KEY: 'proxy-managed',
      ANTHROPIC_MODEL: 'gpt-main',
    });
    expect(runtime.body.env.ANTHROPIC_BASE_URL).toContain(`/proxy/providers/${providerId}`);

    const conflict = await request(`/api/providers/${providerId}`, { method: 'DELETE' });
    expect(conflict.response.status).toBe(409);
    await request('/api/providers/official', { method: 'POST' });
    expect((await request(`/api/providers/${providerId}`, { method: 'DELETE' })).response.status).toBe(200);
  });

  test('returns structured validation errors instead of persisting malformed providers', async () => {
    const result = await request('/api/providers', {
      method: 'POST',
      body: JSON.stringify({ presetId: 'custom', name: '', apiKey: '' }),
    });
    expect(result.response.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'INVALID_PROVIDER_INPUT' });
    expect((await request('/api/providers')).body.providers).toEqual([]);
  });
});
