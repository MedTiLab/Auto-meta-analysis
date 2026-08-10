import { sessionDb, tagDb } from '../database/db.js';
import { encodeProjectPath } from '../projects.js';

function defaultSessionName(provider) {
  return 'New Session';
}

function normalizeStageTagKeys(stageTagKeys = []) {
  const allowedKeys = new Set([
    'literature',
    'ideation',
    'experiment',
    'publication',
    'promotion',
    'protocol',
    'search_dedupe',
    'title_abstract_screening',
    'full_text_review',
    'data_extraction',
    'quality_assessment',
    'data_analysis',
    'results_figures',
    'manuscript_submission',
    'presentation',
  ]);
  const aliases = {
    survey: 'literature',
    research: 'literature',
    search: 'search_dedupe',
    dedupe: 'search_dedupe',
    'search-dedupe': 'search_dedupe',
    title_abstract: 'title_abstract_screening',
    'title-abstract-screening': 'title_abstract_screening',
    full_text: 'full_text_review',
    fulltext: 'full_text_review',
    'full-text-review': 'full_text_review',
    pdf: 'full_text_review',
    mineru: 'full_text_review',
    extraction: 'data_extraction',
    'data-extraction': 'data_extraction',
    quality: 'quality_assessment',
    'quality-assessment': 'quality_assessment',
    statistics: 'data_analysis',
    statistical_pooling: 'data_analysis',
    'data-analysis': 'data_analysis',
    figures: 'results_figures',
    results: 'results_figures',
    'results-figures': 'results_figures',
    manuscript: 'manuscript_submission',
    submission: 'manuscript_submission',
    'manuscript-submission': 'manuscript_submission',
  };
  const normalized = Array.from(new Set(
    (Array.isArray(stageTagKeys) ? stageTagKeys : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .map((value) => aliases[value] || value)
      .filter((value) => allowedKeys.has(value))
  ));

  return normalized;
}

export function applyStageTagsToSession({
  sessionId,
  projectPath = null,
  projectName = null,
  stageTagKeys = [],
  source = 'chat_context',
  linkedBy = null,
}) {
  if (!sessionId) {
    return [];
  }

  const normalizedStageTagKeys = normalizeStageTagKeys(stageTagKeys);
  if (normalizedStageTagKeys.length === 0) {
    return [];
  }

  const resolvedProjectName = projectName || (projectPath ? encodeProjectPath(projectPath) : null);
  if (!resolvedProjectName) {
    return [];
  }

  tagDb.ensureDefaultStageTags(resolvedProjectName);
  return tagDb.appendSessionTagsByKeys(sessionId, resolvedProjectName, 'stage', normalizedStageTagKeys, {
    source,
    linkedBy,
  });
}

export function recordIndexedSession({
  sessionId,
  provider,
  projectPath,
  sessionMode = 'research',
  displayName = null,
  lastActivity = null,
  stageTagKeys = [],
  tagSource = 'chat_context',
  linkedBy = null,
}) {
  if (!sessionId || !provider || !projectPath) {
    return;
  }

  const projectName = encodeProjectPath(projectPath);
  sessionDb.upsertSessionPlaceholder(
    sessionId,
    projectName,
    provider,
    displayName || defaultSessionName(provider),
    lastActivity || new Date().toISOString(),
    {
      sessionMode,
      projectPath,
      indexState: 'placeholder',
    },
  );

  // Dual-path tag application: tags are also applied at spawn start (in the CLI modules)
  // for immediate tagging of existing sessions. This second call ensures tags are applied
  // for newly created sessions. INSERT OR IGNORE in appendSessionTagsByKeys prevents duplicates.
  applyStageTagsToSession({
    sessionId,
    projectPath,
    projectName,
    stageTagKeys,
    source: tagSource,
    linkedBy,
  });
}
