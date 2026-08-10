import crypto from 'crypto';
import fsSync from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveAppDataRoot } from '../utils/storagePaths.js';
import { getBackendPortSync } from '../utils/runtimePorts.js';
import { PROVIDER_PRESETS } from '../config/providerPresets.js';
import {
  BUILT_IN_PROVIDER_IDS,
  CLAUDE_OFFICIAL_PROVIDER_ID,
  CreateProviderSchema,
  OPENAI_OFFICIAL_PROVIDER_ID,
  GROK_OFFICIAL_PROVIDER_ID,
  TestProviderSchema,
  UpdateProviderSchema,
} from '../providers/schema.js';
import {
  buildProviderManagedEnv,
  getPresetAuthStrategy,
  getPresetDefaultEnv,
  normalizeModelMapping,
  normalizeProvidersIndex,
} from './providerRuntimeEnv.js';
import {
  OPENAI_OFFICIAL_PROVIDER,
  isOpenAIOfficialProviderId,
} from './openaiOfficialProvider.js';
import {
  GROK_OFFICIAL_PROVIDER,
  isGrokOfficialProviderId,
} from './grokOfficialProvider.js';
import { joinOpenAIEndpoint, normalizeModelStringForApi } from '../providers/model.js';
import { resolveAzureOpenAIEndpoint } from '../providers/azureOpenAI.js';
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js';
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js';
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js';
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js';
import { openaiResponsesStreamToAnthropicResponse } from '../proxy/streaming/openaiResponsesStreamToAnthropicResponse.js';
import { llmOAuthService } from './providerOAuthService.js';

const SCHEMA_VERSION = 1;
const DEFAULT_INDEX = {
  schemaVersion: SCHEMA_VERSION,
  activeId: null,
  providers: [],
  providerOrder: [...BUILT_IN_PROVIDER_IDS],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function httpError(status, message, code = 'PROVIDER_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function isPermutation(candidateIds, expectedIds) {
  return candidateIds.length === expectedIds.length
    && new Set(candidateIds).size === candidateIds.length
    && expectedIds.every((id) => candidateIds.includes(id));
}

function appendNewProviderToOrder(order, providerId, providers) {
  const saved = new Set(providers.map((provider) => provider.id));
  const lastSavedIndex = order.reduce(
    (latest, id, index) => (saved.has(id) ? index : latest),
    -1,
  );
  if (lastSavedIndex >= 0) {
    return [...order.slice(0, lastSavedIndex + 1), providerId, ...order.slice(lastSavedIndex + 1)];
  }
  const firstBuiltIn = order.findIndex((id) => BUILT_IN_PROVIDER_IDS.includes(id));
  if (firstBuiltIn < 0) return [...order, providerId];
  return [...order.slice(0, firstBuiltIn), providerId, ...order.slice(firstBuiltIn)];
}

function buildAuthHeaders(apiKey, strategy = 'api_key') {
  if (strategy === 'auth_token' || strategy === 'auth_token_empty_api_key') {
    return { Authorization: `Bearer ${apiKey}`, 'x-api-key': '' };
  }
  if (strategy === 'dual_same_token') {
    return { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey };
  }
  if (strategy === 'dual_dummy') {
    return { Authorization: 'Bearer dummy', 'x-api-key': 'dummy' };
  }
  return { 'x-api-key': apiKey };
}

function buildDirectTestRequest(base, apiKey, modelId, format, authStrategy) {
  const prompt = 'Say "ok" and nothing else.';
  if (format === 'openai_chat') {
    return {
      url: joinOpenAIEndpoint(base, 'chat/completions'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_tokens: 16, stream: false, messages: [{ role: 'user', content: prompt }] },
    };
  }
  if (format === 'openai_responses') {
    return {
      url: joinOpenAIEndpoint(base, 'responses'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_output_tokens: 16, input: [{ type: 'message', role: 'user', content: prompt }] },
    };
  }
  if (format === 'azure_openai_responses') {
    return {
      url: resolveAzureOpenAIEndpoint(base),
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: { model: modelId, max_output_tokens: 16, input: [{ type: 'message', role: 'user', content: prompt }] },
    };
  }
  return {
    url: joinOpenAIEndpoint(base, 'messages'),
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...buildAuthHeaders(apiKey, authStrategy),
    },
    body: { model: modelId, max_tokens: 16, stream: false, messages: [{ role: 'user', content: prompt }] },
  };
}

function validateResponseBody(body, format) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Response is not a JSON object' };
  if (format === 'anthropic') {
    return body.type === 'message' && Array.isArray(body.content)
      ? { ok: true, model: body.model }
      : { ok: false, error: 'Invalid Anthropic Messages response' };
  }
  if (format === 'openai_chat') {
    return Array.isArray(body.choices)
      ? { ok: true, model: body.model }
      : { ok: false, error: 'Invalid OpenAI Chat Completions response' };
  }
  return (body.object === 'response' || Array.isArray(body.output))
    ? { ok: true, model: body.model }
    : { ok: false, error: 'Invalid OpenAI Responses response' };
}

export function getProviderConfigDir() {
  return process.env.MEDAUTODATA_PROVIDER_DIR
    ? path.resolve(process.env.MEDAUTODATA_PROVIDER_DIR)
    : path.join(resolveAppDataRoot(), 'llm');
}

export class ProviderService {
  getIndexPath() {
    return path.join(getProviderConfigDir(), 'providers.json');
  }

  getSettingsPath() {
    return path.join(getProviderConfigDir(), 'settings.json');
  }

  async readIndex() {
    try {
      const raw = await fs.readFile(this.getIndexPath(), 'utf8');
      return normalizeProvidersIndex(JSON.parse(raw)) || clone(DEFAULT_INDEX);
    } catch (error) {
      if (error.code === 'ENOENT') return clone(DEFAULT_INDEX);
      if (error instanceof SyntaxError) {
        throw httpError(500, 'Provider configuration is invalid JSON', 'INVALID_PROVIDER_STORAGE');
      }
      throw error;
    }
  }

  readIndexSync() {
    try {
      const raw = fsSync.readFileSync(this.getIndexPath(), 'utf8');
      return normalizeProvidersIndex(JSON.parse(raw)) || clone(DEFAULT_INDEX);
    } catch {
      return clone(DEFAULT_INDEX);
    }
  }

  async writeIndex(index) {
    const filePath = this.getIndexPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tempPath, filePath);
      await fs.chmod(filePath, 0o600).catch(() => {});
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async getManagedSettings() {
    try {
      const raw = JSON.parse(await fs.readFile(this.getSettingsPath(), 'utf8'));
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async updateManagedSettings(updates) {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw httpError(400, 'Provider settings must be a JSON object', 'INVALID_PROVIDER_SETTINGS');
    }
    const settings = { ...(await this.getManagedSettings()), ...updates };
    const filePath = this.getSettingsPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tempPath, filePath);
      await fs.chmod(filePath, 0o600).catch(() => {});
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
    return settings;
  }

  async listProviders() {
    const index = await this.readIndex();
    return {
      providers: index.providers,
      activeId: index.activeId,
      providerOrder: index.providerOrder,
      builtIns: [
        { id: CLAUDE_OFFICIAL_PROVIDER_ID, presetId: 'official', name: 'Claude Official', runtimeKind: 'anthropic_compatible' },
        OPENAI_OFFICIAL_PROVIDER,
        GROK_OFFICIAL_PROVIDER,
      ],
    };
  }

  async getProvider(id) {
    if (id === CLAUDE_OFFICIAL_PROVIDER_ID) {
      return { id, presetId: 'official', name: 'Claude Official', apiKey: '', baseUrl: '', apiFormat: 'anthropic', runtimeKind: 'anthropic_compatible', models: { main: '', haiku: '', sonnet: '', opus: '' } };
    }
    if (isOpenAIOfficialProviderId(id)) return clone(OPENAI_OFFICIAL_PROVIDER);
    if (isGrokOfficialProviderId(id)) return clone(GROK_OFFICIAL_PROVIDER);
    const index = await this.readIndex();
    const provider = index.providers.find((entry) => entry.id === id);
    if (!provider) throw httpError(404, `Provider not found: ${id}`, 'PROVIDER_NOT_FOUND');
    return provider;
  }

  async addProvider(rawInput) {
    const input = CreateProviderSchema.parse(rawInput);
    const index = await this.readIndex();
    if (!PROVIDER_PRESETS.some((preset) => preset.id === input.presetId)) {
      throw httpError(400, `Unknown provider preset: ${input.presetId}`, 'INVALID_PRESET');
    }
    const provider = {
      id: crypto.randomUUID(),
      presetId: input.presetId,
      name: input.name,
      apiKey: input.apiKey,
      ...(input.authStrategy !== undefined && { authStrategy: input.authStrategy }),
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      apiFormat: input.apiFormat ?? 'anthropic',
      runtimeKind: input.runtimeKind ?? 'anthropic_compatible',
      models: normalizeModelMapping(input.models),
      ...(input.model1mSupport !== undefined && { model1mSupport: input.model1mSupport }),
      ...(input.autoCompactWindow !== undefined && { autoCompactWindow: input.autoCompactWindow }),
      ...(input.modelContextWindows !== undefined && { modelContextWindows: input.modelContextWindows }),
      toolSearchEnabled: input.toolSearchEnabled ?? true,
      ...(input.disableExperimentalBetas === true && { disableExperimentalBetas: true }),
      ...(input.notes !== undefined && { notes: input.notes }),
    };
    index.providerOrder = appendNewProviderToOrder(index.providerOrder, provider.id, index.providers);
    index.providers.push(provider);
    await this.writeIndex(index);
    return provider;
  }

  async updateProvider(id, rawInput) {
    const input = UpdateProviderSchema.parse(rawInput);
    const index = await this.readIndex();
    const providerIndex = index.providers.findIndex((entry) => entry.id === id);
    if (providerIndex < 0) throw httpError(404, `Provider not found: ${id}`, 'PROVIDER_NOT_FOUND');
    const updated = {
      ...index.providers[providerIndex],
      ...(input.name !== undefined && { name: input.name }),
      ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
      ...(input.authStrategy !== undefined && { authStrategy: input.authStrategy }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl.replace(/\/+$/, '') }),
      ...(input.apiFormat !== undefined && { apiFormat: input.apiFormat }),
      ...(input.runtimeKind !== undefined && { runtimeKind: input.runtimeKind }),
      ...(input.models !== undefined && { models: normalizeModelMapping(input.models) }),
      ...(input.model1mSupport && { model1mSupport: input.model1mSupport }),
      ...(typeof input.autoCompactWindow === 'number' && { autoCompactWindow: input.autoCompactWindow }),
      ...(input.modelContextWindows && { modelContextWindows: input.modelContextWindows }),
      ...(input.toolSearchEnabled !== undefined && { toolSearchEnabled: input.toolSearchEnabled }),
      ...(input.notes !== undefined && { notes: input.notes }),
    };
    for (const [key, value] of [
      ['model1mSupport', input.model1mSupport],
      ['autoCompactWindow', input.autoCompactWindow],
      ['modelContextWindows', input.modelContextWindows],
    ]) {
      if (value === null) delete updated[key];
    }
    if (input.disableExperimentalBetas === true) updated.disableExperimentalBetas = true;
    if (input.disableExperimentalBetas === false) delete updated.disableExperimentalBetas;
    index.providers[providerIndex] = updated;
    await this.writeIndex(index);
    return updated;
  }

  async deleteProvider(id) {
    const index = await this.readIndex();
    const providerIndex = index.providers.findIndex((entry) => entry.id === id);
    if (providerIndex < 0) throw httpError(404, `Provider not found: ${id}`, 'PROVIDER_NOT_FOUND');
    if (index.activeId === id) throw httpError(409, 'Cannot delete the active provider. Switch providers first.', 'ACTIVE_PROVIDER');
    index.providers.splice(providerIndex, 1);
    index.providerOrder = index.providerOrder.filter((entry) => entry !== id);
    await this.writeIndex(index);
  }

  async reorderProviders(orderedIds) {
    const index = await this.readIndex();
    const savedIds = index.providers.map((provider) => provider.id);
    const fullIds = [...savedIds, ...BUILT_IN_PROVIDER_IDS];
    if (isPermutation(orderedIds, fullIds)) {
      index.providerOrder = orderedIds;
    } else if (isPermutation(orderedIds, savedIds)) {
      const queue = [...orderedIds];
      const savedSet = new Set(savedIds);
      index.providerOrder = index.providerOrder.map((id) => (savedSet.has(id) ? queue.shift() : id));
    } else {
      throw httpError(400, 'orderedIds must be a permutation of all existing provider IDs', 'INVALID_PROVIDER_ORDER');
    }
    const byId = new Map(index.providers.map((provider) => [provider.id, provider]));
    index.providers = index.providerOrder.map((id) => byId.get(id)).filter(Boolean);
    await this.writeIndex(index);
    return { providers: index.providers, providerOrder: index.providerOrder };
  }

  async activateProvider(id) {
    const index = await this.readIndex();
    const exists = BUILT_IN_PROVIDER_IDS.includes(id) || index.providers.some((provider) => provider.id === id);
    if (!exists) throw httpError(404, `Provider not found: ${id}`, 'PROVIDER_NOT_FOUND');
    index.activeId = id === CLAUDE_OFFICIAL_PROVIDER_ID ? null : id;
    await this.writeIndex(index);
  }

  async activateOfficial() {
    const index = await this.readIndex();
    index.activeId = null;
    await this.writeIndex(index);
  }

  async getProviderRuntimeEnv(id) {
    const provider = await this.getProvider(id);
    if (provider.id === CLAUDE_OFFICIAL_PROVIDER_ID) return {};
    return buildProviderManagedEnv(provider, {
      proxyPath: `/proxy/providers/${provider.id}`,
      serverPort: getBackendPortSync(),
    });
  }

  async checkAuthStatus() {
    const index = await this.readIndex();
    if (isOpenAIOfficialProviderId(index.activeId)) {
      const status = await llmOAuthService.status('openai');
      return { hasAuth: status.loggedIn, source: status.loggedIn ? 'openai-oauth' : 'none', activeProvider: OPENAI_OFFICIAL_PROVIDER.name };
    }
    if (isGrokOfficialProviderId(index.activeId)) {
      const status = await llmOAuthService.status('grok');
      return { hasAuth: status.loggedIn, source: status.loggedIn ? 'grok-oauth' : 'none', activeProvider: GROK_OFFICIAL_PROVIDER.name };
    }
    if (index.activeId) {
      const provider = index.providers.find((entry) => entry.id === index.activeId);
      if (provider) {
        const defaults = getPresetDefaultEnv(provider.presetId);
        if (provider.apiKey || defaults.ANTHROPIC_API_KEY || defaults.ANTHROPIC_AUTH_TOKEN) {
          return { hasAuth: true, source: 'configured-provider', activeProvider: provider.name };
        }
      }
    }
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return { hasAuth: true, source: 'env' };
    return { hasAuth: false, source: 'none' };
  }

  async getProviderForProxy(providerId) {
    const index = await this.readIndex();
    const id = providerId || index.activeId;
    if (!id) return null;
    if (isOpenAIOfficialProviderId(id)) {
      const credential = await llmOAuthService.getCredential('openai');
      if (!credential) return null;
      return { ...OPENAI_OFFICIAL_PROVIDER, apiKey: credential.accessToken, oauth: credential };
    }
    if (isGrokOfficialProviderId(id)) {
      const credential = await llmOAuthService.getCredential('grok');
      if (!credential) return null;
      return { ...GROK_OFFICIAL_PROVIDER, apiKey: credential.accessToken, oauth: credential };
    }
    const provider = index.providers.find((entry) => entry.id === id);
    return provider || null;
  }

  async testProvider(id, overrides = {}) {
    if (isOpenAIOfficialProviderId(id) || isGrokOfficialProviderId(id)) {
      const provider = await this.getProviderForProxy(id);
      if (!provider) return { connectivity: { success: false, latencyMs: 0, error: 'OAuth login required' } };
      if (isOpenAIOfficialProviderId(id)) {
        return this.testOpenAIOfficialProvider(provider, overrides.modelId || provider.models.main);
      }
      return this.testProviderConfig({
        baseUrl: overrides.baseUrl || provider.baseUrl,
        apiKey: provider.apiKey,
        modelId: overrides.modelId || provider.models.main,
        apiFormat: overrides.apiFormat || provider.apiFormat,
        authStrategy: overrides.authStrategy || provider.authStrategy,
      });
    }
    const provider = await this.getProvider(id);
    const defaults = getPresetDefaultEnv(provider.presetId);
    const authStrategy = overrides.authStrategy || provider.authStrategy || getPresetAuthStrategy(provider.presetId);
    const apiKey = provider.apiKey || defaults.ANTHROPIC_AUTH_TOKEN || defaults.ANTHROPIC_API_KEY || (authStrategy === 'dual_dummy' ? 'dummy' : '');
    if (!provider.baseUrl || !apiKey) return { connectivity: { success: false, latencyMs: 0, error: 'Missing baseUrl or apiKey' } };
    return this.testProviderConfig({
      baseUrl: overrides.baseUrl || provider.baseUrl,
      apiKey,
      modelId: overrides.modelId || provider.models.main,
      authStrategy,
      apiFormat: overrides.apiFormat || provider.apiFormat,
    });
  }

  async testOpenAIOfficialProvider(provider, requestedModel) {
    const modelId = normalizeModelStringForApi(requestedModel);
    const timeoutMs = Number.parseInt(process.env.LLM_PROVIDER_TEST_TIMEOUT_MS || '30000', 10);
    const start = Date.now();
    try {
      const transformed = anthropicToOpenaiResponses({
        model: modelId,
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      });
      transformed.stream = true;
      transformed.reasoning = { ...(transformed.reasoning || {}), effort: 'low' };
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
        originator: 'codex_cli_rs',
        'User-Agent': 'codex-cli/0.144.0',
      };
      if (provider.oauth?.accountId) headers['ChatGPT-Account-Id'] = provider.oauth.accountId;
      const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers,
        body: JSON.stringify(transformed),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return { connectivity: { success: false, latencyMs, modelUsed: modelId, httpStatus: response.status, error: `HTTP ${response.status}: ${errorText.slice(0, 200)}` } };
      }
      if (!response.body) {
        return { connectivity: { success: false, latencyMs, modelUsed: modelId, httpStatus: response.status, error: 'OpenAI returned no response body' } };
      }
      const anthropicResponse = await openaiResponsesStreamToAnthropicResponse(response.body, modelId);
      const success = anthropicResponse?.type === 'message' && Array.isArray(anthropicResponse.content);
      const step = {
        success,
        latencyMs,
        modelUsed: anthropicResponse?.model || modelId,
        httpStatus: response.status,
        ...(!success && { error: 'OpenAI OAuth proxy produced an invalid Anthropic response' }),
      };
      return { connectivity: step, proxy: { ...step } };
    } catch (error) {
      return { connectivity: { success: false, latencyMs: Date.now() - start, error: error.message || String(error), modelUsed: modelId } };
    }
  }

  async testProviderConfig(rawInput) {
    const input = TestProviderSchema.parse(rawInput);
    const format = input.apiFormat || 'anthropic';
    const authStrategy = input.authStrategy || 'api_key';
    const base = input.baseUrl.replace(/\/+$/, '');
    const modelId = normalizeModelStringForApi(input.modelId);
    const timeoutMs = Number.parseInt(process.env.LLM_PROVIDER_TEST_TIMEOUT_MS || '30000', 10);
    const start = Date.now();
    try {
      const request = buildDirectTestRequest(base, input.apiKey, modelId, format, authStrategy);
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseBody = await response.json().catch(() => null);
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        const message = responseBody?.error?.message || `HTTP ${response.status}`;
        return { connectivity: { success: false, latencyMs, error: message, modelUsed: modelId, httpStatus: response.status } };
      }
      const valid = validateResponseBody(responseBody, format);
      if (!valid.ok) return { connectivity: { success: false, latencyMs, error: valid.error, modelUsed: modelId, httpStatus: response.status } };
      const connectivity = { success: true, latencyMs, modelUsed: valid.model || modelId, httpStatus: response.status };
      if (format === 'anthropic') return { connectivity };
      return {
        connectivity,
        proxy: await this.testProxyPipeline({
          base,
          apiKey: input.apiKey,
          modelId,
          format,
          timeoutMs,
        }),
      };
    } catch (error) {
      return { connectivity: { success: false, latencyMs: Date.now() - start, error: error.message || String(error), modelUsed: modelId } };
    }
  }

  async testProxyPipeline({ base, apiKey, modelId, format, timeoutMs }) {
    const start = Date.now();
    try {
      const anthropicRequest = {
        model: modelId,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      };
      const transformed = format === 'openai_chat'
        ? anthropicToOpenaiChat(anthropicRequest)
        : anthropicToOpenaiResponses(anthropicRequest);
      const url = format === 'openai_chat'
        ? joinOpenAIEndpoint(base, 'chat/completions')
        : format === 'azure_openai_responses'
          ? resolveAzureOpenAIEndpoint(base)
          : joinOpenAIEndpoint(base, 'responses');
      const headers = format === 'azure_openai_responses'
        ? { 'Content-Type': 'application/json', 'api-key': apiKey }
        : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(transformed),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          latencyMs,
          modelUsed: modelId,
          httpStatus: response.status,
          error: `Upstream HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        };
      }
      const upstreamBody = await response.json();
      const transformedBack = format === 'openai_chat'
        ? openaiChatToAnthropic(upstreamBody, modelId)
        : openaiResponsesToAnthropic(upstreamBody, modelId);
      const success = transformedBack?.type === 'message' && Array.isArray(transformedBack.content);
      return {
        success,
        latencyMs,
        modelUsed: transformedBack?.model || modelId,
        httpStatus: response.status,
        ...(!success && { error: 'Proxy transform produced an invalid Anthropic response' }),
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: error.message || String(error),
        modelUsed: modelId,
      };
    }
  }
}

export const providerService = new ProviderService();
export { httpError as createProviderHttpError };
