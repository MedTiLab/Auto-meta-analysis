import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { syncTasksWithResearchBrief, updateTaskRecord } from '../routes/taskmaster.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-taskmaster-brief-sync-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writeBrief(projectPath, brief) {
  const briefPath = path.join(projectPath, '.pipeline', 'docs', 'research_brief.json');
  await fs.mkdir(path.dirname(briefPath), { recursive: true });
  await fs.writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
}

function createBrief(taskTitle, taskDescription, extraBlueprint = null) {
  return {
    meta: {
      title: 'Task sync test',
    },
    pipeline: {
      startStage: 'literature',
      stages: {
        literature: {
          task_blueprints: [
            {
              id: 'literature.baseline',
              title: taskTitle,
              description: taskDescription,
              taskType: 'analysis',
            },
            ...(extraBlueprint ? [extraBlueprint] : []),
          ],
        },
      },
    },
  };
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('taskmaster brief sync', () => {
  it('merges regenerated tasks with existing task state instead of replacing progress', async () => {
    const projectPath = await createTempProject();
    await writeBrief(projectPath, createBrief('Draft baseline question', 'Old description.'));

    const initialSync = await syncTasksWithResearchBrief(projectPath, { mode: 'merge' });
    expect(initialSync.synced).toBe(true);
    expect(initialSync.tasks).toHaveLength(1);
    expect(initialSync.tasks[0]).toMatchObject({
      id: 1,
      title: 'Draft baseline question',
      status: 'pending',
      sourceBlueprintId: 'literature.baseline',
    });

    await updateTaskRecord(projectPath, 1, {
      status: 'in-progress',
      details: 'Manual progress note',
    });

    await writeBrief(projectPath, createBrief(
      'Refine baseline research question',
      'New description from the updated brief.',
      {
        id: 'literature.evidence',
        title: 'Collect seed references',
        description: 'Gather the first pass of core references.',
        taskType: 'analysis',
      },
    ));

    const mergeSync = await syncTasksWithResearchBrief(projectPath, { mode: 'merge' });
    expect(mergeSync.synced).toBe(true);
    expect(mergeSync.tasks).toHaveLength(2);

    const [updatedTask, newTask] = mergeSync.tasks;
    expect(updatedTask).toMatchObject({
      id: 1,
      title: 'Refine baseline research question',
      description: 'New description from the updated brief.',
      status: 'in-progress',
      details: 'Manual progress note',
      sourceBlueprintId: 'literature.baseline',
    });
    expect(newTask).toMatchObject({
      id: 2,
      title: 'Collect seed references',
      status: 'pending',
      sourceBlueprintId: 'literature.evidence',
    });
  });

  it('generates Meta project tasks with numbered workflow stages instead of generic five-stage groups', async () => {
    const projectPath = await createTempProject();
    const template = JSON.parse(
      await fs.readFile(path.resolve('server/taskmaster-templates/medical-meta-project.json'), 'utf8'),
    );
    await writeBrief(projectPath, {
      schemaVersion: '1.1',
      templateId: 'medical-meta-project',
      meta: { title: 'Numbered Meta workflow test' },
      sections: {
        literature: {},
        ideation: {},
        experiment: {},
        publication: {},
        promotion: {},
      },
      pipeline: template.pipeline,
    });

    const sync = await syncTasksWithResearchBrief(projectPath, { mode: 'replace' });
    expect(sync.synced).toBe(true);

    const stages = sync.tasks.map((task) => task.stage);
    expect(stages).not.toEqual(expect.arrayContaining(['ideation', 'experiment', 'publication', 'promotion']));
    expect(stages).toEqual(expect.arrayContaining([
      'literature',
      'protocol',
      'search_dedupe',
      'title_abstract_screening',
      'full_text_review',
      'data_extraction',
      'quality_assessment',
      'data_analysis',
      'results_figures',
      'manuscript_submission',
      'presentation',
    ]));
    expect(sync.tasks.find((task) => task.sourceBlueprintId === 'meta_title_abstract_screening')?.stage)
      .toBe('title_abstract_screening');
    expect(sync.tasks.find((task) => task.sourceBlueprintId === 'meta_full_text_pdf_mineru')?.stage)
      .toBe('full_text_review');
    expect(sync.tasks.find((task) => task.sourceBlueprintId === 'meta_results_figures')?.stage)
      .toBe('results_figures');
  });

  it('migrates legacy five-stage Meta pipeline blueprints into numbered workflow stages', async () => {
    const projectPath = await createTempProject();
    await writeBrief(projectPath, {
      schemaVersion: '1.1',
      templateId: 'medical-meta-project',
      meta: { title: 'Legacy Meta workflow test' },
      pipeline: {
        version: '1.1',
        mode: 'meta',
        startStage: 'literature',
        stages: {
          literature: {
            task_blueprints: [
              { id: 'meta_literature_scope', title: 'Literature scope' },
              { id: 'meta_reference_dedupe_plan', title: 'Dedupe references' },
            ],
          },
          ideation: {
            task_blueprints: [
              { id: 'meta_protocol_lock', title: 'Lock protocol' },
            ],
          },
          experiment: {
            task_blueprints: [
              { id: 'meta_title_abstract_screening', title: 'Screen titles' },
              { id: 'meta_full_text_pdf_mineru', title: 'Review full text' },
              { id: 'meta_data_extraction', title: 'Extract data' },
              { id: 'meta_quality_assessment', title: 'Assess quality' },
              { id: 'meta_statistics', title: 'Run analysis' },
            ],
          },
          publication: {
            task_blueprints: [
              { id: 'meta_prisma_manuscript', title: 'Draft manuscript' },
            ],
          },
          promotion: {
            task_blueprints: [
              { id: 'meta_presentation_storyline', title: 'Build presentation' },
            ],
          },
        },
      },
    });

    const sync = await syncTasksWithResearchBrief(projectPath, { mode: 'replace' });
    expect(sync.synced).toBe(true);

    const stageByBlueprint = Object.fromEntries(
      sync.tasks
        .filter((task) => task.sourceBlueprintId?.startsWith('meta_'))
        .map((task) => [task.sourceBlueprintId, task.stage]),
    );
    expect(stageByBlueprint).toMatchObject({
      meta_literature_scope: 'literature',
      meta_reference_dedupe_plan: 'search_dedupe',
      meta_protocol_lock: 'protocol',
      meta_title_abstract_screening: 'title_abstract_screening',
      meta_full_text_pdf_mineru: 'full_text_review',
      meta_data_extraction: 'data_extraction',
      meta_quality_assessment: 'quality_assessment',
      meta_statistics: 'data_analysis',
      meta_prisma_manuscript: 'manuscript_submission',
      meta_presentation_storyline: 'presentation',
    });
    expect(Object.values(stageByBlueprint)).not.toEqual(expect.arrayContaining([
      'ideation',
      'experiment',
      'publication',
      'promotion',
    ]));
  });
});
