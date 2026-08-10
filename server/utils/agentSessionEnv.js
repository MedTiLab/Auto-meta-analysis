import { agentApiProfilesDb, credentialsDb, userDb } from '../database/db.js';
import { getMinerUCredentials } from './mineruCredentials.js';
import { DEFAULT_BACKEND_PORT, getBackendPortSync, parsePortNumber } from './runtimePorts.js';
import { getProviderConfigDir } from '../services/providerService.js';
import { mergeActiveProviderManagedEnv, readProviderSettingsEnv } from '../services/providerRuntimeEnv.js';

function normalizeEnvValue(value) {
  const text = String(value || '').trim();
  return text || null;
}

export function withZoteroWebCredentialEnv(baseEnv = process.env, userId = null) {
  const env = { ...(baseEnv || {}) };
  if (!userId) return env;

  try {
    const apiKey = normalizeEnvValue(credentialsDb.getActiveCredential(userId, 'zotero_api_key'));
    const zoteroUserId = normalizeEnvValue(credentialsDb.getActiveCredential(userId, 'zotero_user_id'));

    if (apiKey) env.ZOTERO_API_KEY = apiKey;
    if (zoteroUserId) env.ZOTERO_USER_ID = zoteroUserId;
  } catch (error) {
    console.warn('[agent-session-env] Failed to load Zotero credentials for agent env:', error.message);
  }

  return env;
}

export function withMinerUCredentialEnv(baseEnv = process.env, userId = null) {
  const env = { ...(baseEnv || {}) };
  const credentials = getMinerUCredentials(userId, env);
  if (credentials.apiToken) {
    env.MINERU_API_TOKEN = credentials.apiToken;
  }
  return env;
}

function resolveMedHelpApiBaseUrl(baseEnv = process.env) {
  const explicit = normalizeEnvValue(baseEnv.MEDHELP_API_BASE_URL || baseEnv.MEDAUTODATA_API_BASE_URL);
  if (explicit) return explicit.replace(/\/+$/, '');

  const fallbackPort = parsePortNumber(baseEnv.PORT, DEFAULT_BACKEND_PORT);
  const port = getBackendPortSync(fallbackPort);
  return `http://127.0.0.1:${port}`;
}

export function withMedHelpApiEnv(baseEnv = process.env, userId = null) {
  const env = { ...(baseEnv || {}) };
  env.MEDHELP_API_BASE_URL = resolveMedHelpApiBaseUrl(env);

  if (!userId) return env;

  try {
    const user = userDb.getUserById(userId);
    if (!user) return env;

    env.MEDHELP_USER_ID = String(user.id);
    if (user.username) env.MEDHELP_USERNAME = user.username;
  } catch (error) {
    console.warn('[agent-session-env] Failed to build MedHelp API env for agent:', error.message);
  }

  return env;
}

export function withAgentApiProfileEnv(baseEnv = process.env, userId = null) {
  const env = { ...(baseEnv || {}) };
  if (!userId) return env;

  try {
    const profile = agentApiProfilesDb.resolveForUser(userId);
    if (!profile) return env;

    const secret = normalizeEnvValue(profile.secret);
    const baseUrl = normalizeEnvValue(profile.baseUrl);
    const runtimeModel = normalizeEnvValue(profile.runtimeModel);

    if (secret) {
      if (profile.authType === 'auth_token') {
        env.ANTHROPIC_AUTH_TOKEN = secret;
        delete env.ANTHROPIC_API_KEY;
      } else {
        env.ANTHROPIC_API_KEY = secret;
        delete env.ANTHROPIC_AUTH_TOKEN;
      }
    }

    if (baseUrl) {
      env.ANTHROPIC_BASE_URL = baseUrl.replace(/\/+$/, '');
      env.ANTHROPIC_API_URL = env.ANTHROPIC_BASE_URL;
    }

    if (runtimeModel) {
      env.ANTHROPIC_MODEL = runtimeModel;
    }

    env.MEDHELP_AGENT_API_PROFILE_ID = String(profile.id);
    env.MEDHELP_AGENT_API_PROFILE_NAME = profile.name;
    env.MEDHELP_AGENT_API_PROFILE_SCOPE = profile.scope;
  } catch (error) {
    console.warn('[agent-session-env] Failed to load agent API profile for agent env:', error.message);
  }

  return env;
}

export function withActiveLlmProviderEnv(baseEnv = process.env) {
  const configDir = getProviderConfigDir();
  return mergeActiveProviderManagedEnv(
    { ...(baseEnv || {}), ...readProviderSettingsEnv(configDir) },
    configDir,
    { serverPort: getBackendPortSync() },
  );
}

export function buildAgentSessionEnv(userId = null, baseEnv = process.env) {
  const envWithZotero = withZoteroWebCredentialEnv(baseEnv, userId);
  const envWithMinerU = withMinerUCredentialEnv(envWithZotero, userId);
  const envWithMedHelp = withMedHelpApiEnv(envWithMinerU, userId);
  const envWithLegacyApiProfile = withAgentApiProfileEnv(envWithMedHelp, userId);
  return withActiveLlmProviderEnv(envWithLegacyApiProfile);
}
