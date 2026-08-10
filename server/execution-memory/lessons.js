import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

import { buildExecutionPromptContext, readExecutionMemorySnapshot } from './summary.js';

const RESEARCH_LESSONS_VERSION = 1;
const MAX_EVIDENCE_ITEMS = 5;
const DEFAULT_PROMPT_LESSON_LIMIT = 3;

const CORRECTION_CUE_PATTERNS = [
  /错|不对|有误|核对|检查|确认|重新|别再|以后|记住|务必|必须|先/i,
  /不能直接|不要直接|不要凭|先不要|先核对|先确认/i,
  /\bwrong\b|\bincorrect\b|\bverify\b|\bdouble-check\b|\bdo not\b|\bdon't\b|\bmust\b|\bbefore\b/i,
];

const RESEARCH_LESSON_RULES = [
  {
    slug: 'verify-variable-coding-before-binary-definitions',
    title: 'Verify coding before binary exposure definitions',
    category: 'data-definition',
    severity: 'high',
    stageHints: ['experiment'],
    summary: 'Before defining binary exposures or outcomes, verify the original variable coding and source codebook instead of inferring the meaning of 0/1 values from column names alone.',
    trigger: 'When deriving binary exposures or coded outcomes from survey, questionnaire, or registry fields.',
    correctPattern: 'Check the original coding, questionnaire labels, and codebook first; only then derive binary categories.',
    matches(text, lowerText, hasCorrectionCue) {
      return hasCorrectionCue
        && /编码|codebook|问卷|变量定义|原始编码|0\/1|1\/0|binary/i.test(text)
        && /核对|确认|检查|verify|double-check|先/i.test(text);
    },
  },
  {
    slug: 'harmonize-units-and-thresholds-before-comparison',
    title: 'Harmonize units and thresholds before comparison',
    category: 'unit-threshold',
    severity: 'high',
    stageHints: ['experiment'],
    summary: 'Do not compare biomarker thresholds or prevalence across datasets until units and cutoffs are harmonized.',
    trigger: 'When comparing biomarkers, laboratory values, or thresholds across cohorts.',
    correctPattern: 'Confirm unit systems, conversion factors, and cutoffs before computing cross-cohort results.',
    matches(text, lowerText, hasCorrectionCue) {
      return hasCorrectionCue
        && /单位|阈值|cutoff|cut-off|换算|mg\/dl|mg\/l|mmol|unit/i.test(lowerText)
        && /核对|确认|统一|换算|verify|harmonize|convert|先/i.test(text);
    },
  },
  {
    slug: 'verify-sample-size-and-table-outputs-against-source-data',
    title: 'Verify sample sizes and tables against source data',
    category: 'data-qc',
    severity: 'high',
    stageHints: ['experiment'],
    summary: 'Critical counts, Table 1 outputs, and cohort sizes should be checked back against the source data before reporting.',
    trigger: 'When reporting baseline tables, sample sizes, exclusions, or summary counts.',
    correctPattern: 'Recompute key counts from source data and verify Table 1 style outputs before writing the report.',
    matches(text, lowerText, hasCorrectionCue) {
      return hasCorrectionCue
        && /样本量|人数|table ?1|baseline|cohort|n=|例数|counts?/i.test(lowerText)
        && /核对|确认|检查|回源|重新算|verify|recompute|double-check/i.test(text);
    },
  },
  {
    slug: 'run-adjusted-analyses-before-transportability-claims',
    title: 'Run adjusted analyses before transportability claims',
    category: 'method-selection',
    severity: 'high',
    stageHints: ['experiment', 'publication'],
    summary: 'Do not claim transportability, paradoxes, or exposure-context heterogeneity from crude results alone; adjustment and sensitivity analyses must come first.',
    trigger: 'When writing cross-population interpretation or apparent paradox claims.',
    correctPattern: 'Complete adjusted, matched, or sensitivity analyses before making transportability or heterogeneity claims.',
    matches(text, lowerText, hasCorrectionCue) {
      return hasCorrectionCue
        && /调整|adjusted|psm|匹配|混杂|敏感性|sensitivity|confound/i.test(lowerText)
        && /transportability|transportable|外推|paradox|异质性|heterogeneity|不能直接下结论|不要直接下结论|crude/i.test(lowerText);
    },
  },
  {
    slug: 'harmonize-cross-population-definitions-before-comparison',
    title: 'Harmonize definitions before cross-population comparison',
    category: 'cross-dataset-harmonization',
    severity: 'medium',
    stageHints: ['experiment', 'publication'],
    summary: 'Cross-population comparisons should only be interpreted after exposure, outcome, and covariate definitions are made comparable.',
    trigger: 'When comparing results across cohorts, countries, or survey systems.',
    correctPattern: 'Harmonize exposure, outcome, and covariate definitions before interpreting cross-population differences.',
    matches(text, lowerText, hasCorrectionCue) {
      return hasCorrectionCue
        && /跨人群|跨数据集|跨队列|跨队伍|nhanes|charls|population|cohort|dataset/i.test(lowerText)
        && /统一|可比|一致|harmonize|comparable|transportability|transportable/i.test(lowerText);
    },
  },
];

function createEmptyResearchLessonsState() {
  return {
    version: RESEARCH_LESSONS_VERSION,
    updatedAt: null,
    items: [],
  };
}

function getResearchLessonsPaths(projectPath) {
  return {
    jsonPath: projectPath ? path.join(projectPath, '.pipeline', 'docs', 'research_lessons.json') : null,
    markdownPath: projectPath ? path.join(projectPath, '.pipeline', 'docs', 'research_lessons.md') : null,
  };
}

async function readResearchLessons(projectPath) {
  const paths = getResearchLessonsPaths(projectPath);
  if (!paths.jsonPath) {
    return createEmptyResearchLessonsState();
  }

  try {
    const raw = await fs.readFile(paths.jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeResearchLessonsState(parsed);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return createEmptyResearchLessonsState();
    }
    throw error;
  }
}

async function writeResearchLessons(projectPath, state) {
  const paths = getResearchLessonsPaths(projectPath);
  if (!paths.jsonPath || !paths.markdownPath) {
    return null;
  }

  const normalizedState = normalizeResearchLessonsState(state);
  normalizedState.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(paths.jsonPath), { recursive: true });
  await Promise.all([
    fs.writeFile(paths.jsonPath, `${JSON.stringify(normalizedState, null, 2)}\n`, 'utf8'),
    fs.writeFile(paths.markdownPath, buildResearchLessonsMarkdown(normalizedState), 'utf8'),
  ]);
  return {
    ...paths,
    state: normalizedState,
  };
}

async function captureResearchLessonsFromText(projectPath, text, meta = {}) {
  if (!projectPath) {
    return { synced: false, items: [] };
  }

  const candidates = extractResearchLessonCandidates(text, meta);
  if (candidates.length === 0) {
    return { synced: false, items: [] };
  }

  const state = await readResearchLessons(projectPath);
  const updatedItems = [];

  for (const candidate of candidates) {
    const existing = state.items.find((item) => item.slug === candidate.slug);
    if (existing) {
      existing.updatedAt = new Date().toISOString();
      existing.lastSeenAt = new Date().toISOString();
      existing.timesSeen = Number.isFinite(existing.timesSeen) ? existing.timesSeen + 1 : 2;
      existing.status = resolveLessonStatus(existing.status, candidate.status);
      existing.stageHints = dedupeStrings([
        ...(Array.isArray(existing.stageHints) ? existing.stageHints : []),
        ...(Array.isArray(candidate.stageHints) ? candidate.stageHints : []),
      ]);
      existing.evidence = mergeEvidence(existing.evidence, candidate.evidence);
      if (!existing.summary && candidate.summary) {
        existing.summary = candidate.summary;
      }
      if (!existing.correctPattern && candidate.correctPattern) {
        existing.correctPattern = candidate.correctPattern;
      }
      updatedItems.push(existing);
      continue;
    }

    const lesson = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      timesSeen: 1,
      ...candidate,
    };
    state.items.push(lesson);
    updatedItems.push(lesson);
  }

  state.items.sort((left, right) => {
    const scoreDelta = scoreLesson(right) - scoreLesson(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
  });

  const result = await writeResearchLessons(projectPath, state);
  return {
    synced: true,
    items: updatedItems,
    state: result?.state || state,
    paths: result ? { jsonPath: result.jsonPath, markdownPath: result.markdownPath } : getResearchLessonsPaths(projectPath),
  };
}

function extractResearchLessonCandidates(text, meta = {}) {
  const normalizedText = compactWhitespace(text);
  if (!normalizedText || normalizedText.length < 16) {
    return [];
  }

  const lowerText = normalizedText.toLowerCase();
  const hasCorrectionCue = CORRECTION_CUE_PATTERNS.some((pattern) => pattern.test(normalizedText));
  const lessons = [];

  for (const rule of RESEARCH_LESSON_RULES) {
    if (!rule.matches(normalizedText, lowerText, hasCorrectionCue, meta)) {
      continue;
    }
    lessons.push({
      slug: rule.slug,
      title: rule.title,
      category: rule.category,
      status: hasCorrectionCue ? 'confirmed' : 'candidate',
      severity: rule.severity,
      summary: rule.summary,
      trigger: rule.trigger,
      correctPattern: rule.correctPattern,
      stageHints: dedupeStrings([
        ...(Array.isArray(rule.stageHints) ? rule.stageHints : []),
        meta?.stage || null,
      ]),
      evidence: [{
        snippet: normalizedText.slice(0, 320),
        provider: meta?.provider || null,
        sessionId: meta?.sessionId || null,
        taskId: meta?.taskId || null,
        taskTitle: meta?.taskTitle || null,
        source: meta?.source || 'user_command',
        capturedAt: new Date().toISOString(),
      }],
    });
  }

  const seen = new Set();
  return lessons.filter((lesson) => {
    if (seen.has(lesson.slug)) {
      return false;
    }
    seen.add(lesson.slug);
    return true;
  });
}

async function buildResearchLessonsPromptContext(projectPath, options = {}) {
  const state = await readResearchLessons(projectPath);
  const stage = compactWhitespace(options.stage || '');
  const maxItems = Number.isFinite(options.maxItems)
    ? Math.max(1, Number(options.maxItems))
    : DEFAULT_PROMPT_LESSON_LIMIT;

  const relevantItems = state.items
    .filter((item) => String(item?.status || '').toLowerCase() === 'confirmed')
    .sort((left, right) => contextualLessonScore(right, stage) - contextualLessonScore(left, stage))
    .slice(0, maxItems);

  if (relevantItems.length === 0) {
    return '';
  }

  const lines = ['<research_lessons>', 'Relevant lessons from previous corrections:'];
  for (const item of relevantItems) {
    const description = item.correctPattern || item.summary || item.title;
    lines.push(`- ${item.title}: ${compactWhitespace(description)}`);
  }
  lines.push('Use these lessons to avoid repeating known data-check and analysis mistakes.');
  lines.push('</research_lessons>');
  return lines.join('\n');
}

function clipText(value, maxLength = 1200) {
  const normalized = compactWhitespace(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildTaskContextPromptBlock(taskContext) {
  if (!taskContext || typeof taskContext !== 'object') {
    return '';
  }

  const lines = ['<task_context>'];
  const pushLine = (label, value, maxLength = 1200) => {
    const normalized = clipText(value, maxLength);
    if (normalized) {
      lines.push(`${label}: ${normalized}`);
    }
  };
  const pushList = (label, values) => {
    if (!Array.isArray(values)) {
      return;
    }
    const normalizedValues = dedupeStrings(values.map((value) => String(value || ''))).slice(0, 10);
    if (normalizedValues.length > 0) {
      lines.push(`${label}: ${normalizedValues.join(', ')}`);
    }
  };

  pushLine('Task ID', taskContext.id, 120);
  pushLine('Title', taskContext.title, 400);
  pushLine('Stage', taskContext.stage, 120);
  pushLine('Status', taskContext.status, 120);
  pushLine('Priority', taskContext.priority, 120);
  pushLine('Task type', taskContext.taskType, 120);
  pushLine('Why this task is next', taskContext.whyNext, 600);
  pushLine('Description', taskContext.description, 900);
  pushLine('Details', taskContext.details, 1200);
  pushLine('Test strategy', taskContext.testStrategy, 700);
  pushList('Required inputs', taskContext.requiredInputs);
  pushList('Suggested skills', taskContext.suggestedSkills);
  pushList('Dependencies', taskContext.dependencies);
  pushLine('Next action prompt', taskContext.nextActionPrompt, 1800);

  if (lines.length === 1) {
    return '';
  }

  lines.push('Use this task context as the active work boundary. Prefer completing this task before broadening scope.');
  lines.push('</task_context>');
  return lines.join('\n');
}

async function buildResearchAwarePromptPrefix(scopeRef, command, options = {}) {
  const blocks = [];
  const projectPath = scopeRef?.projectPath || null;

  const taskBlock = buildTaskContextPromptBlock(options.taskContext);
  if (taskBlock) {
    blocks.push(taskBlock);
  }

  if (projectPath && options.includeExecutionMemory !== false) {
    const snapshot = await readExecutionMemorySnapshot(scopeRef, {
      ledgerLimit: options.ledgerLimit || 80,
    });
    const executionBlock = buildExecutionPromptContext(snapshot);
    if (executionBlock) {
      blocks.push(executionBlock);
    }
  }

  if (projectPath && options.includeResearchLessons !== false) {
    const lessonsBlock = await buildResearchLessonsPromptContext(projectPath, {
      stage: options.stage || scopeRef?.stage || null,
      maxItems: options.maxLessonItems || DEFAULT_PROMPT_LESSON_LIMIT,
    });
    if (lessonsBlock) {
      blocks.push(lessonsBlock);
    }
  }

  if (blocks.length === 0) {
    return command;
  }

  const body = String(command || '').trim() || options.fallbackCommand || 'Continue from the latest confirmed project state.';
  return `${blocks.join('\n\n')}\n\nUser request:\n${body}`;
}

function normalizeResearchLessonsState(state) {
  const normalized = state && typeof state === 'object' ? state : {};
  return {
    version: RESEARCH_LESSONS_VERSION,
    updatedAt: normalized.updatedAt || null,
    items: Array.isArray(normalized.items)
      ? normalized.items
        .map((item) => normalizeLesson(item))
        .filter(Boolean)
      : [],
  };
}

function normalizeLesson(item) {
  if (!item || typeof item !== 'object' || !item.slug || !item.title) {
    return null;
  }
  return {
    id: item.id || crypto.randomUUID(),
    slug: item.slug,
    title: item.title,
    category: item.category || 'general',
    status: item.status || 'candidate',
    severity: item.severity || 'medium',
    summary: item.summary || '',
    trigger: item.trigger || '',
    correctPattern: item.correctPattern || '',
    stageHints: dedupeStrings(Array.isArray(item.stageHints) ? item.stageHints : []),
    evidence: mergeEvidence([], Array.isArray(item.evidence) ? item.evidence : []),
    timesSeen: Number.isFinite(item.timesSeen) ? Number(item.timesSeen) : 1,
    createdAt: item.createdAt || item.firstSeenAt || null,
    updatedAt: item.updatedAt || item.lastSeenAt || null,
    firstSeenAt: item.firstSeenAt || item.createdAt || null,
    lastSeenAt: item.lastSeenAt || item.updatedAt || null,
  };
}

function resolveLessonStatus(existingStatus, nextStatus) {
  if (String(existingStatus || '').toLowerCase() === 'confirmed') {
    return 'confirmed';
  }
  return nextStatus || existingStatus || 'candidate';
}

function mergeEvidence(existingEvidence, newEvidence) {
  const deduped = [];
  const seen = new Set();

  for (const evidence of [...(existingEvidence || []), ...(newEvidence || [])]) {
    const normalizedEvidence = normalizeEvidence(evidence);
    if (!normalizedEvidence) {
      continue;
    }
    const key = JSON.stringify([
      normalizedEvidence.snippet,
      normalizedEvidence.provider,
      normalizedEvidence.sessionId,
      normalizedEvidence.taskId,
      normalizedEvidence.source,
    ]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalizedEvidence);
  }

  return deduped.slice(-MAX_EVIDENCE_ITEMS);
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return null;
  }
  const snippet = compactWhitespace(evidence.snippet || '');
  if (!snippet) {
    return null;
  }
  return {
    snippet: snippet.slice(0, 320),
    provider: evidence.provider || null,
    sessionId: evidence.sessionId || null,
    taskId: evidence.taskId || null,
    taskTitle: evidence.taskTitle || null,
    source: evidence.source || null,
    capturedAt: evidence.capturedAt || new Date().toISOString(),
  };
}

function buildResearchLessonsMarkdown(state) {
  const confirmed = state.items.filter((item) => String(item.status || '').toLowerCase() === 'confirmed');
  const candidates = state.items.filter((item) => String(item.status || '').toLowerCase() !== 'confirmed');
  const lines = ['# Research Lessons', ''];

  if (state.updatedAt) {
    lines.push(`Updated: ${state.updatedAt}`);
    lines.push('');
  }

  lines.push('## Confirmed Lessons');
  if (confirmed.length === 0) {
    lines.push('- None yet.');
  } else {
    for (const item of confirmed) {
      lines.push(`- **${item.title}** (${item.category}, seen ${item.timesSeen}x): ${item.correctPattern || item.summary}`);
    }
  }
  lines.push('');

  lines.push('## Candidate Lessons');
  if (candidates.length === 0) {
    lines.push('- None.');
  } else {
    for (const item of candidates) {
      lines.push(`- **${item.title}** (${item.category}): ${item.correctPattern || item.summary}`);
    }
  }
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

function contextualLessonScore(item, stage) {
  let score = scoreLesson(item);
  const stageHints = Array.isArray(item.stageHints) ? item.stageHints : [];
  if (stage && stageHints.includes(stage)) {
    score += 20;
  } else if (stage && stageHints.length > 0 && !stageHints.includes(stage)) {
    score -= 5;
  }
  return score;
}

function scoreLesson(item) {
  const severityScore = item?.severity === 'high'
    ? 30
    : item?.severity === 'medium'
      ? 20
      : 10;
  const confirmedScore = String(item?.status || '').toLowerCase() === 'confirmed' ? 50 : 0;
  const frequencyScore = Math.min(Number(item?.timesSeen || 0), 10);
  return confirmedScore + severityScore + frequencyScore;
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeStrings(values) {
  const deduped = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = compactWhitespace(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

export {
  buildResearchAwarePromptPrefix,
  buildResearchLessonsPromptContext,
  buildTaskContextPromptBlock,
  captureResearchLessonsFromText,
  createEmptyResearchLessonsState,
  extractResearchLessonCandidates,
  getResearchLessonsPaths,
  readResearchLessons,
  writeResearchLessons,
};
