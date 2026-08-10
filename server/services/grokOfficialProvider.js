import path from 'path';
import { resolveAppDataRoot } from '../utils/storagePaths.js';
import { getBackendPortSync } from '../utils/runtimePorts.js';
import { GROK_OFFICIAL_PROVIDER_ID } from '../providers/schema.js';
import { GROK_OFFICIAL_MODELS } from '../../shared/modelConstants.js';

export { GROK_OFFICIAL_PROVIDER_ID };
export const GROK_OFFICIAL_PROVIDER_NAME = 'Grok Official';
export const GROK_OAUTH_PROVIDER_ENV_KEY = 'MEDHELP_GROK_OAUTH_PROVIDER';
export const GROK_OAUTH_FILE_ENV_KEY = 'GROK_OAUTH_FILE';

const modelContextWindows = {
  [GROK_OFFICIAL_MODELS.MAIN]: 500000,
  [GROK_OFFICIAL_MODELS.FAST]: 200000,
};

export const GROK_OFFICIAL_PROVIDER = {
  id: GROK_OFFICIAL_PROVIDER_ID,
  presetId: GROK_OFFICIAL_PROVIDER_ID,
  name: GROK_OFFICIAL_PROVIDER_NAME,
  apiKey: '',
  authStrategy: 'dual_dummy',
  baseUrl: 'https://cli-chat-proxy.grok.com',
  apiFormat: 'openai_chat',
  runtimeKind: 'grok_oauth',
  models: {
    main: GROK_OFFICIAL_MODELS.MAIN,
    haiku: GROK_OFFICIAL_MODELS.MAIN,
    sonnet: GROK_OFFICIAL_MODELS.MAIN,
    opus: GROK_OFFICIAL_MODELS.MAIN,
  },
  modelContextWindows,
};

export function isGrokOfficialProviderId(id) {
  return id === GROK_OFFICIAL_PROVIDER_ID;
}

export function getGrokOAuthFilePath() {
  return path.join(resolveAppDataRoot(), 'llm', 'grok-oauth.json');
}

export function buildGrokOfficialRuntimeEnv() {
  const port = getBackendPortSync();
  return {
    [GROK_OAUTH_PROVIDER_ENV_KEY]: '1',
    [GROK_OAUTH_FILE_ENV_KEY]: getGrokOAuthFilePath(),
    CLAUDE_CODE_MODEL_CONTEXT_WINDOWS: JSON.stringify(modelContextWindows),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/proxy/providers/${GROK_OFFICIAL_PROVIDER_ID}`,
    ANTHROPIC_API_KEY: 'proxy-managed',
    ANTHROPIC_MODEL: GROK_OFFICIAL_PROVIDER.models.main,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: GROK_OFFICIAL_PROVIDER.models.haiku,
    ANTHROPIC_DEFAULT_SONNET_MODEL: GROK_OFFICIAL_PROVIDER.models.sonnet,
    ANTHROPIC_DEFAULT_OPUS_MODEL: GROK_OFFICIAL_PROVIDER.models.opus,
  };
}
