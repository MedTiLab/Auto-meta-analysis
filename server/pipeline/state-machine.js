const AUTO_RESEARCH_STAGE_SEQUENCE = ['literature', 'ideation', 'experiment', 'publication', 'promotion'];

const AUTO_RESEARCH_STAGE_META = {
  literature: {
    key: 'literature',
    label: 'Literature',
    index: 0,
    gateRequired: false,
    rollbackStage: null,
  },
  ideation: {
    key: 'ideation',
    label: 'Ideation',
    index: 1,
    gateRequired: false,
    rollbackStage: 'literature',
  },
  experiment: {
    key: 'experiment',
    label: 'Experiment',
    index: 2,
    gateRequired: false,
    rollbackStage: 'ideation',
  },
  publication: {
    key: 'publication',
    label: 'Publication',
    index: 3,
    gateRequired: true,
    rollbackStage: 'experiment',
  },
  promotion: {
    key: 'promotion',
    label: 'Promotion',
    index: 4,
    gateRequired: false,
    rollbackStage: 'publication',
  },
};

function normalizeAutoResearchStage(stage) {
  const raw = String(stage || '').trim().toLowerCase();
  if (!raw) return 'unknown';
  if (raw === 'presentation') return 'promotion';
  if (raw === 'research' || raw === 'survey') return 'literature';
  return AUTO_RESEARCH_STAGE_META[raw] ? raw : 'unknown';
}

function getNextAutoResearchStage(stage) {
  const normalized = normalizeAutoResearchStage(stage);
  const meta = AUTO_RESEARCH_STAGE_META[normalized];
  if (!meta) return null;
  return AUTO_RESEARCH_STAGE_SEQUENCE[meta.index + 1] || null;
}

function getPreviousAutoResearchStage(stage) {
  const normalized = normalizeAutoResearchStage(stage);
  const meta = AUTO_RESEARCH_STAGE_META[normalized];
  if (!meta || meta.index === 0) return null;
  return AUTO_RESEARCH_STAGE_SEQUENCE[meta.index - 1] || null;
}

function canEnterAutoResearchStage(stage, completedStages = []) {
  const normalized = normalizeAutoResearchStage(stage);
  const meta = AUTO_RESEARCH_STAGE_META[normalized];
  if (!meta) return false;
  if (meta.index === 0) return true;

  const completed = new Set((completedStages || []).map((value) => normalizeAutoResearchStage(value)));
  const previousStage = getPreviousAutoResearchStage(normalized);
  return previousStage ? completed.has(previousStage) : true;
}

function deriveAutoResearchStateMachine({
  pipelineState,
  currentTask = null,
  runStatus = 'queued',
  generatedAt = new Date().toISOString(),
} = {}) {
  const tasks = Array.isArray(pipelineState?.tasks) ? pipelineState.tasks : [];
  const currentTaskId = currentTask?.id != null ? String(currentTask.id) : null;
  const stages = Object.fromEntries(
    AUTO_RESEARCH_STAGE_SEQUENCE.map((stage) => [stage, {
      ...AUTO_RESEARCH_STAGE_META[stage],
      totalTasks: 0,
      completedTasks: 0,
      pendingTasks: 0,
      runningTasks: 0,
      failedTasks: 0,
      activeTaskId: null,
      activeTaskTitle: null,
      status: 'unplanned',
      nextStage: getNextAutoResearchStage(stage),
      previousStage: getPreviousAutoResearchStage(stage),
    }]),
  );

  for (const task of tasks) {
    const stageKey = normalizeAutoResearchStage(task.stage);
    if (!stages[stageKey]) {
      continue;
    }

    const bucket = stages[stageKey];
    bucket.totalTasks += 1;

    if (task.status === 'done') {
      bucket.completedTasks += 1;
    } else if (task.status === 'failed') {
      bucket.failedTasks += 1;
    } else if (task.status === 'in-progress' || String(task.id) === currentTaskId) {
      bucket.runningTasks += 1;
      bucket.activeTaskId = String(task.id);
      bucket.activeTaskTitle = task.title || null;
    } else {
      bucket.pendingTasks += 1;
    }
  }

  for (const stage of AUTO_RESEARCH_STAGE_SEQUENCE) {
    const bucket = stages[stage];
    if (bucket.totalTasks === 0) {
      bucket.status = 'unplanned';
    } else if (bucket.runningTasks > 0) {
      bucket.status = 'running';
    } else if (bucket.failedTasks > 0) {
      bucket.status = 'failed';
    } else if (bucket.completedTasks === bucket.totalTasks) {
      bucket.status = 'done';
    } else if (bucket.completedTasks > 0) {
      bucket.status = 'partial';
    } else {
      bucket.status = 'pending';
    }
  }

  const completedStages = AUTO_RESEARCH_STAGE_SEQUENCE.filter((stage) => stages[stage].status === 'done');
  for (const stage of AUTO_RESEARCH_STAGE_SEQUENCE) {
    stages[stage].canEnter = canEnterAutoResearchStage(stage, completedStages);
  }

  const currentStage = currentTask?.stage
    ? normalizeAutoResearchStage(currentTask.stage)
    : pipelineState?.nextTask?.stage
      ? normalizeAutoResearchStage(pipelineState.nextTask.stage)
      : AUTO_RESEARCH_STAGE_SEQUENCE.find((stage) => stages[stage].status === 'running')
        || AUTO_RESEARCH_STAGE_SEQUENCE.find((stage) => stages[stage].status === 'partial')
        || AUTO_RESEARCH_STAGE_SEQUENCE.find((stage) => stages[stage].status === 'pending')
        || null;

  const nextStage = currentStage ? getNextAutoResearchStage(currentStage) : null;

  return {
    generatedAt,
    runStatus,
    currentStage,
    nextStage,
    currentTaskId,
    currentTaskTitle: currentTask?.title || null,
    completedStages,
    stages,
  };
}

export {
  AUTO_RESEARCH_STAGE_META,
  AUTO_RESEARCH_STAGE_SEQUENCE,
  canEnterAutoResearchStage,
  deriveAutoResearchStateMachine,
  getNextAutoResearchStage,
  getPreviousAutoResearchStage,
  normalizeAutoResearchStage,
};
