import { projectDb, userPreferenceMemoryDb } from '../database/db.js';

export const USER_PREFERENCE_MEMORY_MAX_ITEMS = 20;
export const USER_PREFERENCE_MEMORY_MAX_CONTENT_LENGTH = 300;
export const USER_PREFERENCE_MEMORY_CATEGORIES = ['general', 'preference', 'context', 'workflow'];
export const USER_PREFERENCE_MEMORY_SCOPES = ['user', 'meta', 'project'];
export const ANALYSIS_LANGUAGE_PREFERENCES = ['auto', 'python', 'r'];

export function normalizeUserPreferenceMemoryCategory(category) {
  const normalized = typeof category === 'string' ? category.trim().toLowerCase() : '';
  return USER_PREFERENCE_MEMORY_CATEGORIES.includes(normalized) ? normalized : 'general';
}

export function normalizeUserPreferenceMemoryScope(scope) {
  const normalized = typeof scope === 'string' ? scope.trim().toLowerCase() : '';
  return USER_PREFERENCE_MEMORY_SCOPES.includes(normalized) ? normalized : 'user';
}

export function normalizeUserPreferenceProjectKind(projectKind) {
  const normalized = typeof projectKind === 'string' ? projectKind.trim().toLowerCase() : '';
  if (normalized === 'meta' || normalized === 'meta_analysis' || normalized === 'meta-analysis') {
    return 'meta';
  }
  return '';
}

function resolveUserPreferenceProjectKind(userId, projectPath, explicitProjectKind) {
  const normalizedExplicitKind = normalizeUserPreferenceProjectKind(explicitProjectKind);
  if (normalizedExplicitKind) {
    return normalizedExplicitKind;
  }

  const normalizedProjectPath = typeof projectPath === 'string' ? projectPath.trim() : '';
  if (!normalizedProjectPath) {
    return '';
  }

  const project = projectDb.getProjectByPath(normalizedProjectPath, userId)
    || projectDb.getProjectByPath(normalizedProjectPath);
  return normalizeUserPreferenceProjectKind(project?.metadata?.projectKind) || 'meta';
}

export function sanitizeUserPreferenceMemoryContent(content) {
  return String(content || '')
    .replace(/<\/?user_preferences>/gi, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAnalysisLanguagePreference(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ANALYSIS_LANGUAGE_PREFERENCES.includes(normalized) ? normalized : 'auto';
}

export function buildAnalysisLanguagePreferenceBlock(options = {}) {
  const analysisLanguage = normalizeAnalysisLanguagePreference(options.analysisLanguage);
  if (analysisLanguage === 'auto') {
    return '';
  }

  const preferenceLine = analysisLanguage === 'r'
    ? '- Prefer R for statistical analysis code, scripts, package choices, and runnable examples unless the user explicitly asks for another language.'
    : '- Prefer Python for data analysis code, scripts, package choices, and runnable examples unless the user explicitly asks for another language.';

  return [
    '<analysis_preferences>',
    'Preferred analysis language for this conversation:',
    preferenceLine,
    'Apply this only when the task involves code, data analysis, or an executable workflow.',
    '</analysis_preferences>',
  ].join('\n');
}

export function buildUserPreferenceMemoryBlock(userId, options = {}) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return '';
  }

  if (!userPreferenceMemoryDb.getMemoryEnabled(normalizedUserId)) {
    return '';
  }

  const requestedLimit = Number.isFinite(options.maxItems)
    ? Math.floor(Number(options.maxItems))
    : 4;
  const maxItems = Math.max(1, Math.min(5, requestedLimit));
  const normalizedProjectPath = typeof options.projectPath === 'string' ? options.projectPath.trim() : '';
  const normalizedProjectKind = resolveUserPreferenceProjectKind(
    normalizedUserId,
    normalizedProjectPath,
    options.projectKind,
  );
  const memories = userPreferenceMemoryDb.getEnabled(normalizedUserId, {
    limit: maxItems,
    projectPath: normalizedProjectPath || null,
    projectKind: normalizedProjectKind || null,
  });

  if (!Array.isArray(memories) || memories.length === 0) {
    return '';
  }

  const lines = ['<user_preferences>', 'Saved user preferences:'];

  for (const memory of memories) {
    const sanitizedContent = sanitizeUserPreferenceMemoryContent(memory?.content);
    if (!sanitizedContent) {
      continue;
    }

    const categoryPrefix = memory?.category && memory.category !== 'general'
      ? `[${memory.category}] `
      : '';
    let scopePrefix = '';
    if (memory?.scope === 'project') {
      scopePrefix = '[project] ';
    } else if (memory?.scope === 'meta') {
      scopePrefix = '[meta project] ';
    }
    lines.push(`- ${scopePrefix}${categoryPrefix}${sanitizedContent}`);
  }

  if (lines.length <= 2) {
    return '';
  }

  lines.push('Honor these preferences when relevant, but always follow the user\'s explicit request first.');
  lines.push('</user_preferences>');

  return lines.join('\n');
}

export function prependUserPreferenceMemoryToPrompt(prompt, userId, options = {}) {
  const promptText = typeof prompt === 'string' ? prompt : '';
  const hasUserPreferencesBlock = /<user_preferences>[\s\S]*?(?:<\/user_preferences>|$)/i.test(promptText);
  const hasAnalysisPreferencesBlock = /<analysis_preferences>[\s\S]*?(?:<\/analysis_preferences>|$)/i.test(promptText);

  const prefixBlocks = [];

  if (!hasAnalysisPreferencesBlock) {
    const analysisBlock = buildAnalysisLanguagePreferenceBlock(options);
    if (analysisBlock) {
      prefixBlocks.push(analysisBlock);
    }
  }

  if (!hasUserPreferencesBlock) {
    const memoryBlock = buildUserPreferenceMemoryBlock(userId, options);
    if (memoryBlock) {
      prefixBlocks.push(memoryBlock);
    }
  }

  if (prefixBlocks.length === 0) {
    return promptText;
  }

  const body = promptText.trim() || options.fallbackCommand || 'Continue with the current task.';
  return `${prefixBlocks.join('\n\n')}\n\n${body}`;
}
