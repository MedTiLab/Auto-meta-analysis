export const INTERNAL_PROJECT_ROOT_FILENAMES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'instance.json',
  'pipeline_config.json',
  'research_brief.json',
  'tasks.json',
]);

export function normalizeProjectRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

export function isInternalProjectPath(relativePath) {
  const normalized = normalizeProjectRelativePath(relativePath);
  if (!normalized) {
    return false;
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) {
    return true;
  }

  return segments.length === 1 && INTERNAL_PROJECT_ROOT_FILENAMES.has(segments[0]);
}
