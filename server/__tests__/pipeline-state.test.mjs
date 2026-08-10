import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { readPipelineState } from '../pipeline/state.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-pipeline-state-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writeTasks(projectPath, tasks) {
  const tasksPath = path.join(projectPath, '.pipeline', 'tasks', 'tasks.json');
  await fs.mkdir(path.dirname(tasksPath), { recursive: true });
  await fs.writeFile(tasksPath, `${JSON.stringify({ master: { tasks } }, null, 2)}\n`, 'utf8');
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('pipeline state', () => {
  it('treats review tasks as actionable and prefers them as the next task after in-progress work', async () => {
    const projectPath = await createTempProject();
    await writeTasks(projectPath, [
      { id: 1, title: 'Completed task', status: 'done', stage: 'literature' },
      { id: 2, title: 'Review quality gate', status: 'review', stage: 'publication' },
      { id: 3, title: 'Pending task', status: 'pending', stage: 'promotion' },
    ]);

    const state = await readPipelineState(projectPath);

    expect(state.actionableTaskCount).toBe(2);
    expect(state.nextTask).toMatchObject({
      id: 2,
      status: 'review',
      title: 'Review quality gate',
    });
  });
});
