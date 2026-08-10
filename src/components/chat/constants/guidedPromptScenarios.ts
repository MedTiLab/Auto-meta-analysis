import {
  META_ANALYSIS_PIPELINE_SKILLS,
  META_ANALYSIS_STAGE_SKILLS,
  META_ANALYSIS_SYNTHESIS_TYPE_SKILLS,
} from './metaAnalysisSkills';

export interface GuidedPromptScenario {
  id: string;
  icon: string;
  titleKey: string;
  descriptionKey: string;
  skills: string[];
  autoRoutePromptKey?: string;
  reviewType?: string;
  children?: GuidedPromptScenario[];
}

export const GUIDED_PROMPT_SCENARIOS: GuidedPromptScenario[] = [
  {
    id: 'paper-polishing',
    icon: '✨',
    titleKey: 'guidedStarter.scenarios.paperPolishing.title',
    descriptionKey: 'guidedStarter.scenarios.paperPolishing.description',
    skills: [
      'nature-polishing',
      'inno-humanizer',
      'scientific-writing',
      'citation-management',
      'venue-templates',
    ],
  },
  {
    id: 'manuscript-review',
    icon: '🧾',
    titleKey: 'guidedStarter.scenarios.manuscriptReview.title',
    descriptionKey: 'guidedStarter.scenarios.manuscriptReview.description',
    skills: ['inno-paper-reviewer', 'peer-review', 'inno-reference-audit', 'citation-management', 'inno-humanizer'],
  },
  {
    id: 'rebuttal-response',
    icon: '💬',
    titleKey: 'guidedStarter.scenarios.rebuttalResponse.title',
    descriptionKey: 'guidedStarter.scenarios.rebuttalResponse.description',
    skills: ['inno-rebuttal', 'peer-review', 'citation-management'],
  },
];

export const META_ANALYSIS_SYNTHESIS_TYPE_SCENARIOS: GuidedPromptScenario[] = [
  {
    id: 'meta-diagnostic',
    icon: '🩺',
    titleKey: 'guidedStarter.metaModes.diagnostic.title',
    descriptionKey: 'guidedStarter.metaModes.diagnostic.description',
    reviewType: 'diagnostic',
    autoRoutePromptKey: 'guidedStarter.prompts.metaDiagnostic',
    skills: [...META_ANALYSIS_SYNTHESIS_TYPE_SKILLS.diagnostic],
  },
  {
    id: 'meta-intervention',
    icon: '💊',
    titleKey: 'guidedStarter.metaModes.intervention.title',
    descriptionKey: 'guidedStarter.metaModes.intervention.description',
    reviewType: 'intervention',
    autoRoutePromptKey: 'guidedStarter.prompts.metaIntervention',
    skills: [...META_ANALYSIS_SYNTHESIS_TYPE_SKILLS.intervention],
  },
  {
    id: 'meta-prognostic',
    icon: '⏱️',
    titleKey: 'guidedStarter.metaModes.prognostic.title',
    descriptionKey: 'guidedStarter.metaModes.prognostic.description',
    reviewType: 'prognostic',
    autoRoutePromptKey: 'guidedStarter.prompts.metaPrognostic',
    skills: [...META_ANALYSIS_SYNTHESIS_TYPE_SKILLS.prognostic],
  },
  {
    id: 'meta-prevalence',
    icon: '％',
    titleKey: 'guidedStarter.metaModes.prevalence.title',
    descriptionKey: 'guidedStarter.metaModes.prevalence.description',
    reviewType: 'prevalence',
    autoRoutePromptKey: 'guidedStarter.prompts.metaPrevalence',
    skills: [...META_ANALYSIS_SYNTHESIS_TYPE_SKILLS.prevalence],
  },
  {
    id: 'meta-network',
    icon: '🕸️',
    titleKey: 'guidedStarter.metaModes.network.title',
    descriptionKey: 'guidedStarter.metaModes.network.description',
    reviewType: 'network',
    autoRoutePromptKey: 'guidedStarter.prompts.metaNetwork',
    skills: [...META_ANALYSIS_SYNTHESIS_TYPE_SKILLS.network],
  },
];

export const META_ANALYSIS_MODE_SCENARIOS = META_ANALYSIS_SYNTHESIS_TYPE_SCENARIOS;

export const META_ANALYSIS_FLOW_SCENARIOS: GuidedPromptScenario[] = [
  {
    id: 'meta-start-pipeline',
    icon: '🚀',
    titleKey: 'guidedStarter.metaFlow.pipeline.title',
    descriptionKey: 'guidedStarter.metaFlow.pipeline.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaPipeline',
    skills: [...META_ANALYSIS_PIPELINE_SKILLS],
  },
  {
    id: 'meta-literature',
    icon: '📚',
    titleKey: 'guidedStarter.metaFlow.literature.title',
    descriptionKey: 'guidedStarter.metaFlow.literature.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaLiterature',
    skills: [...META_ANALYSIS_STAGE_SKILLS.literature],
  },
  {
    id: 'meta-ideation',
    icon: '💡',
    titleKey: 'guidedStarter.metaFlow.ideation.title',
    descriptionKey: 'guidedStarter.metaFlow.ideation.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaIdeation',
    skills: [...META_ANALYSIS_STAGE_SKILLS.ideation],
  },
  {
    id: 'meta-scoping-review',
    icon: '🗺️',
    titleKey: 'guidedStarter.metaFlow.scopingReview.title',
    descriptionKey: 'guidedStarter.metaFlow.scopingReview.description',
    reviewType: 'scoping',
    autoRoutePromptKey: 'guidedStarter.prompts.metaScopingReview',
    skills: [...META_ANALYSIS_STAGE_SKILLS.scopingReview],
  },
  {
    id: 'meta-protocol',
    icon: '📋',
    titleKey: 'guidedStarter.metaFlow.protocol.title',
    descriptionKey: 'guidedStarter.metaFlow.protocol.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaProtocol',
    skills: [...META_ANALYSIS_STAGE_SKILLS.protocol],
  },
  {
    id: 'meta-search-dedupe',
    icon: '🔎',
    titleKey: 'guidedStarter.metaFlow.searchDedupe.title',
    descriptionKey: 'guidedStarter.metaFlow.searchDedupe.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaSearchDedupe',
    skills: [...META_ANALYSIS_STAGE_SKILLS.searchDedupe],
  },
  {
    id: 'meta-title-abstract-screening',
    icon: '✅',
    titleKey: 'guidedStarter.metaFlow.titleAbstractScreening.title',
    descriptionKey: 'guidedStarter.metaFlow.titleAbstractScreening.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaTitleAbstractScreening',
    skills: [...META_ANALYSIS_STAGE_SKILLS.titleAbstractScreening],
  },
  {
    id: 'meta-full-text-download',
    icon: '📥',
    titleKey: 'guidedStarter.metaFlow.fullTextDownload.title',
    descriptionKey: 'guidedStarter.metaFlow.fullTextDownload.description',
    skills: [...META_ANALYSIS_STAGE_SKILLS.fullTextDownload],
  },
  {
    id: 'meta-pdf-acquisition',
    icon: '⬇️',
    titleKey: 'guidedStarter.metaFlow.pdfAcquisition.title',
    descriptionKey: 'guidedStarter.metaFlow.pdfAcquisition.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaPdfAcquisition',
    skills: [...META_ANALYSIS_STAGE_SKILLS.pdfAcquisition],
  },
  {
    id: 'meta-mineru',
    icon: '📄',
    titleKey: 'guidedStarter.metaFlow.mineru.title',
    descriptionKey: 'guidedStarter.metaFlow.mineru.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaMineru',
    skills: [...META_ANALYSIS_STAGE_SKILLS.mineruParse],
  },
  {
    id: 'meta-full-text-screening',
    icon: '🧪',
    titleKey: 'guidedStarter.metaFlow.fullTextScreening.title',
    descriptionKey: 'guidedStarter.metaFlow.fullTextScreening.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaFullTextScreening',
    skills: [...META_ANALYSIS_STAGE_SKILLS.fullTextScreening],
  },
  {
    id: 'meta-extraction-quality',
    icon: '🧾',
    titleKey: 'guidedStarter.metaFlow.extractionQuality.title',
    descriptionKey: 'guidedStarter.metaFlow.extractionQuality.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaExtractionQuality',
    skills: [...META_ANALYSIS_STAGE_SKILLS.extractionQuality],
  },
  {
    id: 'meta-quality-assessment',
    icon: '⚖️',
    titleKey: 'guidedStarter.metaFlow.qualityAssessment.title',
    descriptionKey: 'guidedStarter.metaFlow.qualityAssessment.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaQualityAssessment',
    skills: [...META_ANALYSIS_STAGE_SKILLS.qualityAssessment],
  },
  {
    id: 'meta-statistics',
    icon: '📊',
    titleKey: 'guidedStarter.metaFlow.statistics.title',
    descriptionKey: 'guidedStarter.metaFlow.statistics.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaStatistics',
    skills: [...META_ANALYSIS_STAGE_SKILLS.statistics],
    children: [...META_ANALYSIS_SYNTHESIS_TYPE_SCENARIOS],
  },
  {
    id: 'meta-figures',
    icon: '🎨',
    titleKey: 'guidedStarter.metaFlow.figures.title',
    descriptionKey: 'guidedStarter.metaFlow.figures.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaFigures',
    skills: [...META_ANALYSIS_STAGE_SKILLS.figures],
  },
  {
    id: 'meta-manuscript',
    icon: '✍️',
    titleKey: 'guidedStarter.metaFlow.manuscript.title',
    descriptionKey: 'guidedStarter.metaFlow.manuscript.description',
    autoRoutePromptKey: 'guidedStarter.prompts.metaManuscript',
    skills: [...META_ANALYSIS_STAGE_SKILLS.manuscript],
  },
];

export const META_PROJECT_GUIDED_PROMPT_SCENARIOS: GuidedPromptScenario[] = [
  ...META_ANALYSIS_FLOW_SCENARIOS,
  ...GUIDED_PROMPT_SCENARIOS,
];
