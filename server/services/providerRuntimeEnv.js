import * as fs from 'fs';
import * as path from 'path';
import { MODEL_CONTEXT_WINDOWS_ENV_KEY } from '../providers/model.js';
import { PROVIDER_PRESETS } from '../config/providerPresets.js';
import { BUILT_IN_PROVIDER_IDS, } from '../providers/schema.js';
import { ATTRIBUTION_HEADER_ENV_KEY, attributionHeaderEnvForModel, } from './attributionHeaderPolicy.js';
import { OPENAI_CODEX_OAUTH_FILE_ENV_KEY, OPENAI_OAUTH_PROVIDER_ENV_KEY, buildOpenAIOfficialRuntimeEnv, isOpenAIOfficialProviderId, } from './openaiOfficialProvider.js';
import { GROK_OAUTH_FILE_ENV_KEY, GROK_OAUTH_PROVIDER_ENV_KEY, buildGrokOfficialRuntimeEnv, isGrokOfficialProviderId, } from './grokOfficialProvider.js';
export const MANAGED_PROVIDER_ENV_KEYS = [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_AZURE_OPENAI',
    'ANTHROPIC_BEDROCK_BASE_URL',
    'ANTHROPIC_VERTEX_BASE_URL',
    'ANTHROPIC_VERTEX_PROJECT_ID',
    'ANTHROPIC_FOUNDRY_BASE_URL',
    'ANTHROPIC_FOUNDRY_RESOURCE',
    'ANTHROPIC_FOUNDRY_API_KEY',
    'AZURE_OPENAI_BASE_URL',
    'AZURE_OPENAI_ENDPOINT',
    'AZURE_OPENAI_API_VERSION',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_CODEX_DEPLOYMENT',
    'AWS_BEARER_TOKEN_BEDROCK',
    'AWS_DEFAULT_REGION',
    'AWS_REGION',
    'AWS_PROFILE',
    'CLOUD_ML_REGION',
    'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
    'CLAUDE_CODE_SKIP_VERTEX_AUTH',
    'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
    'CLAUDE_CODE_SKIP_AZURE_OPENAI_AUTH',
    'ENABLE_TOOL_SEARCH',
    'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION',
    'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
    'ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
    'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
    ATTRIBUTION_HEADER_ENV_KEY,
    MODEL_CONTEXT_WINDOWS_ENV_KEY,
    OPENAI_OAUTH_PROVIDER_ENV_KEY,
    OPENAI_CODEX_OAUTH_FILE_ENV_KEY,
    GROK_OAUTH_PROVIDER_ENV_KEY,
    GROK_OAUTH_FILE_ENV_KEY,
];
const CUSTOM_PROVIDER_MODEL_CAPABILITIES = 'thinking,effort,adaptive_thinking,xhigh_effort,max_effort';
const XIAOMI_MIMO_MODEL_CAPABILITIES = 'thinking';
const KIMI_K3_MODEL_CAPABILITIES = 'thinking,required_thinking,effort,max_effort';
const KIMI_CODING_FALLBACK_MODEL_CAPABILITIES = 'thinking,required_thinking';
const AUTH_ENV_KEYS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
const MODEL_SLOTS = ['main', 'haiku', 'sonnet', 'opus'];
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isProviderModels(value) {
    return (isRecord(value) &&
        typeof value.main === 'string' &&
        (value.fable === undefined || typeof value.fable === 'string') &&
        typeof value.haiku === 'string' &&
        typeof value.sonnet === 'string' &&
        typeof value.opus === 'string');
}
function isProviderModel1mSupport(value) {
    return (isRecord(value) &&
        MODEL_SLOTS.every((slot) => typeof value[slot] === 'boolean'));
}
function isSavedProvider(value) {
    if (!isRecord(value))
        return false;
    const runtimeKind = value.runtimeKind;
    return (typeof value.id === 'string' &&
        typeof value.presetId === 'string' &&
        typeof value.name === 'string' &&
        typeof value.apiKey === 'string' &&
        typeof value.baseUrl === 'string' &&
        (runtimeKind === undefined ||
            runtimeKind === 'anthropic_compatible' ||
            runtimeKind === 'openai_oauth' ||
            runtimeKind === 'grok_oauth') &&
        isProviderModels(value.models) &&
        (value.model1mSupport === undefined || isProviderModel1mSupport(value.model1mSupport)));
}
function normalizeToolSearchEnabled(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['0', 'false', 'off', 'no'].includes(normalized))
            return false;
        if (['1', 'true', 'on', 'yes', 'auto'].includes(normalized) || normalized.startsWith('auto:')) {
            return true;
        }
    }
    return true;
}
function normalizeDisableExperimentalBetas(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['0', 'false', 'off', 'no'].includes(normalized))
            return false;
        if (['1', 'true', 'on', 'yes'].includes(normalized))
            return true;
    }
    return false;
}
export function normalizeModelMapping(models) {
    const main = models.main.trim();
    return {
        main,
        ...(models.fable?.trim() ? { fable: models.fable.trim() } : {}),
        haiku: models.haiku.trim() || main,
        sonnet: models.sonnet.trim() || main,
        opus: models.opus.trim() || main,
    };
}
function normalizeModel1mSupport(model1mSupport) {
    if (!model1mSupport)
        return undefined;
    const normalized = {
        main: model1mSupport.main === true,
        haiku: model1mSupport.haiku === true,
        sonnet: model1mSupport.sonnet === true,
        opus: model1mSupport.opus === true,
    };
    return MODEL_SLOTS.some((slot) => normalized[slot]) ? normalized : undefined;
}
function applyModel1mSupport(model, enabled) {
    const trimmed = model.trim();
    if (!enabled)
        return trimmed;
    return `${trimmed.replace(/\[1m\]$/i, '').replace(/:1m$/i, '').trim()}[1m]`;
}
function applyModel1mSupportMapping(models, model1mSupport) {
    return {
        main: applyModel1mSupport(models.main, model1mSupport?.main),
        ...(models.fable ? { fable: models.fable.trim() } : {}),
        haiku: applyModel1mSupport(models.haiku, model1mSupport?.haiku),
        sonnet: applyModel1mSupport(models.sonnet, model1mSupport?.sonnet),
        opus: applyModel1mSupport(models.opus, model1mSupport?.opus),
    };
}
export function normalizeSavedProvider(provider) {
    const { disableExperimentalBetas: rawDisableExperimentalBetas, model1mSupport: rawModel1mSupport, ...rest } = provider;
    const rawProvider = provider;
    const model1mSupport = normalizeModel1mSupport(rawModel1mSupport);
    return {
        ...rest,
        apiFormat: provider.apiFormat ?? 'anthropic',
        runtimeKind: provider.runtimeKind ?? 'anthropic_compatible',
        models: normalizeModelMapping(provider.models),
        toolSearchEnabled: normalizeToolSearchEnabled(rawProvider.toolSearchEnabled),
        ...(normalizeDisableExperimentalBetas(rawDisableExperimentalBetas) ? { disableExperimentalBetas: true } : {}),
        ...(model1mSupport !== undefined ? { model1mSupport } : {}),
    };
}
function defaultProviderOrder(providers) {
    return [
        ...providers.map((provider) => provider.id),
        ...BUILT_IN_PROVIDER_IDS,
    ];
}
function normalizeProviderOrder(value, providers) {
    const providerIds = providers.map((provider) => provider.id);
    const knownIds = new Set([
        ...providerIds,
        ...BUILT_IN_PROVIDER_IDS,
    ]);
    const source = Array.isArray(value)
        ? value
        : defaultProviderOrder(providers);
    const seen = new Set();
    const order = [];
    for (const id of source) {
        if (typeof id !== 'string' || !knownIds.has(id) || seen.has(id))
            continue;
        seen.add(id);
        order.push(id);
    }
    for (const id of defaultProviderOrder(providers)) {
        if (seen.has(id))
            continue;
        seen.add(id);
        order.push(id);
    }
    return order;
}
export function normalizeProvidersIndex(value) {
    if (!isRecord(value) || !Array.isArray(value.providers)) {
        return null;
    }
    const { activeProviderId: legacyActiveProviderId, providerOrder: rawProviderOrder, ...rest } = value;
    const providers = value.providers
        .filter(isSavedProvider)
        .map((provider) => normalizeSavedProvider(provider));
    const rawActiveId = typeof value.activeId === 'string'
        ? value.activeId
        : typeof legacyActiveProviderId === 'string'
            ? legacyActiveProviderId
            : null;
    const activeId = rawActiveId && (providers.some((provider) => provider.id === rawActiveId) ||
        isOpenAIOfficialProviderId(rawActiveId) ||
        isGrokOfficialProviderId(rawActiveId))
        ? rawActiveId
        : null;
    return {
        ...rest,
        schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : 1,
        activeId,
        providers,
        providerOrder: normalizeProviderOrder(rawProviderOrder, providers),
    };
}
export function getPresetDefaultEnv(presetId) {
    return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.defaultEnv ?? {};
}
function omitAuthEnv(env) {
    return Object.fromEntries(Object.entries(env).filter(([key]) => !AUTH_ENV_KEYS.has(key.toUpperCase())));
}
export function getPresetAuthStrategy(presetId) {
    return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.authStrategy ?? 'auth_token';
}
function getPresetModelContextWindows(presetId) {
    return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.modelContextWindows ?? {};
}
function isXiaomiMimoProvider(provider, models) {
    const baseUrl = provider.baseUrl.toLowerCase();
    const modelIds = Object.values(models).map((model) => model.toLowerCase());
    return (baseUrl.includes('xiaomimimo.com') ||
        modelIds.some((model) => /^mimo-v\d/i.test(model)));
}
function getCustomProviderModelCapabilities(provider, models) {
    if (isXiaomiMimoProvider(provider, models)) {
        return XIAOMI_MIMO_MODEL_CAPABILITIES;
    }
    return CUSTOM_PROVIDER_MODEL_CAPABILITIES;
}
function getKimiModelCapabilities(model) {
    const normalized = model
        .trim()
        .replace(/\[1m\]$/i, '')
        .replace(/:1m$/i, '')
        .toLowerCase();
    return normalized === 'k3'
        ? KIMI_K3_MODEL_CAPABILITIES
        : KIMI_CODING_FALLBACK_MODEL_CAPABILITIES;
}
function getProviderCapabilityEnv(provider, models) {
    if (provider.presetId === 'custom') {
        const capabilities = getCustomProviderModelCapabilities(provider, models);
        return {
            ...(models.fable
                ? { ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES: capabilities }
                : {}),
            ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: capabilities,
            ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: capabilities,
            ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: capabilities,
        };
    }
    if (provider.presetId === 'kimi') {
        return {
            ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: getKimiModelCapabilities(models.haiku),
            ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: getKimiModelCapabilities(models.sonnet),
            ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: getKimiModelCapabilities(models.opus),
        };
    }
    return {};
}
export function buildProviderAuthEnv(provider, presetDefaultEnv, needsProxy) {
    if (needsProxy) {
        return { ANTHROPIC_API_KEY: 'proxy-managed' };
    }
    const strategy = provider.authStrategy ?? getPresetAuthStrategy(provider.presetId);
    const key = provider.apiKey || presetDefaultEnv.ANTHROPIC_AUTH_TOKEN || presetDefaultEnv.ANTHROPIC_API_KEY || '';
    switch (strategy) {
        case 'api_key':
            return key ? { ANTHROPIC_API_KEY: key } : {};
        case 'auth_token':
        case 'auth_token_empty_api_key':
            return {
                ANTHROPIC_API_KEY: '',
                ...(key ? { ANTHROPIC_AUTH_TOKEN: key } : {}),
            };
        case 'dual_same_token':
            return key ? { ANTHROPIC_API_KEY: key, ANTHROPIC_AUTH_TOKEN: key } : {};
        case 'dual_dummy':
            return { ANTHROPIC_API_KEY: 'dummy', ANTHROPIC_AUTH_TOKEN: 'dummy' };
        case 'azure_api_key':
            return key ? { ANTHROPIC_API_KEY: key } : {};
    }
}
export function getManagedEnvKeys() {
    const keys = new Set(MANAGED_PROVIDER_ENV_KEYS);
    for (const preset of PROVIDER_PRESETS) {
        for (const key of Object.keys(preset.defaultEnv ?? {})) {
            keys.add(key);
        }
    }
    return [...keys];
}
export function buildProviderManagedEnv(provider, options) {
    if (provider.runtimeKind === 'openai_oauth') {
        return buildOpenAIOfficialRuntimeEnv();
    }
    if (provider.runtimeKind === 'grok_oauth') {
        return buildGrokOfficialRuntimeEnv();
    }
    const apiFormat = provider.apiFormat ?? 'anthropic';
    const needsProxy = apiFormat !== 'anthropic';
    const proxyPath = options?.proxyPath ?? '/proxy';
    const serverPort = options?.serverPort ?? 3456;
    const baseUrl = needsProxy
        ? `http://127.0.0.1:${serverPort}${proxyPath}`
        : provider.baseUrl;
    const models = normalizeModelMapping(provider.models);
    const runtimeModels = applyModel1mSupportMapping(models, provider.model1mSupport);
    const modelContextWindows = {
        ...getPresetModelContextWindows(provider.presetId),
        ...(provider.modelContextWindows ?? {}),
    };
    const presetDefaultEnv = getPresetDefaultEnv(provider.presetId);
    const providerCapabilityEnv = getProviderCapabilityEnv(provider, models);
    return {
        ...omitAuthEnv(presetDefaultEnv),
        ...providerCapabilityEnv,
        ...(provider.autoCompactWindow !== undefined && {
            CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(provider.autoCompactWindow),
        }),
        ...(Object.keys(modelContextWindows).length > 0 && {
            [MODEL_CONTEXT_WINDOWS_ENV_KEY]: JSON.stringify(modelContextWindows),
        }),
        ...(apiFormat === 'anthropic' && {
            ENABLE_TOOL_SEARCH: provider.toolSearchEnabled === false ? 'false' : 'true',
        }),
        ...(provider.disableExperimentalBetas === true && {
            CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
        }),
        ANTHROPIC_BASE_URL: baseUrl,
        ...buildProviderAuthEnv(provider, presetDefaultEnv, needsProxy),
        ANTHROPIC_MODEL: runtimeModels.main,
        ...(runtimeModels.fable && {
            ANTHROPIC_DEFAULT_FABLE_MODEL: runtimeModels.fable,
        }),
        ANTHROPIC_DEFAULT_HAIKU_MODEL: runtimeModels.haiku,
        ANTHROPIC_DEFAULT_SONNET_MODEL: runtimeModels.sonnet,
        ANTHROPIC_DEFAULT_OPUS_MODEL: runtimeModels.opus,
        ...attributionHeaderEnvForModel(runtimeModels.main),
    };
}
export function readActiveProviderManagedEnv(configDir, options) {
    try {
        const raw = fs.readFileSync(path.join(configDir, 'providers.json'), 'utf-8');
        const index = normalizeProvidersIndex(JSON.parse(raw));
        if (!index?.activeId)
            return null;
        if (isOpenAIOfficialProviderId(index.activeId)) {
            return buildOpenAIOfficialRuntimeEnv();
        }
        if (isGrokOfficialProviderId(index.activeId)) {
            return buildGrokOfficialRuntimeEnv();
        }
        const provider = index.providers.find((entry) => entry.id === index.activeId);
        if (!provider)
            return null;
        return buildProviderManagedEnv(provider, {
            serverPort: options?.serverPort,
        });
    }
    catch {
        return null;
    }
}
export function activeProviderNeedsProxy(configDir) {
    try {
        const raw = fs.readFileSync(path.join(configDir, 'providers.json'), 'utf-8');
        const index = normalizeProvidersIndex(JSON.parse(raw));
        if (!index?.activeId ||
            isOpenAIOfficialProviderId(index.activeId) ||
            isGrokOfficialProviderId(index.activeId)) {
            return false;
        }
        const provider = index.providers.find((entry) => entry.id === index.activeId);
        if (!provider)
            return false;
        return (provider.apiFormat ?? 'anthropic') !== 'anthropic';
    }
    catch {
        return false;
    }
}
export function mergeActiveProviderManagedEnv(settingsEnv, configDir, options) {
    const activeProviderEnv = readActiveProviderManagedEnv(configDir, options);
    if (!activeProviderEnv) {
        return settingsEnv;
    }
    const cleanedEnv = { ...settingsEnv };
    for (const key of getManagedEnvKeys()) {
        delete cleanedEnv[key];
    }
    for (const key of Object.keys(cleanedEnv)) {
        if (key.toUpperCase().startsWith('VERTEX_REGION_CLAUDE_'))
            delete cleanedEnv[key];
    }
    return {
        ...cleanedEnv,
        ...activeProviderEnv,
    };
}

export function readProviderSettingsEnv(configDir) {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf-8'));
        if (!raw || typeof raw !== 'object' || !raw.env || typeof raw.env !== 'object' || Array.isArray(raw.env))
            return {};
        return Object.fromEntries(Object.entries(raw.env ?? {}).filter(([, value]) => typeof value === 'string'));
    }
    catch {
        return {};
    }
}
