import path from 'path';
import { constants as fsConstants, promises as fs } from 'fs';

import {
  AUTO_RESEARCH_STAGE_META,
  AUTO_RESEARCH_STAGE_SEQUENCE,
  deriveAutoResearchStateMachine,
  getPreviousAutoResearchStage,
  normalizeAutoResearchStage,
} from './state-machine.js';

const AUTO_RESEARCH_STAGE_CONTRACT_META = {
  literature: {
    objective: 'Frame the research question, evidence scope, and source inventory before downstream work starts.',
    defaultRequiredElements: [
      'sections.literature.core_research_question',
      'sections.literature.literature_scope',
      'sections.literature.synthesis_summary',
    ],
    defaultOptionalElements: [
      'sections.literature.key_references',
      'sections.literature.seed_papers',
      'sections.literature.open_gaps',
      'sections.literature.evidence_requirements',
    ],
    qualityGate: [
      'The literature question is specific enough to guide later stage work.',
      'Prior evidence and open gaps are summarized concretely.',
      'The source inventory is clear enough for follow-up ideation and experiments.',
    ],
    expectedOutputs: [
      { key: 'literature_reports', label: 'Literature reports', relativePath: path.join('Literature', 'reports') },
      { key: 'literature_references', label: 'Reference papers', relativePath: path.join('Literature', 'references') },
    ],
    definitionOfDone: [
      'All literature tasks are marked done.',
      'The brief captures the research question, scope, and evidence synthesis.',
      'Literature reports and references are created or explicitly waived.',
    ],
  },
  ideation: {
    objective: 'Turn literature findings into a crisp study direction with explicit framing and success criteria.',
    defaultRequiredElements: [
      'sections.ideation.research_goal',
      'sections.ideation.clinical_or_scientific_gap',
      'sections.ideation.problem_framing',
      'sections.ideation.evidence_plan',
    ],
    defaultOptionalElements: [
      'sections.ideation.success_criteria',
    ],
    qualityGate: [
      'The proposed idea is anchored in the literature evidence rather than a generic topic shift.',
      'The study framing is operational enough to produce a field manifest or implementation plan.',
      'Success criteria are explicit enough to judge experiment quality later.',
    ],
    expectedOutputs: [
      { key: 'ideation_ideas', label: 'Research ideas', relativePath: path.join('Ideation', 'ideas') },
      { key: 'ideation_references', label: 'Ideation references', relativePath: path.join('Ideation', 'references') },
    ],
    definitionOfDone: [
      'All ideation tasks are marked done.',
      'The brief captures the chosen direction, framing, and evidence plan.',
      'At least one concrete idea artifact exists for downstream experiment work.',
    ],
  },
  experiment: {
    objective: 'Produce a reproducible implementation and analysis plan that can generate interpretable results.',
    defaultRequiredElements: [
      'sections.experiment.hypothesis_or_validation_goal',
      'sections.experiment.dataset_or_data_source',
      'sections.experiment.method_or_protocol',
      'sections.experiment.evaluation_plan',
    ],
    defaultOptionalElements: [
      'sections.experiment.sensitivity_plan',
    ],
    qualityGate: [
      'The data extraction and implementation plan are reproducible.',
      'Evaluation covers the primary metric or estimand and relevant robustness checks.',
      'The experiment outputs are detailed enough to feed publication materials.',
    ],
    expectedOutputs: [
      { key: 'experiment_core_code', label: 'Experiment core code', relativePath: path.join('Experiment', 'core_code') },
      { key: 'experiment_datasets', label: 'Experiment datasets', relativePath: path.join('Experiment', 'datasets') },
      { key: 'experiment_code_references', label: 'Experiment code references', relativePath: path.join('Experiment', 'code_references') },
      { key: 'experiment_analysis', label: 'Experiment analysis', relativePath: path.join('Experiment', 'analysis') },
    ],
    definitionOfDone: [
      'All experiment tasks are marked done.',
      'The brief captures the implementation, dataset, and evaluation plan.',
      'Runnable code or analysis artifacts exist for publication to build on.',
    ],
  },
  publication: {
    objective: 'Convert experiment outputs into a manuscript package with traceable figures, tables, and references.',
    defaultRequiredElements: [
      'sections.publication.paper_outline',
      'sections.publication.figures_tables_plan',
    ],
    defaultOptionalElements: [
      'sections.publication.artifact_plan',
      'sections.publication.submission_checklist',
    ],
    qualityGate: [
      'The paper outline reflects the finished experiment and target venue expectations.',
      'Figures and tables are mapped to actual experiment outputs.',
      'Citation and submission quality checks are ready for the next validation step.',
    ],
    expectedOutputs: [
      { key: 'publication_manuscript', label: 'Manuscript draft', relativePath: path.join('Publication', 'manuscript') },
      { key: 'publication_figures', label: 'Publication figures', relativePath: path.join('Publication', 'figures') },
      { key: 'publication_tables', label: 'Publication tables', relativePath: path.join('Publication', 'tables') },
      { key: 'publication_supplementary', label: 'Supplementary materials', relativePath: path.join('Publication', 'supplementary') },
    ],
    definitionOfDone: [
      'All publication tasks are marked done.',
      'The brief captures the manuscript outline and figure/table plan.',
      'A paper draft or figure package exists for downstream promotion assets.',
    ],
  },
  promotion: {
    objective: 'Package the finished work into presentation and dissemination assets.',
    defaultRequiredElements: [
      'sections.promotion.slide_outline',
      'sections.promotion.homepage_plan',
    ],
    defaultOptionalElements: [
      'sections.promotion.deck_style',
      'sections.promotion.tts_config',
      'sections.promotion.video_assembly_plan',
    ],
    qualityGate: [
      'Promotion materials faithfully summarize the publication-stage conclusions.',
      'Slide and homepage plans are concrete enough to render assets without guessing.',
      'Narration or video plans are explicit when audio/video output is expected.',
    ],
    expectedOutputs: [
      { key: 'promotion_slides', label: 'Slide deck', relativePath: path.join('Promotion', 'slides') },
      { key: 'promotion_audio', label: 'Audio narration', relativePath: path.join('Promotion', 'audio') },
      { key: 'promotion_video', label: 'Demo video', relativePath: path.join('Promotion', 'video') },
      { key: 'promotion_homepage', label: 'Project homepage', relativePath: path.join('Promotion', 'homepage') },
    ],
    definitionOfDone: [
      'All promotion tasks are marked done.',
      'The brief captures the dissemination plan for slides and homepage.',
      'At least one promotion artifact root exists for asset generation.',
    ],
  },
};

const AUTO_RESEARCH_CONTRACT_ERROR_META = {
  STAGE_UNKNOWN: {
    defaultStatus: 'fail',
    defaultFix: 'Use one of the canonical stages: literature, ideation, experiment, publication, promotion.',
  },
  BRIEF_MISSING: {
    defaultStatus: 'fail',
    defaultFix: 'Generate or repair .pipeline/docs/research_brief.json before continuing.',
  },
  REQUIRED_ELEMENT_MISSING: {
    defaultStatus: 'fail',
  },
  TASKS_MISSING: {
    defaultStatus: 'fail',
  },
  PREVIOUS_STAGE_INCOMPLETE: {
    defaultStatus: 'fail',
  },
  OUTPUT_ROOT_MISSING: {
    defaultStatus: 'warn',
  },
};

function getValueAtPath(source, dottedPath) {
  if (!source || !dottedPath) return undefined;
  return dottedPath.split('.').reduce((value, part) => {
    if (value == null) return undefined;
    return value[part];
  }, source);
}

function hasMeaningfulValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((entry) => hasMeaningfulValue(entry));
  if (typeof value === 'object') return Object.values(value).some((entry) => hasMeaningfulValue(entry));
  return true;
}

function createContractIssue(code, detail, extras = {}) {
  const meta = AUTO_RESEARCH_CONTRACT_ERROR_META[code] || {};
  return {
    code,
    status: extras.status || meta.defaultStatus || 'fail',
    detail,
    ...(extras.fix || meta.defaultFix ? { fix: extras.fix || meta.defaultFix } : {}),
    ...(extras.path ? { path: extras.path } : {}),
    ...(extras.source ? { source: extras.source } : {}),
    ...(extras.relativePath ? { relativePath: extras.relativePath } : {}),
    ...(extras.stage ? { stage: extras.stage } : {}),
  };
}

function buildTaskStats(stageBucket = {}) {
  return {
    totalTasks: stageBucket.totalTasks || 0,
    completedTasks: stageBucket.completedTasks || 0,
    pendingTasks: stageBucket.pendingTasks || 0,
    runningTasks: stageBucket.runningTasks || 0,
    failedTasks: stageBucket.failedTasks || 0,
    status: stageBucket.status || 'unplanned',
    activeTaskId: stageBucket.activeTaskId || null,
    activeTaskTitle: stageBucket.activeTaskTitle || null,
  };
}

function summarizeContractResult(label, result, successMessage) {
  if (result.blockingErrors.length > 0) {
    return `${label} contract blocked: ${result.blockingErrors[0].detail}`;
  }
  if (result.warnings.length > 0) {
    return `${label} contract has warnings: ${result.warnings[0].detail}`;
  }
  return successMessage;
}

async function inspectExpectedOutputs(projectPath, expectedOutputs = []) {
  return Promise.all(expectedOutputs.map(async (output) => {
    const absolutePath = projectPath ? path.join(projectPath, output.relativePath) : null;

    if (!absolutePath) {
      return {
        ...output,
        absolutePath: null,
        exists: null,
        status: 'unchecked',
      };
    }

    try {
      await fs.access(absolutePath, fsConstants.F_OK);
      return {
        ...output,
        absolutePath,
        exists: true,
        status: 'present',
      };
    } catch {
      return {
        ...output,
        absolutePath,
        exists: false,
        status: 'missing',
      };
    }
  }));
}

function getConfiguredStartStage(researchBriefData) {
  const startStage = normalizeAutoResearchStage(researchBriefData?.pipeline?.startStage || 'literature');
  return AUTO_RESEARCH_STAGE_META[startStage] ? startStage : 'literature';
}

function buildAutoResearchStageContract(stage, { researchBriefData = null } = {}) {
  const key = normalizeAutoResearchStage(stage);
  const fallbackMeta = AUTO_RESEARCH_STAGE_CONTRACT_META[key] || null;
  const stageMeta = AUTO_RESEARCH_STAGE_META[key] || null;
  const configuredStage = researchBriefData?.pipeline?.stages?.[key] || null;

  if (!stageMeta || !fallbackMeta) {
    return {
      key,
      label: key === 'unknown' ? 'Unknown' : String(stage || ''),
      objective: 'Unknown stage',
      index: null,
      previousStage: null,
      requiredElements: [],
      requiredElementsSource: 'unknown',
      enforceRequiredElements: false,
      optionalElements: [],
      qualityGate: [],
      expectedOutputs: [],
      definitionOfDone: [],
      errorCodes: ['STAGE_UNKNOWN'],
    };
  }

  const explicitRequiredElements = Array.isArray(configuredStage?.required_elements)
    ? configuredStage.required_elements.filter(Boolean)
    : [];
  const explicitOptionalElements = Array.isArray(configuredStage?.optional_elements)
    ? configuredStage.optional_elements.filter(Boolean)
    : [];
  const qualityGate = Array.isArray(configuredStage?.quality_gate) && configuredStage.quality_gate.length > 0
    ? configuredStage.quality_gate
    : fallbackMeta.qualityGate;

  return {
    key,
    label: stageMeta.label,
    objective: fallbackMeta.objective,
    index: stageMeta.index,
    previousStage: getPreviousAutoResearchStage(key),
    requiredElements: explicitRequiredElements.length > 0
      ? explicitRequiredElements
      : fallbackMeta.defaultRequiredElements,
    requiredElementsSource: explicitRequiredElements.length > 0 ? 'brief' : 'default',
    enforceRequiredElements: explicitRequiredElements.length > 0,
    optionalElements: explicitOptionalElements.length > 0
      ? explicitOptionalElements
      : fallbackMeta.defaultOptionalElements,
    qualityGate,
    expectedOutputs: fallbackMeta.expectedOutputs,
    definitionOfDone: fallbackMeta.definitionOfDone,
    errorCodes: Object.keys(AUTO_RESEARCH_CONTRACT_ERROR_META),
  };
}

async function validateAutoResearchStageContract({
  stage,
  projectPath = null,
  pipelineState = null,
  researchBriefData = pipelineState?.researchBriefData || null,
  currentTask = null,
  runStatus = 'idle',
  stateMachine = null,
} = {}) {
  const key = normalizeAutoResearchStage(stage);
  const contract = buildAutoResearchStageContract(key, { researchBriefData });
  const machine = stateMachine || deriveAutoResearchStateMachine({
    pipelineState,
    currentTask,
    runStatus,
  });
  const stageBucket = machine?.stages?.[key] || null;
  const taskStats = buildTaskStats(stageBucket);
  const readinessIssues = [];
  const completionIssues = [];
  const configuredStartStage = getConfiguredStartStage(researchBriefData);
  const configuredStartMeta = AUTO_RESEARCH_STAGE_META[configuredStartStage];
  const currentMeta = AUTO_RESEARCH_STAGE_META[key];

  if (!currentMeta) {
    const issue = createContractIssue(
      'STAGE_UNKNOWN',
      `Stage ${String(stage || '(empty)')} is not a recognized Auto Research stage.`,
      { stage: String(stage || '') },
    );
    readinessIssues.push(issue);
    completionIssues.push(issue);
  } else {
    if (!researchBriefData) {
      const issue = createContractIssue(
        'BRIEF_MISSING',
        `Research brief data is unavailable for the ${contract.label} contract.`,
        { stage: key },
      );
      readinessIssues.push(issue);
      completionIssues.push(issue);
    } else {
      const missingRequiredElements = contract.requiredElements.filter((elementPath) => (
        !hasMeaningfulValue(getValueAtPath(researchBriefData, elementPath))
      ));

      for (const elementPath of missingRequiredElements) {
        const issue = createContractIssue(
          'REQUIRED_ELEMENT_MISSING',
          `${contract.label} requires ${elementPath} before the stage can be trusted.`,
          {
            stage: key,
            path: elementPath,
            source: contract.requiredElementsSource,
            status: contract.enforceRequiredElements ? 'fail' : 'warn',
            fix: `Populate ${elementPath} in .pipeline/docs/research_brief.json or regenerate the ${contract.label} section.`,
          },
        );
        readinessIssues.push(issue);
        completionIssues.push(issue);
      }
    }

    if (taskStats.totalTasks === 0) {
      const issue = createContractIssue(
        'TASKS_MISSING',
        `No tasks are planned for the ${contract.label} stage.`,
        {
          stage: key,
          fix: `Regenerate .pipeline/tasks/tasks.json so the ${contract.label} stage has executable tasks.`,
        },
      );
      readinessIssues.push(issue);
      completionIssues.push(issue);
    }

    if (currentMeta.index > configuredStartMeta.index) {
      const previousStage = getPreviousAutoResearchStage(key);
      const previousStageStatus = previousStage ? machine?.stages?.[previousStage]?.status : null;

      if (previousStage && previousStageStatus !== 'done') {
        const issue = createContractIssue(
          'PREVIOUS_STAGE_INCOMPLETE',
          `${contract.label} cannot start until ${AUTO_RESEARCH_STAGE_META[previousStage]?.label || previousStage} is complete.`,
          {
            stage: key,
            fix: `Finish or intentionally skip the ${AUTO_RESEARCH_STAGE_META[previousStage]?.label || previousStage} stage before running ${contract.label}.`,
          },
        );
        readinessIssues.push(issue);
      }
    }

  }

  const outputChecks = await inspectExpectedOutputs(projectPath, contract.expectedOutputs);
  const stageIsDone = taskStats.totalTasks > 0 && taskStats.completedTasks === taskStats.totalTasks;

  if (stageIsDone) {
    for (const output of outputChecks) {
      if (output.exists === false) {
        completionIssues.push(createContractIssue(
          'OUTPUT_ROOT_MISSING',
          `${contract.label} expected output root is missing: ${output.relativePath}`,
          {
            stage: key,
            relativePath: output.relativePath,
            fix: `Write ${contract.label} outputs under ${output.relativePath} or document why the artifact is intentionally skipped.`,
          },
        ));
      }
    }
  }

  const readiness = {
    overall: readinessIssues.some((issue) => issue.status === 'fail')
      ? 'fail'
      : readinessIssues.some((issue) => issue.status === 'warn')
        ? 'warn'
        : 'pass',
    canStart: !readinessIssues.some((issue) => issue.status === 'fail'),
    blockingErrors: readinessIssues.filter((issue) => issue.status === 'fail'),
    warnings: readinessIssues.filter((issue) => issue.status === 'warn'),
  };
  readiness.summary = summarizeContractResult(
    contract.label,
    readiness,
    `${contract.label} contract is ready for execution.`,
  );

  const completion = {
    overall: !stageIsDone
      ? 'pending'
      : completionIssues.some((issue) => issue.status === 'fail')
        ? 'fail'
        : completionIssues.some((issue) => issue.status === 'warn')
          ? 'warn'
          : 'pass',
    applicable: taskStats.totalTasks > 0,
    stageIsDone,
    satisfied: stageIsDone && !completionIssues.some((issue) => issue.status === 'fail'),
    blockingErrors: completionIssues.filter((issue) => issue.status === 'fail'),
    warnings: completionIssues.filter((issue) => issue.status === 'warn'),
  };
  if (!completion.applicable) {
    completion.summary = `${contract.label} completion contract cannot be evaluated because no tasks are planned.`;
  } else if (!stageIsDone) {
    completion.summary = completion.blockingErrors.length > 0
      ? `${contract.label} completion is pending and already has blockers: ${completion.blockingErrors[0].detail}`
      : `${contract.label} completion is pending until all stage tasks are done.`;
  } else {
    completion.summary = summarizeContractResult(
      contract.label,
      completion,
      `${contract.label} contract is satisfied.`,
    );
  }

  return {
    ...contract,
    configuredStartStage,
    currentStageStatus: taskStats.status,
    taskStats,
    outputChecks,
    readiness,
    completion,
  };
}

async function deriveAutoResearchStageContractSummary({
  projectPath = null,
  pipelineState = null,
  researchBriefData = pipelineState?.researchBriefData || null,
  currentTask = null,
  runStatus = 'idle',
  generatedAt = new Date().toISOString(),
} = {}) {
  const stateMachine = deriveAutoResearchStateMachine({
    pipelineState,
    currentTask,
    runStatus,
    generatedAt,
  });
  const stages = await Promise.all(AUTO_RESEARCH_STAGE_SEQUENCE.map(async (stage) => (
    validateAutoResearchStageContract({
      stage,
      projectPath,
      pipelineState,
      researchBriefData,
      currentTask,
      runStatus,
      stateMachine,
    })
  )));

  const stageMap = Object.fromEntries(stages.map((stage) => [stage.key, stage]));
  const overall = stages.some((stage) => stage.readiness.overall === 'fail' || stage.completion.overall === 'fail')
    ? 'fail'
    : stages.some((stage) => stage.readiness.overall === 'warn' || stage.completion.overall === 'warn')
      ? 'warn'
      : 'pass';

  return {
    generatedAt,
    overall,
    configuredStartStage: getConfiguredStartStage(researchBriefData),
    currentStage: stateMachine.currentStage,
    nextStage: stateMachine.nextStage,
    stages: stageMap,
  };
}

export {
  AUTO_RESEARCH_CONTRACT_ERROR_META,
  AUTO_RESEARCH_STAGE_CONTRACT_META,
  buildAutoResearchStageContract,
  deriveAutoResearchStageContractSummary,
  getConfiguredStartStage,
  validateAutoResearchStageContract,
};
