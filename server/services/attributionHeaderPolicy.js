export const ATTRIBUTION_HEADER_ENV_KEY = 'CLAUDE_CODE_ATTRIBUTION_HEADER';

export function isClaudeModelName(modelName) {
  return typeof modelName === 'string' && modelName.trim().toLowerCase().startsWith('claude');
}

export function attributionHeaderEnvForModel(modelName) {
  const normalizedModel = modelName?.trim();
  if (!normalizedModel) return {};
  return {
    [ATTRIBUTION_HEADER_ENV_KEY]: isClaudeModelName(normalizedModel) ? '1' : '0',
  };
}
