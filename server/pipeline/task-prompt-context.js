import path from 'path';
import { promises as fs } from 'fs';

const DEFAULT_KB_MANIFEST_RELATIVE_PATH = '.pipeline/docs/kb/manifest.json';
const WORKSPACE_MATERIALS_RULE_MARKER = 'Workspace materials rule:';
const OUTPUT_LOCATION_RULE_MARKER = 'Output location rule:';
const INDEXED_WORKSPACE_MATERIALS_MARKER = 'Indexed workspace materials:';
const CODE_LOCATION_RULE_MARKER = 'Code location rule:';
const EVIDENCE_INTEGRITY_RULE_MARKER = 'Evidence integrity rule:';
const HUMAN_REVIEW_GATE_RULE_MARKER = 'Human review gate rule:';
const CONTEXT_COMPACTION_RULE_MARKER = 'Context compaction rule:';
const MAX_INDEXED_ENTRY_SUMMARY_CHARS = 180;
const DEFAULT_INDEXED_ENTRY_LIMIT = 4;

const STAGE_LABELS = {
  literature: 'Literature',
  ideation: 'Ideation',
  experiment: 'Experiment',
  publication: 'Publication',
  promotion: 'Promotion',
  presentation: 'Promotion',
  protocol: 'Protocol / PICO',
  search_dedupe: 'Search / Dedupe',
  title_abstract_screening: 'Title / Abstract Screening',
  full_text_review: 'Full-text Review',
  data_extraction: 'Data Extraction',
  quality_assessment: 'Quality Assessment',
  data_analysis: 'Data Analysis',
  results_figures: 'Results / Figures',
  manuscript_submission: 'Manuscript / Submission',
  research: 'Literature',
  survey: 'Literature',
};

const STAGE_OUTPUT_ROOTS = {
  literature: ['Literature/reports', 'Literature/references'],
  ideation: ['Ideation/ideas', 'Ideation/references'],
  experiment: ['Experiment/core_code', 'Experiment/analysis', 'Experiment/datasets', 'Experiment/code_references'],
  publication: [
    'Publication/manuscript',
    'Publication/figures',
    'Publication/tables',
    'Publication/supplementary',
  ],
  promotion: ['Promotion/slides', 'Promotion/audio', 'Promotion/video', 'Promotion/homepage'],
  protocol: ['01_protocol'],
  search_dedupe: ['02_search_dedupe'],
  title_abstract_screening: ['03_title_abstract_screening'],
  full_text_review: ['04_full_text_review'],
  data_extraction: ['05_data_extraction'],
  quality_assessment: ['06_quality_assessment'],
  data_analysis: ['07_data_analysis'],
  results_figures: ['08_results_figures'],
  manuscript_submission: ['09_manuscript_submission'],
  presentation: ['10_presentation'],
};

const META_STAGE_OUTPUT_ROOTS = {
  literature: [
    '00_literature/reports',
    '00_literature/references',
    '00_literature/topic_selection',
    '00_literature/scoping_review',
  ],
  ideation: ['01_protocol'],
  experiment: [
    '02_search_dedupe',
    '03_title_abstract_screening',
    '04_full_text_review',
    '05_data_extraction',
    '06_quality_assessment',
    '07_data_analysis',
  ],
  publication: ['08_results_figures', '09_manuscript_submission'],
  promotion: ['10_presentation'],
  protocol: ['01_protocol'],
  search_dedupe: ['02_search_dedupe'],
  title_abstract_screening: ['03_title_abstract_screening'],
  full_text_review: ['04_full_text_review'],
  data_extraction: ['05_data_extraction'],
  quality_assessment: ['06_quality_assessment'],
  data_analysis: ['07_data_analysis'],
  results_figures: ['08_results_figures'],
  manuscript_submission: ['09_manuscript_submission'],
  presentation: ['10_presentation'],
};

const STAGE_REPORT_ROOTS = {
  literature: 'Literature/reports',
  ideation: 'Ideation/ideas',
  experiment: 'Experiment/analysis',
  publication: 'Publication/manuscript',
  promotion: 'Promotion/slides',
  protocol: '01_protocol',
  search_dedupe: '02_search_dedupe',
  title_abstract_screening: '03_title_abstract_screening',
  full_text_review: '04_full_text_review',
  data_extraction: '05_data_extraction',
  quality_assessment: '06_quality_assessment',
  data_analysis: '07_data_analysis',
  results_figures: '08_results_figures',
  manuscript_submission: '09_manuscript_submission',
  presentation: '10_presentation',
};

const META_STAGE_REPORT_ROOTS = {
  literature: '00_literature/reports',
  ideation: '01_protocol',
  experiment: '07_data_analysis',
  publication: '09_manuscript_submission',
  promotion: '10_presentation',
  protocol: '01_protocol',
  search_dedupe: '02_search_dedupe',
  title_abstract_screening: '03_title_abstract_screening',
  full_text_review: '04_full_text_review',
  data_extraction: '05_data_extraction',
  quality_assessment: '06_quality_assessment',
  data_analysis: '07_data_analysis',
  results_figures: '08_results_figures',
  manuscript_submission: '09_manuscript_submission',
  presentation: '10_presentation',
};

const STAGE_CODE_ROOTS = {
  experiment: 'Experiment/core_code',
  data_analysis: '07_data_analysis/code',
  results_figures: '08_results_figures/code',
  manuscript_submission: '09_manuscript_submission/code',
  presentation: '10_presentation/code',
};

const META_STAGE_CODE_ROOTS = {
  search_dedupe: '02_search_dedupe/code',
  title_abstract_screening: '03_title_abstract_screening/code',
  full_text_review: '04_full_text_review/code',
  data_extraction: '05_data_extraction/code',
  quality_assessment: '06_quality_assessment/code',
  data_analysis: '07_data_analysis/code',
  results_figures: '08_results_figures/code',
  manuscript_submission: '09_manuscript_submission/code',
  presentation: '10_presentation/code',
  experiment: '07_data_analysis/code',
  publication: '09_manuscript_submission/code',
  promotion: '10_presentation/code',
};

const TASK_TYPE_REPORT_STAGE_FALLBACKS = {
  analysis: 'experiment',
  implementation: 'experiment',
  scripting: 'experiment',
  writing: 'publication',
  rendering: 'promotion',
  narration: 'promotion',
  delivery: 'promotion',
  exploration: 'literature',
};

const REPORT_STAGE_INFERENCE_RULES = {
  literature: [
    /\bliterature review\b/i,
    /\bevidence synthesis\b/i,
    /\bsystematic review\b/i,
    /\bscoping review\b/i,
    /\bmeta-analysis\b/i,
    /\bliterature\b/i,
    /\bsurvey\b/i,
    /\bevidence\b/i,
    /\bpubmed\b/i,
    /\bguideline\b/i,
    /\bprior work\b/i,
    /\bsearch strategy\b/i,
    /文献|综述|证据|检索|指南|先行研究|调研/,
  ],
  ideation: [
    /\bbrainstorm\b/i,
    /\bnovelty\b/i,
    /\bresearch idea\b/i,
    /\bidea\b/i,
    /\bproblem framing\b/i,
    /\bresearch question\b/i,
    /\bconcept\b/i,
    /\bfeasibility\b/i,
    /\bgap\b/i,
    /\bthesis\b/i,
    /想法|创意|点子|头脑风暴|创新性|选题|方向|研究问题|构思|可行性|空白/,
  ],
  experiment: [
    /\bexperiment\b/i,
    /\banalysis\b/i,
    /\bimplementation\b/i,
    /\bimplement\b/i,
    /\bcode\b/i,
    /\bdebug\b/i,
    /\bmodel\b/i,
    /\bdataset\b/i,
    /\btraining\b/i,
    /\btrain\b/i,
    /\bevaluation\b/i,
    /\bevaluate\b/i,
    /\bcox\b/i,
    /\bregression\b/i,
    /\bscript\b/i,
    /\bpipeline\b/i,
    /\bresults?\b/i,
    /\bstatistics?\b/i,
    /实验|分析|实现|代码|调试|模型|数据集|训练|评估|脚本|流程|结果|统计|回归|队列/,
  ],
  publication: [
    /\bmanuscript\b/i,
    /\bpaper draft\b/i,
    /\bcitation\b/i,
    /\breference audit\b/i,
    /\boverleaf\b/i,
    /\babstract\b/i,
    /\bintroduction\b/i,
    /\bmethods\b/i,
    /\bdiscussion\b/i,
    /\bjournal\b/i,
    /\bsubmission\b/i,
    /\brebuttal\b/i,
    /\bcover letter\b/i,
    /\bfigure legend\b/i,
    /论文|稿件|引文|参考文献|摘要|引言|方法|讨论|投稿|返修|回复审稿人|图注/,
  ],
  promotion: [
    /\bslides?\b/i,
    /\bdeck\b/i,
    /\bpresentation\b/i,
    /\bposter\b/i,
    /\bhomepage\b/i,
    /\blanding page\b/i,
    /\bvideo\b/i,
    /\bnarration\b/i,
    /\baudio\b/i,
    /\btts\b/i,
    /\bdemo\b/i,
    /\bpromotion\b/i,
    /幻灯|演示|汇报|答辩|海报|主页|首页|视频|旁白|配音|推广|宣发/,
  ],
};

const STAGE_CONTEXT_PREFIXES = {
  literature: ['00_literature/', 'Literature/', 'literature/', 'Survey/', 'Research/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  ideation: ['01_protocol/', '00_literature/', 'Ideation/', 'Literature/', 'literature/', 'Survey/', 'Research/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  experiment: ['02_search_dedupe/', '03_title_abstract_screening/', '04_full_text_review/', '05_data_extraction/', '06_quality_assessment/', '07_data_analysis/', 'Experiment/', 'Ideation/', 'Literature/', 'literature/', 'Survey/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  publication: ['08_results_figures/', '09_manuscript_submission/', 'Publication/', 'Experiment/', 'Literature/', 'literature/', 'Survey/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  promotion: ['10_presentation/', 'Promotion/', 'Publication/', 'Experiment/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  protocol: ['01_protocol/', '00_literature/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  search_dedupe: ['02_search_dedupe/', '00_literature/references/', '00_literature/reports/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  title_abstract_screening: ['03_title_abstract_screening/', '02_search_dedupe/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  full_text_review: ['04_full_text_review/', '03_title_abstract_screening/', '02_search_dedupe/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  data_extraction: ['05_data_extraction/', '04_full_text_review/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  quality_assessment: ['06_quality_assessment/', '05_data_extraction/', '04_full_text_review/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  data_analysis: ['07_data_analysis/', '06_quality_assessment/', '05_data_extraction/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  results_figures: ['08_results_figures/', '07_data_analysis/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  manuscript_submission: ['09_manuscript_submission/', '08_results_figures/', '07_data_analysis/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  presentation: ['10_presentation/', '09_manuscript_submission/', '08_results_figures/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
};

function collapseWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clipText(value = '', maxChars = MAX_INDEXED_ENTRY_SUMMARY_CHARS) {
  const normalized = collapseWhitespace(value);
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeStageName(stage) {
  const value = collapseWhitespace(stage).toLowerCase();
  if (!value) return '';
  if (value === 'research' || value === 'survey') return 'literature';
  return value;
}

function inferStageFromText(text = '') {
  const normalizedText = collapseWhitespace(text);
  if (!normalizedText) {
    return '';
  }

  let bestStage = '';
  let bestScore = 0;

  Object.entries(REPORT_STAGE_INFERENCE_RULES).forEach(([stage, patterns]) => {
    const score = patterns.reduce((count, pattern) => (
      pattern.test(normalizedText) ? count + 1 : count
    ), 0);

    if (score > bestScore) {
      bestScore = score;
      bestStage = stage;
    }
  });

  return bestScore > 0 ? bestStage : '';
}

export function resolveReportStage({ stage = '', text = '', taskType = '' } = {}) {
  const normalizedStage = normalizeStageName(stage);
  if (normalizedStage && STAGE_REPORT_ROOTS[normalizedStage]) {
    return normalizedStage;
  }

  const inferredStage = inferStageFromText(text);
  if (inferredStage) {
    return inferredStage;
  }

  const normalizedTaskType = collapseWhitespace(taskType).toLowerCase();
  return TASK_TYPE_REPORT_STAGE_FALLBACKS[normalizedTaskType] || '';
}

function isMetaWorkflowText(text = '') {
  return /(00_literature|clinical meta|meta-analysis|systematic review|prisma|系统综述|meta 项目|meta 分析)/i.test(String(text || ''));
}

function buildReportPlacementHint(resolvedStage = '', options = {}) {
  const isMeta = Boolean(options.isMeta);
  const reportRoot = isMeta ? META_STAGE_REPORT_ROOTS[resolvedStage] : STAGE_REPORT_ROOTS[resolvedStage];
  const metaStartupRule = isMeta
    ? ' Meta project startup, pipeline bootstrap, and initial task-queue reports belong in the workflow research-plan area: write `01_protocol/project_startup_report.md` or a timestamped `01_protocol/project_startup_report-YYYY-MM-DD.md` variant.'
    : '';
  const generalRule = isMeta
    ? 'Never use hidden folders such as .pipeline/docs/chat-reports for routine report artifacts. For Meta projects, infer the closest visible stage from the conversation content: literature/topic/scoping -> 00_literature/reports or the relevant 00_literature subfolder, protocol -> 01_protocol, search/screening -> 02_search_dedupe or 03_title_abstract_screening, full text/extraction/quality/statistics -> 04_full_text_review through 07_data_analysis, manuscript/figures -> 08_results_figures or 09_manuscript_submission, presentation -> 10_presentation.'
    : 'Never use hidden folders such as .pipeline/docs/chat-reports for routine report artifacts. If the stage is unclear, infer the closest visible stage from the conversation content: literature/evidence -> Literature/reports, ideas/planning -> Ideation/ideas, code/results/analysis -> Experiment/analysis, manuscript/citations -> Publication/manuscript, slides/poster/homepage/video -> Promotion/slides. If still unclear, use the current active stage directory.';
  const publicationRule = resolvedStage === 'publication'
    ? ' For publication artifacts, route manuscripts, abstracts, outlines, and manuscript change logs to Publication/manuscript; generated figures, images, and legends to Publication/figures; tables to Publication/tables; and supplementary materials, checklists, and supplemental files to Publication/supplementary.'
    : '';

  if (!reportRoot) {
    return `${generalRule}${metaStartupRule}${publicationRule}`;
  }

  return `If the deliverable is a report, review, summary, plan, findings note, or change log, persist it as a Markdown file under ${reportRoot}. ${generalRule}${metaStartupRule}${publicationRule}`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sortByUpdatedAtDesc(left, right) {
  return new Date(right?.updatedAt || 0).getTime() - new Date(left?.updatedAt || 0).getTime();
}

function scoreKnowledgeBaseEntry(entry = {}, stage = '') {
  const normalizedStage = normalizeStageName(stage);
  const relativePath = collapseWhitespace(entry?.relativePath);
  const sourceType = collapseWhitespace(entry?.sourceType).toLowerCase();
  let score = 0;

  if (sourceType === 'user_upload') score += 80;
  if (sourceType === 'manual_note') score += 70;
  if (sourceType === 'research_brief') score += 65;
  if (sourceType === 'literature_report' || sourceType === 'survey_report' || sourceType === 'literature_reference') score += normalizedStage === 'literature' ? 60 : 30;
  if (sourceType === 'publication_artifact') score += normalizedStage === 'publication' ? 40 : 15;

  if (relativePath === '.pipeline/docs/research_brief.json') {
    score += 55;
  }

  const prefixes = STAGE_CONTEXT_PREFIXES[normalizedStage] || [];
  if (prefixes.some((prefix) => relativePath.startsWith(prefix))) {
    score += 45;
  }

  if (relativePath.startsWith('.pipeline/docs/kb/uploads/')) {
    score += 35;
  }

  if (relativePath.startsWith('.pipeline/docs/kb/notes/')) {
    score += 30;
  }

  if (relativePath.startsWith('.pipeline/docs/kb/news/')) {
    score += 10;
  }

  if (entry?.summary) {
    score += 5;
  }

  return score;
}

function selectIndexedWorkspaceMaterials(entries = [], stage = '', limit = DEFAULT_INDEXED_ENTRY_LIMIT) {
  const ranked = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      ...entry,
      _score: scoreKnowledgeBaseEntry(entry, stage),
    }))
    .filter((entry) => entry._score > 0)
    .sort((left, right) => {
      if (right._score !== left._score) {
        return right._score - left._score;
      }
      return sortByUpdatedAtDesc(left, right);
    });

  const selected = [];
  const seen = new Set();
  for (const entry of ranked) {
    const key = collapseWhitespace(entry.relativePath).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    selected.push(entry);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

export function buildWorkspaceMaterialsRule() {
  return `${WORKSPACE_MATERIALS_RULE_MARKER} before execution, inspect .pipeline/docs/kb/manifest.json when it exists and open the most relevant files under .pipeline/docs/kb/uploads/, .pipeline/docs/kb/notes/, and the active stage directories. Treat workspace documents as required task inputs instead of ignoring them.`;
}

export function buildCodeLocationRule(stage = '', text = '') {
  const resolvedStage = resolveReportStage({ stage, text });
  const normalizedStage = normalizeStageName(stage) || resolvedStage;
  const isMeta = isMetaWorkflowText(text);
  const codeRoot = (isMeta ? META_STAGE_CODE_ROOTS[normalizedStage] : STAGE_CODE_ROOTS[normalizedStage]) || '';
  const rootHint = codeRoot
    ? ` Use ${codeRoot} for this stage.`
    : ' For Meta projects, use the active numbered stage directory with a new or existing code/ subfolder, such as 02_search_dedupe/code, 04_full_text_review/code, 05_data_extraction/code, 06_quality_assessment/code, 07_data_analysis/code, 08_results_figures/code, 09_manuscript_submission/code, or 10_presentation/code.';
  return `${CODE_LOCATION_RULE_MARKER} if this task writes scripts, notebooks, app code, extraction/statistics runners, plotting code, or automation glue, create or reuse a code/ subfolder inside the relevant stage directory.${rootHint} Do not place new code directly in the project root or mix it with reports, tables, PDFs, or manuscript files.`;
}

export function buildEvidenceIntegrityRule() {
  return `${EVIDENCE_INTEGRITY_RULE_MARKER} never fabricate search records, citation metadata, PDFs, extracted fields, study counts, effect sizes, quality ratings, statistical inputs, or results. If there is no usable data, no reachable lawful PDF/full text, or no extractable field, stop that substep and write a cannot-extract report in the active stage, for example 02_search_dedupe/no_data_report.md, 04_full_text_review/unavailable_full_text_report.md, 05_data_extraction/cannot_extract_data_report.md, or 07_data_analysis/cannot_synthesize_report.md. State exactly what was checked, why extraction or synthesis cannot proceed, and what human input or source file is required.`;
}

export function buildHumanReviewGateRule() {
  return `${HUMAN_REVIEW_GATE_RULE_MARKER} build targeted human-review checkpoints at key gates: protocol lock, final search/dedupe input, low-confidence or conflicting screening decisions, full-text license/availability, extraction/quality rows before statistics, and synthesis/manuscript outputs before submission. Keep review queues small and specific; do not create a broad default user-confirmation backlog.`;
}

export function buildContextCompactionRule() {
  return `${CONTEXT_COMPACTION_RULE_MARKER} after a long run, a stage transition, or any major artifact change, compress the working context into files before continuing: update .pipeline/docs/research_brief.json, .pipeline/tasks/tasks.json or the task details when applicable, and the relevant stage report with the current status, artifact paths, blockers, decisions, and next three actions. Resume from those files instead of relying on chat history.`;
}

export function buildOutputLocationRule(stage = '', text = '', taskType = '') {
  const resolvedStage = resolveReportStage({ stage, text, taskType });
  const normalizedStage = normalizeStageName(stage) || resolvedStage;
  const stageLabel = STAGE_LABELS[normalizedStage] || 'Pipeline';
  const isMeta = isMetaWorkflowText(text);
  const outputRoots = (isMeta ? META_STAGE_OUTPUT_ROOTS[normalizedStage] : STAGE_OUTPUT_ROOTS[normalizedStage]) || [];
  const reportPersistenceHint = buildReportPlacementHint(resolvedStage, { isMeta });
  if (outputRoots.length === 0) {
    return `${OUTPUT_LOCATION_RULE_MARKER} read instance.json first and write generated artifacts into the canonical pipeline directories for the active stage. Do not place code, reports, drafts, datasets, results, or figures in the project root unless the task explicitly requires it. ${reportPersistenceHint}`;
  }

  return `${OUTPUT_LOCATION_RULE_MARKER} read instance.json first and write generated artifacts only under the canonical ${stageLabel} directories: ${outputRoots.join(', ')}. Do not place code, reports, drafts, datasets, results, or figures in the project root unless the task explicitly requires it. ${reportPersistenceHint}`;
}

function buildIndexedWorkspaceMaterialsBlock(context = {}, stage = '') {
  const entries = selectIndexedWorkspaceMaterials(context?.manifest?.entries || [], stage);
  if (entries.length === 0) {
    return '';
  }

  const lines = [
    `${INDEXED_WORKSPACE_MATERIALS_MARKER} use these project materials as direct inputs for this task:`,
  ];

  entries.forEach((entry) => {
    const title = collapseWhitespace(entry?.title);
    const relativePath = collapseWhitespace(entry?.relativePath);
    const summary = clipText(entry?.summary || '');
    const prefix = title ? `${relativePath} (${title})` : relativePath;
    lines.push(summary ? `- ${prefix} — ${summary}` : `- ${prefix}`);
  });

  return lines.join('\n');
}

export async function loadTaskPromptContext(projectPath) {
  const manifestPath = path.join(projectPath, DEFAULT_KB_MANIFEST_RELATIVE_PATH);
  let manifest = null;

  if (await pathExists(manifestPath)) {
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      manifest = JSON.parse(raw);
    } catch (error) {
      console.warn('[TaskPromptContext] Failed to read knowledge-base manifest:', error?.message || error);
    }
  }

  return {
    projectPath,
    manifestPath,
    manifest,
  };
}

export function enrichTaskPrompt(basePrompt = '', { stage = '', context = null } = {}) {
  const prompt = String(basePrompt || '').trim();
  const blocks = [prompt].filter(Boolean);

  if (!prompt.includes(WORKSPACE_MATERIALS_RULE_MARKER)) {
    blocks.push(buildWorkspaceMaterialsRule());
  }

  if (!prompt.includes(OUTPUT_LOCATION_RULE_MARKER)) {
    blocks.push(buildOutputLocationRule(stage, prompt));
  }

  if (!prompt.includes(CODE_LOCATION_RULE_MARKER)) {
    blocks.push(buildCodeLocationRule(stage, prompt));
  }

  if (!prompt.includes(EVIDENCE_INTEGRITY_RULE_MARKER)) {
    blocks.push(buildEvidenceIntegrityRule());
  }

  if (!prompt.includes(HUMAN_REVIEW_GATE_RULE_MARKER)) {
    blocks.push(buildHumanReviewGateRule());
  }

  if (!prompt.includes(CONTEXT_COMPACTION_RULE_MARKER)) {
    blocks.push(buildContextCompactionRule());
  }

  const indexedMaterialsBlock = buildIndexedWorkspaceMaterialsBlock(context, stage);
  if (indexedMaterialsBlock && !prompt.includes(INDEXED_WORKSPACE_MATERIALS_MARKER)) {
    blocks.push(indexedMaterialsBlock);
  }

  return blocks.join('\n\n').trim();
}

export function enrichTaskForExecution(task = {}, context = null) {
  return {
    ...task,
    nextActionPrompt: enrichTaskPrompt(task?.nextActionPrompt || '', {
      stage: task?.stage || '',
      context,
    }),
  };
}

export {
  DEFAULT_KB_MANIFEST_RELATIVE_PATH,
  CODE_LOCATION_RULE_MARKER,
  CONTEXT_COMPACTION_RULE_MARKER,
  EVIDENCE_INTEGRITY_RULE_MARKER,
  HUMAN_REVIEW_GATE_RULE_MARKER,
  INDEXED_WORKSPACE_MATERIALS_MARKER,
  OUTPUT_LOCATION_RULE_MARKER,
  STAGE_OUTPUT_ROOTS,
  STAGE_REPORT_ROOTS,
  WORKSPACE_MATERIALS_RULE_MARKER,
};
