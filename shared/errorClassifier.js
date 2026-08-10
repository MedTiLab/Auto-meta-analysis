/**
 * Shared error classification for all agent providers.
 * Single source of truth for error type detection and retryability.
 */

export const ERROR_TYPES = /** @type {const} */ ({
  USAGE_LIMIT: 'usage_limit',
  OVERLOADED: 'overloaded',
  NETWORK: 'network',
  AUTH: 'auth',
  UNKNOWN: 'unknown',
});

const RE_USAGE_LIMIT = /usage[_ ]limit|usage quota|rate[_ ]limit|Too Many Requests|\b429\b|RESOURCE_EXHAUSTED|capacity exhausted|quota/i;
const RE_OVERLOADED = /overloaded|MODEL_CAPACITY_EXHAUSTED|No capacity available|server[_ ]error/i;
const RE_NETWORK = /network|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket hang up/i;
const RE_AUTH = /\bauth\b|unauthorized|forbidden|authentication[_ ]failed|billing[_ ]error|invalid[_ ]api[_ ]key/i;

function makeResult(errorType) {
  return { errorType, isRetryable: errorType !== ERROR_TYPES.AUTH };
}

/** @param {string} message */
export function classifyError(message) {
  const msg = String(message || '');

  if (RE_USAGE_LIMIT.test(msg)) return makeResult(ERROR_TYPES.USAGE_LIMIT);
  if (RE_OVERLOADED.test(msg)) return makeResult(ERROR_TYPES.OVERLOADED);
  if (RE_NETWORK.test(msg)) return makeResult(ERROR_TYPES.NETWORK);
  if (RE_AUTH.test(msg)) return makeResult(ERROR_TYPES.AUTH);

  return makeResult(ERROR_TYPES.UNKNOWN);
}

export const TRANSIENT_ERROR_TYPES = /** @type {const} */ ([
  ERROR_TYPES.NETWORK,
  ERROR_TYPES.OVERLOADED,
]);

/**
 * Claude SDK error code → ERROR_TYPES mappings.
 *
 * Claude (AssistantMessageError):
 *   'authentication_failed' | 'billing_error' | 'rate_limit' |
 *   'invalid_request' | 'server_error' | 'max_output_tokens' | 'unknown'
 */
const CLAUDE_ERROR_MAP = {
  rate_limit: ERROR_TYPES.USAGE_LIMIT,
  authentication_failed: ERROR_TYPES.AUTH,
  billing_error: ERROR_TYPES.AUTH,
  server_error: ERROR_TYPES.OVERLOADED,
  invalid_request: ERROR_TYPES.UNKNOWN,
  max_output_tokens: ERROR_TYPES.UNKNOWN,
  unknown: ERROR_TYPES.UNKNOWN,
};

const PROVIDER_ERROR_MAPS = {
  claude: CLAUDE_ERROR_MAP,
};

/**
 * Classify from a provider SDK structured error code.
 * @param {string} sdkErrorCode - e.g. 'rate_limit', 'rate_limit_exceeded', 'RESOURCE_EXHAUSTED'
 * @param {'claude'} [provider] - provider name for precise mapping; omit to search all
 * @returns {{ errorType: string, isRetryable: boolean }}
 */
export function classifySDKError(sdkErrorCode, provider) {
  let errorType;

  if (provider && PROVIDER_ERROR_MAPS[provider]) {
    errorType = PROVIDER_ERROR_MAPS[provider][sdkErrorCode];
  } else {
    for (const map of Object.values(PROVIDER_ERROR_MAPS)) {
      errorType = map[sdkErrorCode];
      if (errorType) break;
    }
  }

  return makeResult(errorType || ERROR_TYPES.UNKNOWN);
}
