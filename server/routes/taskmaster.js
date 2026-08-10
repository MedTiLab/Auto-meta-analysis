/**
 * TASKMASTER API ROUTES
 * ====================
 * 
 * This module provides API endpoints for TaskMaster integration including:
 * - .pipeline folder detection in project directories
 * - MCP server configuration detection
 * - TaskMaster state and metadata management
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import multer from 'multer';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import { extractProjectDirectory } from '../projects.js';
import { referencesDb } from '../database/db.js';
import { syncReferencesToProjectArtifacts } from '../utils/reference-project-artifacts.js';
import { detectTaskMasterMCPServer } from '../utils/mcp-detector.js';
import {
    buildCodeLocationRule,
    buildContextCompactionRule,
    buildEvidenceIntegrityRule,
    buildHumanReviewGateRule,
    buildOutputLocationRule,
    STAGE_REPORT_ROOTS,
    buildWorkspaceMaterialsRule,
    enrichTaskForExecution,
    loadTaskPromptContext,
    resolveReportStage,
} from '../pipeline/task-prompt-context.js';
import {
    writeKnowledgeBaseManifest as writeProjectKnowledgeBaseManifest,
} from '../utils/project-knowledge-base.js';
import { broadcastTaskMasterProjectUpdate, broadcastTaskMasterTasksUpdate } from '../utils/taskmaster-websocket.js';

const router = express.Router();
const PIPELINE_DIR = '.pipeline';
const LEGACY_TASKMASTER_DIR = '.taskmaster';
const DEFAULT_TASKS_TAG = 'master';
const DEFAULT_RESEARCH_BRIEF_FILENAME = 'research_brief.json';
const DEFAULT_RESEARCH_BRIEF_PATH = '.pipeline/docs/research_brief.json';
const DEFAULT_KB_DIRNAME = 'kb';
const DEFAULT_KB_MANIFEST_FILENAME = 'manifest.json';
const DEFAULT_KB_MANIFEST_RELATIVE_PATH = '.pipeline/docs/kb/manifest.json';
const DEFAULT_KB_NEWS_RELATIVE_DIR = '.pipeline/docs/kb/news';
const DEFAULT_KB_NOTES_RELATIVE_DIR = '.pipeline/docs/kb/notes';
const DEFAULT_KB_UPLOADS_RELATIVE_DIR = '.pipeline/docs/kb/uploads';
const DEFAULT_MAX_TASKS = 80;
const MAX_KB_SUMMARY_CHARS = 600;
const MAX_KB_TEXT_FILE_BYTES = 1024 * 1024;
const KB_UPLOAD_MAX_BYTES = 48 * 1024 * 1024;
const KB_UPLOAD_ALLOWED_EXTENSIONS = new Set([
    'pdf',
    'txt',
    'md',
    'markdown',
    'csv',
    'tsv',
    'doc',
    'docx',
    'rtf',
    'odt',
    'xls',
    'xlsx',
    'xlsm',
    'ods',
    'ppt',
    'pptx',
    'odp',
]);

const kbUploadSingle = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: KB_UPLOAD_MAX_BYTES, files: 1 },
}).single('file');
const LEGACY_STAGE_ORDER = ['literature', 'ideation', 'experiment', 'publication', 'promotion'];
const META_WORKFLOW_STAGE_ORDER = [
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
];
const META_STAGE_ORDER = META_WORKFLOW_STAGE_ORDER.filter((stage) => !LEGACY_STAGE_ORDER.includes(stage));
const STAGE_ORDER = [...LEGACY_STAGE_ORDER, ...META_STAGE_ORDER];
const STAGE_LABELS = {
    literature: 'Literature',
    ideation: 'Ideation',
    experiment: 'Experiment',
    publication: 'Publication',
    promotion: 'Promotion',
    presentation: 'Presentation',
    protocol: 'Protocol / PICO',
    search_dedupe: 'Search / Dedupe',
    title_abstract_screening: 'Title / Abstract Screening',
    full_text_review: 'Full-text Review',
    data_extraction: 'Data Extraction',
    quality_assessment: 'Quality Assessment',
    data_analysis: 'Data Analysis',
    results_figures: 'Results / Figures',
    manuscript_submission: 'Manuscript / Submission',
};
const STAGE_PROMPT_HINTS = {
    literature: 'Establish the literature baseline, collect evidence, and map open gaps before committing to a direction.',
    ideation: 'Clarify thesis, scope boundaries, and evidence framing before execution.',
    experiment: 'Turn assumptions into an executable protocol with measurable validation criteria.',
    publication: 'Convert outcomes into a coherent manuscript narrative with concrete submission artifacts.',
    promotion: 'Transform research outcomes into homepage assets, visual slides, narration scripts, and demo videos.',
    protocol: 'Lock the review type, PICO/PECO, eligibility criteria, outcomes, and PRISMA logic before downstream review work.',
    search_dedupe: 'Build reproducible database searches, search logs, imported records, and deduplicated reference sets.',
    title_abstract_screening: 'After search/dedupe, run title/abstract first screen and title/abstract second screen. Write first-screen audit files under 03_title_abstract_screening/01_ai_pre_screen/, second-screen queues/conflicts under 03_title_abstract_screening/02_agent_rescreen/, and write/update 03_title_abstract_screening/screening_decisions.json with stage=title_abstract.',
    full_text_review: 'After Zotero full-text handoff and attachment sync, repeat first/second screening for full text. Read fulltext_manifest plus parsed Markdown/HTML/text assets, write/update 03_title_abstract_screening/screening_decisions.json with stage=full_text, and keep full-text assets, parse outputs, unavailable lists, and concise audit logs under 04_full_text_review/ or 04_full_text_review/fulltext/.',
    data_extraction: 'Extract candidate fields with evidence text, page/table provenance, confidence, and review status.',
    quality_assessment: 'Run the appropriate RoB/QUADAS/NOS/GRADE quality tool with traceable Claude review notes and user escalation only for conflicts.',
    data_analysis: 'Prepare model inputs, statistical scripts, pooled estimates, heterogeneity checks, and sensitivity analyses.',
    results_figures: 'Produce publication-ready result tables, forest/funnel/SROC/PRISMA figures, and legends.',
    manuscript_submission: 'Draft and package the PRISMA manuscript, checklist, supplements, appendices, and submission files.',
};
const DEFAULT_STAGE_SKILL_MAP = {
    literature: {
        base: ['meta-analysis-workflow', 'literature-review', 'pubmed-search-strategy', 'pubmed-database', 'citation-management', 'scientific-critical-thinking'],
        byTaskType: {
            exploration: ['meta-analysis-workflow', 'literature-review', 'pubmed-search-strategy', 'pubmed-database', 'research-lookup', 'citation-management'],
            analysis: ['meta-analysis-workflow', 'literature-review', 'citation-management', 'scientific-critical-thinking', 'research-lookup'],
        },
    },
    ideation: {
        base: ['meta-pipeline-planner', 'meta-analysis-workflow', 'scientific-brainstorming'],
        byTaskType: {
            analysis: ['meta-pipeline-planner', 'meta-analysis-workflow'],
            exploration: ['scientific-brainstorming', 'literature-review'],
        },
    },
    experiment: {
        base: ['meta-analysis-workflow', 'data-transform', 'scientific-critical-thinking', 'statistical-analysis', 'data-stats-analysis', 'statsmodels'],
        byTaskType: {
            implementation: ['meta-analysis-workflow', 'data-transform', 'legal-pdf-acquisition', 'public-literature-download', 'meta-zotero-fulltext-handoff', 'mineru-pdf-parser'],
            analysis: ['meta-analysis-workflow', 'statistical-analysis', 'data-stats-analysis', 'statsmodels', 'scientific-critical-thinking'],
            exploration: ['meta-analysis-workflow', 'literature-review', 'scientific-critical-thinking'],
        },
    },
    publication: {
        base: ['meta-analysis-workflow', 'prisma-manuscript-writer', 'manuscript-editor', 'inno-paper-writing', 'scientific-writing', 'citation-management', 'venue-templates', 'docx'],
        byTaskType: {
            writing: ['meta-analysis-workflow', 'prisma-manuscript-writer', 'manuscript-editor', 'inno-paper-writing', 'scientific-writing', 'citation-management', 'venue-templates', 'docx'],
            analysis: ['meta-analysis-workflow', 'peer-review', 'scientific-critical-thinking', 'citation-management', 'inno-reference-audit'],
        },
    },
    promotion: {
        base: ['meta-analysis-workflow', 'scientific-slides', 'making-academic-presentations', 'paper-2-web', 'pptx-posters'],
        byTaskType: {
            scripting: ['meta-analysis-workflow', 'scientific-slides', 'making-academic-presentations', 'scientific-writing'],
            rendering: ['meta-analysis-workflow', 'scientific-visualization', 'paper-2-web', 'pptx-posters'],
            narration: ['meta-analysis-workflow', 'scientific-writing', 'scientific-slides', 'making-academic-presentations'],
            delivery: ['meta-analysis-workflow', 'scientific-slides', 'making-academic-presentations', 'paper-2-web'],
        },
    },
    protocol: {
        base: ['meta-pipeline-planner', 'meta-analysis-workflow', 'literature-review', 'scientific-critical-thinking', 'citation-management'],
        byTaskType: {
            analysis: ['meta-pipeline-planner', 'meta-analysis-workflow', 'literature-review', 'scientific-critical-thinking'],
            implementation: ['meta-pipeline-planner', 'meta-analysis-workflow', 'citation-management', 'literature-review'],
        },
    },
    search_dedupe: {
        base: ['meta-analysis-workflow', 'pubmed-search-strategy', 'citation-management', 'pubmed-database'],
        byTaskType: {
            analysis: ['meta-analysis-workflow', 'pubmed-search-strategy', 'citation-management', 'literature-review'],
            exploration: ['meta-analysis-workflow', 'pubmed-search-strategy', 'pubmed-database', 'citation-management'],
        },
    },
    title_abstract_screening: {
        base: ['meta-analysis-workflow', 'meta-screening-rescreen', 'citation-management', 'peer-review'],
        byTaskType: {
            analysis: ['meta-analysis-workflow', 'meta-screening-rescreen', 'citation-management', 'peer-review'],
        },
    },
    full_text_review: {
        base: ['meta-analysis-workflow', 'legal-pdf-acquisition', 'public-literature-download', 'meta-zotero-fulltext-handoff', 'zotero-medautodata-library', 'meta-screening-rescreen', 'citation-management', 'mineru-pdf-parser', 'data-transform', 'peer-review'],
        byTaskType: {
            implementation: ['meta-analysis-workflow', 'legal-pdf-acquisition', 'public-literature-download', 'meta-zotero-fulltext-handoff', 'zotero-medautodata-library', 'mineru-pdf-parser', 'data-transform', 'citation-management'],
            analysis: ['meta-analysis-workflow', 'meta-screening-rescreen', 'peer-review', 'scientific-critical-thinking', 'citation-management'],
        },
    },
    data_extraction: {
        base: ['meta-analysis-workflow', 'meta-extraction', 'pdf-evidence-extraction', 'diagnostic-data-extraction', 'data-transform', 'scientific-critical-thinking', 'peer-review'],
        byTaskType: {
            analysis: ['meta-analysis-workflow', 'meta-extraction', 'pdf-evidence-extraction', 'diagnostic-data-extraction', 'data-transform', 'scientific-critical-thinking', 'peer-review'],
        },
    },
    quality_assessment: {
        base: ['meta-analysis-workflow', 'scientific-critical-thinking', 'peer-review', 'data-transform', 'scholar-evaluation'],
        byTaskType: {
            analysis: ['meta-analysis-workflow', 'scientific-critical-thinking', 'peer-review', 'data-transform', 'scholar-evaluation'],
        },
    },
    data_analysis: {
        base: ['meta-analysis-workflow', 'diagnostic-meta-analysis', 'meta-statistics-r', 'statistical-analysis', 'data-stats-analysis', 'statsmodels', 'data-transform'],
        byTaskType: {
            analysis: ['meta-analysis-workflow', 'diagnostic-meta-analysis', 'meta-statistics-r', 'statistical-analysis', 'data-stats-analysis', 'statsmodels', 'data-transform'],
        },
    },
    results_figures: {
        base: ['meta-analysis-workflow', 'data-visualization-biomedical', 'scientific-visualization', 'data-viz-plots', 'matplotlib', 'seaborn', 'plotly', 'scientific-schematics'],
        byTaskType: {
            analysis: ['meta-analysis-workflow', 'data-visualization-biomedical', 'scientific-visualization', 'matplotlib', 'scientific-schematics'],
            rendering: ['meta-analysis-workflow', 'scientific-visualization', 'data-visualization-biomedical', 'data-viz-plots', 'matplotlib', 'seaborn', 'plotly'],
        },
    },
    manuscript_submission: {
        base: ['meta-analysis-workflow', 'prisma-manuscript-writer', 'manuscript-editor', 'inno-paper-writing', 'scientific-writing', 'citation-management', 'venue-templates', 'docx', 'peer-review'],
        byTaskType: {
            writing: ['meta-analysis-workflow', 'prisma-manuscript-writer', 'manuscript-editor', 'inno-paper-writing', 'scientific-writing', 'citation-management', 'venue-templates', 'docx'],
            analysis: ['meta-analysis-workflow', 'peer-review', 'scientific-critical-thinking', 'citation-management'],
        },
    },
    presentation: {
        base: ['meta-analysis-workflow', 'scientific-slides', 'making-academic-presentations', 'paper-2-web', 'pptx-posters'],
        byTaskType: {
            scripting: ['meta-analysis-workflow', 'scientific-slides', 'making-academic-presentations', 'scientific-writing'],
            delivery: ['meta-analysis-workflow', 'scientific-slides', 'making-academic-presentations', 'paper-2-web', 'pptx-posters'],
        },
    },
};
const DEFAULT_BRIEF_SECTIONS = {
    literature: {
        core_research_question: '',
        literature_scope: '',
        knowledge_base_scope: '',
        key_references: [],
        seed_papers: [],
        synthesis_summary: '',
        open_gaps: [],
        evidence_requirements: [],
    },
    ideation: {
        research_goal: '',
        clinical_or_scientific_gap: '',
        problem_framing: '',
        evidence_plan: '',
        success_criteria: [],
    },
    experiment: {
        hypothesis_or_validation_goal: '',
        dataset_or_data_source: '',
        method_or_protocol: '',
        evaluation_plan: '',
    },
    publication: {
        paper_outline: '',
        figures_tables_plan: '',
        artifact_plan: '',
        submission_checklist: [],
    },
    promotion: {
        slide_outline: '',
        deck_style: '',
        tts_config: '',
        video_assembly_plan: '',
        homepage_plan: '',
    },
};
const META_TEMPLATE_IDS = new Set(['medical-meta-project', 'medical-meta-analysis']);
const LEGACY_META_STAGE_FALLBACKS = {
    literature: 'literature',
    ideation: 'protocol',
    experiment: 'data_analysis',
    publication: 'manuscript_submission',
    promotion: 'presentation',
};
const META_STAGE_REQUIRED_ELEMENTS = {
    literature: [
        'sections.literature.core_research_question',
        'sections.literature.literature_scope',
        'sections.literature.search_plan',
    ],
    protocol: [
        'sections.ideation.review_objective',
        'sections.ideation.pico_or_peco',
        'sections.ideation.eligibility_criteria',
    ],
    search_dedupe: [
        'sections.literature.search_plan',
    ],
    title_abstract_screening: [
        'sections.experiment.screening_plan',
    ],
    full_text_review: [
        'sections.experiment.pdf_and_parse_plan',
    ],
    data_extraction: [
        'sections.experiment.extraction_plan',
    ],
    quality_assessment: [
        'sections.experiment.extraction_plan',
    ],
    data_analysis: [
        'sections.experiment.analysis_plan',
    ],
    results_figures: [
        'sections.publication.figures_tables_plan',
    ],
    manuscript_submission: [
        'sections.publication.manuscript_outline',
        'sections.publication.submission_checklist',
    ],
    presentation: [
        'sections.promotion.slide_outline',
    ],
};
const META_BLUEPRINT_STAGE_OVERRIDES = {
    meta_literature_scope: 'literature',
    meta_protocol_scope: 'literature',
    meta_reference_dedupe_plan: 'search_dedupe',
    meta_search_strategy: 'search_dedupe',
    meta_protocol_lock: 'protocol',
    meta_scoping_systematic_route: 'protocol',
    meta_execution_queue: 'protocol',
    meta_title_abstract_screening: 'title_abstract_screening',
    meta_search_dedupe_screen: 'search_dedupe',
    meta_full_text_pdf_mineru: 'full_text_review',
    meta_pdf_download_parse: 'full_text_review',
    meta_data_extraction: 'data_extraction',
    meta_extraction_quality: 'data_extraction',
    meta_quality_assessment: 'quality_assessment',
    meta_statistics: 'data_analysis',
    meta_statistics_figures: 'data_analysis',
    meta_results_figures: 'results_figures',
    meta_prisma_manuscript: 'manuscript_submission',
    meta_submission_audit: 'manuscript_submission',
    meta_presentation_storyline: 'presentation',
    meta_delivery_assets: 'presentation',
    meta_presentation_assets: 'presentation',
};
const KNOWLEDGE_BASE_SOURCE_DIRECTORIES = [
    { relativeDir: '00_literature/reports', sourceType: 'literature_report', tags: ['literature', 'report', 'meta'] },
    { relativeDir: '00_literature/references', sourceType: 'literature_reference', tags: ['literature', 'reference', 'meta'] },
    { relativeDir: '00_literature/topic_selection', sourceType: 'literature_report', tags: ['literature', 'topic-selection', 'meta'] },
    { relativeDir: '00_literature/scoping_review', sourceType: 'literature_report', tags: ['literature', 'scoping-review', 'meta'] },
    { relativeDir: 'Literature/reports', sourceType: 'literature_report', tags: ['literature', 'report'] },
    { relativeDir: 'literature/reports', sourceType: 'literature_report', tags: ['literature', 'report', 'legacy-lowercase'] },
    { relativeDir: 'Research/reports', sourceType: 'literature_report', tags: ['literature', 'report', 'legacy-survey'] },
    { relativeDir: 'Publication', sourceType: 'publication_artifact', tags: ['publication'] },
    { relativeDir: 'reports', sourceType: 'project_report', tags: ['report'] },
    { relativeDir: 'drafts', sourceType: 'draft', tags: ['draft'] },
    { relativeDir: DEFAULT_KB_NEWS_RELATIVE_DIR, sourceType: 'news_reference', tags: ['news', 'monitor'] },
    { relativeDir: DEFAULT_KB_NOTES_RELATIVE_DIR, sourceType: 'manual_note', tags: ['manual', 'note'] },
    { relativeDir: DEFAULT_KB_UPLOADS_RELATIVE_DIR, sourceType: 'user_upload', tags: ['upload', 'document'] },
];
const KNOWLEDGE_BASE_TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'csv', 'tsv', 'html', 'htm']);
const KNOWLEDGE_BASE_METADATA_EXTENSIONS = new Set([
    'pdf',
    'doc',
    'docx',
    'rtf',
    'odt',
    'xls',
    'xlsx',
    'xlsm',
    'ods',
    'ppt',
    'pptx',
    'odp',
]);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, '..', '..', 'skills');
const STAGE_SKILL_MAP_PATH = path.join(SKILLS_DIR, 'stage-skill-map.json');
let cachedStageSkillMap = null;
let cachedStageSkillMapMtimeMs = null;
function normalizeStageSkillMap(rawMap = {}) {
    const normalized = {};
    STAGE_ORDER.forEach((stage) => {
        const source = rawMap?.[stage]
            || (stage === 'literature' ? rawMap?.survey : null)
            || (stage === 'promotion' ? rawMap?.presentation : null)
            || {};
        normalized[stage] = {
            base: Array.isArray(source.base) ? source.base.map((item) => String(item || '').trim()).filter(Boolean) : [],
            byTaskType: source.byTaskType && typeof source.byTaskType === 'object'
                ? Object.fromEntries(
                    Object.entries(source.byTaskType).map(([taskType, skills]) => [
                        String(taskType || '').trim(),
                        Array.isArray(skills) ? skills.map((item) => String(item || '').trim()).filter(Boolean) : [],
                    ]),
                )
                : {},
        };
        if (normalized[stage].base.length === 0) {
            normalized[stage].base = DEFAULT_STAGE_SKILL_MAP[stage]?.base || [];
        }
    });
    return normalized;
}

function getStageSkillMap() {
    try {
        const stats = fs.statSync(STAGE_SKILL_MAP_PATH);
        if (
            cachedStageSkillMap &&
            typeof cachedStageSkillMapMtimeMs === 'number' &&
            cachedStageSkillMapMtimeMs === stats.mtimeMs
        ) {
            return cachedStageSkillMap;
        }

        const content = fs.readFileSync(STAGE_SKILL_MAP_PATH, 'utf8');
        const parsed = JSON.parse(content);
        cachedStageSkillMap = normalizeStageSkillMap(parsed);
        cachedStageSkillMapMtimeMs = stats.mtimeMs;
        return cachedStageSkillMap;
    } catch (error) {
        if (!cachedStageSkillMap) {
            cachedStageSkillMap = normalizeStageSkillMap(DEFAULT_STAGE_SKILL_MAP);
        }
        return cachedStageSkillMap;
    }
}

function buildDefaultBriefPipeline(stageSkillMap) {
    const map = stageSkillMap || getStageSkillMap();
    return {
        version: '1.1',
        mode: 'idea',
        stages: {
            literature: {
                required_elements: [
                    'sections.literature.core_research_question',
                    'sections.literature.literature_scope',
                    'sections.literature.synthesis_summary',
                ],
                optional_elements: [
                    'sections.literature.knowledge_base_scope',
                    'sections.literature.key_references',
                    'sections.literature.seed_papers',
                    'sections.literature.open_gaps',
                    'sections.literature.evidence_requirements',
                ],
                quality_gate: [
                    'The core research question is explicit and scoped for evidence collection',
                    'The literature scope and knowledge-base boundary are explicit and bounded',
                    'The synthesis identifies concrete open gaps or unresolved tensions',
                ],
                task_blueprints: [
                    {
                        id: 'literature_collect_references',
                        title: 'Clarify the research question and collect the core literature set',
                        description: 'State the central question, assemble the most relevant references, group them by theme, and note inclusion boundaries.',
                        taskType: 'exploration',
                    },
                    {
                        id: 'literature_summarize_gaps',
                        title: 'Summarize trends, evidence requirements, and open gaps',
                        description: 'Write a compact synthesis of what is known, what is contested, which evidence is still needed, and where the project can contribute.',
                        taskType: 'analysis',
                    },
                ],
                recommended_skills: map.literature.base,
            },
            ideation: {
                required_elements: [
                    'sections.ideation.research_goal',
                    'sections.ideation.clinical_or_scientific_gap',
                    'sections.ideation.problem_framing',
                ],
                optional_elements: [
                    'sections.ideation.evidence_plan',
                    'sections.ideation.success_criteria',
                ],
                quality_gate: [
                    'A concrete clinical or scientific gap is defined',
                    'At least one clear research direction is defined',
                    'Problem framing and expected value are specific',
                ],
                task_blueprints: [
                    {
                        id: 'ideation_generate_candidates',
                        title: 'Generate and compare candidate research directions',
                        description: 'Produce multiple candidate directions and compare novelty, feasibility, and expected impact.',
                        taskType: 'exploration',
                    },
                    {
                        id: 'ideation_select_direction',
                        title: 'Select one direction with explicit rationale',
                        description: 'Pick one direction and document the gap, tradeoffs, and scope boundaries.',
                        taskType: 'analysis',
                    },
                ],
                recommended_skills: map.ideation.base,
            },
            experiment: {
                required_elements: [
                    'sections.experiment.hypothesis_or_validation_goal',
                    'sections.experiment.method_or_protocol',
                    'sections.experiment.evaluation_plan',
                ],
                optional_elements: [
                    'sections.experiment.dataset_or_data_source',
                ],
                quality_gate: [
                    'Validation goal can be measured objectively',
                    'Method and evaluation protocol are executable',
                ],
                task_blueprints: [
                    {
                        id: 'experiment_define_protocol',
                        title: 'Define executable experiment protocol',
                        description: 'Translate method and evaluation plan into executable steps and checkpoints.',
                        taskType: 'implementation',
                    },
                    {
                        id: 'experiment_run_analysis',
                        title: 'Run baseline analysis and record outcomes',
                        description: 'Execute baseline validation and summarize key findings and gaps.',
                        taskType: 'analysis',
                    },
                ],
                recommended_skills: map.experiment.base,
            },
            publication: {
                required_elements: [
                    'sections.publication.paper_outline',
                    'sections.publication.submission_checklist',
                ],
                optional_elements: [
                    'sections.publication.figures_tables_plan',
                    'sections.publication.artifact_plan',
                ],
                quality_gate: [
                    'Contribution narrative and structure are coherent',
                    'Submission checklist and artifacts are complete',
                ],
                task_blueprints: [
                    {
                        id: 'publication_outline_to_draft',
                        title: 'Expand outline into draft sections',
                        description: 'Convert paper outline into structured draft sections with claim-evidence alignment.',
                        taskType: 'writing',
                    },
                    {
                        id: 'publication_finalize_artifacts',
                        title: 'Finalize figures, tables, and artifacts',
                        description: 'Prepare final visuals and reproducibility artifacts required for submission.',
                        taskType: 'writing',
                    },
                ],
                recommended_skills: map.publication.base,
            },
            promotion: {
                required_elements: [
                    'sections.promotion.slide_outline',
                ],
                optional_elements: [
                    'sections.promotion.deck_style',
                    'sections.promotion.tts_config',
                    'sections.promotion.video_assembly_plan',
                    'sections.promotion.homepage_plan',
                ],
                quality_gate: [
                    'Slide outline and homepage plan cover key paper contributions',
                    'Deck style defined for visual consistency',
                ],
                task_blueprints: [
                    {
                        id: 'promotion_draft_outline',
                        title: 'Draft slide outline and narration scripts',
                        description: 'Create per-slide content plan with talking points based on paper contributions.',
                        taskType: 'scripting',
                    },
                    {
                        id: 'promotion_prepare_homepage',
                        title: 'Prepare research homepage content and assets',
                        description: 'Organize homepage sections, key visuals, and links for project promotion.',
                        taskType: 'delivery',
                    },
                    {
                        id: 'promotion_generate_slides',
                        title: 'Generate slide images from outline and paper figures',
                        description: 'Use nanobanana to render slide images, preferring /edit on existing HQ paper figures.',
                        taskType: 'rendering',
                    },
                    {
                        id: 'promotion_generate_narration',
                        title: 'Generate TTS audio for slide narration',
                        description: 'Generate one audio file per slide using edge-tts (default), Kokoro (offline), or ElevenLabs (premium).',
                        taskType: 'narration',
                    },
                ],
                recommended_skills: map.promotion?.base || map.presentation?.base || ['scientific-visualization', 'scientific-slides', 'paper-2-web'],
            },
        },
    };
}
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'taskmaster-templates');
const DEFAULT_PIPELINE_CONFIG = {
    version: '1.0',
    provider: 'medhelp-web',
    initializedAt: new Date().toISOString(),
};
let cachedTemplates = null;

function getPipelinePaths(projectPath) {
    const pipelineRoot = path.join(projectPath, PIPELINE_DIR);
    return {
        root: pipelineRoot,
        tasksDir: path.join(pipelineRoot, 'tasks'),
        tasksFile: path.join(pipelineRoot, 'tasks', 'tasks.json'),
        docsDir: path.join(pipelineRoot, 'docs'),
        configFile: path.join(pipelineRoot, 'config.json'),
        legacyRoot: path.join(projectPath, LEGACY_TASKMASTER_DIR),
    };
}

async function pathExists(filePath) {
    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function migrateLegacyTaskmasterIfNeeded(projectPath) {
    const paths = getPipelinePaths(projectPath);
    const hasPipeline = await pathExists(paths.root);
    const hasLegacy = await pathExists(paths.legacyRoot);
    if (hasPipeline || !hasLegacy) {
        return;
    }

    await fsPromises.cp(paths.legacyRoot, paths.root, { recursive: true, force: false });
}

async function ensurePipelineInitialized(projectPath) {
    const paths = getPipelinePaths(projectPath);
    await migrateLegacyTaskmasterIfNeeded(projectPath);
    await fsPromises.mkdir(paths.tasksDir, { recursive: true });
    await fsPromises.mkdir(paths.docsDir, { recursive: true });

    if (!(await pathExists(paths.configFile))) {
        await fsPromises.writeFile(paths.configFile, `${JSON.stringify(DEFAULT_PIPELINE_CONFIG, null, 2)}\n`, 'utf8');
    }

    if (!(await pathExists(paths.tasksFile))) {
        const initial = { [DEFAULT_TASKS_TAG]: { tasks: [] } };
        await fsPromises.writeFile(paths.tasksFile, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
    }

    return paths;
}

function extractTasksFromData(tasksData) {
    let currentTag = DEFAULT_TASKS_TAG;
    let tasks = [];

    if (Array.isArray(tasksData)) {
        tasks = tasksData;
    } else if (tasksData?.tasks) {
        tasks = tasksData.tasks;
    } else if (tasksData && typeof tasksData === 'object') {
        if (tasksData[currentTag]?.tasks) {
            tasks = tasksData[currentTag].tasks;
        } else if (tasksData.master?.tasks) {
            tasks = tasksData.master.tasks;
            currentTag = 'master';
        } else {
            const firstTag = Object.keys(tasksData).find((key) => Array.isArray(tasksData[key]?.tasks));
            if (firstTag) {
                currentTag = firstTag;
                tasks = tasksData[firstTag].tasks;
            }
        }
    }

    return { tasks: Array.isArray(tasks) ? tasks : [], currentTag };
}

function normalizeTask(task) {
    const now = new Date().toISOString();
    const stage = normalizeStageName(task.stage);
    return {
        id: task.id,
        title: task.title || 'Untitled Task',
        description: task.description || '',
        status: normalizeTaskStatus(task.status),
        priority: task.priority || 'medium',
        dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
        createdAt: task.createdAt || task.created || now,
        updatedAt: task.updatedAt || task.updated || now,
        details: task.details || '',
        testStrategy: task.testStrategy || task.test_strategy || '',
        subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
        stage: stage || undefined,
        taskType: task.taskType || 'implementation',
        inputsNeeded: Array.isArray(task.inputsNeeded) ? task.inputsNeeded.filter(Boolean) : [],
        suggestedSkills: Array.isArray(task.suggestedSkills) ? task.suggestedSkills.filter(Boolean) : [],
        sourceBlueprintId: task.sourceBlueprintId || '',
        nextActionPrompt: typeof task.nextActionPrompt === 'string' ? task.nextActionPrompt : '',
    };
}

function normalizeTaskStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw) return 'pending';
    if (raw === 'completed' || raw === 'complete') return 'done';
    if (raw === 'in_progress' || raw === 'inprogress') return 'in-progress';
    if (raw === 'todo' || raw === 'open') return 'pending';
    return raw;
}

async function readTasksFile(tasksFilePath) {
    const content = await fsPromises.readFile(tasksFilePath, 'utf8');
    const parsed = JSON.parse(content);
    const { tasks, currentTag } = extractTasksFromData(parsed);
    return {
        raw: parsed,
        currentTag,
        tasks: tasks.map(normalizeTask),
    };
}

async function writeTasksFile(tasksFilePath, tasks, currentTag = DEFAULT_TASKS_TAG) {
    const payload = { [currentTag]: { tasks } };
    await fsPromises.writeFile(tasksFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function generateTaskId(tasks) {
    const numericIds = tasks
        .map((task) => Number(task.id))
        .filter((value) => Number.isFinite(value));
    if (numericIds.length === 0) {
        return 1;
    }
    return Math.max(...numericIds) + 1;
}

/**
 * Reassign all task IDs sequentially (1, 2, 3, ...) following global stage order.
 * Preserves array order within each stage group and remaps dependency references.
 */
function reindexTasks(tasks) {
    const staged = {};
    STAGE_ORDER.forEach((s) => { staged[s] = []; });
    const unassigned = [];

    for (const task of tasks) {
        const s = normalizeStageName(task.stage);
        if (s && staged[s]) {
            staged[s].push(task);
        } else {
            unassigned.push(task);
        }
    }

    const ordered = [];
    STAGE_ORDER.forEach((s) => { ordered.push(...staged[s]); });
    ordered.push(...unassigned);

    const idMap = {};
    ordered.forEach((task, idx) => {
        idMap[String(task.id)] = idx + 1;
    });

    return ordered.map((task, idx) => ({
        ...task,
        id: idx + 1,
        dependencies: Array.isArray(task.dependencies)
            ? task.dependencies
                .map((dep) => idMap[String(dep)])
                .filter(Boolean)
            : [],
        updatedAt: new Date().toISOString(),
    }));
}

function splitPromptToTitle(prompt) {
    const cleaned = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) {
        return 'Untitled Task';
    }
    return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
}

function assignPath(target, dottedPath, value) {
    const keys = String(dottedPath || '').split('.').filter(Boolean);
    if (keys.length === 0) return;
    let cursor = target;
    for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i];
        if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
            cursor[key] = {};
        }
        cursor = cursor[key];
    }
    cursor[keys[keys.length - 1]] = value;
}

function toTaskCandidate(raw) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!value) return null;
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function isPlaceholderLikeValue(value = '') {
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return true;
    const blocked = new Set([
        'none', 'null', 'n/a', 'na', 'todo', 'tbd', 'unknown', 'not sure', '-',
        '[]', '{}', 'placeholder',
    ]);
    return blocked.has(normalized);
}

function buildFallbackTaskCandidates(briefData = {}) {
    const title = String(briefData?.meta?.title || '').trim();
    const target = title ? ` for "${title}"` : '';
    return [
        `Finalize Literature section${target}: define literature scope, summarize prior work, and record open gaps.`,
        `Finalize Ideation section${target}: clarify research goal, framing, and evidence plan.`,
        `Define Experiment section${target}: specify validation goal, protocol, and evaluation plan.`,
        `Prepare Publication section${target}: draft paper outline, figures/tables plan, and submission checklist.`,
        `Create Promotion section${target}: draft homepage plan, slide outline, deck style, TTS config, and video assembly plan.`,
    ];
}

function buildMetaFallbackTaskCandidates(briefData = {}) {
    const title = String(briefData?.meta?.title || '').trim();
    const target = title ? ` for "${title}"` : '';
    return [
        `00_literature: define the review question, evidence scope, seed references, and scoping route${target}.`,
        `01_protocol: lock PICO/PECO, eligibility criteria, review type, outcomes, and PRISMA protocol decisions${target}.`,
        `02_search_dedupe: run database search exports, import logs, and deduplicated reference set${target}.`,
        `03_title_abstract_screening: run title/abstract first-screen and named second-screen review${target}.`,
        `04_full_text_review: push missing full text to Zotero, sync attachments, parse assets, and complete full-text review${target}.`,
        `05_data_extraction: build source-linked extraction tables with confidence and review status${target}.`,
        `06_quality_assessment: complete risk-of-bias or quality appraisal with traceable evidence${target}.`,
        `07_data_analysis: run authorized synthesis inputs, statistical models, and sensitivity checks${target}.`,
        `08_results_figures: generate PRISMA, result tables, and route-appropriate figures${target}.`,
        `09_manuscript_submission: draft PRISMA manuscript, checklist, supplements, and submission package${target}.`,
        `10_presentation: prepare slides and delivery assets without exceeding evidence certainty${target}.`,
    ];
}

function buildPipelineSkeletonCandidates(briefData = {}, options = {}) {
    if (options.isMeta) {
        return buildMetaFallbackTaskCandidates(briefData);
    }

    const title = String(briefData?.meta?.title || '').trim();
    const target = title ? ` (${title})` : '';
    return [
        `Literature: define literature scope and search boundary${target}.`,
        `Literature: synthesize key baselines, trends, and open gaps${target}.`,
        `Ideation: clarify problem framing and research goal${target}.`,
        `Ideation: collect key evidence and references${target}.`,
        `Ideation: define measurable success criteria${target}.`,
        `Experiment: define validation hypothesis and evaluation criteria${target}.`,
        `Experiment: prepare data source and method/protocol plan${target}.`,
        `Experiment: execute baseline validation and analyze results${target}.`,
        `Publication: draft paper outline and contribution boundaries${target}.`,
        `Publication: prepare figures/tables and artifact appendix${target}.`,
        `Publication: complete submission checklist and final review${target}.`,
        `Promotion: prepare project homepage structure and assets${target}.`,
        `Promotion: draft slide outline and narration scripts${target}.`,
        `Promotion: generate slide images from paper figures${target}.`,
        `Promotion: generate TTS audio and assemble demo video${target}.`,
    ];
}

function parseBriefJsonToTaskCandidates(briefData = {}, options = {}) {
    const candidates = [];
    const sectionOrder = ['literature', 'survey', 'ideation', 'experiment', 'publication', 'promotion', 'presentation'];
    const sectionData = briefData?.sections && typeof briefData.sections === 'object'
        ? briefData.sections
        : {};

    sectionOrder.forEach((sectionName) => {
        const fields = sectionData[sectionName];
        if (!fields || typeof fields !== 'object') return;
        Object.values(fields).forEach((value) => {
            if (Array.isArray(value)) {
                value.forEach((item) => {
                    const normalized = toTaskCandidate(item);
                    if (normalized) candidates.push(normalized);
                });
                return;
            }
            const normalized = toTaskCandidate(value);
            if (normalized && !isPlaceholderLikeValue(normalized)) candidates.push(normalized);
        });
    });

    const dynamic = [...new Set(candidates)];
    const skeleton = buildPipelineSkeletonCandidates(briefData, options);
    const fallback = dynamic.length > 0
        ? []
        : (options.isMeta ? buildMetaFallbackTaskCandidates(briefData) : buildFallbackTaskCandidates(briefData));
    return [...new Set([...skeleton, ...dynamic, ...fallback])];
}

function inferStageFromCandidate(text = '') {
    const value = String(text || '').toLowerCase();
    if (value.includes('literature') || value.includes('survey')) return 'literature';
    if (value.includes('ideation')) return 'ideation';
    if (value.includes('experiment') || value.includes('validation') || value.includes('baseline')) return 'experiment';
    if (value.includes('publication') || value.includes('paper') || value.includes('submission')) return 'publication';
    if (
        value.includes('promotion')
        || value.includes('presentation')
        || value.includes('slide')
        || value.includes('deck')
        || value.includes('demo video')
        || value.includes('homepage')
    ) return 'promotion';
    return null;
}

function normalizeStageName(stage) {
    const value = String(stage || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const aliases = {
        research: 'literature',
        survey: 'literature',
        search: 'search_dedupe',
        dedupe: 'search_dedupe',
        title_abstract: 'title_abstract_screening',
        manual_screening: 'title_abstract_screening',
        full_text: 'full_text_review',
        fulltext: 'full_text_review',
        pdf: 'full_text_review',
        mineru: 'full_text_review',
        extraction: 'data_extraction',
        quality: 'quality_assessment',
        risk_of_bias: 'quality_assessment',
        statistics: 'data_analysis',
        statistical_pooling: 'data_analysis',
        results: 'results_figures',
        figures: 'results_figures',
        manuscript: 'manuscript_submission',
        submission: 'manuscript_submission',
        paper: 'manuscript_submission',
    };
    const normalized = aliases[value] || value;
    if ([
        'literature',
        'ideation',
        'experiment',
        'publication',
        'promotion',
        'presentation',
        'protocol',
        'search_dedupe',
        'title_abstract_screening',
        'full_text_review',
        'data_extraction',
        'quality_assessment',
        'data_analysis',
        'results_figures',
        'manuscript_submission',
    ].includes(normalized)) {
        return normalized;
    }
    return null;
}

function normalizeMetaStageName(stage) {
    const normalized = normalizeStageName(stage);
    if (!normalized) return null;
    return LEGACY_META_STAGE_FALLBACKS[normalized] || normalized;
}

function isMetaBriefData(briefData = {}) {
    const templateId = String(briefData?.templateId || briefData?.template_id || '').trim().toLowerCase();
    const pipelineMode = String(briefData?.pipeline?.mode || '').trim().toLowerCase();
    const workflow = String(briefData?.meta?.workflow || briefData?.workflow || '').trim().toLowerCase();

    return pipelineMode === 'meta'
        || workflow === 'meta'
        || META_TEMPLATE_IDS.has(templateId);
}

function getBlueprintNodeId(blueprintNode, fallback = '') {
    if (typeof blueprintNode === 'string') {
        return blueprintNode.trim();
    }
    if (blueprintNode && typeof blueprintNode === 'object') {
        return String(blueprintNode.id || fallback || '').trim();
    }
    return String(fallback || '').trim();
}

function getBlueprintNodeText(blueprintNode) {
    if (typeof blueprintNode === 'string') {
        return blueprintNode;
    }
    if (!blueprintNode || typeof blueprintNode !== 'object') {
        return '';
    }
    return [
        blueprintNode.id,
        blueprintNode.title,
        blueprintNode.description,
        blueprintNode.nextActionPrompt,
    ].filter(Boolean).join(' ');
}

function inferMetaStageFromText(text = '', fallbackStage = null) {
    const value = String(text || '').toLowerCase();
    if (!value) return fallbackStage;

    if (value.includes('10_presentation') || /(presentation|slides?|deck|homepage|audio|video|poster)/.test(value)) {
        return 'presentation';
    }
    if (value.includes('09_manuscript_submission') || /(manuscript|submission|prisma checklist|supplement|cover letter)/.test(value)) {
        return 'manuscript_submission';
    }
    if (value.includes('08_results_figures') || /(result figures?|forest|funnel|sroc|figures?|tables?|legends?)/.test(value)) {
        return 'results_figures';
    }
    if (value.includes('07_data_analysis') || /(data analysis|statistics|synthesis|pooled|heterogeneity|subgroup|sensitivity|meta_input|model)/.test(value)) {
        return 'data_analysis';
    }
    if (value.includes('06_quality_assessment') || /(quality assessment|risk.of.bias|risk-of-bias|rob|quadas|grade|nos)/.test(value)) {
        return 'quality_assessment';
    }
    if (value.includes('05_data_extraction') || /(data extraction|extraction table|effect-size|effect size|study characteristics)/.test(value)) {
        return 'data_extraction';
    }
    if (value.includes('04_full_text_review') || /(full.text|fulltext|pdf|mineru|parse|zotero|attachment)/.test(value)) {
        return 'full_text_review';
    }
    if (value.includes('03_title_abstract_screening') || /(title.?abstract|screening_decisions|first.screen|second.screen|screening)/.test(value)) {
        return 'title_abstract_screening';
    }
    if (value.includes('02_search_dedupe') || /(search|dedupe|dedup|import log|reference export)/.test(value)) {
        return 'search_dedupe';
    }
    if (value.includes('01_protocol') || /(protocol|pico|peco|eligibility|inclusion|exclusion|outcomes?)/.test(value)) {
        return 'protocol';
    }
    if (value.includes('00_literature') || /(literature|evidence gap|seed references?|topic selection|scoping)/.test(value)) {
        return 'literature';
    }

    return fallbackStage;
}

function inferMetaStageFromBlueprintNode(blueprintNode, sourceStage = '') {
    const blueprintId = getBlueprintNodeId(blueprintNode).toLowerCase();
    if (blueprintId && META_BLUEPRINT_STAGE_OVERRIDES[blueprintId]) {
        return META_BLUEPRINT_STAGE_OVERRIDES[blueprintId];
    }

    const fallback = normalizeMetaStageName(sourceStage) || 'literature';
    return inferMetaStageFromText(getBlueprintNodeText(blueprintNode), fallback) || fallback;
}

function ensureMetaStageConfig(stages, stage, sourceConfig = null) {
    if (!stage || !META_WORKFLOW_STAGE_ORDER.includes(stage)) return null;
    const defaultRequiredElements = META_STAGE_REQUIRED_ELEMENTS[stage] || [];
    const sourceSkills = Array.isArray(sourceConfig?.recommended_skills)
        ? sourceConfig.recommended_skills
        : [];

    if (!stages[stage] || typeof stages[stage] !== 'object' || Array.isArray(stages[stage])) {
        stages[stage] = {
            required_elements: [...defaultRequiredElements],
            quality_gate: Array.isArray(sourceConfig?.quality_gate) ? [...sourceConfig.quality_gate] : [],
            task_blueprints: [],
            recommended_skills: sourceSkills.length > 0 ? [...sourceSkills] : [...(DEFAULT_STAGE_SKILL_MAP[stage]?.base || [])],
        };
    }

    const config = stages[stage];
    if (!Array.isArray(config.required_elements) || config.required_elements.length === 0) {
        config.required_elements = [...defaultRequiredElements];
    }
    if (!Array.isArray(config.quality_gate)) {
        config.quality_gate = [];
    }
    if (!Array.isArray(config.task_blueprints)) {
        config.task_blueprints = ensureArray(config.task_blueprints);
    }
    if (!Array.isArray(config.recommended_skills) || config.recommended_skills.length === 0) {
        config.recommended_skills = sourceSkills.length > 0
            ? [...sourceSkills]
            : [...(DEFAULT_STAGE_SKILL_MAP[stage]?.base || [])];
    }
    return config;
}

function appendUniqueBlueprint(stageConfig, blueprintNode, fallbackId = '') {
    if (!stageConfig) return;
    const blueprint = cloneJsonCompatible(blueprintNode);
    const blueprintId = getBlueprintNodeId(blueprint, fallbackId);
    if (blueprintId) {
        const alreadyExists = ensureArray(stageConfig.task_blueprints).some(
            (node) => getBlueprintNodeId(node).toLowerCase() === blueprintId.toLowerCase(),
        );
        if (alreadyExists) return;
    }
    stageConfig.task_blueprints.push(blueprint);
}

function normalizeMetaPipelineStages(pipelineStages = {}) {
    const sourceStages = pipelineStages && typeof pipelineStages === 'object' && !Array.isArray(pipelineStages)
        ? pipelineStages
        : {};
    const normalizedStages = {};

    Object.entries(sourceStages).forEach(([rawStage, stageConfig]) => {
        const stage = normalizeStageName(rawStage);
        if (!stage || stage === 'literature' || !META_WORKFLOW_STAGE_ORDER.includes(stage)) {
            return;
        }
        if (!stageConfig || typeof stageConfig !== 'object' || Array.isArray(stageConfig)) {
            return;
        }

        normalizedStages[stage] = cloneJsonCompatible(stageConfig);
        ensureMetaStageConfig(normalizedStages, stage, stageConfig);
    });

    Object.entries(sourceStages).forEach(([rawStage, stageConfig]) => {
        const sourceStage = normalizeStageName(rawStage);
        if (!sourceStage || !Object.prototype.hasOwnProperty.call(LEGACY_META_STAGE_FALLBACKS, sourceStage)) {
            return;
        }
        if (!stageConfig || typeof stageConfig !== 'object' || Array.isArray(stageConfig)) {
            return;
        }

        const blueprints = ensureArray(stageConfig.task_blueprints);
        if (blueprints.length === 0) {
            ensureMetaStageConfig(normalizedStages, normalizeMetaStageName(sourceStage), stageConfig);
            return;
        }

        blueprints.forEach((blueprintNode, index) => {
            const targetStage = inferMetaStageFromBlueprintNode(blueprintNode, sourceStage);
            const targetConfig = ensureMetaStageConfig(normalizedStages, targetStage, stageConfig);
            appendUniqueBlueprint(targetConfig, blueprintNode, `${targetStage}_task_${index + 1}`);
        });
    });

    return Object.fromEntries(
        META_WORKFLOW_STAGE_ORDER
            .filter((stage) => normalizedStages[stage])
            .map((stage) => [stage, normalizedStages[stage]]),
    );
}

function normalizeMetaPipelineForTaskGeneration(pipeline = {}) {
    const sourcePipeline = pipeline && typeof pipeline === 'object' && !Array.isArray(pipeline)
        ? cloneJsonCompatible(pipeline)
        : {};
    return {
        ...sourcePipeline,
        version: sourcePipeline.version || '1.1',
        mode: 'meta',
        startStage: normalizeMetaStageName(sourcePipeline.startStage) || 'literature',
        stages: normalizeMetaPipelineStages(sourcePipeline.stages),
    };
}

function titleFromBlueprintId(sourceBlueprintId = '', stage = '') {
    const cleaned = String(sourceBlueprintId || '').replace(/[_-]+/g, ' ').trim();
    const title = cleaned
        ? cleaned.replace(/\b\w/g, (ch) => ch.toUpperCase())
        : `Execute ${STAGE_LABELS[stage] || 'Pipeline'} task`;
    return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

function getValueByPath(target, dottedPath) {
    if (!target || typeof target !== 'object') return undefined;
    const keys = String(dottedPath || '').split('.').filter(Boolean);
    if (keys.length === 0) return undefined;
    let cursor = target;
    for (const key of keys) {
        if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
            return undefined;
        }
        cursor = cursor[key];
    }
    return cursor;
}

function hasMeaningfulValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return !isPlaceholderLikeValue(value);
    if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
}

function computeMissingElements(briefData = {}, requiredElements = []) {
    if (!Array.isArray(requiredElements)) return [];
    return requiredElements
        .map((pathName) => String(pathName || '').trim())
        .filter(Boolean)
        .filter((pathName) => !hasMeaningfulValue(getValueByPath(briefData, pathName)));
}

function ensureArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value];
}

function dedupeStringList(values = []) {
    return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function formatInputValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        return value.trim();
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item ?? '').trim())
            .filter(Boolean)
            .join('\n');
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function toTitleCase(text = '') {
    return String(text || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function formatFieldDisplayName(pathName = '') {
    const cleaned = String(pathName || '').trim();
    if (!cleaned) return 'Required Field';
    const parts = cleaned.split('.').filter(Boolean);
    const fieldKey = parts[parts.length - 1] || cleaned;
    const stageKey = parts[1] && STAGE_LABELS[parts[1]] ? STAGE_LABELS[parts[1]] : '';
    const fieldLabel = toTitleCase(fieldKey.replace(/[_-]+/g, ' '));
    return stageKey ? `${stageKey} ${fieldLabel}` : fieldLabel;
}

function resolveTaskSkills(stage, taskType, stageConfiguredSkills = [], blueprintSkills = []) {
    const stageMap = getStageSkillMap()[stage] || {};
    const fromStageBase = ensureArray(stageMap.base);
    const fromTaskType = ensureArray(stageMap.byTaskType?.[taskType]);
    return dedupeStringList([
        ...ensureArray(stageConfiguredSkills),
        ...fromStageBase,
        ...fromTaskType,
        ...ensureArray(blueprintSkills),
    ]);
}

function isReviewStepTask(task = {}) {
    const sourceBlueprintId = String(task.sourceBlueprintId || '').trim().toLowerCase();
    if (sourceBlueprintId.endsWith('.quality_gate')) {
        return true;
    }

    const combined = `${task.title || ''} ${task.description || ''}`;
    return /\b(review|quality gate|audit|peer review|reviewer|approval)\b/i.test(combined)
        || /(审核|审阅|复核|评审|把关|质量门)/.test(combined);
}

function shouldWriteTaskReport(task = {}) {
    if (isReviewStepTask(task)) {
        return true;
    }

    const taskType = String(task.taskType || '').trim().toLowerCase();
    return ['analysis', 'writing', 'implementation', 'scripting', 'rendering', 'narration'].includes(taskType);
}

function buildSuggestedTaskReportPath(task = {}, stage = '') {
    const normalizedStage = resolveReportStage({
        stage: stage || task.stage || '',
        taskType: task.taskType || '',
        text: [
            task.title || '',
            task.description || '',
            task.nextActionPrompt || '',
            task.sourceBlueprintId || '',
        ].join(' '),
    });
    const reviewTask = isReviewStepTask(task);
    const taskType = String(task.taskType || '').trim().toLowerCase();
    const reportRoot = STAGE_REPORT_ROOTS[normalizedStage] || 'Experiment/analysis';
    const suffix = reviewTask ? 'review' : taskType === 'writing' ? 'change-log' : 'report';
    const baseName = slugifyFileSegment(task.title || `${normalizedStage || 'task'}-${task.id || 'item'}`, 'task');
    return `${reportRoot}/${baseName}-${suffix}.md`;
}

function buildTaskNextActionPrompt(task = {}, stageConfig = {}, stage = '', briefData = {}) {
    const lines = [
        `Task ID: ${task.id != null ? task.id : 'unknown'}`,
        `Task: ${task.title || 'Untitled Task'}`,
        `Stage: ${STAGE_LABELS[stage] || stage || 'Unknown'}`,
    ];
    const reviewStep = isReviewStepTask(task);
    const reportFirst = shouldWriteTaskReport(task);
    const suggestedReportPath = reportFirst ? buildSuggestedTaskReportPath(task, stage) : '';

    const requiredInputs = dedupeStringList(Array.isArray(task.inputsNeeded) ? task.inputsNeeded : []);
    const missingInputs = [];
    const providedInputs = [];
    requiredInputs.forEach((pathName) => {
        const value = getValueByPath(briefData, pathName);
        if (hasMeaningfulValue(value)) {
            providedInputs.push({ pathName, value: formatInputValue(value) });
        } else {
            missingInputs.push(pathName);
        }
    });

    if (missingInputs.length > 0) {
        lines.push(`Missing inputs: ${missingInputs.join(', ')}`);
    }
    if (providedInputs.length === 1) {
        lines.push(`User inputs: "${providedInputs[0].value}"`);
    } else if (providedInputs.length > 1) {
        lines.push('User inputs:');
        providedInputs.forEach((entry) => {
            lines.push(`- ${entry.pathName}: "${entry.value}"`);
        });
    }

    const suggestedSkills = Array.isArray(task.suggestedSkills) ? task.suggestedSkills : [];
    if (suggestedSkills.length > 0) {
        lines.push(`Suggested skills: ${suggestedSkills.join(', ')}`);
    }

    const qualityGate = Array.isArray(stageConfig.quality_gate) ? stageConfig.quality_gate : [];
    if (qualityGate.length > 0 && task.taskType === 'analysis') {
        lines.push(`Quality gate checklist: ${qualityGate.join(' | ')}`);
    }

    if (STAGE_PROMPT_HINTS[stage]) {
        lines.push(`Stage guidance: ${STAGE_PROMPT_HINTS[stage]}`);
    }
    lines.push(buildWorkspaceMaterialsRule());
    lines.push(buildOutputLocationRule(stage, [
        task.title || '',
        task.description || '',
        task.nextActionPrompt || '',
        task.sourceBlueprintId || '',
    ].join(' '), task.taskType || ''));
    lines.push(buildCodeLocationRule(stage, [
        task.title || '',
        task.description || '',
        task.nextActionPrompt || '',
        task.sourceBlueprintId || '',
    ].join(' ')));
    lines.push(buildEvidenceIntegrityRule());
    lines.push(buildHumanReviewGateRule());
    lines.push(buildContextCompactionRule());

    if (reviewStep) {
        lines.push('Review workflow: run an explicit audit or reviewer pass on the existing outputs. A named Claude reviewer pass can satisfy the second-review role; do not require two human reviewers. Produce a concrete review artifact or verdict. If the user has already authorized the item and no legal, safety, or data-quality blocker remains, move forward instead of asking for more manual fields. Only keep the task in review when the review identifies unresolved blockers.');
    }
    if (reportFirst) {
        lines.push(`Execution log: before your final reply, write or update a concrete Markdown task report at ${suggestedReportPath}. Include the objective, touched files or sections, what changed, key findings or decisions, remaining issues, and the next step.`);
        lines.push('Persistence rule: do not leave report-style work only in chat text. The Markdown artifact is the handoff record for other AI sessions.');
        lines.push('Chat response rule: after the report is written, reply with only the report path, the touched files, and a one-sentence verdict or progress update. Do not dump the full report into chat.');
        lines.push(`Task bookkeeping: if automatic task sync does not catch up after you edit files or write the report, run node scripts/pipeline-task.mjs update --task-id ${task.id != null ? task.id : 'TASK_ID'} --status <pending|in-progress|review|done> --details "<report path + changed files + short summary>" from the project root.`);
    }

    if (providedInputs.length > 0) {
        lines.push('Please produce a concrete next step plan and execution output. If user inputs are provided, polish and make them concrete, then write updates back to .pipeline/docs/research_brief.json.');
    } else {
        lines.push('Please produce a concrete next step plan and execution output. If key inputs are missing, propose precise placeholders and write updates back to .pipeline/docs/research_brief.json. For registry/protocol registration, do not claim to register on the user\'s behalf; if registration cannot be completed from the agent, record concise registration instructions and continue with the workflow.');
    }
    return lines.join('\n');
}

function instantiatePipelineTasksFromBrief(briefData = {}, numTasks = DEFAULT_MAX_TASKS) {
    const rawPipelineStages = briefData?.pipeline?.stages && typeof briefData.pipeline.stages === 'object'
        ? briefData.pipeline.stages
        : null;
    if (!rawPipelineStages) return null;

    const now = new Date().toISOString();
    const generated = [];
    const maxTasks = Number.isFinite(Number(numTasks)) && Number(numTasks) > 0 ? Number(numTasks) : DEFAULT_MAX_TASKS;
    const metaPipeline = isMetaBriefData(briefData);
    const pipelineStages = metaPipeline ? normalizeMetaPipelineStages(rawPipelineStages) : rawPipelineStages;
    const stageOrder = metaPipeline ? META_WORKFLOW_STAGE_ORDER : STAGE_ORDER;

    // Respect pipeline.startStage — only generate tasks for stages >= startStage
    const startStage = (metaPipeline
        ? normalizeMetaStageName(briefData?.pipeline?.startStage)
        : normalizeStageName(briefData?.pipeline?.startStage)) || 'literature';
    const startIdx = stageOrder.indexOf(startStage);
    const activeStages = startIdx > 0 ? stageOrder.slice(startIdx) : stageOrder;

    for (const stage of activeStages) {
        const stageConfig = pipelineStages?.[stage]
            || (!metaPipeline && stage === 'literature' ? pipelineStages?.survey : null)
            || (!metaPipeline && stage === 'promotion' ? pipelineStages?.presentation : null);
        if (!stageConfig || typeof stageConfig !== 'object') continue;

        const stageSkills = resolveTaskSkills(stage, '', stageConfig.recommended_skills, []);
        const stageRequiredElements = dedupeStringList(ensureArray(stageConfig.required_elements));
        const missingElements = computeMissingElements(briefData, stageConfig.required_elements);
        const stageBlueprints = ensureArray(stageConfig.task_blueprints);

        stageBlueprints.forEach((blueprintNode, index) => {
            const blueprint = typeof blueprintNode === 'string'
                ? { id: blueprintNode }
                : (blueprintNode && typeof blueprintNode === 'object' ? blueprintNode : { id: `${stage}_task_${index + 1}` });
            const sourceBlueprintId = String(blueprint.id || `${stage}_task_${index + 1}`);
            const task = normalizeTask({
                id: generated.length + 1,
                title: blueprint.title || titleFromBlueprintId(sourceBlueprintId, stage),
                description: blueprint.description || `Execute ${STAGE_LABELS[stage] || stage} task from pipeline blueprint.`,
                status: 'pending',
                priority: blueprint.priority || 'medium',
                dependencies: Array.isArray(blueprint.dependencies) ? blueprint.dependencies : [],
                createdAt: now,
                updatedAt: now,
                stage,
                taskType: blueprint.taskType || 'implementation',
                inputsNeeded: dedupeStringList([
                    ...ensureArray(blueprint.inputsNeeded),
                    ...stageRequiredElements,
                ]),
                suggestedSkills: resolveTaskSkills(stage, blueprint.taskType || 'implementation', stageSkills, blueprint.recommended_skills),
                sourceBlueprintId,
                nextActionPrompt: blueprint.nextActionPrompt || '',
            });
            task.nextActionPrompt = task.nextActionPrompt || buildTaskNextActionPrompt(task, stageConfig, stage, briefData);
            generated.push(task);
        });

        stageRequiredElements.forEach((requiredPath) => {
            const value = getValueByPath(briefData, requiredPath);
            const hasValue = hasMeaningfulValue(value);
            const fieldDisplayName = formatFieldDisplayName(requiredPath);
            const task = normalizeTask({
                id: generated.length + 1,
                title: hasValue ? `Refine ${fieldDisplayName}` : `Define ${fieldDisplayName}`,
                description: hasValue
                    ? `The required field "${requiredPath}" exists but may still be vague. Refine it into concrete, testable language.`
                    : `The required field "${requiredPath}" is missing or unclear. Clarify it before stage completion.`,
                status: 'pending',
                priority: hasValue ? 'medium' : 'high',
                dependencies: [],
                createdAt: now,
                updatedAt: now,
                stage,
                taskType: hasValue ? 'analysis' : 'exploration',
                inputsNeeded: [requiredPath],
                suggestedSkills: resolveTaskSkills(stage, hasValue ? 'analysis' : 'exploration', stageSkills, []),
                sourceBlueprintId: hasValue ? `${stage}.refine.${requiredPath}` : `${stage}.missing.${requiredPath}`,
                nextActionPrompt: '',
            });
            task.nextActionPrompt = buildTaskNextActionPrompt(task, stageConfig, stage, briefData);
            generated.push(task);
        });

        const qualityGate = Array.isArray(stageConfig.quality_gate)
            ? stageConfig.quality_gate.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        if (qualityGate.length > 0) {
            const task = normalizeTask({
                id: generated.length + 1,
                title: `Review ${STAGE_LABELS[stage] || stage} quality gate before moving forward`,
                description: `Complete and verify ${STAGE_LABELS[stage] || stage} quality gate criteria.`,
                status: 'pending',
                priority: 'medium',
                dependencies: [],
                createdAt: now,
                updatedAt: now,
                stage,
                taskType: 'analysis',
                inputsNeeded: [],
                suggestedSkills: resolveTaskSkills(stage, 'analysis', stageSkills, []),
                sourceBlueprintId: `${stage}.quality_gate`,
                nextActionPrompt: '',
            });
            task.nextActionPrompt = buildTaskNextActionPrompt(task, stageConfig, stage, briefData);
            generated.push(task);
        }
    }

    const tempIdByBlueprint = new Map(
        generated
            .filter((task) => task.sourceBlueprintId)
            .map((task) => [String(task.sourceBlueprintId), task.id]),
    );
    const normalized = generated.slice(0, maxTasks).map((task, index) => normalizeTask({
        ...task,
        id: index + 1,
        dependencies: Array.isArray(task.dependencies)
            ? task.dependencies.map((dep) => tempIdByBlueprint.get(String(dep)) || dep)
            : [],
    }));

    return normalized.length > 0 ? normalized : null;
}

function computeNextGuidance(tasks = []) {
    const allTasks = Array.isArray(tasks) ? tasks : [];
    const doneIds = new Set(
        allTasks
            .filter((task) => String(task.status || '').toLowerCase() === 'done')
            .map((task) => String(task.id)),
    );

    const inProgress = allTasks.find((task) => String(task.status || '').toLowerCase() === 'in-progress') || null;
    if (inProgress) {
        return {
            nextTask: inProgress,
            whyNext: 'This task is already in progress and should be finished first.',
            requiredInputs: Array.isArray(inProgress.inputsNeeded) ? inProgress.inputsNeeded : [],
            suggestedSkills: Array.isArray(inProgress.suggestedSkills) ? inProgress.suggestedSkills : [],
            nextActionPrompt: inProgress.nextActionPrompt || '',
        };
    }

    const inReview = allTasks.find((task) => String(task.status || '').toLowerCase() === 'review') || null;
    if (inReview) {
        return {
            nextTask: inReview,
            whyNext: 'This task has generated evidence and is waiting for review or sign-off before the stage can move forward.',
            requiredInputs: Array.isArray(inReview.inputsNeeded) ? inReview.inputsNeeded : [],
            suggestedSkills: Array.isArray(inReview.suggestedSkills) ? inReview.suggestedSkills : [],
            nextActionPrompt: inReview.nextActionPrompt || '',
        };
    }

    const pendingTasks = allTasks.filter((task) => String(task.status || '').toLowerCase() === 'pending');
    if (pendingTasks.length === 0) {
        return {
            nextTask: null,
            whyNext: 'No pending, in-progress, or review tasks available.',
            requiredInputs: [],
            suggestedSkills: [],
            nextActionPrompt: '',
        };
    }

    const readyTask = pendingTasks.find((task) => {
        const deps = Array.isArray(task.dependencies) ? task.dependencies.map((dep) => String(dep)) : [];
        return deps.every((dep) => doneIds.has(dep));
    }) || pendingTasks[0];

    const blockedDependencies = Array.isArray(readyTask.dependencies)
        ? readyTask.dependencies.filter((dep) => !doneIds.has(String(dep)))
        : [];
    const whyNext = blockedDependencies.length === 0
        ? 'This is the first actionable pending task based on dependency order.'
        : `This pending task is recommended, but it still references unresolved dependencies: ${blockedDependencies.join(', ')}`;

    return {
        nextTask: readyTask,
        whyNext,
        requiredInputs: Array.isArray(readyTask.inputsNeeded) ? readyTask.inputsNeeded : [],
        suggestedSkills: Array.isArray(readyTask.suggestedSkills) ? readyTask.suggestedSkills : [],
        nextActionPrompt: readyTask.nextActionPrompt || '',
    };
}

function computeTaskmasterStatus(taskMasterResult, mcpResult) {
    let status = 'not-configured';
    if (taskMasterResult.hasTaskmaster && taskMasterResult.hasEssentialFiles) {
        if (mcpResult.hasMCPServer && mcpResult.isConfigured) {
            status = 'fully-configured';
        } else {
            status = 'taskmaster-only';
        }
    } else if (mcpResult.hasMCPServer && mcpResult.isConfigured) {
        status = 'mcp-only';
    }
    return status;
}

function buildTaskmasterSummaryPayload({
    projectName,
    projectPath,
    status,
    tasks = [],
    nextTask = null,
    guidance = null,
    updatedAt = new Date().toISOString(),
}) {
    const tasksByStatus = tasks.reduce((acc, task) => {
        const taskStatus = normalizeTaskStatus(task.status);
        acc[taskStatus] = (acc[taskStatus] || 0) + 1;
        return acc;
    }, {
        pending: 0,
        'in-progress': 0,
        done: 0,
        review: 0,
        deferred: 0,
        cancelled: 0,
        blocked: 0,
    });

    const total = tasks.length;
    const completed = tasksByStatus.done || 0;

    return {
        project: projectName,
        status,
        project_path: projectPath,
        counts: {
            total,
            completed,
            in_progress: tasksByStatus['in-progress'] || 0,
            pending: tasksByStatus.pending || 0,
            blocked: tasksByStatus.blocked || 0,
            review: tasksByStatus.review || 0,
            deferred: tasksByStatus.deferred || 0,
            cancelled: tasksByStatus.cancelled || 0,
            completion_rate: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
        },
        next_task: nextTask,
        guidance,
        updated_at: updatedAt,
    };
}

function dedupeGeneratedTasks(existingTasks = [], generatedTasks = []) {
    const signature = (task) => `${String(task.title || '').trim().toLowerCase()}|${String(task.description || '').trim().toLowerCase()}`;
    const existingSignatures = new Set(existingTasks.map(signature));
    return generatedTasks.filter((task) => {
        const key = signature(task);
        if (existingSignatures.has(key)) return false;
        existingSignatures.add(key);
        return true;
    });
}

function buildGeneratedTasksFromBriefData(briefData = {}, existingTasks = [], maxTasks = DEFAULT_MAX_TASKS, now = new Date().toISOString()) {
    const pipelineGenerated = instantiatePipelineTasksFromBrief(briefData, maxTasks);
    if (pipelineGenerated && pipelineGenerated.length > 0) {
        let nextId = generateTaskId(existingTasks);
        return {
            generationMode: 'pipeline-blueprint',
            tasks: pipelineGenerated.map((task) => normalizeTask({
                ...task,
                id: nextId++,
                createdAt: task.createdAt || now,
                updatedAt: now,
            })),
        };
    }

    const metaBrief = isMetaBriefData(briefData);
    const candidates = parseBriefJsonToTaskCandidates(briefData, { isMeta: metaBrief });
    let nextId = generateTaskId(existingTasks);
    return {
        generationMode: 'legacy-fallback',
        tasks: candidates.slice(0, maxTasks).map((candidate) => {
            const inferredStage = metaBrief
                ? inferMetaStageFromText(candidate, 'literature')
                : inferStageFromCandidate(candidate);
            const task = normalizeTask({
                id: nextId++,
                title: splitPromptToTitle(candidate),
                description: candidate,
                status: 'pending',
                priority: 'medium',
                dependencies: [],
                createdAt: now,
                updatedAt: now,
                stage: inferredStage,
                taskType: 'exploration',
                suggestedSkills: ensureArray(getStageSkillMap()[inferredStage]?.base),
                sourceBlueprintId: `legacy.candidate.${nextId - 1}`,
                nextActionPrompt: [
                    `Task: ${splitPromptToTitle(candidate)}`,
                    `Description: ${candidate}`,
                    'Please turn this into a concrete actionable plan and provide first-step outputs.',
                ].join('\n'),
            });
            return task;
        }),
    };
}

function buildTaskPlanningSignature(task = {}) {
    return [
        normalizeStageName(task.stage) || '',
        collapseWhitespace(task.title || '').toLowerCase(),
        collapseWhitespace(task.description || '').toLowerCase(),
    ].join('|');
}

function appendTaskPlanningSyncNote(existingDetails = '', message = '') {
    const normalizedMessage = collapseWhitespace(message);
    if (!normalizedMessage) {
        return existingDetails || '';
    }
    const marker = `Task plan sync: ${normalizedMessage}`;
    const details = String(existingDetails || '').trim();
    if (!details) {
        return marker;
    }
    if (details.includes(marker)) {
        return details;
    }
    return `${details}\n\n${marker}`;
}

function mergeGeneratedTasksWithExisting(existingTasks = [], generatedTasks = [], now = new Date().toISOString()) {
    const existingByBlueprint = new Map();
    const existingBySignature = new Map();
    existingTasks.forEach((task) => {
        if (task.sourceBlueprintId) {
            existingByBlueprint.set(String(task.sourceBlueprintId), task);
        }
        existingBySignature.set(buildTaskPlanningSignature(task), task);
    });

    const matchedExistingIds = new Set();
    const generatedBlueprintIds = new Set(
        generatedTasks.map((task) => String(task.sourceBlueprintId || '')).filter(Boolean),
    );
    const tempIdToFinalId = new Map();
    let nextId = generateTaskId(existingTasks);

    const mergedGeneratedTasks = generatedTasks.map((generatedTask) => {
        const blueprintId = String(generatedTask.sourceBlueprintId || '');
        let existingTask = null;
        if (blueprintId && existingByBlueprint.has(blueprintId)) {
            existingTask = existingByBlueprint.get(blueprintId);
        } else {
            existingTask = existingBySignature.get(buildTaskPlanningSignature(generatedTask)) || null;
        }

        const finalId = existingTask ? existingTask.id : nextId++;
        tempIdToFinalId.set(String(generatedTask.id), finalId);
        if (existingTask) {
            matchedExistingIds.add(String(existingTask.id));
        }

        return normalizeTask({
            ...generatedTask,
            id: finalId,
            status: existingTask?.status || generatedTask.status,
            priority: existingTask?.priority || generatedTask.priority,
            details: existingTask?.details || generatedTask.details || '',
            testStrategy: existingTask?.testStrategy || generatedTask.testStrategy || '',
            subtasks: Array.isArray(existingTask?.subtasks) ? existingTask.subtasks : (Array.isArray(generatedTask.subtasks) ? generatedTask.subtasks : []),
            createdAt: existingTask?.createdAt || generatedTask.createdAt || now,
            updatedAt: existingTask ? now : (generatedTask.updatedAt || now),
        });
    }).map((task, index) => normalizeTask({
        ...task,
        dependencies: (Array.isArray(generatedTasks[index]?.dependencies) ? generatedTasks[index].dependencies : [])
            .map((dep) => tempIdToFinalId.get(String(dep)) || dep),
    }));

    const preservedExistingTasks = existingTasks
        .filter((task) => !matchedExistingIds.has(String(task.id)))
        .map((task) => {
            const normalizedStatus = normalizeTaskStatus(task.status);
            if (
                task.sourceBlueprintId
                && !generatedBlueprintIds.has(String(task.sourceBlueprintId))
                && normalizedStatus === 'pending'
            ) {
                return normalizeTask({
                    ...task,
                    status: 'deferred',
                    details: appendTaskPlanningSyncNote(
                        task.details,
                        'This generated task no longer appears in the latest research brief, so it was deferred for manual review.',
                    ),
                    updatedAt: now,
                });
            }
            return normalizeTask(task);
        });

    return [...mergedGeneratedTasks, ...preservedExistingTasks];
}

function stripTaskForSyncComparison(task = {}) {
    return {
        id: String(task.id),
        title: task.title || '',
        description: task.description || '',
        status: normalizeTaskStatus(task.status),
        priority: task.priority || 'medium',
        dependencies: Array.isArray(task.dependencies) ? task.dependencies.map((dep) => String(dep)) : [],
        details: task.details || '',
        testStrategy: task.testStrategy || '',
        subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
        stage: normalizeStageName(task.stage) || '',
        taskType: task.taskType || 'implementation',
        inputsNeeded: Array.isArray(task.inputsNeeded) ? task.inputsNeeded : [],
        suggestedSkills: Array.isArray(task.suggestedSkills) ? task.suggestedSkills : [],
        sourceBlueprintId: task.sourceBlueprintId || '',
        nextActionPrompt: task.nextActionPrompt || '',
    };
}

async function updateTaskRecord(projectPath, taskId, updates = {}) {
    assertAbsoluteProjectPath(projectPath, path.basename(projectPath || '') || 'project');
    const paths = await ensurePipelineInitialized(projectPath);
    const { tasks, currentTag } = await readTasksFile(paths.tasksFile);
    const now = new Date().toISOString();
    const targetId = String(taskId);
    const taskIndex = tasks.findIndex((task) => String(task.id) === targetId);

    if (taskIndex === -1) {
        const error = new Error(`Task "${taskId}" does not exist`);
        error.code = 'TASK_NOT_FOUND';
        throw error;
    }

    const existingTask = tasks[taskIndex];
    const updatedTask = {
        ...existingTask,
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.description !== undefined ? { description: updates.description } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
        ...(updates.details !== undefined ? { details: updates.details } : {}),
        ...(updates.testStrategy !== undefined ? { testStrategy: updates.testStrategy } : {}),
        ...(updates.dependencies !== undefined ? { dependencies: Array.isArray(updates.dependencies) ? updates.dependencies : [] } : {}),
        updatedAt: now,
    };

    const nextTasks = [...tasks];
    nextTasks[taskIndex] = normalizeTask(updatedTask);
    await writeTasksFile(paths.tasksFile, nextTasks, currentTag);
    return {
        projectPath,
        tasksPath: paths.tasksFile,
        currentTag,
        task: nextTasks[taskIndex],
        tasks: nextTasks,
        timestamp: now,
    };
}

async function syncTasksWithResearchBrief(projectPath, options = {}) {
    assertAbsoluteProjectPath(projectPath, path.basename(projectPath || '') || 'project');
    const {
        fileName = DEFAULT_RESEARCH_BRIEF_FILENAME,
        numTasks,
        mode = 'merge',
    } = options;

    if (!fileName.endsWith('.json')) {
        const error = new Error('Research Brief must be a .json file');
        error.code = 'INVALID_BRIEF_FILENAME';
        throw error;
    }

    const paths = await ensurePipelineInitialized(projectPath);
    const briefPath = path.join(paths.docsDir, fileName);
    if (!(await pathExists(briefPath))) {
        return { synced: false, reason: 'brief_missing', briefPath };
    }

    let briefData;
    try {
        briefData = JSON.parse(await fsPromises.readFile(briefPath, 'utf8'));
    } catch (error) {
        error.code = 'INVALID_BRIEF_JSON';
        throw error;
    }

    const { tasks: existingTasks, currentTag } = await readTasksFile(paths.tasksFile);
    const now = new Date().toISOString();
    const maxTasks = Number.isFinite(Number(numTasks)) && Number(numTasks) > 0 ? Number(numTasks) : DEFAULT_MAX_TASKS;
    const { generationMode, tasks: generatedTasks } = buildGeneratedTasksFromBriefData(briefData, existingTasks, maxTasks, now);

    let nextTasks = generatedTasks;
    if (mode === 'append') {
        nextTasks = [...existingTasks, ...dedupeGeneratedTasks(existingTasks, generatedTasks)];
    } else if (mode === 'merge') {
        nextTasks = mergeGeneratedTasksWithExisting(existingTasks, generatedTasks, now);
    }

    const existingComparable = existingTasks.map(stripTaskForSyncComparison);
    const nextComparable = nextTasks.map(stripTaskForSyncComparison);
    if (JSON.stringify(existingComparable) === JSON.stringify(nextComparable)) {
        return {
            synced: false,
            reason: 'unchanged',
            generationMode,
            currentTag,
            briefPath,
            tasksPath: paths.tasksFile,
            generatedCount: generatedTasks.length,
            totalTasks: existingTasks.length,
        };
    }

    await writeTasksFile(paths.tasksFile, nextTasks, currentTag);
    return {
        synced: true,
        reason: mode,
        generationMode,
        currentTag,
        briefPath,
        tasksPath: paths.tasksFile,
        generatedCount: generatedTasks.length,
        totalTasks: nextTasks.length,
        tasks: nextTasks,
    };
}

/**
 * Check if TaskMaster CLI is installed globally
 * @returns {Promise<Object>} Installation status result
 */
async function checkTaskMasterInstallation() {
    return {
        isInstalled: true,
        installPath: PIPELINE_DIR,
        version: 'web-native',
        reason: null,
    };
}

/**
 * Detect .pipeline folder presence in a given project directory
 * @param {string} projectPath - Absolute path to project directory
 * @returns {Promise<Object>} Detection result with status and metadata
 */
async function detectTaskMasterFolder(projectPath) {
    try {
        await migrateLegacyTaskmasterIfNeeded(projectPath);
        const taskMasterPath = getPipelinePaths(projectPath).root;
        
        // Check if .pipeline directory exists
        try {
            const stats = await fsPromises.stat(taskMasterPath);
            if (!stats.isDirectory()) {
                return {
                    hasTaskmaster: false,
                    reason: '.pipeline exists but is not a directory'
                };
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    hasTaskmaster: false,
                    reason: '.pipeline directory not found'
                };
            }
            throw error;
        }

        // Check for key TaskMaster files
        const keyFiles = [
            'tasks/tasks.json',
            'docs/research_brief.json',
            'config.json'
        ];
        
        const fileStatus = {};
        let hasEssentialFiles = true;

        for (const file of keyFiles) {
            const filePath = path.join(taskMasterPath, file);
            try {
                await fsPromises.access(filePath, fs.constants.R_OK);
                fileStatus[file] = true;
            } catch (error) {
                fileStatus[file] = false;
                if (file === 'tasks/tasks.json') {
                    hasEssentialFiles = false;
                }
            }
        }

        // Parse tasks.json if it exists for metadata
        let taskMetadata = null;
        if (fileStatus['tasks/tasks.json']) {
            try {
                const tasksPath = path.join(taskMasterPath, 'tasks/tasks.json');
                const tasksContent = await fsPromises.readFile(tasksPath, 'utf8');
                const tasksData = JSON.parse(tasksContent);
                const { tasks } = extractTasksFromData(tasksData);

                // Calculate task statistics
                const stats = tasks.reduce((acc, task) => {
                    const taskStatus = normalizeTaskStatus(task.status);
                    acc.total++;
                    acc[taskStatus] = (acc[taskStatus] || 0) + 1;
                    
                    // Count subtasks
                    if (task.subtasks) {
                        task.subtasks.forEach(subtask => {
                            const subtaskStatus = normalizeTaskStatus(subtask.status);
                            acc.subtotalTasks++;
                            acc.subtasks = acc.subtasks || {};
                            acc.subtasks[subtaskStatus] = (acc.subtasks[subtaskStatus] || 0) + 1;
                        });
                    }
                    
                    return acc;
                }, { 
                    total: 0, 
                    subtotalTasks: 0,
                    pending: 0, 
                    'in-progress': 0, 
                    done: 0, 
                    review: 0,
                    deferred: 0,
                    cancelled: 0,
                    subtasks: {}
                });

                taskMetadata = {
                    taskCount: stats.total,
                    subtaskCount: stats.subtotalTasks,
                    completed: stats.done || 0,
                    pending: stats.pending || 0,
                    inProgress: stats['in-progress'] || 0,
                    review: stats.review || 0,
                    completionPercentage: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
                    lastModified: (await fsPromises.stat(tasksPath)).mtime.toISOString()
                };
            } catch (parseError) {
                console.warn('Failed to parse tasks.json:', parseError.message);
                taskMetadata = { error: 'Failed to parse tasks.json' };
            }
        }

        const hasResearchBrief = fileStatus['docs/research_brief.json'] === true;

        return {
            hasTaskmaster: true,
            hasEssentialFiles,
            hasResearchBrief,
            files: fileStatus,
            metadata: taskMetadata,
            path: taskMasterPath
        };

    } catch (error) {
        console.error('Error detecting TaskMaster folder:', error);
        return {
            hasTaskmaster: false,
            reason: `Error checking directory: ${error.message}`
        };
    }
}

// MCP detection is now handled by the centralized utility

// API Routes

/**
 * GET /api/taskmaster/installation-status
 * Check if TaskMaster CLI is installed on the system
 */
router.get('/installation-status', async (req, res) => {
    try {
        const installationStatus = await checkTaskMasterInstallation();
        
        // Also check for MCP server configuration
        const mcpStatus = await detectTaskMasterMCPServer();
        
        res.json({
            success: true,
            installation: installationStatus,
            mcpServer: mcpStatus,
            isReady: installationStatus.isInstalled && mcpStatus.hasMCPServer
        });
    } catch (error) {
        console.error('Error checking TaskMaster installation:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check TaskMaster installation status',
            installation: {
                isInstalled: false,
                reason: `Server error: ${error.message}`
            },
            mcpServer: {
                hasMCPServer: false,
                reason: `Server error: ${error.message}`
            },
            isReady: false
        });
    }
});

/**
 * GET /api/taskmaster/detect/:projectName
 * Detect TaskMaster configuration for a specific project
 */
router.get('/detect/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        // Use the existing extractProjectDirectory function to get actual project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            console.error('Error extracting project directory:', error);
            return res.status(404).json({
                error: 'Project path not found',
                projectName,
                message: error.message
            });
        }
        
        // Verify the project path exists
        try {
            await fsPromises.access(projectPath, fs.constants.R_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'Project path not accessible',
                projectPath,
                projectName,
                message: error.message
            });
        }

        // Run detection in parallel
        const [taskMasterResult, mcpResult] = await Promise.all([
            detectTaskMasterFolder(projectPath),
            detectTaskMasterMCPServer()
        ]);

        const status = computeTaskmasterStatus(taskMasterResult, mcpResult);

        const responseData = {
            projectName,
            projectPath,
            status,
            taskmaster: taskMasterResult,
            mcp: mcpResult,
            timestamp: new Date().toISOString()
        };

        res.json(responseData);

    } catch (error) {
        console.error('TaskMaster detection error:', error);
        res.status(500).json({
            error: 'Failed to detect TaskMaster configuration',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/detect-all
 * Detect TaskMaster configuration for all known projects
 * This endpoint works with the existing projects system
 */
router.get('/detect-all', async (req, res) => {
    try {
        // Import getProjects from the projects module
        const { getProjects } = await import('../projects.js');
        const projects = await getProjects();

        // Run detection for all projects in parallel
        const detectionPromises = projects.map(async (project) => {
            try {
                // Use the project's fullPath if available, otherwise extract the directory
                let projectPath;
                if (project.fullPath) {
                    projectPath = project.fullPath;
                } else {
                    try {
                        projectPath = await extractProjectDirectory(project.name);
                    } catch (error) {
                        throw new Error(`Failed to extract project directory: ${error.message}`);
                    }
                }
                
                const [taskMasterResult, mcpResult] = await Promise.all([
                    detectTaskMasterFolder(projectPath),
                    detectTaskMasterMCPServer()
                ]);

                const status = computeTaskmasterStatus(taskMasterResult, mcpResult);

                return {
                    projectName: project.name,
                    displayName: project.displayName,
                    projectPath,
                    status,
                    taskmaster: taskMasterResult,
                    mcp: mcpResult
                };
            } catch (error) {
                return {
                    projectName: project.name,
                    displayName: project.displayName,
                    status: 'error',
                    error: error.message
                };
            }
        });

        const results = await Promise.all(detectionPromises);

        res.json({
            projects: results,
            summary: {
                total: results.length,
                fullyConfigured: results.filter(p => p.status === 'fully-configured').length,
                taskmasterOnly: results.filter(p => p.status === 'taskmaster-only').length,
                mcpOnly: results.filter(p => p.status === 'mcp-only').length,
                notConfigured: results.filter(p => p.status === 'not-configured').length,
                errors: results.filter(p => p.status === 'error').length
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Bulk TaskMaster detection error:', error);
        res.status(500).json({
            error: 'Failed to detect TaskMaster configuration for projects',
            message: error.message
        });
    }
});

/**
 * POST /api/taskmaster/initialize/:projectName
 * Initialize TaskMaster in a project (placeholder for future CLI integration)
 */
router.post('/initialize/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        res.json({
            projectName,
            projectPath,
            pipelinePath: paths.root,
            message: 'Pipeline initialized successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('TaskMaster initialization error:', error);
        res.status(500).json({
            error: 'Failed to initialize TaskMaster',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/next/:projectName
 * Get the next recommended task from local pipeline tasks
 */
router.get('/next/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const { tasks } = await readTasksFile(paths.tasksFile);
        const promptContext = await loadTaskPromptContext(projectPath);
        const nextTask = tasks.find((task) => task.status === 'in-progress')
            || tasks.find((task) => task.status === 'pending')
            || null;

        res.json({
            projectName,
            projectPath,
            nextTask: nextTask ? enrichTaskForExecution(nextTask, promptContext) : null,
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('TaskMaster next task error:', error);
        res.status(500).json({
            error: 'Failed to get next task',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/next-guidance/:projectName
 * Get next actionable task with guidance metadata for Chat handoff
 */
router.get('/next-guidance/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`,
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const { tasks } = await readTasksFile(paths.tasksFile);
        const guidance = computeNextGuidance(tasks);
        const promptContext = await loadTaskPromptContext(projectPath);
        const nextTask = guidance.nextTask ? enrichTaskForExecution(guidance.nextTask, promptContext) : null;

        res.json({
            projectName,
            projectPath,
            nextTask,
            guidance: {
                whyNext: guidance.whyNext,
                requiredInputs: guidance.requiredInputs,
                suggestedSkills: guidance.suggestedSkills,
                nextActionPrompt: nextTask?.nextActionPrompt || guidance.nextActionPrompt,
            },
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('TaskMaster next-guidance error:', error);
        res.status(500).json({
            error: 'Failed to get next guidance',
            message: error.message,
        });
    }
});

/**
 * GET /api/taskmaster/summary/:projectName
 * Build a compact TaskMaster summary for CLI / OpenClaw reporting
 */
router.get('/summary/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;

        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`,
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const [taskMasterResult, mcpResult, tasksResult] = await Promise.all([
            detectTaskMasterFolder(projectPath),
            detectTaskMasterMCPServer(),
            readTasksFile(paths.tasksFile),
        ]);

        const tasks = tasksResult.tasks || [];
        const guidanceResult = computeNextGuidance(tasks);
        const status = computeTaskmasterStatus(taskMasterResult, mcpResult);
        const promptContext = await loadTaskPromptContext(projectPath);
        const nextTask = guidanceResult.nextTask ? enrichTaskForExecution(guidanceResult.nextTask, promptContext) : null;

        res.json(buildTaskmasterSummaryPayload({
            projectName,
            projectPath,
            status,
            tasks,
            nextTask,
            guidance: {
                whyNext: guidanceResult.whyNext,
                requiredInputs: guidanceResult.requiredInputs,
                suggestedSkills: guidanceResult.suggestedSkills,
                nextActionPrompt: nextTask?.nextActionPrompt || guidanceResult.nextActionPrompt,
            },
            updatedAt: new Date().toISOString(),
        }));
    } catch (error) {
        console.error('TaskMaster summary error:', error);
        res.status(500).json({
            error: 'Failed to build TaskMaster summary',
            message: error.message,
        });
    }
});

/**
 * GET /api/taskmaster/tasks/:projectName
 * Load actual tasks from .pipeline/tasks/tasks.json
 */
router.get('/tasks/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const tasksFilePath = paths.tasksFile;

        if (typeof req.app.locals.registerTaskMasterProjectPath === 'function') {
            await req.app.locals.registerTaskMasterProjectPath(projectName, projectPath);
        }

        // Check if tasks file exists
        try {
            await fsPromises.access(tasksFilePath);
        } catch (error) {
            return res.json({
                projectName,
                tasks: [],
                message: 'No tasks.json file found'
            });
        }

        // Read and parse tasks file
        try {
            const { tasks: transformedTasks, currentTag } = await readTasksFile(tasksFilePath);
            const promptContext = await loadTaskPromptContext(projectPath);
            const enrichedTasks = transformedTasks.map((task) => enrichTaskForExecution(task, promptContext));

            res.json({
                projectName,
                projectPath,
                tasks: enrichedTasks,
                currentTag,
                totalTasks: enrichedTasks.length,
                tasksByStatus: {
                    pending: enrichedTasks.filter(t => t.status === 'pending').length,
                    'in-progress': enrichedTasks.filter(t => t.status === 'in-progress').length,
                    done: enrichedTasks.filter(t => t.status === 'done').length,
                    review: enrichedTasks.filter(t => t.status === 'review').length,
                    deferred: enrichedTasks.filter(t => t.status === 'deferred').length,
                    cancelled: enrichedTasks.filter(t => t.status === 'cancelled').length
                },
                timestamp: new Date().toISOString()
            });

        } catch (parseError) {
            console.error('Failed to parse tasks.json:', parseError);
            return res.status(500).json({
                error: 'Failed to parse tasks file',
                message: parseError.message
            });
        }

    } catch (error) {
        console.error('TaskMaster tasks loading error:', error);
        res.status(500).json({
            error: 'Failed to load TaskMaster tasks',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/artifacts/:projectName
 * Summarize recent project artifacts for mobile/reporting workflows.
 */
router.get('/artifacts/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;

        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const artifacts = await summarizeProjectArtifacts(projectPath);
        const latest = artifacts.length > 0 ? artifacts[0] : null;

        res.json({
            projectName,
            projectPath,
            artifacts,
            latestArtifact: latest,
            totalArtifacts: artifacts.length,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('TaskMaster artifact summary error:', error);
        res.status(500).json({
            error: 'Failed to summarize project artifacts',
            message: error.message,
        });
    }
});

/**
 * GET /api/taskmaster/prd/:projectName
 * List all PRD files in the project's .pipeline/docs directory
 */
router.get('/prd/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const docsPath = paths.docsDir;
        
        // Check if docs directory exists
        try {
            await fsPromises.access(docsPath, fs.constants.R_OK);
        } catch (error) {
            return res.json({
                projectName,
                prdFiles: [],
                message: 'No .pipeline/docs directory found'
            });
        }

        // Read directory and filter for PRD files
        try {
            const files = await fsPromises.readdir(docsPath);
            const prdFiles = [];

            for (const file of files) {
                const filePath = path.join(docsPath, file);
                const stats = await fsPromises.stat(filePath);
                
                if (stats.isFile() && (file.endsWith('.txt') || file.endsWith('.md') || file.endsWith('.json'))) {
                    prdFiles.push({
                        name: file,
                        path: path.relative(projectPath, filePath),
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        created: stats.birthtime.toISOString()
                    });
                }
            }

            res.json({
                projectName,
                projectPath,
                prdFiles: prdFiles.sort((a, b) => new Date(b.modified) - new Date(a.modified)),
                timestamp: new Date().toISOString()
            });

        } catch (readError) {
            console.error('Error reading docs directory:', readError);
            return res.status(500).json({
                error: 'Failed to read PRD files',
                message: readError.message
            });
        }

    } catch (error) {
        console.error('PRD list error:', error);
        res.status(500).json({
            error: 'Failed to list PRD files',
            message: error.message
        });
    }
});

/**
 * POST /api/taskmaster/prd/:projectName
 * Create or update a PRD file in the project's .pipeline/docs directory
 */
router.post('/prd/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { fileName, content } = req.body;

        if (!fileName || !content) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'fileName and content are required'
            });
        }

        // Validate filename
        if (!fileName.match(/^[\w\-. ]+\.(txt|md|json)$/)) {
            return res.status(400).json({
                error: 'Invalid filename',
                message: 'Filename must end with .txt, .md, or .json and contain only alphanumeric characters, spaces, dots, and dashes'
            });
        }

        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const docsPath = paths.docsDir;
        const filePath = path.join(docsPath, fileName);

        // Ensure docs directory exists
        try {
            await fsPromises.mkdir(docsPath, { recursive: true });
        } catch (error) {
            console.error('Failed to create docs directory:', error);
            return res.status(500).json({
                error: 'Failed to create directory',
                message: error.message
            });
        }

        // Write the PRD file
        try {
            await fsPromises.writeFile(filePath, content, 'utf8');
            
            // Get file stats
            const stats = await fsPromises.stat(filePath);

            res.json({
                projectName,
                projectPath,
                fileName,
                filePath: path.relative(projectPath, filePath),
                size: stats.size,
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
                message: 'PRD file saved successfully',
                timestamp: new Date().toISOString()
            });

        } catch (writeError) {
            console.error('Failed to write PRD file:', writeError);
            return res.status(500).json({
                error: 'Failed to write PRD file',
                message: writeError.message
            });
        }

    } catch (error) {
        console.error('PRD create/update error:', error);
        res.status(500).json({
            error: 'Failed to create/update PRD file',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/prd/:projectName/:fileName
 * Get content of a specific PRD file
 */
router.get('/prd/:projectName/:fileName', async (req, res) => {
    try {
        const { projectName, fileName } = req.params;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const filePath = path.join(paths.docsDir, fileName);
        
        // Check if file exists
        try {
            await fsPromises.access(filePath, fs.constants.R_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'PRD file not found',
                message: `File "${fileName}" does not exist`
            });
        }

        // Read file content
        try {
            const content = await fsPromises.readFile(filePath, 'utf8');
            const stats = await fsPromises.stat(filePath);

            res.json({
                projectName,
                projectPath,
                fileName,
                filePath: path.relative(projectPath, filePath),
                content,
                size: stats.size,
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
                timestamp: new Date().toISOString()
            });

        } catch (readError) {
            console.error('Failed to read PRD file:', readError);
            return res.status(500).json({
                error: 'Failed to read PRD file',
                message: readError.message
            });
        }

    } catch (error) {
        console.error('PRD read error:', error);
        res.status(500).json({
            error: 'Failed to read PRD file',
            message: error.message
        });
    }
});

/**
 * DELETE /api/taskmaster/prd/:projectName/:fileName
 * Delete a specific PRD file
 */
router.delete('/prd/:projectName/:fileName', async (req, res) => {
    try {
        const { projectName, fileName } = req.params;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const filePath = path.join(paths.docsDir, fileName);
        
        // Check if file exists
        try {
            await fsPromises.access(filePath, fs.constants.F_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'PRD file not found',
                message: `File "${fileName}" does not exist`
            });
        }

        // Delete the file
        try {
            await fsPromises.unlink(filePath);

            res.json({
                projectName,
                projectPath,
                fileName,
                message: 'PRD file deleted successfully',
                timestamp: new Date().toISOString()
            });

        } catch (deleteError) {
            console.error('Failed to delete PRD file:', deleteError);
            return res.status(500).json({
                error: 'Failed to delete PRD file',
                message: deleteError.message
            });
        }

    } catch (error) {
        console.error('PRD delete error:', error);
        res.status(500).json({
            error: 'Failed to delete PRD file',
            message: error.message
        });
    }
});

/**
 * POST /api/taskmaster/init/:projectName
 * Initialize TaskMaster in a project
 */
router.post('/init/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        if (req.app.locals.wss) {
            broadcastTaskMasterProjectUpdate(
                req.app.locals.wss,
                projectName,
                { hasTaskmaster: true, status: 'initialized', path: paths.root }
            );
        }

        res.json({
            projectName,
            projectPath,
            pipelinePath: paths.root,
            message: 'Pipeline initialized successfully',
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('TaskMaster init error:', error);
        res.status(500).json({
            error: 'Failed to initialize TaskMaster',
            message: error.message
        });
    }
});

/**
 * POST /api/taskmaster/add-task/:projectName
 * Add a new task to the project
 */
router.post('/add-task/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { prompt, title, description, priority = 'high', dependencies, stage, insertAfterId } = req.body;

        if (!prompt && (!title || !description)) {
            return res.status(400).json({
                error: 'Missing required parameters',
                message: 'Either "prompt" or both "title" and "description" are required'
            });
        }
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const { tasks, currentTag } = await readTasksFile(paths.tasksFile);
        const taskId = generateTaskId(tasks);
        const now = new Date().toISOString();

        const dependencyList = Array.isArray(dependencies)
            ? dependencies
            : typeof dependencies === 'string' && dependencies.trim().length > 0
                ? dependencies.split(',').map((item) => item.trim()).filter(Boolean)
                : [];

        const newTask = normalizeTask({
            id: taskId,
            title: title || splitPromptToTitle(prompt),
            description: description || (prompt ? String(prompt).trim() : ''),
            priority,
            status: 'pending',
            dependencies: dependencyList,
            ...(stage ? { stage } : {}),
            createdAt: now,
            updatedAt: now,
        });

        // Determine insertion position
        let nextTasks;
        if (insertAfterId !== undefined) {
            if (insertAfterId === null || insertAfterId === 0) {
                // Insert at beginning of the target stage
                const targetStage = normalizeStageName(stage);
                const firstInStageIdx = tasks.findIndex(
                    (t) => normalizeStageName(t.stage) === targetStage
                );
                if (firstInStageIdx === -1) {
                    nextTasks = [...tasks, newTask];
                } else {
                    nextTasks = [...tasks.slice(0, firstInStageIdx), newTask, ...tasks.slice(firstInStageIdx)];
                }
            } else {
                // Insert after the specified task
                const afterIdx = tasks.findIndex((t) => String(t.id) === String(insertAfterId));
                if (afterIdx === -1) {
                    nextTasks = [...tasks, newTask];
                } else {
                    nextTasks = [...tasks.slice(0, afterIdx + 1), newTask, ...tasks.slice(afterIdx + 1)];
                }
            }
        } else {
            nextTasks = [...tasks, newTask];
        }

        // Reindex all tasks so IDs are sequential
        const reindexed = reindexTasks(nextTasks);
        await writeTasksFile(paths.tasksFile, reindexed, currentTag);

        // Find the inserted task by its createdAt timestamp
        const insertedTask = reindexed.find((t) => t.createdAt === now && t.title === newTask.title);

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            message: 'Task added successfully',
            task: insertedTask || newTask,
            timestamp: now,
        });

    } catch (error) {
        console.error('Add task error:', error);
        res.status(500).json({
            error: 'Failed to add task',
            message: error.message
        });
    }
});

/**
 * DELETE /api/taskmaster/delete-task/:projectName/:taskId
 * Permanently remove a task from the project
 */
router.delete('/delete-task/:projectName/:taskId', async (req, res) => {
    try {
        const { projectName, taskId } = req.params;

        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const { tasks, currentTag } = await readTasksFile(paths.tasksFile);

        const targetId = String(taskId);
        const taskIndex = tasks.findIndex((t) => String(t.id) === targetId);
        if (taskIndex === -1) {
            return res.status(404).json({
                error: 'Task not found',
                message: `Task with ID "${taskId}" does not exist`
            });
        }

        const deletedTask = tasks[taskIndex];
        const nextTasks = tasks.filter((_, i) => i !== taskIndex);

        // Remove deleted task ID from dependency arrays, then reindex
        nextTasks.forEach((t) => {
            if (Array.isArray(t.dependencies)) {
                t.dependencies = t.dependencies.filter(
                    (dep) => String(dep) !== targetId
                );
            }
        });

        const reindexed = reindexTasks(nextTasks);
        await writeTasksFile(paths.tasksFile, reindexed, currentTag);

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            message: 'Task deleted successfully',
            deletedTask,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({
            error: 'Failed to delete task',
            message: error.message
        });
    }
});

/**
 * PUT /api/taskmaster/update-task/:projectName/:taskId
 * Update a specific task using TaskMaster CLI
 */
router.put('/update-task/:projectName/:taskId', async (req, res) => {
    try {
        const { projectName, taskId } = req.params;
        const { title, description, status, priority, details, testStrategy, dependencies } = req.body;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await updateTaskRecord(projectPath, taskId, {
            title,
            description,
            status,
            priority,
            details,
            testStrategy,
            dependencies,
        });

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            taskId,
            message: 'Task updated successfully',
            task: result.task,
            timestamp: result.timestamp,
        });

    } catch (error) {
        if (error?.code === 'TASK_NOT_FOUND') {
            return res.status(404).json({
                error: 'Task not found',
                message: error.message,
            });
        }
        console.error('Update task error:', error);
        res.status(500).json({
            error: 'Failed to update task',
            message: error.message
        });
    }
});

/**
 * POST /api/taskmaster/parse-prd/:projectName
 * Parse a Research Brief JSON file to generate tasks
 */
router.post('/parse-prd/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { fileName = DEFAULT_RESEARCH_BRIEF_FILENAME, numTasks, append = false } = req.body;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const briefPath = path.join(paths.docsDir, fileName);
        
        // Check if brief JSON file exists
        try {
            await fsPromises.access(briefPath, fs.constants.F_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'Research Brief file not found',
                message: `File "${fileName}" does not exist in ${PIPELINE_DIR}/docs/`
            });
        }

        if (!fileName.endsWith('.json')) {
            return res.status(400).json({
                error: 'Invalid brief format',
                message: 'Research Brief must be a .json file',
            });
        }

        const syncResult = await syncTasksWithResearchBrief(projectPath, {
            fileName,
            numTasks,
            mode: append ? 'append' : 'replace',
        });

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            briefFile: fileName,
            generationMode: syncResult.generationMode,
            message: syncResult.generationMode === 'pipeline-blueprint'
                ? 'Research Brief pipeline instantiated successfully'
                : 'Research Brief parsed and tasks generated successfully',
            generatedCount: syncResult.generatedCount,
            totalTasks: syncResult.totalTasks,
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('Parse PRD error:', error);
        res.status(500).json({
            error: 'Failed to parse Research Brief',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/prd-templates
 * Get available PRD templates
 */
router.get('/prd-templates', async (req, res) => {
    try {
        const templates = await getAvailableTemplates();
        res.json({
            templates,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('PRD templates error:', error);
        res.status(500).json({
            error: 'Failed to get PRD templates',
            message: error.message
        });
    }
});

function normalizeLoadedTemplate(template = {}) {
    return {
        ...template,
        category: template.category || template.domain || 'general',
        format: template.format || 'research-brief-json',
        fileName: template.fileName || DEFAULT_RESEARCH_BRIEF_FILENAME,
        metaFields: Array.isArray(template.metaFields) ? template.metaFields : [],
        sectionFields: template.sectionFields && typeof template.sectionFields === 'object' ? template.sectionFields : {},
    };
}

function cloneJsonCompatible(value) {
    return JSON.parse(JSON.stringify(value));
}

function collapseWhitespace(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeStringArray(values) {
    if (!Array.isArray(values)) {
        return [];
    }
    return values.map((value) => collapseWhitespace(value)).filter(Boolean);
}

function humanizeFileStem(fileName = '') {
    const stem = String(fileName || '').replace(/\.[^.]+$/, '');
    return stem
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function slugifyFileSegment(value = '', fallback = 'item') {
    const normalized = collapseWhitespace(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 96);

    return normalized || fallback;
}

function getKnowledgeBasePaths(projectPath) {
    const pipelinePaths = getPipelinePaths(projectPath);
    const kbDir = path.join(pipelinePaths.docsDir, DEFAULT_KB_DIRNAME);
    return {
        kbDir,
        manifestFile: path.join(kbDir, DEFAULT_KB_MANIFEST_FILENAME),
        manifestRelativePath: DEFAULT_KB_MANIFEST_RELATIVE_PATH,
    };
}

function assertAbsoluteProjectPath(projectPath, projectName) {
    if (!path.isAbsolute(projectPath)) {
        const error = new Error(`Project "${projectName}" is not resolved to an absolute path. Re-open or re-add the project before writing pipeline files.`);
        error.code = 'NON_ABSOLUTE_PROJECT_PATH';
        throw error;
    }
    return projectPath;
}

function sanitizeKnowledgeBaseUploadOriginalName(originalName) {
    const base = path.basename(originalName || 'upload');
    const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '');
    return cleaned.slice(0, 180) || 'upload.bin';
}

function tryExtractPdfSidecar(pdfPath) {
    const txtPath = `${pdfPath}.kb_extract.txt`;
    try {
        fs.rmSync(txtPath, { force: true });
    } catch {
        // ignore
    }
    try {
        const result = spawnSync('pdftotext', ['-q', '-enc', 'UTF-8', pdfPath, txtPath], {
            timeout: 120000,
            maxBuffer: 50 * 1024 * 1024,
        });
        return result.status === 0;
    } catch {
        return false;
    }
}

async function readKnowledgeBaseSummary(fullPath) {
    const extension = path.extname(fullPath).replace(/^\./, '').toLowerCase();

    if (extension === 'pdf') {
        const sidecar = `${fullPath}.kb_extract.txt`;
        try {
            const stats = await fsPromises.stat(sidecar);
            if (stats.size > MAX_KB_TEXT_FILE_BYTES) {
                return '';
            }
            const content = await fsPromises.readFile(sidecar, 'utf8');
            return collapseWhitespace(content).slice(0, MAX_KB_SUMMARY_CHARS);
        } catch {
            return '';
        }
    }

    if (!KNOWLEDGE_BASE_TEXT_EXTENSIONS.has(extension)) {
        return '';
    }

    try {
        const stats = await fsPromises.stat(fullPath);
        if (stats.size > MAX_KB_TEXT_FILE_BYTES) {
            return '';
        }

        const content = await fsPromises.readFile(fullPath, 'utf8');
        return collapseWhitespace(content).slice(0, MAX_KB_SUMMARY_CHARS);
    } catch (error) {
        return '';
    }
}

async function collectKnowledgeBaseFileEntries(projectPath, descriptor) {
    const sourceRoot = path.join(projectPath, descriptor.relativeDir);
    if (!(await pathExists(sourceRoot))) {
        return [];
    }

    const entries = [];

    async function walk(currentDir) {
        const children = await fsPromises.readdir(currentDir, { withFileTypes: true });
        for (const child of children) {
            if (child.name.startsWith('.')) {
                continue;
            }

            const fullPath = path.join(currentDir, child.name);
            if (child.isDirectory()) {
                await walk(fullPath);
                continue;
            }

            if (child.name.endsWith('.kb_extract.txt')) {
                continue;
            }

            const extension = path.extname(child.name).replace(/^\./, '').toLowerCase();
            const supported = KNOWLEDGE_BASE_TEXT_EXTENSIONS.has(extension) || KNOWLEDGE_BASE_METADATA_EXTENSIONS.has(extension);
            if (!supported) {
                continue;
            }

            const stats = await fsPromises.stat(fullPath);
            const relativePath = path.relative(projectPath, fullPath).split(path.sep).join('/');
            const summary = await readKnowledgeBaseSummary(fullPath);
            const isTextKind = KNOWLEDGE_BASE_TEXT_EXTENSIONS.has(extension)
                || extension === 'markdown'
                || (extension === 'pdf' && Boolean(summary));
            entries.push({
                id: `file:${relativePath}`,
                sourceType: descriptor.sourceType,
                title: humanizeFileStem(child.name) || child.name,
                relativePath,
                tags: [...descriptor.tags, extension].filter(Boolean),
                updatedAt: stats.mtime.toISOString(),
                summary,
                kind: isTextKind ? 'text' : 'metadata',
            });
        }
    }

    await walk(sourceRoot);
    return entries;
}

async function collectKnowledgeBaseFileEntriesFromDescriptors(projectPath, descriptors) {
    const fileEntries = [];
    const seenSourceRoots = new Set();

    for (const descriptor of descriptors) {
        const sourceRoot = path.join(projectPath, descriptor.relativeDir);
        let realSourceRoot = '';
        try {
            realSourceRoot = await fsPromises.realpath(sourceRoot);
        } catch {
            continue;
        }
        if (seenSourceRoots.has(realSourceRoot)) {
            continue;
        }
        seenSourceRoots.add(realSourceRoot);
        const entries = await collectKnowledgeBaseFileEntries(projectPath, descriptor);
        fileEntries.push(...entries);
    }

    return fileEntries;
}

function buildResearchBriefKnowledgeBaseEntry(briefData, updatedAt) {
    const title = collapseWhitespace(briefData?.meta?.title) || 'Research Brief';
    const summary = collapseWhitespace([
        briefData?.sections?.literature?.core_research_question,
        briefData?.sections?.survey?.core_research_question,
        briefData?.sections?.ideation?.clinical_or_scientific_gap,
        briefData?.sections?.literature?.knowledge_base_scope,
        briefData?.sections?.survey?.knowledge_base_scope,
        briefData?.sections?.literature?.synthesis_summary,
        briefData?.sections?.survey?.synthesis_summary,
    ].filter(Boolean).join(' ')).slice(0, MAX_KB_SUMMARY_CHARS);

    if (!summary && title === 'Research Brief') {
        return null;
    }

    return {
        id: 'brief:research_brief',
        sourceType: 'research_brief',
        title,
        relativePath: DEFAULT_RESEARCH_BRIEF_PATH,
        tags: ['brief', 'research'],
        updatedAt,
        summary,
        kind: 'virtual',
    };
}

async function buildKnowledgeBaseManifest(projectPath, projectName) {
    const generatedAt = new Date().toISOString();
    const briefPath = path.join(projectPath, DEFAULT_RESEARCH_BRIEF_PATH);
    let briefData = null;
    let briefUpdatedAt = generatedAt;

    if (await pathExists(briefPath)) {
        try {
            const [content, stats] = await Promise.all([
                fsPromises.readFile(briefPath, 'utf8'),
                fsPromises.stat(briefPath),
            ]);
            briefData = JSON.parse(content);
            briefUpdatedAt = stats.mtime.toISOString();
        } catch (error) {
            console.warn('[TaskMaster] Failed to read research brief for knowledge base:', error.message);
        }
    }

    const fileEntries = await collectKnowledgeBaseFileEntriesFromDescriptors(projectPath, KNOWLEDGE_BASE_SOURCE_DIRECTORIES);

    const virtualEntries = [];
    const briefEntry = buildResearchBriefKnowledgeBaseEntry(briefData, briefUpdatedAt);
    if (briefEntry) {
        virtualEntries.push(briefEntry);
    }

    const entries = [...fileEntries, ...virtualEntries].sort((left, right) => {
        const leftTime = new Date(left.updatedAt || 0).getTime();
        const rightTime = new Date(right.updatedAt || 0).getTime();
        return rightTime - leftTime;
    });

    const sourceBreakdown = entries.reduce((accumulator, entry) => {
        accumulator[entry.sourceType] = (accumulator[entry.sourceType] || 0) + 1;
        return accumulator;
    }, {});

    return {
        version: '1.0',
        projectName,
        generatedAt,
        manifestPath: DEFAULT_KB_MANIFEST_RELATIVE_PATH,
        entryCount: entries.length,
        sourceBreakdown,
        entries,
    };
}

function buildNewsSeedPaperCitation(item = {}, sourceKey = 'news') {
    const title = collapseWhitespace(item?.title);
    const authors = collapseWhitespace(item?.authors);
    const published = collapseWhitespace(item?.published);
    const url = collapseWhitespace(item?.link || item?.pdf_link);

    return [title, authors, published, sourceKey, url].filter(Boolean).join(' | ');
}

function buildNewsKnowledgeBaseMarkdown(item = {}, sourceKey = 'news', seedPaperCitation = '') {
    const lines = [`# ${collapseWhitespace(item?.title) || 'Imported News Paper'}`, ''];

    if (seedPaperCitation) {
        lines.push(`- Citation: ${seedPaperCitation}`);
    }

    lines.push(`- Source: ${collapseWhitespace(sourceKey) || 'news'}`);

    if (item?.authors) {
        lines.push(`- Authors: ${collapseWhitespace(item.authors)}`);
    }
    if (item?.published) {
        lines.push(`- Published: ${collapseWhitespace(item.published)}`);
    }
    if (item?.matched_domain) {
        lines.push(`- Matched domain: ${collapseWhitespace(item.matched_domain)}`);
    }
    if (Array.isArray(item?.matched_keywords) && item.matched_keywords.length > 0) {
        lines.push(`- Matched keywords: ${normalizeStringArray(item.matched_keywords).join(', ')}`);
    }
    if (Array.isArray(item?.categories) && item.categories.length > 0) {
        lines.push(`- Categories: ${normalizeStringArray(item.categories).join(', ')}`);
    }
    if (item?.link) {
        lines.push(`- URL: ${collapseWhitespace(item.link)}`);
    }
    if (item?.pdf_link) {
        lines.push(`- PDF: ${collapseWhitespace(item.pdf_link)}`);
    }

    if (item?.abstract) {
        lines.push('', '## Abstract', '', String(item.abstract).trim());
    }

    return `${lines.join('\n').trim()}\n`;
}

function parseNewsAuthorsForReference(authorsStr) {
    if (!authorsStr || typeof authorsStr !== 'string') return [];
    const s = collapseWhitespace(authorsStr);
    if (!s) return [];
    const parts = s.split(/\s+and\s+/i).flatMap((chunk) => chunk.split(/;\s*|,\s*/)).map((p) => p.trim()).filter(Boolean);
    return parts.map((p) => ({ family: p.replace(/^\[[^\]]*\]\s*/, ''), given: '' }));
}

function parsePublishedYear(published) {
    if (!published) return null;
    const m = String(published).match(/(19|20)\d{2}/);
    return m ? parseInt(m[0], 10) : null;
}

function buildNewsReferenceImportItem(item = {}, sourceKey = 'news') {
    const title = collapseWhitespace(item?.title);
    const idPart = String(item?.id ?? title ?? 'item').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    const stableKey = `news_${sourceKey}_${idPart}`;
    const authors = parseNewsAuthorsForReference(item?.authors);
    const kw = [
        ...(Array.isArray(item?.categories) ? item.categories : []),
        ...(Array.isArray(item?.matched_keywords) ? item.matched_keywords : []),
        sourceKey,
    ].map((k) => String(k || '').trim()).filter(Boolean);
    return {
        title: title || 'Untitled',
        authors,
        year: parsePublishedYear(item?.published),
        abstract: String(item?.abstract || '').trim(),
        doi: null,
        url: collapseWhitespace(item?.link || item?.pdf_link || ''),
        journal: collapseWhitespace(item?.source || item?.matched_domain) || 'Literature monitor',
        itemType: 'article',
        citationKey: stableKey,
        keywords: [...new Set(kw)].slice(0, 40),
    };
}

function buildManualKnowledgeBaseMarkdown({
    title = '',
    abstract = '',
    notes = '',
    sourceLabel = '',
    authors = '',
    url = '',
    tags = [],
} = {}) {
    const normalizedTitle = collapseWhitespace(title) || 'Manual Knowledge Base Note';
    const normalizedAbstract = String(abstract || '').trim();
    const normalizedNotes = String(notes || '').trim();
    const normalizedTags = normalizeStringArray(tags);
    const lines = [`# ${normalizedTitle}`, ''];

    if (sourceLabel) {
        lines.push(`- Source: ${collapseWhitespace(sourceLabel)}`);
    }
    if (authors) {
        lines.push(`- Authors: ${collapseWhitespace(authors)}`);
    }
    if (url) {
        lines.push(`- URL: ${collapseWhitespace(url)}`);
    }
    if (normalizedTags.length > 0) {
        lines.push(`- Tags: ${normalizedTags.join(', ')}`);
    }

    if (normalizedAbstract) {
        lines.push('', '## Abstract / Summary', '', normalizedAbstract);
    }

    if (normalizedNotes) {
        lines.push('', '## Notes', '', normalizedNotes);
    }

    return `${lines.join('\n').trim()}\n`;
}

function scoreKnowledgeBaseEntry(entry, terms) {
    const title = String(entry?.title || '').toLowerCase();
    const summary = String(entry?.summary || '').toLowerCase();
    const relativePath = String(entry?.relativePath || '').toLowerCase();
    const tags = Array.isArray(entry?.tags) ? entry.tags.join(' ').toLowerCase() : '';

    let score = 0;
    for (const term of terms) {
        let matched = false;
        if (title.includes(term)) {
            score += 5;
            matched = true;
        } else if (summary.includes(term)) {
            score += 3;
            matched = true;
        } else if (relativePath.includes(term)) {
            score += 2;
            matched = true;
        } else if (tags.includes(term)) {
            score += 1;
            matched = true;
        }

        if (!matched) {
            return 0;
        }
    }

    return score;
}

function buildEmptyBrief(nowDate, pipelineOverride = null) {
    const stageSkillMap = getStageSkillMap();
    return {
        schemaVersion: '1.1',
        templateId: '',
        meta: {
            title: '',
            lead_author: '',
            target_venue: '',
            date: nowDate,
        },
        sections: cloneJsonCompatible(DEFAULT_BRIEF_SECTIONS),
        pipeline: cloneJsonCompatible(
            pipelineOverride && typeof pipelineOverride === 'object'
                ? pipelineOverride
                : buildDefaultBriefPipeline(stageSkillMap),
        ),
    };
}

function normalizeBriefDocument(briefData = {}, nowDate = new Date().toISOString().split('T')[0]) {
    const emptyBrief = buildEmptyBrief(nowDate);
    const sourceSections = briefData?.sections && typeof briefData.sections === 'object' ? briefData.sections : {};
    const mergedSections = {
        ...Object.fromEntries(
            Object.entries(DEFAULT_BRIEF_SECTIONS).map(([stage, defaults]) => {
                const existing = sourceSections?.[stage] && typeof sourceSections[stage] === 'object' && !Array.isArray(sourceSections[stage])
                    ? sourceSections[stage]
                    : {};
                const legacySurvey = stage === 'literature' && sourceSections?.survey && typeof sourceSections.survey === 'object' && !Array.isArray(sourceSections.survey)
                    ? sourceSections.survey
                    : {};
                return [stage, { ...cloneJsonCompatible(defaults), ...legacySurvey, ...existing }];
            }),
        ),
        ...Object.fromEntries(
            Object.entries(sourceSections).filter(([stage]) => stage !== 'survey' && !Object.prototype.hasOwnProperty.call(DEFAULT_BRIEF_SECTIONS, stage)),
        ),
    };
    const sourcePipeline = briefData?.pipeline && typeof briefData.pipeline === 'object'
        ? briefData.pipeline
        : emptyBrief.pipeline;
    const briefBase = {
        ...emptyBrief,
        ...briefData,
        meta: {
            ...emptyBrief.meta,
            ...(briefData?.meta && typeof briefData.meta === 'object' ? briefData.meta : {}),
        },
        sections: mergedSections,
    };

    return {
        ...briefBase,
        pipeline: isMetaBriefData({ ...briefBase, pipeline: sourcePipeline })
            ? normalizeMetaPipelineForTaskGeneration(sourcePipeline)
            : sourcePipeline,
    };
}

async function summarizeProjectArtifacts(projectPath, limit = 12) {
    const candidates = [
        '.pipeline/docs',
        '.pipeline/tasks',
        'results',
        'reports',
        'artifacts',
        'output',
        'outputs',
        'analysis',
        'figures',
        'plots',
        'tables',
        'paper',
        'drafts',
    ];

    const artifactFiles = [];
    for (const relativeDir of candidates) {
        const targetDir = path.join(projectPath, relativeDir);
        try {
            const entries = await fsPromises.readdir(targetDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile()) {
                    continue;
                }
                const fullPath = path.join(targetDir, entry.name);
                const stats = await fsPromises.stat(fullPath);
                artifactFiles.push({
                    name: entry.name,
                    relativePath: path.relative(projectPath, fullPath),
                    category: relativeDir,
                    size: stats.size,
                    modified: stats.mtime.toISOString(),
                });
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn('[TaskMaster] Artifact scan skipped for', targetDir, error.message);
            }
        }
    }

    artifactFiles.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    return artifactFiles.slice(0, limit);
}

function buildBriefFromTemplate(template, nowDate) {
    return {
        ...buildEmptyBrief(
            nowDate,
            template?.pipeline && typeof template.pipeline === 'object' ? template.pipeline : null,
        ),
        templateId: template.id,
    };
}

/**
 * POST /api/taskmaster/apply-template/:projectName
 * Apply a structured template to create/update a Research Brief JSON file
 */
router.post('/apply-template/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { templateId, fileName = DEFAULT_RESEARCH_BRIEF_FILENAME, customizations = {} } = req.body;

        if (!templateId) {
            return res.status(400).json({
                error: 'Missing required parameter',
                message: 'templateId is required'
            });
        }

        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
            assertAbsoluteProjectPath(projectPath, projectName);
        } catch (error) {
            return res.status(error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 400 : 404).json({
                error: error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 'Invalid project path' : 'Project not found',
                message: error?.code === 'NON_ABSOLUTE_PROJECT_PATH'
                    ? error.message
                    : `Project "${projectName}" does not exist`
            });
        }

        const templates = await getAvailableTemplates();
        const template = templates.find(t => t.id === templateId);

        if (!template) {
            return res.status(404).json({
                error: 'Template not found',
                message: `Template "${templateId}" does not exist`
            });
        }

        if (!fileName.endsWith('.json')) {
            return res.status(400).json({
                error: 'Invalid filename',
                message: 'Research Brief must be saved as .json',
            });
        }

        const now = new Date().toISOString().split('T')[0];
        const brief = buildBriefFromTemplate(template, now);

        const allFields = [
            ...(Array.isArray(template.metaFields) ? template.metaFields : []),
            ...Object.values(template.sectionFields || {}).flat(),
        ];

        allFields.forEach((field) => {
            const submitted = customizations?.[field.path];
            if (submitted === undefined || submitted === null) return;
            const rawValue = typeof submitted === 'string' ? submitted.trim() : submitted;
            if (rawValue === '') return;

            if (field.type === 'array') {
                const values = Array.isArray(rawValue)
                    ? rawValue.map((item) => String(item).trim()).filter(Boolean)
                    : String(rawValue).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
                assignPath(brief, field.path, values);
                return;
            }

            assignPath(brief, field.path, String(rawValue));
        });

        const paths = await ensurePipelineInitialized(projectPath);
        const docsDir = paths.docsDir;
        try {
            await fsPromises.mkdir(docsDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create docs directory:', error);
        }

        const filePath = path.join(docsDir, fileName);

        // Write the template content to the file
        try {
            await fsPromises.writeFile(filePath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
            let taskSync = null;
            try {
                taskSync = await syncTasksWithResearchBrief(projectPath, {
                    fileName,
                    mode: 'merge',
                });
            } catch (error) {
                console.warn('Automatic task sync after template apply failed:', error.message);
            }
            if (req.app.locals.wss) {
                broadcastTaskMasterProjectUpdate(
                    req.app.locals.wss,
                    projectName,
                    { status: 'research-brief-updated', filePath: path.relative(projectPath, filePath) }
                );
                if (taskSync?.synced) {
                    broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectName);
                }
            }

            res.json({
                projectName,
                projectPath,
                templateId,
                templateName: template.name,
                fileName,
                filePath: path.relative(projectPath, filePath),
                taskSync,
                message: 'Research Brief template applied successfully',
                timestamp: new Date().toISOString()
            });

        } catch (writeError) {
            console.error('Failed to write PRD template:', writeError);
            return res.status(500).json({
                error: 'Failed to write Research Brief',
                message: writeError.message
            });
        }

    } catch (error) {
        console.error('Apply template error:', error);
        res.status(500).json({
            error: 'Failed to apply Research Brief template',
            message: error.message
        });
    }
});

/**
 * PUT /api/taskmaster/research-brief/:projectName
 * Update or create the project research brief with a set of dot-path assignments
 */
router.put('/research-brief/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const {
            updates = {},
            fileName = DEFAULT_RESEARCH_BRIEF_FILENAME,
        } = req.body || {};

        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            return res.status(400).json({
                error: 'Invalid request body',
                message: 'updates must be an object of dot-path assignments',
            });
        }

        if (!fileName.endsWith('.json')) {
            return res.status(400).json({
                error: 'Invalid filename',
                message: 'Research Brief must be saved as .json',
            });
        }

        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
            assertAbsoluteProjectPath(projectPath, projectName);
        } catch (error) {
            return res.status(error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 400 : 404).json({
                error: error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 'Invalid project path' : 'Project not found',
                message: error?.code === 'NON_ABSOLUTE_PROJECT_PATH'
                    ? error.message
                    : `Project "${projectName}" does not exist`,
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const briefPath = path.join(paths.docsDir, fileName);
        const now = new Date().toISOString().split('T')[0];

        let existingBrief = null;
        if (await pathExists(briefPath)) {
            try {
                const content = await fsPromises.readFile(briefPath, 'utf8');
                existingBrief = JSON.parse(content);
            } catch (error) {
                return res.status(400).json({
                    error: 'Invalid brief format',
                    message: error.message,
                });
            }
        }

        const brief = normalizeBriefDocument(existingBrief || {}, now);

        Object.entries(updates).forEach(([dottedPath, rawValue]) => {
            if (!dottedPath || rawValue === undefined) {
                return;
            }

            if (Array.isArray(rawValue)) {
                assignPath(
                    brief,
                    dottedPath,
                    rawValue.map((item) => String(item || '').trim()).filter(Boolean),
                );
                return;
            }

            if (rawValue === null) {
                assignPath(brief, dottedPath, '');
                return;
            }

            assignPath(
                brief,
                dottedPath,
                typeof rawValue === 'string' ? rawValue.trim() : String(rawValue),
            );
        });

        await fsPromises.writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
        let taskSync = null;
        try {
            taskSync = await syncTasksWithResearchBrief(projectPath, {
                fileName,
                mode: 'merge',
            });
        } catch (error) {
            console.warn('Automatic task sync after brief update failed:', error.message);
        }
        if (req.app.locals.wss) {
            broadcastTaskMasterProjectUpdate(
                req.app.locals.wss,
                projectName,
                { status: 'research-brief-updated', filePath: path.relative(projectPath, briefPath) }
            );
            if (taskSync?.synced) {
                broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectName);
            }
        }

        res.json({
            success: true,
            projectName,
            fileName,
            filePath: path.relative(projectPath, briefPath),
            brief,
            taskSync,
            message: 'Research Brief updated successfully',
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Update research brief error:', error);
        res.status(500).json({
            error: 'Failed to update Research Brief',
            message: error.message,
        });
    }
});

router.post('/kb/:projectName/news-item', async (req, res) => {
    try {
        const { projectName } = req.params;
        const {
            item = {},
            sourceKey = 'news',
        } = req.body || {};

        const title = collapseWhitespace(item?.title);
        if (!title) {
            return res.status(400).json({
                error: 'Invalid news item',
                message: 'A news item title is required',
            });
        }

        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
            assertAbsoluteProjectPath(projectPath, projectName);
        } catch (error) {
            return res.status(error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 400 : 404).json({
                error: error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 'Invalid project path' : 'Project not found',
                message: error?.code === 'NON_ABSOLUTE_PROJECT_PATH'
                    ? error.message
                    : `Project "${projectName}" does not exist`,
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const kbPaths = getKnowledgeBasePaths(projectPath);
        const newsDir = path.join(projectPath, DEFAULT_KB_NEWS_RELATIVE_DIR);
        await fsPromises.mkdir(newsDir, { recursive: true });

        const fileStem = slugifyFileSegment(`${sourceKey}-${title}`, `news-${Date.now()}`);
        const newsFileName = `${fileStem}.md`;
        const newsFilePath = path.join(newsDir, newsFileName);
        const relativeNewsFilePath = path.relative(projectPath, newsFilePath).split(path.sep).join('/');
        const seedPaperCitation = buildNewsSeedPaperCitation(item, sourceKey);

        await fsPromises.writeFile(
            newsFilePath,
            buildNewsKnowledgeBaseMarkdown(item, sourceKey, seedPaperCitation),
            'utf8',
        );

        const briefPath = path.join(paths.docsDir, DEFAULT_RESEARCH_BRIEF_FILENAME);
        let brief = null;
        let existingBrief = null;
        if (await pathExists(briefPath)) {
            try {
                existingBrief = JSON.parse(await fsPromises.readFile(briefPath, 'utf8'));
            } catch (error) {
                return res.status(400).json({
                    error: 'Invalid brief format',
                    message: error.message,
                });
            }
        }

        const now = new Date().toISOString().split('T')[0];
        brief = normalizeBriefDocument(existingBrief || {}, now);
        const currentSeedPapers = normalizeStringArray(brief?.sections?.literature?.seed_papers);
        const alreadyPresent = currentSeedPapers.some(
            (value) => value.toLowerCase() === seedPaperCitation.toLowerCase(),
        );
        if (!alreadyPresent && seedPaperCitation) {
            assignPath(brief, 'sections.literature.seed_papers', [seedPaperCitation, ...currentSeedPapers]);
        }
        await fsPromises.writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
        if (req.app.locals.wss) {
            broadcastTaskMasterProjectUpdate(
                req.app.locals.wss,
                projectName,
                { status: 'research-brief-updated', filePath: path.relative(projectPath, briefPath) }
            );
        }

        const { manifest } = await writeProjectKnowledgeBaseManifest(projectPath, projectName);

        const manifestEntry = Array.isArray(manifest?.entries)
            ? manifest.entries.find((entry) => entry.relativePath === relativeNewsFilePath) || null
            : null;

        let literatureReferenceId = null;
        try {
            const userId = req.user?.id;
            if (userId) {
                const importItem = buildNewsReferenceImportItem(item, sourceKey);
                const importedIds = referencesDb.importReferences(userId, [importItem], 'news_monitor');
                const refId = importedIds?.[0];
                if (refId && referencesDb.linkToProject(projectName, refId, userId)) {
                    const reference = referencesDb.getReference(refId, userId);
                    if (reference) {
                        await syncReferencesToProjectArtifacts({
                            projectPath,
                            projectName,
                            references: [reference],
                            resolvePdfSource: async () => ({}),
                        });
                        literatureReferenceId = refId;
                    }
                }
            }
        } catch (litError) {
            console.warn('Ingest news item: literature library sync failed:', litError?.message || litError);
        }

        res.json({
            success: true,
            projectName,
            sourceKey,
            seedPaperCitation,
            briefPath: path.relative(projectPath, briefPath).split(path.sep).join('/'),
            relativePath: relativeNewsFilePath,
            manifestPath: kbPaths.manifestRelativePath,
            manifestEntry,
            literatureReferenceId,
            message: 'News paper added to workspace materials index',
        });
    } catch (error) {
        console.error('Ingest news item error:', error);
        res.status(500).json({
            error: 'Failed to add news paper to materials index',
            message: error.message,
        });
    }
});

router.post('/kb/:projectName/note', async (req, res) => {
    try {
        const { projectName } = req.params;
        const {
            title = '',
            abstract = '',
            notes = '',
            sourceLabel = '',
            authors = '',
            url = '',
            tags = [],
        } = req.body || {};

        const normalizedTitle = collapseWhitespace(title);
        const normalizedAbstract = String(abstract || '').trim();
        const normalizedNotes = String(notes || '').trim();
        if (!normalizedTitle) {
            return res.status(400).json({
                error: 'Invalid note title',
                message: 'A note title is required',
            });
        }

        if (!normalizedAbstract && !normalizedNotes) {
            return res.status(400).json({
                error: 'Empty note body',
                message: 'Add an abstract, summary, or notes body before saving to the materials index',
            });
        }

        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
            assertAbsoluteProjectPath(projectPath, projectName);
        } catch (error) {
            return res.status(error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 400 : 404).json({
                error: error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 'Invalid project path' : 'Project not found',
                message: error?.code === 'NON_ABSOLUTE_PROJECT_PATH'
                    ? error.message
                    : `Project "${projectName}" does not exist`,
            });
        }

        await ensurePipelineInitialized(projectPath);
        const kbPaths = getKnowledgeBasePaths(projectPath);
        const notesDir = path.join(projectPath, DEFAULT_KB_NOTES_RELATIVE_DIR);
        await fsPromises.mkdir(notesDir, { recursive: true });

        const preferredStem = slugifyFileSegment(normalizedTitle, `note-${Date.now()}`);
        let noteFileName = `${preferredStem}.md`;
        let noteFilePath = path.join(notesDir, noteFileName);
        if (await pathExists(noteFilePath)) {
            noteFileName = `${preferredStem}-${Date.now()}.md`;
            noteFilePath = path.join(notesDir, noteFileName);
        }

        const relativeNoteFilePath = path.relative(projectPath, noteFilePath).split(path.sep).join('/');
        await fsPromises.writeFile(
            noteFilePath,
            buildManualKnowledgeBaseMarkdown({
                title: normalizedTitle,
                abstract: normalizedAbstract,
                notes: normalizedNotes,
                sourceLabel,
                authors,
                url,
                tags,
            }),
            'utf8',
        );

        const { manifest } = await writeProjectKnowledgeBaseManifest(projectPath, projectName);

        const manifestEntry = Array.isArray(manifest?.entries)
            ? manifest.entries.find((entry) => entry.relativePath === relativeNoteFilePath) || null
            : null;

        res.json({
            success: true,
            projectName,
            relativePath: relativeNoteFilePath,
            manifestPath: kbPaths.manifestRelativePath,
            manifestEntry,
            message: 'Manual note added to workspace materials index',
        });
    } catch (error) {
        console.error('Create knowledge base note error:', error);
        res.status(500).json({
            error: 'Failed to add manual note to materials index',
            message: error.message,
        });
    }
});

router.post('/kb/:projectName/upload', (req, res) => {
    kbUploadSingle(req, res, async (err) => {
        if (err) {
            return res.status(400).json({
                error: 'Upload failed',
                message: err.message || 'Invalid upload',
            });
        }
        try {
            const { projectName } = req.params;
            const file = req.file;
            if (!file?.buffer?.length) {
                return res.status(400).json({
                    error: 'Missing file',
                    message: 'Attach a file field named "file"',
                });
            }

            let projectPath;
            try {
                projectPath = await extractProjectDirectory(projectName);
                assertAbsoluteProjectPath(projectPath, projectName);
            } catch (error) {
                return res.status(error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 400 : 404).json({
                    error: error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 'Invalid project path' : 'Project not found',
                    message: error?.code === 'NON_ABSOLUTE_PROJECT_PATH'
                        ? error.message
                        : `Project "${projectName}" does not exist`,
                });
            }

            await ensurePipelineInitialized(projectPath);
            const kbPaths = getKnowledgeBasePaths(projectPath);
            const uploadsDir = path.join(projectPath, DEFAULT_KB_UPLOADS_RELATIVE_DIR);
            await fsPromises.mkdir(uploadsDir, { recursive: true });

            let destName = sanitizeKnowledgeBaseUploadOriginalName(file.originalname);
            let rawExt = path.extname(destName).replace(/^\./, '').toLowerCase();
            const normalizedExt = rawExt === 'markdown' ? 'md' : rawExt;
            if (!KB_UPLOAD_ALLOWED_EXTENSIONS.has(rawExt) && !KB_UPLOAD_ALLOWED_EXTENSIONS.has(normalizedExt)) {
                return res.status(400).json({
                    error: 'Unsupported file type',
                    message: 'Upload readable document or table files such as PDF, Word, Excel, CSV, TXT, or Markdown for the materials index',
                });
            }

            let destAbsPath = path.join(uploadsDir, destName);
            if (await pathExists(destAbsPath)) {
                const ext = path.extname(destName);
                const stem = ext ? destName.slice(0, -ext.length) : destName;
                destName = `${stem}-${Date.now()}${ext || ''}`;
                destAbsPath = path.join(uploadsDir, destName);
            }

            await fsPromises.writeFile(destAbsPath, file.buffer);

            let textExtracted = false;
            if (normalizedExt === 'pdf') {
                textExtracted = tryExtractPdfSidecar(destAbsPath);
            }

            const { manifest } = await writeProjectKnowledgeBaseManifest(projectPath, projectName);

            const relativePath = path.relative(projectPath, destAbsPath).split(path.sep).join('/');
            const manifestEntry = Array.isArray(manifest?.entries)
                ? manifest.entries.find((entry) => entry.relativePath === relativePath) || null
                : null;

            res.json({
                success: true,
                projectName,
                relativePath,
                manifestPath: kbPaths.manifestRelativePath,
                manifestEntry,
                textExtracted,
                message: textExtracted
                    ? 'File added to materials index with text extract'
                    : normalizedExt === 'pdf'
                        ? 'File added to materials index (install poppler pdftotext for searchable text extract)'
                        : 'File added to workspace materials index',
            });
        } catch (error) {
            console.error('Knowledge base upload error:', error);
            res.status(500).json({
                error: 'Failed to upload materials-index file',
                message: error.message,
            });
        }
    });
});

router.get('/kb/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
            assertAbsoluteProjectPath(projectPath, projectName);
        } catch (error) {
            return res.status(error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 400 : 404).json({
                error: error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 'Invalid project path' : 'Project not found',
                message: error?.code === 'NON_ABSOLUTE_PROJECT_PATH'
                    ? error.message
                    : `Project "${projectName}" does not exist`,
            });
        }

        const kbPaths = getKnowledgeBasePaths(projectPath);
        if (!(await pathExists(kbPaths.manifestFile))) {
            return res.status(404).json({
                error: 'Materials index not initialized',
                message: 'No manifest.json found under .pipeline/docs/kb/',
            });
        }

        const { manifest } = await writeProjectKnowledgeBaseManifest(projectPath, projectName);
        res.json({
            success: true,
            projectName,
            manifest,
        });
    } catch (error) {
        console.error('Get knowledge base error:', error);
        res.status(500).json({
            error: 'Failed to read workspace materials index',
            message: error.message,
        });
    }
});

router.post('/kb/:projectName/bootstrap', async (req, res) => {
    try {
        const { projectName } = req.params;
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
            assertAbsoluteProjectPath(projectPath, projectName);
        } catch (error) {
            return res.status(error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 400 : 404).json({
                error: error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 'Invalid project path' : 'Project not found',
                message: error?.code === 'NON_ABSOLUTE_PROJECT_PATH'
                    ? error.message
                    : `Project "${projectName}" does not exist`,
            });
        }

        await ensurePipelineInitialized(projectPath);
        const kbPaths = getKnowledgeBasePaths(projectPath);
        await fsPromises.mkdir(kbPaths.kbDir, { recursive: true });

        const { manifest } = await writeProjectKnowledgeBaseManifest(projectPath, projectName);

        res.json({
            success: true,
            projectName,
            manifestPath: kbPaths.manifestRelativePath,
            manifest,
            message: 'Workspace materials index initialized successfully',
        });
    } catch (error) {
        console.error('Bootstrap knowledge base error:', error);
        res.status(500).json({
            error: 'Failed to initialize workspace materials index',
            message: error.message,
        });
    }
});

router.get('/kb/:projectName/search', async (req, res) => {
    try {
        const { projectName } = req.params;
        const query = collapseWhitespace(req.query?.q || '');
        const parsedLimit = Number.parseInt(String(req.query?.limit || '12'), 10);
        const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 12;

        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
            assertAbsoluteProjectPath(projectPath, projectName);
        } catch (error) {
            return res.status(error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 400 : 404).json({
                error: error?.code === 'NON_ABSOLUTE_PROJECT_PATH' ? 'Invalid project path' : 'Project not found',
                message: error?.code === 'NON_ABSOLUTE_PROJECT_PATH'
                    ? error.message
                    : `Project "${projectName}" does not exist`,
            });
        }

        const kbPaths = getKnowledgeBasePaths(projectPath);
        if (!(await pathExists(kbPaths.manifestFile))) {
            return res.status(404).json({
                error: 'Materials index not initialized',
                message: 'No manifest.json found under .pipeline/docs/kb/',
            });
        }

        const { manifest } = await writeProjectKnowledgeBaseManifest(projectPath, projectName);
        const allEntries = Array.isArray(manifest?.entries) ? manifest.entries : [];
        let results = [];

        if (!query) {
            results = allEntries.slice(0, limit);
        } else {
            const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
            results = allEntries
                .map((entry) => ({
                    ...entry,
                    _score: scoreKnowledgeBaseEntry(entry, terms),
                }))
                .filter((entry) => entry._score > 0)
                .sort((left, right) => {
                    if (right._score !== left._score) {
                        return right._score - left._score;
                    }
                    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
                })
                .slice(0, limit)
                .map(({ _score, ...entry }) => entry);
        }

        res.json({
            success: true,
            projectName,
            query,
            count: results.length,
            results,
            manifest: {
                generatedAt: manifest?.generatedAt,
                entryCount: manifest?.entryCount || allEntries.length,
                sourceBreakdown: manifest?.sourceBreakdown || {},
            },
        });
    } catch (error) {
        console.error('Search knowledge base error:', error);
        res.status(500).json({
            error: 'Failed to search workspace materials index',
            message: error.message,
        });
    }
});

// Helper function to get available templates
async function getAvailableTemplates() {
    let files = [];
    try {
        files = await fsPromises.readdir(TEMPLATES_DIR);
    } catch (error) {
        throw new Error(`Failed to read templates directory: ${error.message}`);
    }

    const jsonFiles = files.filter((name) => name.endsWith('.json'));
    if (jsonFiles.length === 0) {
        throw new Error(`No template JSON files found in ${TEMPLATES_DIR}`);
    }

    const loaded = [];
    for (const fileName of jsonFiles) {
        const filePath = path.join(TEMPLATES_DIR, fileName);
        const content = await fsPromises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content);
        if (!parsed?.id || !parsed?.name) {
            throw new Error(`Template "${fileName}" missing required fields: id/name`);
        }
        if (!META_TEMPLATE_IDS.has(parsed.id)) {
            continue;
        }
        loaded.push(normalizeLoadedTemplate(parsed));
    }

    cachedTemplates = loaded.sort((a, b) => {
        const pa = typeof a.listPriority === 'number' ? a.listPriority : 100;
        const pb = typeof b.listPriority === 'number' ? b.listPriority : 100;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
    });
    return cachedTemplates;
}

export {
    syncTasksWithResearchBrief,
    updateTaskRecord,
};

export default router;
