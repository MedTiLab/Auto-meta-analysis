import path from 'path';
import { resolveAppDataRoot } from '../utils/storagePaths.js';
import { getBackendPortSync } from '../utils/runtimePorts.js';
import { OPENAI_OFFICIAL_PROVIDER_ID } from '../providers/schema.js';
import { OPENAI_OFFICIAL_MODELS } from '../../shared/modelConstants.js';

export { OPENAI_OFFICIAL_PROVIDER_ID };
export const OPENAI_OFFICIAL_PROVIDER_NAME = 'ChatGPT Official';
export const OPENAI_OAUTH_PROVIDER_ENV_KEY = 'MEDHELP_OPENAI_OAUTH_PROVIDER';
export const OPENAI_CODEX_OAUTH_FILE_ENV_KEY = 'OPENAI_CODEX_OAUTH_FILE';

const modelContextWindows = Object.fromEntries(OPENAI_OFFICIAL_MODELS.CATALOG.map((model) => [
  model,
  model.startsWith('gpt-5.6-') ? 353400 : 258400,
]));

export const OPENAI_OFFICIAL_PROVIDER = {
  id: OPENAI_OFFICIAL_PROVIDER_ID,
  presetId: OPENAI_OFFICIAL_PROVIDER_ID,
  name: OPENAI_OFFICIAL_PROVIDER_NAME,
  apiKey: '',
  authStrategy: 'dual_dummy',
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  apiFormat: 'openai_responses',
  runtimeKind: 'openai_oauth',
  models: {
    main: OPENAI_OFFICIAL_MODELS.MAIN,
    haiku: OPENAI_OFFICIAL_MODELS.HAIKU,
    sonnet: OPENAI_OFFICIAL_MODELS.SONNET,
    opus: OPENAI_OFFICIAL_MODELS.MAIN,
  },
  modelContextWindows,
};

export function isOpenAIOfficialProviderId(id) {
  return id === OPENAI_OFFICIAL_PROVIDER_ID;
}

export function getOpenAIOAuthFilePath() {
  return path.join(resolveAppDataRoot(), 'llm', 'openai-oauth.json');
}

export function buildOpenAIOfficialRuntimeEnv() {
  const port = getBackendPortSync();
  return {
    [OPENAI_OAUTH_PROVIDER_ENV_KEY]: '1',
    [OPENAI_CODEX_OAUTH_FILE_ENV_KEY]: getOpenAIOAuthFilePath(),
    CLAUDE_CODE_MODEL_CONTEXT_WINDOWS: JSON.stringify(modelContextWindows),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/proxy/providers/${OPENAI_OFFICIAL_PROVIDER_ID}`,
    ANTHROPIC_API_KEY: 'proxy-managed',
    ANTHROPIC_MODEL: OPENAI_OFFICIAL_PROVIDER.models.main,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: OPENAI_OFFICIAL_PROVIDER.models.haiku,
    ANTHROPIC_DEFAULT_SONNET_MODEL: OPENAI_OFFICIAL_PROVIDER.models.sonnet,
    ANTHROPIC_DEFAULT_OPUS_MODEL: OPENAI_OFFICIAL_PROVIDER.models.opus,
  };
}
