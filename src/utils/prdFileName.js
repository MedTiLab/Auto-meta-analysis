const SUPPORTED_PRD_FILE_SUFFIX = /\.(txt|md|json)$/i;

export function buildDefaultPrdFileName(now = new Date()) {
  const dateStr = now.toISOString().split('T')[0];
  return `prd-${dateStr}.txt`;
}

export function normalizePrdFileName(fileName) {
  const trimmed = String(fileName || '').trim();
  if (!trimmed) {
    return '';
  }

  return SUPPORTED_PRD_FILE_SUFFIX.test(trimmed)
    ? trimmed
    : `${trimmed}.txt`;
}

export function getInitialPrdFileName(fileName, isNewFile, now = new Date()) {
  if (isNewFile) {
    return buildDefaultPrdFileName(now);
  }

  const trimmed = String(fileName || '').trim();
  if (trimmed) {
    return trimmed;
  }

  return buildDefaultPrdFileName(now);
}
