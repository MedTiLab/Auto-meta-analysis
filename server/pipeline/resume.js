import { readAutoResearchRunSummary } from './run-files.js';
import { normalizeAutoResearchStage } from './state-machine.js';

const RESUMABLE_AUTO_RESEARCH_RUN_STATUSES = new Set(['failed', 'cancelled']);

function isAutoResearchRunResumableStatus(status) {
  return RESUMABLE_AUTO_RESEARCH_RUN_STATUSES.has(String(status || '').trim().toLowerCase());
}

function buildAutoResearchResumeState({
  run = null,
  pipelineState = null,
  runTracking = null,
} = {}) {
  const checkpoint = runTracking?.checkpoint || null;
  const nextTask = pipelineState?.nextTask || null;

  if (!run) {
    return {
      available: false,
      reason: 'no_previous_run',
      summary: 'No previous Auto Research run is available to resume.',
    };
  }

  if (!isAutoResearchRunResumableStatus(run.status)) {
    return {
      available: false,
      reason: 'run_not_resumable',
      runId: run.id,
      status: run.status,
      summary: `Latest run status ${run.status} is not resumable.`,
    };
  }

  if (!pipelineState?.tasksValid) {
    return {
      available: false,
      reason: 'tasks_invalid',
      runId: run.id,
      status: run.status,
      summary: 'Resume is blocked because tasks.json is missing or invalid.',
    };
  }

  if (!checkpoint) {
    return {
      available: false,
      reason: 'checkpoint_missing',
      runId: run.id,
      status: run.status,
      summary: 'Resume is unavailable because checkpoint.json is missing.',
    };
  }

  if (!nextTask || pipelineState.actionableTaskCount === 0) {
    return {
      available: false,
      reason: 'no_actionable_tasks',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is unavailable because there is no pending task left to continue.',
    };
  }

  const checkpointNextTaskId = checkpoint.nextTaskId != null ? String(checkpoint.nextTaskId) : null;
  const currentNextTaskId = nextTask.id != null ? String(nextTask.id) : null;

  if (!checkpointNextTaskId) {
    return {
      available: false,
      reason: 'checkpoint_incomplete',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is unavailable because checkpoint.json does not record the next task.',
    };
  }

  if (!currentNextTaskId) {
    return {
      available: false,
      reason: 'next_task_missing',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is unavailable because the current pipeline next task could not be identified.',
    };
  }

  if (checkpointNextTaskId !== currentNextTaskId) {
    return {
      available: false,
      reason: 'checkpoint_mismatch',
      runId: run.id,
      status: run.status,
      checkpoint,
      currentNextTaskId,
      currentNextTaskTitle: nextTask.title || null,
      summary: 'Resume is unavailable because the checkpoint no longer matches the current pipeline task order.',
    };
  }

  const matchedTask = (pipelineState.tasks || []).find((task) => String(task.id) === checkpointNextTaskId) || nextTask;
  if (!matchedTask || (matchedTask.status !== 'pending' && matchedTask.status !== 'in-progress')) {
    return {
      available: false,
      reason: 'checkpoint_task_not_actionable',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is unavailable because the checkpoint task is no longer actionable.',
    };
  }

  const nextStage = checkpoint.nextStage
    ? normalizeAutoResearchStage(checkpoint.nextStage)
    : normalizeAutoResearchStage(matchedTask.stage);

  return {
    available: true,
    reason: 'ready',
    runId: run.id,
    status: run.status,
    checkpoint,
    nextTaskId: String(matchedTask.id),
    nextTaskTitle: matchedTask.title || checkpoint.nextTaskTitle || null,
    nextStage,
    lastCompletedTaskId: checkpoint.lastCompletedTaskId || null,
    lastCompletedTaskTitle: checkpoint.lastCompletedTaskTitle || null,
    lastCompletedStage: checkpoint.lastCompletedStage || null,
    summary: `Resume is ready from ${matchedTask.title || checkpoint.nextTaskTitle || 'the next task'}.`,
  };
}

async function loadAutoResearchResumeState({
  run = null,
  pipelineState = null,
} = {}) {
  if (!run?.project_path || !run?.id) {
    return buildAutoResearchResumeState({ run, pipelineState, runTracking: null });
  }

  const runTracking = await readAutoResearchRunSummary(run.project_path, run.id, { eventLimit: 1 });
  return buildAutoResearchResumeState({
    run,
    pipelineState,
    runTracking,
  });
}

function buildAutoResearchResumeMetadata({
  existingMetadata = null,
  resumeState,
  provider,
  model,
  permissionMode,
  resumedAt = new Date().toISOString(),
} = {}) {
  const resumeCount = Math.max(0, Number(existingMetadata?.autoResearchResume?.resumeCount || 0)) + 1;

  return {
    ...(existingMetadata || {}),
    autoResearchModel: model,
    autoResearchPermissionMode: permissionMode,
    autoResearchResume: {
      resumeCount,
      resumedAt,
      resumedFromStatus: resumeState?.status || null,
      checkpointTimestamp: resumeState?.checkpoint?.timestamp || null,
      checkpointNextTaskId: resumeState?.checkpoint?.nextTaskId || null,
      checkpointNextStage: resumeState?.checkpoint?.nextStage || null,
    },
  };
}

export {
  buildAutoResearchResumeMetadata,
  buildAutoResearchResumeState,
  isAutoResearchRunResumableStatus,
  loadAutoResearchResumeState,
};
