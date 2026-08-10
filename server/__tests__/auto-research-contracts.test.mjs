import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  deriveAutoResearchStageContractSummary,
  validateAutoResearchStageContract,
} from '../pipeline/contracts.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-contracts-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('auto-research stage contracts', () => {
  it('passes readiness when explicit ideation requirements are present and prior stage is complete', async () => {
    const projectPath = await createTempProject();
    const pipelineState = {
      researchBriefData: {
        pipeline: {
          startStage: 'literature',
          stages: {
            ideation: {
              required_elements: [
                'sections.ideation.research_goal',
                'sections.ideation.problem_framing',
              ],
            },
          },
        },
        sections: {
          ideation: {
            research_goal: 'Test a concrete cohort idea',
            problem_framing: 'Define inclusion, exclusions, and endpoints.',
          },
        },
      },
      tasks: [
        { id: '1', title: 'Literature refs', stage: 'literature', status: 'done' },
        { id: '2', title: 'Generate study direction', stage: 'ideation', status: 'pending' },
      ],
      nextTask: { id: '2', title: 'Generate study direction', stage: 'ideation', status: 'pending' },
      completedTaskCount: 1,
      actionableTaskCount: 1,
    };

    const contract = await validateAutoResearchStageContract({
      stage: 'ideation',
      projectPath,
      pipelineState,
      currentTask: pipelineState.nextTask,
      runStatus: 'queued',
    });

    expect(contract.requiredElementsSource).toBe('brief');
    expect(contract.readiness.overall).toBe('pass');
    expect(contract.readiness.canStart).toBe(true);
    expect(contract.completion.overall).toBe('pending');
  });

  it('blocks a later stage when the previous stage is incomplete', async () => {
    const pipelineState = {
      researchBriefData: {
        pipeline: {
          startStage: 'literature',
          stages: {
            experiment: {
              required_elements: [
                'sections.experiment.hypothesis_or_validation_goal',
              ],
            },
          },
        },
        sections: {
          experiment: {
            hypothesis_or_validation_goal: 'Estimate the primary endpoint.',
          },
        },
      },
      tasks: [
        { id: '1', title: 'Literature refs', stage: 'literature', status: 'done' },
        { id: '2', title: 'Finalize idea', stage: 'ideation', status: 'pending' },
        { id: '3', title: 'Run analysis', stage: 'experiment', status: 'pending' },
      ],
      nextTask: { id: '3', title: 'Run analysis', stage: 'experiment', status: 'pending' },
      completedTaskCount: 1,
      actionableTaskCount: 2,
    };

    const contract = await validateAutoResearchStageContract({
      stage: 'experiment',
      pipelineState,
      currentTask: pipelineState.nextTask,
      runStatus: 'queued',
    });

    expect(contract.readiness.overall).toBe('fail');
    expect(contract.readiness.blockingErrors.map((issue) => issue.code)).toContain('PREVIOUS_STAGE_INCOMPLETE');
  });

  it('downgrades missing fallback brief fields to warnings for legacy projects', async () => {
    const pipelineState = {
      researchBriefData: {
        pipeline: {
          startStage: 'literature',
        },
        sections: {
          literature: {
            core_research_question: 'What predicts the outcome?',
          },
        },
      },
      tasks: [
        { id: '1', title: 'Literature refs', stage: 'literature', status: 'pending' },
      ],
      nextTask: { id: '1', title: 'Literature refs', stage: 'literature', status: 'pending' },
      completedTaskCount: 0,
      actionableTaskCount: 1,
    };

    const contract = await validateAutoResearchStageContract({
      stage: 'literature',
      pipelineState,
      currentTask: pipelineState.nextTask,
      runStatus: 'queued',
    });

    expect(contract.requiredElementsSource).toBe('default');
    expect(contract.readiness.overall).toBe('warn');
    expect(contract.readiness.canStart).toBe(true);
    expect(contract.readiness.warnings.map((issue) => issue.code)).toContain('REQUIRED_ELEMENT_MISSING');
  });

  it('marks completion with warnings when a finished stage is missing expected output roots', async () => {
    const projectPath = await createTempProject();
    const pipelineState = {
      researchBriefData: {
        pipeline: {
          startStage: 'literature',
          stages: {
            publication: {
              required_elements: [
                'sections.publication.paper_outline',
                'sections.publication.figures_tables_plan',
              ],
            },
          },
        },
        sections: {
          publication: {
            paper_outline: 'Intro / Methods / Results / Discussion',
            figures_tables_plan: 'Figure 1 and Table 1',
          },
        },
      },
      tasks: [
        { id: '1', title: 'Draft paper', stage: 'publication', status: 'done' },
      ],
      nextTask: null,
      completedTaskCount: 1,
      actionableTaskCount: 0,
    };

    const contract = await validateAutoResearchStageContract({
      stage: 'publication',
      projectPath,
      pipelineState,
      currentTask: null,
      runStatus: 'completed',
    });

    expect(contract.completion.stageIsDone).toBe(true);
    expect(contract.completion.overall).toBe('warn');
    expect(contract.completion.warnings.map((issue) => issue.code)).toContain('OUTPUT_ROOT_MISSING');
  });
});

describe('auto-research contract summary', () => {
  it('derives a five-stage summary keyed by stage', async () => {
    const projectPath = await createTempProject();
    await fs.mkdir(path.join(projectPath, 'Literature', 'reports'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'Literature', 'references'), { recursive: true });

    const pipelineState = {
      researchBriefData: {
        pipeline: {
          startStage: 'literature',
          stages: {
            literature: {
              required_elements: [
                'sections.literature.core_research_question',
              ],
            },
            ideation: {
              required_elements: [
                'sections.ideation.research_goal',
              ],
            },
          },
        },
        sections: {
          literature: {
            core_research_question: 'Can we summarize prior evidence?',
          },
          ideation: {
            research_goal: 'Pick the next hypothesis.',
          },
        },
      },
      tasks: [
        { id: '1', title: 'Literature refs', stage: 'literature', status: 'done' },
        { id: '2', title: 'Generate ideas', stage: 'ideation', status: 'pending' },
      ],
      nextTask: { id: '2', title: 'Generate ideas', stage: 'ideation', status: 'pending' },
      completedTaskCount: 1,
      actionableTaskCount: 1,
    };

    const summary = await deriveAutoResearchStageContractSummary({
      projectPath,
      pipelineState,
      currentTask: pipelineState.nextTask,
      runStatus: 'running',
    });

    expect(summary.configuredStartStage).toBe('literature');
    expect(summary.currentStage).toBe('ideation');
    expect(summary.stages.literature.completion.overall).toBe('pass');
    expect(summary.stages.ideation.readiness.overall).toBe('pass');
    expect(summary.stages.publication).toBeTruthy();
  });
});
