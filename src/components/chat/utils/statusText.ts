import type { TFunction } from 'i18next';

const DEFAULT_STATUS_TEXT: Record<string, string> = {
  'status.thinking': 'Thinking',
  'status.processing': 'Processing',
  'status.analyzing': 'Analyzing',
  'status.working': 'Working',
  'status.computing': 'Computing',
  'status.reasoning': 'Reasoning',
  'status.runningCode': 'Running code',
  'status.resuming': 'Resuming',
  'status.initializing': 'Initializing',
  'status.restarting': 'Restarting',
};

const STATUS_PATTERNS: Array<{ pattern: RegExp; key: keyof typeof DEFAULT_STATUS_TEXT }> = [
  { pattern: /^thinking$/i, key: 'status.thinking' },
  { pattern: /^processing$/i, key: 'status.processing' },
  { pattern: /^analy[sz]ing$/i, key: 'status.analyzing' },
  { pattern: /^working$/i, key: 'status.working' },
  { pattern: /^computing$/i, key: 'status.computing' },
  { pattern: /^reasoning$/i, key: 'status.reasoning' },
  { pattern: /^(running|runing|executing)\s+code$/i, key: 'status.runningCode' },
  { pattern: /^running$/i, key: 'status.processing' },
  { pattern: /^resuming$/i, key: 'status.resuming' },
  { pattern: /^initializing$/i, key: 'status.initializing' },
  { pattern: /^restarting$/i, key: 'status.restarting' },
];

function translateStatusKey(key: string, t: TFunction<'chat'>): string {
  const translated = t(key);
  if (translated && translated !== key) {
    return translated;
  }
  return DEFAULT_STATUS_TEXT[key] ?? key;
}

function normalizeStatusLookupValue(rawText: string): string {
  return rawText
    .trim()
    .replace(/^chat:/i, '')
    .replace(/\u2026/g, '...')
    .replace(/\.\.\.$/, '')
    .trim();
}

export function resolveChatStatusText(
  rawText: unknown,
  t: TFunction<'chat'>,
  fallbackKey: keyof typeof DEFAULT_STATUS_TEXT = 'status.thinking',
): string {
  const fallbackText = translateStatusKey(fallbackKey, t);

  if (typeof rawText !== 'string' || !rawText.trim()) {
    return fallbackText;
  }

  const originalText = rawText.trim();
  const lookupText = normalizeStatusLookupValue(originalText);
  if (!lookupText) {
    return fallbackText;
  }

  if (/^status\./i.test(lookupText)) {
    const translated = translateStatusKey(lookupText, t);
    return translated === lookupText ? fallbackText : translated;
  }

  const match = STATUS_PATTERNS.find(({ pattern }) => pattern.test(lookupText));
  if (match) {
    return translateStatusKey(match.key, t);
  }

  return originalText;
}

export function shouldAppendStatusEllipsis(statusText: string): boolean {
  return !/[.!?…]$/.test(statusText.trim());
}
