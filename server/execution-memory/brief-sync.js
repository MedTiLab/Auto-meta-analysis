import path from 'path';

import { readJsonIfExists, writeJson } from './files.js';

const DEFAULT_RESEARCH_BRIEF_FILENAME = 'research_brief.json';
const DEFAULT_BRIEF_SECTIONS = {
  literature: {
    core_research_question: '',
    literature_scope: '',
    knowledge_base_scope: '',
    key_references: [],
    seed_papers: [],
    synthesis_summary: '',
    open_gaps: [],
    evidence_requirements: [],
  },
  ideation: {
    research_goal: '',
    clinical_or_scientific_gap: '',
    problem_framing: '',
    evidence_plan: '',
    success_criteria: [],
  },
  experiment: {
    hypothesis_or_validation_goal: '',
    dataset_or_data_source: '',
    method_or_protocol: '',
    evaluation_plan: '',
    sensitivity_plan: [],
  },
  publication: {
    paper_outline: '',
    figures_tables_plan: '',
    artifact_plan: '',
    submission_checklist: [],
  },
  promotion: {
    slide_outline: '',
    deck_style: '',
    tts_config: '',
    video_assembly_plan: '',
    homepage_plan: '',
  },
};

function normalizeStageName(stage) {
  const value = String(stage || '').trim().toLowerCase();
  if (value === 'presentation') return 'promotion';
  if (value === 'research' || value === 'survey') return 'literature';
  if (value === 'literature' || value === 'ideation' || value === 'experiment' || value === 'publication' || value === 'promotion') {
    return value;
  }
  return null;
}

function normalizeBriefDocument(briefData = {}, nowDate = new Date().toISOString().split('T')[0]) {
  const sourceSections = briefData?.sections && typeof briefData.sections === 'object' ? briefData.sections : {};
  const mergedSections = {
    ...Object.fromEntries(
      Object.entries(DEFAULT_BRIEF_SECTIONS).map(([stage, defaults]) => {
        const existing = sourceSections?.[stage] && typeof sourceSections[stage] === 'object' && !Array.isArray(sourceSections[stage])
          ? sourceSections[stage]
          : {};
        const legacySurvey = stage === 'literature' && sourceSections?.survey && typeof sourceSections.survey === 'object' && !Array.isArray(sourceSections.survey)
          ? sourceSections.survey
          : {};
        return [stage, { ...cloneJsonCompatible(defaults), ...legacySurvey, ...existing }];
      }),
    ),
    ...Object.fromEntries(
      Object.entries(sourceSections).filter(([stage]) => stage !== 'survey' && !Object.prototype.hasOwnProperty.call(DEFAULT_BRIEF_SECTIONS, stage)),
    ),
  };

  return {
    schemaVersion: briefData?.schemaVersion || '1.1',
    templateId: briefData?.templateId || '',
    meta: {
      title: '',
      lead_author: '',
      target_venue: '',
      date: nowDate,
      ...(briefData?.meta && typeof briefData.meta === 'object' ? briefData.meta : {}),
    },
    ...briefData,
    sections: mergedSections,
    pipeline: briefData?.pipeline && typeof briefData.pipeline === 'object' ? briefData.pipeline : {},
  };
}

async function syncConfirmedExecutionMemoryToResearchBrief(scopeRef, options = {}) {
  const projectPath = scopeRef?.projectPath;
  if (!projectPath) {
    return { synced: false, reason: 'missing_project_path' };
  }

  const briefPath = path.join(projectPath, '.pipeline', 'docs', DEFAULT_RESEARCH_BRIEF_FILENAME);
  const existingBrief = await readJsonIfExists(briefPath, null);
  if (!existingBrief || typeof existingBrief !== 'object' || Array.isArray(existingBrief)) {
    return { synced: false, reason: 'brief_missing' };
  }

  const snapshot = options.snapshot || null;
  if (!snapshot) {
    return { synced: false, reason: 'missing_snapshot' };
  }

  const stage = normalizeStageName(
    options.stage
      || snapshot?.microtasks?.stage
      || inferStageFromSnapshot(snapshot),
  );
  if (!stage) {
    return { synced: false, reason: 'missing_stage' };
  }

  const confirmedStageData = buildConfirmedStageSnapshot(snapshot, stage, scopeRef);
  if (!confirmedStageData) {
    return { synced: false, reason: 'no_confirmed_data', stage };
  }

  const nowDate = new Date().toISOString().split('T')[0];
  const brief = normalizeBriefDocument(existingBrief, nowDate);
  const existingSync = brief?.execution_memory_sync && typeof brief.execution_memory_sync === 'object'
    ? brief.execution_memory_sync
    : {};
  const existingStages = existingSync?.stages && typeof existingSync.stages === 'object'
    ? existingSync.stages
    : {};
  const existingStageSnapshot = existingStages?.[stage] && typeof existingStages[stage] === 'object'
    ? existingStages[stage]
    : {};
  const mergedStageSnapshot = mergeStageSnapshots(existingStageSnapshot, confirmedStageData);

  if (!hasStageSnapshotContent(mergedStageSnapshot)) {
    return { synced: false, reason: 'no_confirmed_data', stage };
  }

  const changed = JSON.stringify(stripVolatileStageSnapshot(existingStageSnapshot))
    !== JSON.stringify(stripVolatileStageSnapshot(mergedStageSnapshot));
  if (!changed) {
    return { synced: false, reason: 'unchanged', stage };
  }

  brief.execution_memory_sync = {
    ...existingSync,
    version: 1,
    updatedAt: new Date().toISOString(),
    stages: {
      ...existingStages,
      [stage]: mergedStageSnapshot,
    },
  };

  await writeJson(briefPath, brief);
  return {
    synced: true,
    stage,
    briefPath,
    stageSnapshot: mergedStageSnapshot,
  };
}

function buildConfirmedStageSnapshot(snapshot, stage, scopeRef) {
  const ledgerEvents = Array.isArray(snapshot?.ledgerEvents) ? snapshot.ledgerEvents : [];
  const latestStageEvents = ledgerEvents.filter((event) => normalizeStageName(event?.stage) === stage);
  const completedTasks = dedupeStrings(
    latestStageEvents
      .filter((event) => event?.type === 'task_completed')
      .map((event) => normalizeCompletedTaskLabel(event?.summary, event?.taskTitle)),
  );
  const completedMicrotasks = dedupeStrings(
    (Array.isArray(snapshot?.microtasks?.items) ? snapshot.microtasks.items : [])
      .filter((item) => item?.status === 'completed')
      .filter((item) => {
        const itemStage = normalizeStageName(item?.stage);
        return itemStage ? itemStage === stage : normalizeStageName(snapshot?.microtasks?.stage) === stage;
      })
      .map((item) => item?.title),
  );
  const confirmedArtifacts = dedupeStrings(
    latestStageEvents
      .filter((event) => event?.type === 'artifact_created')
      .map((event) => event?.path),
  );
  const confirmedFindings = dedupeStrings(
    [
      ...latestStageEvents
        .filter((event) => event?.type === 'finding_recorded' && String(event?.confirmation || '').toLowerCase() === 'confirmed')
        .map((event) => event?.summary),
      ...latestStageEvents
        .filter((event) => event?.type === 'stat_result')
        .map((event) => event?.summary),
    ],
  );

  if (
    completedTasks.length === 0
    && completedMicrotasks.length === 0
    && confirmedArtifacts.length === 0
    && confirmedFindings.length === 0
  ) {
    return null;
  }

  const sourceScope = describeScope(scopeRef);
  const currentObjective = compactWhitespace(snapshot?.microtasks?.currentObjective || '');
  const lastTaskTitle = compactWhitespace(snapshot?.microtasks?.currentTaskTitle || '');
  return {
    stage,
    updatedAt: new Date().toISOString(),
    latestSourceScope: sourceScope,
    sourceScopes: sourceScope ? [sourceScope] : [],
    provider: snapshot?.microtasks?.provider || scopeRef?.provider || null,
    currentObjective: currentObjective || null,
    lastTaskTitle: lastTaskTitle || null,
    completedTasks: completedTasks.slice(-20),
    completedMicrotasks: completedMicrotasks.slice(-25),
    confirmedArtifacts: confirmedArtifacts.slice(-25),
    confirmedFindings: confirmedFindings.slice(-20),
    summary: '',
  };
}

function mergeStageSnapshots(existingStageSnapshot = {}, nextStageSnapshot = {}) {
  const merged = {
    stage: nextStageSnapshot.stage || existingStageSnapshot.stage || null,
    updatedAt: nextStageSnapshot.updatedAt || existingStageSnapshot.updatedAt || null,
    latestSourceScope: nextStageSnapshot.latestSourceScope || existingStageSnapshot.latestSourceScope || null,
    sourceScopes: dedupeStrings([
      ...(Array.isArray(existingStageSnapshot.sourceScopes) ? existingStageSnapshot.sourceScopes : []),
      ...(Array.isArray(nextStageSnapshot.sourceScopes) ? nextStageSnapshot.sourceScopes : []),
    ]).slice(-10),
    provider: nextStageSnapshot.provider || existingStageSnapshot.provider || null,
    currentObjective: nextStageSnapshot.currentObjective || existingStageSnapshot.currentObjective || null,
    lastTaskTitle: nextStageSnapshot.lastTaskTitle || existingStageSnapshot.lastTaskTitle || null,
    completedTasks: dedupeStrings([
      ...(Array.isArray(existingStageSnapshot.completedTasks) ? existingStageSnapshot.completedTasks : []),
      ...(Array.isArray(nextStageSnapshot.completedTasks) ? nextStageSnapshot.completedTasks : []),
    ]).slice(-20),
    completedMicrotasks: dedupeStrings([
      ...(Array.isArray(existingStageSnapshot.completedMicrotasks) ? existingStageSnapshot.completedMicrotasks : []),
      ...(Array.isArray(nextStageSnapshot.completedMicrotasks) ? nextStageSnapshot.completedMicrotasks : []),
    ]).slice(-25),
    confirmedArtifacts: dedupeStrings([
      ...(Array.isArray(existingStageSnapshot.confirmedArtifacts) ? existingStageSnapshot.confirmedArtifacts : []),
      ...(Array.isArray(nextStageSnapshot.confirmedArtifacts) ? nextStageSnapshot.confirmedArtifacts : []),
    ]).slice(-25),
    confirmedFindings: dedupeStrings([
      ...(Array.isArray(existingStageSnapshot.confirmedFindings) ? existingStageSnapshot.confirmedFindings : []),
      ...(Array.isArray(nextStageSnapshot.confirmedFindings) ? nextStageSnapshot.confirmedFindings : []),
    ]).slice(-20),
  };
  merged.summary = buildStageSnapshotSummary(merged);
  return merged;
}

function buildStageSnapshotSummary(stageSnapshot = {}) {
  const lines = [];
  if (stageSnapshot.currentObjective) {
    lines.push(`Objective: ${stageSnapshot.currentObjective}`);
  }
  if (stageSnapshot.completedTasks?.length > 0) {
    lines.push(`Completed tasks: ${stageSnapshot.completedTasks.join('; ')}`);
  }
  if (stageSnapshot.completedMicrotasks?.length > 0) {
    lines.push(`Completed microtasks: ${stageSnapshot.completedMicrotasks.join('; ')}`);
  }
  if (stageSnapshot.confirmedArtifacts?.length > 0) {
    lines.push(`Confirmed artifacts: ${stageSnapshot.confirmedArtifacts.join('; ')}`);
  }
  if (stageSnapshot.confirmedFindings?.length > 0) {
    lines.push(`Confirmed findings: ${stageSnapshot.confirmedFindings.join('; ')}`);
  }
  return lines.join(' | ');
}

function inferStageFromSnapshot(snapshot) {
  const directStage = normalizeStageName(snapshot?.microtasks?.stage);
  if (directStage) {
    return directStage;
  }

  const ledgerEvents = Array.isArray(snapshot?.ledgerEvents) ? snapshot.ledgerEvents : [];
  for (let index = ledgerEvents.length - 1; index >= 0; index -= 1) {
    const event = ledgerEvents[index];
    const eventStage = normalizeStageName(event?.stage);
    if (eventStage) {
      return eventStage;
    }
    const artifactStage = inferStageFromArtifactPath(event?.path);
    if (artifactStage) {
      return artifactStage;
    }
    const textStage = inferStageFromText(event?.summary || event?.taskTitle || event?.currentTaskTitle || '');
    if (textStage) {
      return textStage;
    }
  }

  return inferStageFromText(snapshot?.microtasks?.currentObjective || '');
}

function inferStageFromArtifactPath(filePath = '') {
  const normalized = String(filePath || '').trim().replace(/\\/g, '/').toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('literature/') || normalized.startsWith('survey/') || normalized.startsWith('research/')) return 'literature';
  if (normalized.startsWith('ideation/') || normalized.startsWith('idea/')) return 'ideation';
  if (normalized.startsWith('experiment/')) return 'experiment';
  if (normalized.startsWith('publication/') || normalized.startsWith('paper/') || normalized.startsWith('drafts/')) return 'publication';
  if (normalized.startsWith('promotion/') || normalized.startsWith('slides/') || normalized.startsWith('video/') || normalized.startsWith('homepage/')) return 'promotion';
  return null;
}

function inferStageFromText(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes('survey') || normalized.includes('literature')) return 'literature';
  if (normalized.includes('ideation') || normalized.includes('problem framing')) return 'ideation';
  if (normalized.includes('experiment') || normalized.includes('validation') || normalized.includes('analysis')) return 'experiment';
  if (normalized.includes('publication') || normalized.includes('paper') || normalized.includes('submission')) return 'publication';
  if (
    normalized.includes('promotion')
    || normalized.includes('presentation')
    || normalized.includes('slide')
    || normalized.includes('deck')
    || normalized.includes('homepage')
    || normalized.includes('video')
  ) return 'promotion';
  return null;
}

function describeScope(scopeRef = {}) {
  if (scopeRef?.scope === 'run') {
    return scopeRef?.runId ? `run:${scopeRef.runId}` : 'run:unknown';
  }
  return scopeRef?.sessionId ? `session:${scopeRef.sessionId}` : 'session:unknown';
}

function normalizeCompletedTaskLabel(summary, taskTitle) {
  const normalizedSummary = compactWhitespace(summary || '');
  const normalizedTaskTitle = compactWhitespace(taskTitle || '');
  if (!normalizedSummary) {
    return normalizedTaskTitle || '';
  }
  if (normalizedTaskTitle && normalizedSummary.toLowerCase() === `completed ${normalizedTaskTitle}`.toLowerCase()) {
    return normalizedTaskTitle;
  }
  return normalizedSummary;
}

function hasStageSnapshotContent(stageSnapshot = {}) {
  return Boolean(
    (Array.isArray(stageSnapshot.completedTasks) && stageSnapshot.completedTasks.length > 0)
    || (Array.isArray(stageSnapshot.completedMicrotasks) && stageSnapshot.completedMicrotasks.length > 0)
    || (Array.isArray(stageSnapshot.confirmedArtifacts) && stageSnapshot.confirmedArtifacts.length > 0)
    || (Array.isArray(stageSnapshot.confirmedFindings) && stageSnapshot.confirmedFindings.length > 0),
  );
}

function stripVolatileStageSnapshot(stageSnapshot = {}) {
  return {
    stage: stageSnapshot.stage || null,
    latestSourceScope: stageSnapshot.latestSourceScope || null,
    sourceScopes: Array.isArray(stageSnapshot.sourceScopes) ? stageSnapshot.sourceScopes : [],
    provider: stageSnapshot.provider || null,
    currentObjective: stageSnapshot.currentObjective || null,
    lastTaskTitle: stageSnapshot.lastTaskTitle || null,
    completedTasks: Array.isArray(stageSnapshot.completedTasks) ? stageSnapshot.completedTasks : [],
    completedMicrotasks: Array.isArray(stageSnapshot.completedMicrotasks) ? stageSnapshot.completedMicrotasks : [],
    confirmedArtifacts: Array.isArray(stageSnapshot.confirmedArtifacts) ? stageSnapshot.confirmedArtifacts : [],
    confirmedFindings: Array.isArray(stageSnapshot.confirmedFindings) ? stageSnapshot.confirmedFindings : [],
    summary: stageSnapshot.summary || '',
  };
}

function cloneJsonCompatible(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const deduped = [];
  for (const value of values) {
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
  syncConfirmedExecutionMemoryToResearchBrief,
};
