import path from 'path';
import { promises as fs } from 'fs';

import { ensureAutoResearchRunDir, writeAutoResearchRunJson } from './run-files.js';
import {
  AUTO_RESEARCH_STAGE_SEQUENCE,
  deriveAutoResearchStateMachine,
  normalizeAutoResearchStage,
} from './state-machine.js';

function buildAutoResearchStageSummary({
  pipelineState,
  currentTask = null,
  runStatus = 'queued',
  generatedAt = new Date().toISOString(),
} = {}) {
  const machine = deriveAutoResearchStateMachine({
    pipelineState,
    currentTask,
    runStatus,
    generatedAt,
  });
  const tasks = Array.isArray(pipelineState?.tasks) ? pipelineState.tasks : [];
  const currentTaskId = currentTask?.id != null ? String(currentTask.id) : null;

  return {
    generatedAt,
    runStatus,
    currentStage: machine.currentStage,
    nextStage: machine.nextStage,
    currentTaskId,
    currentTaskTitle: currentTask?.title || null,
    actionableTaskCount: pipelineState?.actionableTaskCount || 0,
    completedTaskCount: pipelineState?.completedTaskCount || 0,
    totalTaskCount: tasks.length,
    completedStages: machine.completedStages,
    stages: machine.stages,
  };
}

function buildAutoResearchHeartbeat({
  run,
  runtime = null,
  pipelineState,
  currentTask = null,
  heartbeatStatus = null,
  timestamp = new Date().toISOString(),
} = {}) {
  return {
    runId: run?.id || null,
    projectName: run?.project_name || null,
    provider: runtime?.provider || run?.provider || null,
    status: heartbeatStatus || run?.status || 'unknown',
    sessionId: runtime?.sessionId || run?.session_id || null,
    currentStage: currentTask?.stage
      ? normalizeAutoResearchStage(currentTask.stage)
      : pipelineState?.nextTask?.stage
        ? normalizeAutoResearchStage(pipelineState.nextTask.stage)
        : null,
    currentTaskId: currentTask?.id != null
      ? String(currentTask.id)
      : run?.current_task_id != null
        ? String(run.current_task_id)
        : null,
    currentTaskTitle: currentTask?.title || null,
    completedTasks: pipelineState?.completedTaskCount ?? run?.completed_tasks ?? 0,
    totalTasks: pipelineState?.tasks?.length ?? run?.total_tasks ?? 0,
    timestamp,
  };
}

function buildAutoResearchCheckpoint({
  run,
  pipelineState,
  completedTask = null,
  timestamp = new Date().toISOString(),
} = {}) {
  const nextTask = pipelineState?.nextTask || null;

  return {
    runId: run?.id || null,
    status: run?.status || 'unknown',
    lastCompletedTaskId: completedTask?.id != null ? String(completedTask.id) : null,
    lastCompletedTaskTitle: completedTask?.title || null,
    lastCompletedStage: completedTask?.stage ? normalizeAutoResearchStage(completedTask.stage) : null,
    completedTasks: pipelineState?.completedTaskCount ?? run?.completed_tasks ?? 0,
    totalTasks: pipelineState?.tasks?.length ?? run?.total_tasks ?? 0,
    nextTaskId: nextTask?.id != null ? String(nextTask.id) : null,
    nextTaskTitle: nextTask?.title || null,
    nextStage: nextTask?.stage ? normalizeAutoResearchStage(nextTask.stage) : null,
    timestamp,
  };
}

async function appendAutoResearchRunEvent(projectPath, runId, event) {
  const runDir = await ensureAutoResearchRunDir(projectPath, runId);
  const eventsPath = path.join(runDir, 'events.jsonl');
  const payload = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  await fs.appendFile(eventsPath, `${JSON.stringify(payload)}\n`, 'utf8');
  return eventsPath;
}

async function writeAutoResearchStageSummary(projectPath, runId, summary) {
  return writeAutoResearchRunJson(projectPath, runId, 'stage-summary.json', summary);
}

async function writeAutoResearchHeartbeat(projectPath, runId, heartbeat) {
  return writeAutoResearchRunJson(projectPath, runId, 'heartbeat.json', heartbeat);
}

async function writeAutoResearchCheckpoint(projectPath, runId, checkpoint) {
  return writeAutoResearchRunJson(projectPath, runId, 'checkpoint.json', checkpoint);
}

export {
  AUTO_RESEARCH_STAGE_SEQUENCE as STAGE_ORDER,
  appendAutoResearchRunEvent,
  buildAutoResearchCheckpoint,
  buildAutoResearchHeartbeat,
  buildAutoResearchStageSummary,
  normalizeAutoResearchStage as normalizeStageKey,
  writeAutoResearchCheckpoint,
  writeAutoResearchHeartbeat,
  writeAutoResearchStageSummary,
};
