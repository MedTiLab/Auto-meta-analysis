import { credentialsDb } from '../database/db.js';

export const MINERU_API_TOKEN_CREDENTIAL_TYPE = 'mineru_api_token';

function normalizeCredentialValue(value) {
  return String(value || '').trim();
}

function getStoredMinerUApiToken(userId) {
  if (!userId) return '';
  try {
    return normalizeCredentialValue(
      credentialsDb.getActiveCredential(userId, MINERU_API_TOKEN_CREDENTIAL_TYPE),
    );
  } catch (error) {
    console.warn('[mineru-credentials] Failed to read MinerU API token:', error.message);
    return '';
  }
}

export function getMinerUCredentials(userId, env = process.env) {
  const storedToken = getStoredMinerUApiToken(userId);
  if (storedToken) {
    return {
      apiToken: storedToken,
      configured: true,
      source: 'user_credential',
    };
  }

  const environmentToken = normalizeCredentialValue(
    env?.MINERU_API_TOKEN || env?.MINERU_API_KEY,
  );
  return {
    apiToken: environmentToken,
    configured: Boolean(environmentToken),
    source: environmentToken ? 'environment' : null,
  };
}

export function getMinerUCredentialStatus(userId, env = process.env) {
  const credentials = getMinerUCredentials(userId, env);
  return {
    configured: credentials.configured,
    source: credentials.source,
  };
}

export function saveMinerUApiToken(userId, apiToken) {
  const normalizedToken = normalizeCredentialValue(apiToken);
  if (!normalizedToken) {
    throw new Error('MinerU API token is required');
  }

  const credential = credentialsDb.createCredential(
    userId,
    'MinerU API Token',
    MINERU_API_TOKEN_CREDENTIAL_TYPE,
    normalizedToken,
    'Saved from Settings for MinerU parsing and agent SDK sessions',
  );

  for (const previous of credentialsDb.getCredentials(userId, MINERU_API_TOKEN_CREDENTIAL_TYPE)) {
    if (String(previous.id) !== String(credential.id) && previous.is_active) {
      credentialsDb.toggleCredential(userId, previous.id, false);
    }
  }

  return getMinerUCredentialStatus(userId);
}
