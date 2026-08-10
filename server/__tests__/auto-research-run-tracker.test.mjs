import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  appendAutoResearchRunEvent,
  buildAutoResearchCheckpoint,
  buildAutoResearchHeartbeat,
  buildAutoResearchStageSummary,
  writeAutoResearchCheckpoint,
  writeAutoResearchHeartbeat,
  writeAutoResearchStageSummary,
} from '../pipeline/run-tracker.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-run-tracker-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('auto-research run tracker', () => {
  it('builds stage summary from pipeline tasks', () => {
    const pipelineState = {
      tasks: [
        { id: '1', title: 'Literature refs', stage: 'literature', status: 'done' },
        { id: '2', title: 'Generate ideas', stage: 'ideation', status: 'pending' },
        { id: '3', title: 'Analyze result', stage: 'experiment', status: 'in-progress' },
      ],
      nextTask: { id: '3', title: 'Analyze result', stage: 'experiment', status: 'in-progress' },
      completedTaskCount: 1,
      actionableTaskCount: 2,
    };

    const summary = buildAutoResearchStageSummary({
      pipelineState,
      currentTask: pipelineState.nextTask,
      runStatus: 'running',
    });

    expect(summary.currentStage).toBe('experiment');
    expect(summary.stages.literature.status).toBe('done');
    expect(summary.stages.ideation.status).toBe('pending');
    expect(summary.stages.experiment.status).toBe('running');
    expect(summary.stages.experiment.activeTaskId).toBe('3');
  });

  it('builds heartbeat and checkpoint payloads from run state', () => {
    const run = {
      id: 'run-1',
      project_name: 'Demo',
      provider: 'claude',
      status: 'running',
      session_id: 'session-1',
      completed_tasks: 1,
      total_tasks: 3,
    };
    const pipelineState = {
      tasks: [
        { id: '1', title: 'Literature refs', stage: 'literature', status: 'done' },
        { id: '2', title: 'Generate ideas', stage: 'ideation', status: 'pending' },
      ],
      nextTask: { id: '2', title: 'Generate ideas', stage: 'ideation', status: 'pending' },
      completedTaskCount: 1,
    };

    const heartbeat = buildAutoResearchHeartbeat({
      run,
      pipelineState,
      currentTask: pipelineState.nextTask,
      heartbeatStatus: 'running',
    });
    const checkpoint = buildAutoResearchCheckpoint({
      run,
      pipelineState,
      completedTask: pipelineState.tasks[0],
    });

    expect(heartbeat.currentStage).toBe('ideation');
    expect(heartbeat.currentTaskId).toBe('2');
    expect(checkpoint.lastCompletedTaskId).toBe('1');
    expect(checkpoint.lastCompletedStage).toBe('literature');
    expect(checkpoint.nextTaskId).toBe('2');
  });

  it('writes heartbeat, checkpoint, stage summary, and events into the run directory', async () => {
    const projectPath = await createTempProject();
    const runId = 'run-xyz';
    const runDir = path.join(projectPath, '.pipeline', 'runs', runId);

    await writeAutoResearchHeartbeat(projectPath, runId, { status: 'running' });
    await writeAutoResearchCheckpoint(projectPath, runId, { lastCompletedTaskId: '1' });
    await writeAutoResearchStageSummary(projectPath, runId, { currentStage: 'literature' });
    await appendAutoResearchRunEvent(projectPath, runId, { type: 'task_started', taskId: '2' });
    await appendAutoResearchRunEvent(projectPath, runId, { type: 'task_completed', taskId: '2' });

    const [heartbeatRaw, checkpointRaw, summaryRaw, eventsRaw] = await Promise.all([
      fs.readFile(path.join(runDir, 'heartbeat.json'), 'utf8'),
      fs.readFile(path.join(runDir, 'checkpoint.json'), 'utf8'),
      fs.readFile(path.join(runDir, 'stage-summary.json'), 'utf8'),
      fs.readFile(path.join(runDir, 'events.jsonl'), 'utf8'),
    ]);

    expect(JSON.parse(heartbeatRaw).status).toBe('running');
    expect(JSON.parse(checkpointRaw).lastCompletedTaskId).toBe('1');
    expect(JSON.parse(summaryRaw).currentStage).toBe('literature');

    const events = eventsRaw.trim().split('\n').map((line) => JSON.parse(line));
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('task_started');
    expect(events[1].type).toBe('task_completed');
  });
});
