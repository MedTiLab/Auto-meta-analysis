export const MODEL_CONTEXT_WINDOWS_ENV_KEY = 'CLAUDE_CODE_MODEL_CONTEXT_WINDOWS';

export function normalizeModelStringForApi(model) {
  return String(model || '')
    .trim()
    .replace(/\[1m\]$/i, '')
    .replace(/:1m$/i, '')
    .trim();
}

export function joinOpenAIEndpoint(baseUrl, endpoint) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/${endpoint}` : `${base}/v1/${endpoint}`;
}
