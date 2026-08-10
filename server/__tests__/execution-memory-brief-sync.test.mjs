import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { createExecutionMemoryTracker } from '../execution-memory/tracker.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-execution-brief-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writeResearchBrief(projectPath, brief) {
  const briefPath = path.join(projectPath, '.pipeline', 'docs', 'research_brief.json');
  await fs.mkdir(path.dirname(briefPath), { recursive: true });
  await fs.writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
  return briefPath;
}

async function writeArtifact(projectPath, relativePath, content) {
  const artifactPath = path.join(projectPath, relativePath);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, content, 'utf8');
  return artifactPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('execution memory research brief sync', () => {
  it('syncs confirmed artifacts and completed microtasks into research_brief.json without overwriting stage fields', async () => {
    const projectPath = await createTempProject();
    const briefPath = await writeResearchBrief(projectPath, {
      schemaVersion: '1.1',
      meta: {
        title: 'Overall survival study',
        date: '2026-04-05',
      },
      sections: {
        experiment: {
          evaluation_plan: 'Original statistical evaluation plan.',
        },
      },
      pipeline: {},
    });

    const tracker = createExecutionMemoryTracker({
      scope: 'run',
      projectPath,
      provider: 'claude',
      runId: 'run-sync-1',
      currentObjective: 'Analyze overall survival.',
      stage: 'experiment',
    });

    await writeArtifact(projectPath, path.join('Experiment', 'analysis', 'cox_results.json'), JSON.stringify({
      term: 'treated cohort',
      hazard_ratio: 1.42,
      ci_lower: 1.18,
      ci_upper: 1.71,
      p_value: 0.0003,
    }, null, 2));

    await tracker.recordTaskStarted({
      id: '1',
      title: 'Run Cox model',
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
            id: 'todo-sync-1',
            name: 'TodoWrite',
            input: {
              todos: [
                { id: 'm1', content: 'Clean cohort', status: 'completed' },
                { id: 'm2', content: 'Run Cox model', status: 'in_progress' },
              ],
            },
          }],
        },
      },
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'tool-sync-1',
            name: 'Edit',
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
          tool_use_id: 'tool-sync-1',
          content: 'Saved cox_results.json',
          is_error: false,
        }],
      },
    });

    await tracker.recordTaskCompleted({
      id: '1',
      title: 'Run Cox model',
      stage: 'experiment',
    }, {
      stage: 'experiment',
      summary: 'Completed Run Cox model',
    });

    const brief = JSON.parse(await fs.readFile(briefPath, 'utf8'));
    const experimentSync = brief?.execution_memory_sync?.stages?.experiment;

    expect(brief.sections.experiment.evaluation_plan).toBe('Original statistical evaluation plan.');
    expect(experimentSync).toBeTruthy();
    expect(experimentSync.confirmedArtifacts).toContain('Experiment/analysis/cox_results.json');
    expect(experimentSync.completedMicrotasks).toContain('Clean cohort');
    expect(experimentSync.completedTasks).toContain('Run Cox model');
    expect(experimentSync.confirmedFindings).toContain('treated cohort: HR 1.42 (95% CI 1.18-1.71), p = 0.0003');
    expect(experimentSync.summary).toContain('Confirmed artifacts: Experiment/analysis/cox_results.json');
  });

  it('does not create research_brief.json when confirmed results exist but no brief is present yet', async () => {
    const projectPath = await createTempProject();
    const briefPath = path.join(projectPath, '.pipeline', 'docs', 'research_brief.json');
    const tracker = createExecutionMemoryTracker({
      scope: 'run',
      projectPath,
      provider: 'claude',
      runId: 'run-sync-2',
      currentObjective: 'Analyze biomarkers.',
      stage: 'experiment',
    });

    await tracker.recordTaskStarted({
      id: '2',
      title: 'Build biomarker table',
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
            id: 'tool-sync-2',
            name: 'Write',
            input: {
              file_path: 'Experiment/analysis/biomarker_table.csv',
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
          tool_use_id: 'tool-sync-2',
          content: 'Saved biomarker_table.csv',
          is_error: false,
        }],
      },
    });

    await expect(fs.access(briefPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
