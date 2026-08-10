import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeAutoResearchRunJson } from '../pipeline/run-files.js';
import {
  buildAutoResearchResumeMetadata,
  buildAutoResearchResumeState,
  loadAutoResearchResumeState,
} from '../pipeline/resume.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-resume-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('auto-research resume state', () => {
  it('loads a resumable state when checkpoint matches the current next task', async () => {
    const projectPath = await createTempProject();
    const run = {
      id: 'run-resume-1',
      project_path: projectPath,
      status: 'failed',
    };
    await writeAutoResearchRunJson(projectPath, run.id, 'checkpoint.json', {
      nextTaskId: 'task-2',
      nextTaskTitle: 'Run experiment',
      nextStage: 'experiment',
      lastCompletedTaskId: 'task-1',
      lastCompletedTaskTitle: 'Literature refs',
      timestamp: '2026-04-04T00:00:00.000Z',
    });

    const pipelineState = {
      tasksValid: true,
      actionableTaskCount: 1,
      tasks: [
        { id: 'task-1', title: 'Literature refs', status: 'done', stage: 'literature' },
        { id: 'task-2', title: 'Run experiment', status: 'pending', stage: 'experiment' },
      ],
      nextTask: { id: 'task-2', title: 'Run experiment', status: 'pending', stage: 'experiment' },
    };

    const resume = await loadAutoResearchResumeState({
      run,
      pipelineState,
    });

    expect(resume.available).toBe(true);
    expect(resume.nextTaskId).toBe('task-2');
    expect(resume.nextStage).toBe('experiment');
    expect(resume.summary).toContain('Run experiment');
  });

  it('rejects resume when checkpoint and current pipeline next task diverge', () => {
    const resume = buildAutoResearchResumeState({
      run: {
        id: 'run-resume-2',
        status: 'cancelled',
      },
      runTracking: {
        checkpoint: {
          nextTaskId: 'task-3',
          nextTaskTitle: 'Write paper',
        },
      },
      pipelineState: {
        tasksValid: true,
        actionableTaskCount: 1,
        tasks: [
          { id: 'task-4', title: 'Make slides', status: 'pending', stage: 'promotion' },
        ],
        nextTask: { id: 'task-4', title: 'Make slides', status: 'pending', stage: 'promotion' },
      },
    });

    expect(resume.available).toBe(false);
    expect(resume.reason).toBe('checkpoint_mismatch');
  });

  it('rejects non-resumable run statuses', () => {
    const resume = buildAutoResearchResumeState({
      run: {
        id: 'run-resume-3',
        status: 'completed',
      },
      runTracking: {
        checkpoint: {
          nextTaskId: 'task-2',
        },
      },
      pipelineState: {
        tasksValid: true,
        actionableTaskCount: 1,
        tasks: [
          { id: 'task-2', title: 'Run experiment', status: 'pending', stage: 'experiment' },
        ],
        nextTask: { id: 'task-2', title: 'Run experiment', status: 'pending', stage: 'experiment' },
      },
    });

    expect(resume.available).toBe(false);
    expect(resume.reason).toBe('run_not_resumable');
  });
});

describe('auto-research resume metadata', () => {
  it('increments resume count and records checkpoint provenance', () => {
    const metadata = buildAutoResearchResumeMetadata({
      existingMetadata: {
        mode: 'auto_research_v1',
        autoResearchResume: {
          resumeCount: 1,
        },
      },
      resumeState: {
        status: 'failed',
        checkpoint: {
          timestamp: '2026-04-04T00:00:00.000Z',
          nextTaskId: 'task-2',
          nextStage: 'experiment',
        },
      },
      provider: 'claude',
      model: 'opus',
      permissionMode: 'bypassPermissions',
      resumedAt: '2026-04-04T01:00:00.000Z',
    });

    expect(metadata.autoResearchModel).toBe('opus');
    expect(metadata.autoResearchPermissionMode).toBe('bypassPermissions');
    expect(metadata.autoResearchResume.resumeCount).toBe(2);
    expect(metadata.autoResearchResume.resumedFromStatus).toBe('failed');
    expect(metadata.autoResearchResume.checkpointNextTaskId).toBe('task-2');
  });
});
