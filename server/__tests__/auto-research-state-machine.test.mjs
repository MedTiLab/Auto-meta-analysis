import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { deriveAutoResearchStateMachine } from '../pipeline/state-machine.js';
import { readAutoResearchRunSummary, writeAutoResearchRunJson } from '../pipeline/run-files.js';
import { appendAutoResearchRunEvent } from '../pipeline/run-tracker.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-state-machine-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('auto-research state machine', () => {
  it('derives five-stage progress from current pipeline tasks', () => {
    const state = deriveAutoResearchStateMachine({
      pipelineState: {
        tasks: [
          { id: '1', title: 'Literature refs', stage: 'literature', status: 'done' },
          { id: '2', title: 'Pick idea', stage: 'ideation', status: 'done' },
          { id: '3', title: 'Run baseline', stage: 'experiment', status: 'in-progress' },
          { id: '4', title: 'Draft paper', stage: 'publication', status: 'pending' },
        ],
        nextTask: { id: '3', title: 'Run baseline', stage: 'experiment', status: 'in-progress' },
      },
      currentTask: { id: '3', title: 'Run baseline', stage: 'experiment', status: 'in-progress' },
      runStatus: 'running',
    });

    expect(state.currentStage).toBe('experiment');
    expect(state.nextStage).toBe('publication');
    expect(state.completedStages).toEqual(['literature', 'ideation']);
    expect(state.stages.publication.gateRequired).toBe(true);
    expect(state.stages.promotion.canEnter).toBe(false);
  });
});

describe('auto-research run summary reader', () => {
  it('loads heartbeat, checkpoint, stage summary, and recent events from the run directory', async () => {
    const projectPath = await createTempProject();
    const runId = 'run-summary';

    await Promise.all([
      writeAutoResearchRunJson(projectPath, runId, 'heartbeat.json', { currentStage: 'experiment' }),
      writeAutoResearchRunJson(projectPath, runId, 'checkpoint.json', { lastCompletedStage: 'ideation' }),
      writeAutoResearchRunJson(projectPath, runId, 'stage-summary.json', { currentStage: 'experiment' }),
    ]);
    await appendAutoResearchRunEvent(projectPath, runId, { type: 'task_started', taskTitle: 'Run baseline' });
    await appendAutoResearchRunEvent(projectPath, runId, { type: 'task_completed', taskTitle: 'Run baseline' });

    const summary = await readAutoResearchRunSummary(projectPath, runId, { eventLimit: 1 });

    expect(summary.heartbeat?.currentStage).toBe('experiment');
    expect(summary.checkpoint?.lastCompletedStage).toBe('ideation');
    expect(summary.stageSummary?.currentStage).toBe('experiment');
    expect(summary.recentEvents).toHaveLength(1);
    expect(summary.recentEvents[0]?.type).toBe('task_completed');
  });
});
