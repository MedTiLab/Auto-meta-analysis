import express from 'express';
import { providerService } from '../services/providerService.js';
import { joinOpenAIEndpoint, normalizeModelStringForApi } from '../providers/model.js';
import { resolveAzureOpenAIEndpoint } from '../providers/azureOpenAI.js';
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js';
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js';
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js';
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js';
import { openaiChatStreamToAnthropic } from '../proxy/streaming/openaiChatStreamToAnthropic.js';
import { openaiResponsesStreamToAnthropic } from '../proxy/streaming/openaiResponsesStreamToAnthropic.js';
import { openaiResponsesStreamToAnthropicResponse } from '../proxy/streaming/openaiResponsesStreamToAnthropicResponse.js';
import { resolvePromptCacheKey } from '../proxy/promptCacheKey.js';

const router = express.Router();

export function isLoopbackAddress(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

router.use((req, res, next) => {
  if (
    process.env.MEDAUTODATA_ALLOW_REMOTE_PROVIDER_PROXY === 'true'
    || isLoopbackAddress(req.socket?.remoteAddress)
  ) {
    next();
    return;
  }
  res.status(403).json(errorBody('The LLM provider proxy only accepts loopback requests', 'permission_error'));
});

function errorBody(message, type = 'api_error') {
  return { type: 'error', error: { type, message } };
}

function isEventStream(response) {
  return (response.headers.get('content-type') || '').toLowerCase().includes('text/event-stream');
}

async function pipeWebStream(stream, res) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) res.status(502).json(errorBody(error.message || String(error)));
    else res.destroy(error);
  } finally {
    reader.releaseLock();
  }
}

function createConnectionTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
  }, timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export async function fetchUpstreamWithTimeout(url, init, timeoutMs, isStream) {
  if (!isStream) {
    return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }

  // Streaming generations can legitimately run longer than the request
  // timeout. Limit connection/header setup here; body inactivity is handled by
  // withStreamIdleTimeout below.
  const timeout = createConnectionTimeout(timeoutMs);
  try {
    return await fetch(url, { ...init, signal: timeout.signal });
  } finally {
    timeout.clear();
  }
}

export function withStreamIdleTimeout(upstream, timeoutMs) {
  let reader = null;
  let timer = null;

  const clearIdleTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return new ReadableStream({
    async start(controller) {
      reader = upstream.getReader();
      let timedOut = false;
      const armIdleTimer = () => {
        clearIdleTimer();
        timer = setTimeout(() => {
          timedOut = true;
          void reader?.cancel('stream idle timeout').catch(() => undefined);
          controller.error(new Error(`Upstream stream idle timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      };

      try {
        armIdleTimer();
        while (true) {
          const { done, value } = await reader.read();
          if (done || timedOut) break;
          controller.enqueue(value);
          armIdleTimer();
        }
        clearIdleTimer();
        if (!timedOut) controller.close();
      } catch (error) {
        clearIdleTimer();
        if (!timedOut) controller.error(error);
      }
    },
    cancel(reason) {
      clearIdleTimer();
      return reader?.cancel(reason);
    },
  });
}

function buildUpstream(provider, body, promptCacheKey) {
  if (provider.apiFormat === 'openai_chat') {
    const baseUrl = provider.baseUrl.toLowerCase();
    const deepSeekCompatible = baseUrl.includes('deepseek');
    return {
      url: joinOpenAIEndpoint(provider.baseUrl, 'chat/completions'),
      body: anthropicToOpenaiChat(body, {
        roundTripReasoningContent: deepSeekCompatible,
        passThinkingToggle: deepSeekCompatible,
        imageContentMode: baseUrl.includes('cerebras') ? 'text_only' : 'vision',
      }),
    };
  }

  const url = provider.runtimeKind === 'openai_oauth'
    ? 'https://chatgpt.com/backend-api/codex/responses'
    : provider.apiFormat === 'azure_openai_responses'
      ? resolveAzureOpenAIEndpoint(provider.baseUrl)
      : joinOpenAIEndpoint(provider.baseUrl, 'responses');
  const transformed = anthropicToOpenaiResponses(body, { cacheKey: promptCacheKey });
  if (provider.runtimeKind === 'openai_oauth') transformed.stream = true;
  return { url, body: transformed };
}

function buildUpstreamHeaders(provider) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (provider.apiFormat === 'azure_openai_responses') {
    delete headers.Authorization;
    headers['api-key'] = provider.apiKey;
  }
  if (provider.runtimeKind === 'openai_oauth') {
    headers.originator = 'codex_cli_rs';
    headers['User-Agent'] = 'codex-cli/0.144.0';
    if (provider.oauth?.accountId) headers['ChatGPT-Account-Id'] = provider.oauth.accountId;
  }
  return headers;
}

async function handleProxy(req, res) {
  try {
    const provider = await providerService.getProviderForProxy(req.params.providerId);
    if (!provider) {
      return res.status(400).json(errorBody(
        req.params.providerId
          ? `Provider "${req.params.providerId}" is not configured or requires login`
          : 'No active proxy provider is configured',
        'invalid_request_error',
      ));
    }
    if (provider.apiFormat === 'anthropic') {
      return res.status(400).json(errorBody('Provider uses native Anthropic format; protocol proxy is not needed', 'invalid_request_error'));
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json(errorBody('Invalid JSON request body', 'invalid_request_error'));
    }

    const body = { ...req.body, model: normalizeModelStringForApi(req.body.model) };
    const requestedStream = body.stream === true;
    const promptCacheKey = resolvePromptCacheKey(body, req.get('x-claude-code-session-id'));
    const upstreamRequest = buildUpstream(provider, body, promptCacheKey);
    const timeoutMs = Number.parseInt(process.env.LLM_PROVIDER_REQUEST_TIMEOUT_MS || '300000', 10);
    const upstream = await fetchUpstreamWithTimeout(upstreamRequest.url, {
      method: 'POST',
      headers: buildUpstreamHeaders(provider),
      body: JSON.stringify(upstreamRequest.body),
    }, timeoutMs, upstreamRequest.body.stream === true);

    if (!upstream.ok) {
      const message = (await upstream.text().catch(() => '')).slice(0, 1000);
      return res.status(upstream.status).json(errorBody(`Upstream returned HTTP ${upstream.status}: ${message}`));
    }

    if (requestedStream) {
      if (!upstream.body) return res.status(502).json(errorBody('Upstream returned no streaming body'));
      const upstreamBody = withStreamIdleTimeout(upstream.body, timeoutMs);
      const stream = provider.apiFormat === 'openai_chat'
        ? openaiChatStreamToAnthropic(upstreamBody, body.model)
        : openaiResponsesStreamToAnthropic(upstreamBody, body.model);
      res.status(200);
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.flushHeaders();
      return pipeWebStream(stream, res);
    }

    let responseBody;
    if (provider.apiFormat === 'openai_responses' && upstream.body && isEventStream(upstream)) {
      responseBody = await openaiResponsesStreamToAnthropicResponse(
        withStreamIdleTimeout(upstream.body, timeoutMs),
        body.model,
      );
    } else {
      const raw = await upstream.json();
      responseBody = provider.apiFormat === 'openai_chat'
        ? openaiChatToAnthropic(raw, body.model)
        : openaiResponsesToAnthropic(raw, body.model);
    }
    return res.json(responseBody);
  } catch (error) {
    console.error('[ERROR] Provider proxy request failed:', error.message || error);
    return res.status(502).json(errorBody(error.message || String(error)));
  }
}

router.post('/v1/messages', handleProxy);
router.post('/providers/:providerId/v1/messages', handleProxy);

export default router;
