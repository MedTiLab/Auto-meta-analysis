import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { createExecutionMemoryTracker } from '../execution-memory/tracker.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-execution-task-sync-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writeTasks(projectPath, tasks) {
  const tasksPath = path.join(projectPath, '.pipeline', 'tasks', 'tasks.json');
  await fs.mkdir(path.dirname(tasksPath), { recursive: true });
  await fs.writeFile(tasksPath, `${JSON.stringify({ master: { tasks } }, null, 2)}\n`, 'utf8');
  return tasksPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('execution memory task sync', () => {
  it('marks the active task done when confirmed outputs and completion cues are recorded', async () => {
    const projectPath = await createTempProject();
    const tasksPath = await writeTasks(projectPath, [
      {
        id: 1,
        title: 'Run Cox model',
        description: 'Fit the survival model and summarize outputs.',
        status: 'pending',
        stage: 'experiment',
        details: '',
      },
    ]);

    const resultPath = path.join(projectPath, 'Experiment', 'analysis', 'cox_results.json');
    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    await fs.writeFile(resultPath, JSON.stringify({
      term: 'treated cohort',
      hazard_ratio: 1.42,
      ci_lower: 1.18,
      ci_upper: 1.71,
      p_value: 0.0003,
    }, null, 2), 'utf8');

    const tracker = createExecutionMemoryTracker({
      scope: 'session',
      projectPath,
      provider: 'claude',
      sessionId: 'session-task-sync-1',
      currentObjective: 'Task: Run Cox model',
      currentTaskId: '1',
      currentTaskTitle: 'Run Cox model',
      stage: 'experiment',
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'tool-task-sync-1',
            name: 'Write',
            input: {
              file_path: 'Experiment/analysis/cox_results.json',
            },
          }],
        },
      },
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-task-sync-1',
          content: 'Saved cox_results.json',
          is_error: false,
        }],
      },
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: 'Completed Run Cox model and verified the treated cohort hazard ratio output.',
          }],
        },
      },
    });

    const payload = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
    const task = payload.master.tasks[0];

    expect(task.status).toBe('done');
    expect(task.details).toContain('Execution memory sync:');
    expect(task.details).toContain('Touched files: Experiment/analysis/cox_results.json');
    expect(task.details).toContain('Confirmed artifacts: Experiment/analysis/cox_results.json');
    expect(task.details).toContain('treated cohort: HR 1.42 (95% CI 1.18-1.71), p = 0.0003');
    expect(task.details).toContain('Latest update: Completed Run Cox model and verified the treated cohort hazard ratio output.');
  });

  it('moves review tasks into review when audit evidence exists but sign-off is still pending', async () => {
    const projectPath = await createTempProject();
    const tasksPath = await writeTasks(projectPath, [
      {
        id: 1,
        title: 'Review Publication quality gate before moving forward',
        description: 'Complete and verify Publication quality gate criteria.',
        status: 'pending',
        stage: 'publication',
        sourceBlueprintId: 'publication.quality_gate',
        details: '',
      },
    ]);

    const reviewPath = path.join(projectPath, 'Publication', 'review', 'quality_gate_review.md');
    await fs.mkdir(path.dirname(reviewPath), { recursive: true });
    await fs.writeFile(reviewPath, '# Review\n\nPending sign-off.\n', 'utf8');

    const tracker = createExecutionMemoryTracker({
      scope: 'session',
      projectPath,
      provider: 'claude',
      sessionId: 'session-task-sync-review',
      currentObjective: 'Task: Review Publication quality gate before moving forward',
      currentTaskId: '1',
      currentTaskTitle: 'Review Publication quality gate before moving forward',
      stage: 'publication',
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'tool-task-sync-review-1',
            name: 'Write',
            input: {
              file_path: 'Publication/review/quality_gate_review.md',
            },
          }],
        },
      },
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-task-sync-review-1',
          content: 'Saved quality_gate_review.md',
          is_error: false,
        }],
      },
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: 'Reviewed Publication quality gate before moving forward and captured the audit notes. Approval is still pending before moving forward.',
          }],
        },
      },
    });

    const payload = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
    const task = payload.master.tasks[0];

    expect(task.status).toBe('review');
    expect(task.details).toContain('Status: review');
    expect(task.details).toContain('Touched files: Publication/review/quality_gate_review.md');
    expect(task.details).toContain('Report artifacts: Publication/review/quality_gate_review.md');
    expect(task.details).toContain('Confirmed artifacts: Publication/review/quality_gate_review.md');
    expect(task.details).toContain('Latest update: Reviewed Publication quality gate before moving forward and captured the audit notes. Approval is still pending before moving forward.');
  });

  it('marks review tasks done after an explicit approval verdict is recorded', async () => {
    const projectPath = await createTempProject();
    const tasksPath = await writeTasks(projectPath, [
      {
        id: 1,
        title: 'Review Publication quality gate before moving forward',
        description: 'Complete and verify Publication quality gate criteria.',
        status: 'pending',
        stage: 'publication',
        sourceBlueprintId: 'publication.quality_gate',
        details: '',
      },
    ]);

    const reviewPath = path.join(projectPath, 'Publication', 'review', 'quality_gate_review.md');
    await fs.mkdir(path.dirname(reviewPath), { recursive: true });
    await fs.writeFile(reviewPath, '# Review\n\nQuality gate passed.\n', 'utf8');

    const tracker = createExecutionMemoryTracker({
      scope: 'session',
      projectPath,
      provider: 'claude',
      sessionId: 'session-task-sync-review-pass',
      currentObjective: 'Task: Review Publication quality gate before moving forward',
      currentTaskId: '1',
      currentTaskTitle: 'Review Publication quality gate before moving forward',
      stage: 'publication',
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'tool-task-sync-review-2',
            name: 'Write',
            input: {
              file_path: 'Publication/review/quality_gate_review.md',
            },
          }],
        },
      },
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-task-sync-review-2',
          content: 'Saved quality_gate_review.md',
          is_error: false,
        }],
      },
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: 'Reviewed Publication quality gate before moving forward and the quality gate passed. The audit was approved and is ready to move forward.',
          }],
        },
      },
    });

    const payload = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
    const task = payload.master.tasks[0];

    expect(task.status).toBe('done');
    expect(task.details).toContain('Status: done');
    expect(task.details).toContain('Report artifacts: Publication/review/quality_gate_review.md');
  });
});
