/**
 * Centralized Model Definitions
 * Single source of truth for all supported AI models
 */

export const DEFAULT_CONTEXT_WINDOW = 1000000;

function parseContextWindow(value, fallback = DEFAULT_CONTEXT_WINDOW) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const CLAUDE_DEFAULT_MODEL = 'opus';

const CLAUDE_MODEL_PLAN_VALUES = new Set(['free', 'plus', 'pro']);
const MEMBERSHIP_PLAN_TO_CLAUDE_PLAN = {
  free: 'free',
  lite: 'free',
  plus: 'plus',
  pro: 'pro',
  lifetime: 'pro',
};
const CLAUDE_MODEL_PLAN_RANK = {
  free: 0,
  plus: 1,
  pro: 2,
};

const CLAUDE_LEGACY_MODEL_TO_PLAN = [
  { pattern: /^(haiku|claude-.*haiku)/i, plan: 'free' },
  { pattern: /^(sonnet|claude-.*sonnet)/i, plan: 'plus' },
  { pattern: /^(opus|opusplan|claude-.*opus)/i, plan: 'pro' },
];

const CLAUDE_PLAN_TO_FALLBACK_MODEL = {
  free: 'haiku',
  plus: 'sonnet',
  pro: 'opus',
};

const CLAUDE_ALIAS_MODELS = new Set(['sonnet', 'opus', 'haiku', 'opusplan', 'sonnet[1m]']);

function readEnvValue(env, key) {
  return env && typeof env === 'object' ? env[key] : undefined;
}

export function normalizeClaudeStoredModelSelection(model) {
  const normalized = typeof model === 'string' ? model.trim() : '';

  if (!normalized) {
    return CLAUDE_MODELS.DEFAULT;
  }

  const lower = normalized.toLowerCase();
  if (lower === 'free') {
    return 'haiku';
  }
  if (lower === 'plus') {
    return 'sonnet';
  }
  if (lower === 'pro') {
    return 'opus';
  }

  return normalized;
}

export function resolveClaudeModelSelection(model, env = typeof process !== 'undefined' ? process.env : undefined) {
  const normalized = normalizeClaudeStoredModelSelection(model);
  return normalized || readEnvValue(env, 'ANTHROPIC_MODEL') || CLAUDE_MODELS.DEFAULT;
}

export function isClaudeModelSelectionSupported(model) {
  const normalized = typeof model === 'string' ? model.trim() : '';
  return CLAUDE_ALIAS_MODELS.has(normalized)
    || /^claude-(?:opus|sonnet|haiku|\d)[A-Za-z0-9._-]*$/i.test(normalized);
}

export function normalizeMembershipPlan(value, fallback = 'free') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return MEMBERSHIP_PLAN_TO_CLAUDE_PLAN[normalized] || fallback;
}

export function getClaudePlanForMembership(membershipPlan) {
  return normalizeMembershipPlan(membershipPlan, 'free');
}

export function getClaudePlanRank(plan) {
  const normalized = typeof plan === 'string' ? plan.trim().toLowerCase() : '';
  let planKey = CLAUDE_MODEL_PLAN_VALUES.has(normalized) ? normalized : null;
  if (!planKey) {
    planKey = CLAUDE_LEGACY_MODEL_TO_PLAN.find(({ pattern }) => pattern.test(normalized))?.plan || 'pro';
  }
  return CLAUDE_MODEL_PLAN_RANK[planKey] ?? 0;
}

export function enforceClaudeModelForMembership(model, membershipPlan) {
  const requestedModel = normalizeClaudeStoredModelSelection(model || CLAUDE_MODELS.DEFAULT);
  const maxModelPlan = getClaudePlanForMembership(membershipPlan);
  const allowed = getClaudePlanRank(requestedModel) <= getClaudePlanRank(maxModelPlan);
  const resolvedModel = allowed ? requestedModel : CLAUDE_PLAN_TO_FALLBACK_MODEL[maxModelPlan];

  return {
    model: resolvedModel,
    requestedModel,
    membershipPlan: normalizeMembershipPlan(membershipPlan, 'free'),
    changed: requestedModel !== resolvedModel,
  };
}

export const CLAUDE_MODELS = {
  OPTIONS: [
    { value: 'sonnet', label: 'Sonnet', contextLength: 1000000 },
    { value: 'opus', label: 'Opus (Auto, currently 5)', contextLength: 1000000 },
    { value: 'haiku', label: 'Haiku', contextLength: 200000 },
    { value: 'opusplan', label: 'Opus (Plan Mode Only)', contextLength: 1000000 },
    { value: 'sonnet[1m]', label: 'Sonnet [1M]', contextLength: 1000000 },
    { value: 'claude-opus-5', label: 'Opus 5 (Pinned)', contextLength: 1000000 },
    { value: 'claude-opus-4-8', label: 'Opus 4.8 (Pinned)', contextLength: 1000000 },
    { value: 'claude-opus-4-7', label: 'Opus 4.7 (Pinned)', contextLength: 1000000 },
    { value: 'claude-opus-4-6', label: 'Opus 4.6 (Pinned)', contextLength: 1000000 },
  ],

  DEFAULT: CLAUDE_DEFAULT_MODEL
};

export const OPENAI_OFFICIAL_MODELS = {
  MAIN: 'gpt-5.6-sol',
  HAIKU: 'gpt-5.6-luna',
  SONNET: 'gpt-5.6-terra',
  CATALOG: [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.3-codex',
    'gpt-5.4',
    'gpt-5.5',
    'gpt-5.4-mini',
  ],
};

export const GROK_OFFICIAL_MODELS = {
  MAIN: 'grok-4.5',
  FAST: 'grok-composer-2.5-fast',
};

export function getClaudeModelOptionsForMembership(membershipPlan) {
  const currentRank = getClaudePlanRank(getClaudePlanForMembership(membershipPlan));
  return CLAUDE_MODELS.OPTIONS.filter((option) => getClaudePlanRank(option.value) <= currentRank);
}

export function getRequestableClaudePlansForMembership(membershipPlan) {
  const currentRank = getClaudePlanRank(getClaudePlanForMembership(membershipPlan));
  return ['free', 'plus', 'pro'].filter((plan) => getClaudePlanRank(plan) > currentRank);
}

export function getContextWindowForModel(modelName, fallback = DEFAULT_CONTEXT_WINDOW) {
  const normalized = String(modelName || '').trim();
  if (!normalized) {
    return fallback;
  }

  const MODEL_CONTEXT_WINDOWS = {
    'deepseek': DEFAULT_CONTEXT_WINDOW,
    'deepseek-chat': DEFAULT_CONTEXT_WINDOW,
    'deepseek-reasoner': DEFAULT_CONTEXT_WINDOW,
    'opus': 200000,
    'sonnet': 200000,
    'haiku': 200000,
    'pro': 200000,
    'plus': 200000,
    'free': 200000,
    'claude-opus-4-7': 200000,
    'claude-opus-4-6': 200000,
    'claude-opus-4-5': 200000,
    'claude-opus-4-5-20251101': 200000,
    'claude-opus-4-1': 200000,
    'claude-opus-4-1-20250805': 200000,
    'claude-opus-4-0': 200000,
    'claude-opus-4-20250918': 200000,
    'claude-sonnet-4-6': 200000,
    'claude-sonnet-4-20250514': 200000,
    'claude-haiku-4-5': 200000,
    'claude-haiku-4-5-20251001': 200000,
    'claude-3-5-sonnet': 200000,
    'claude-3-5-sonnet-20241022': 200000,
    'claude-3-5-haiku': 200000,
    'claude-3-5-haiku-20241022': 200000,
    'claude-3-opus': 200000,
    'claude-3-opus-20240229': 200000,
    'claude-3-sonnet': 200000,
    'claude-3-haiku': 200000,
  };

  if (MODEL_CONTEXT_WINDOWS[normalized]) {
    return MODEL_CONTEXT_WINDOWS[normalized];
  }

  const prefix = Object.keys(MODEL_CONTEXT_WINDOWS).find((key) => normalized.startsWith(key));
  return prefix ? MODEL_CONTEXT_WINDOWS[prefix] : fallback;
}

export function getConfiguredContextWindow(envValue, fallback = DEFAULT_CONTEXT_WINDOW) {
  return parseContextWindow(envValue, fallback);
}
