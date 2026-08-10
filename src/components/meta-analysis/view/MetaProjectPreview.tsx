import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  BarChart3,
  Beaker,
  BookOpen,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  FileText,
  FolderOpen,
  GitBranch,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { META_ANALYSIS_STAGE_SKILLS } from '../../chat/constants/metaAnalysisSkills';

import { Button } from '../../ui/button';
import { api } from '../../../utils/api';
import {
  META_PROJECT_FOLDER_SCHEMA_VERSION,
  getMetaProjectArtifactRoots,
  getMetaReviewType,
  usesMetaNumberedFolders,
} from '../../../utils/projectKind';
import { metaAnalysisApi } from '../api/metaAnalysisApi';
import type { MetaOverview, MetaProject } from '../types';
import type { Project, SessionTag } from '../../../types/app';
import SurveillanceSection from './SurveillanceSection';

type ProjectFileNode = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  modified?: string | null;
  size?: number;
  children?: ProjectFileNode[];
};

type ArtifactItem = {
  name: string;
  relativePath: string;
  modified?: string | null;
  category: string;
  stage: MetaStageKey;
};

type TaskItem = {
  id?: string | number;
  title?: string;
  description?: string;
  status?: string;
  stage?: string;
  priority?: string;
  details?: string;
  testStrategy?: string;
  taskType?: string;
  whyNext?: string;
  inputsNeeded?: string[];
  suggestedSkills?: string[];
  dependencies?: Array<string | number>;
  nextActionPrompt?: string;
  guidance?: {
    nextActionPrompt?: string;
    whyNext?: string;
    requiredInputs?: string[];
    suggestedSkills?: string[];
  };
};

type ResearchBrief = {
  meta?: Record<string, unknown>;
  sections?: Record<string, Record<string, unknown>>;
};

type Props = {
  selectedProject: Project;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onStartTask?: (prompt?: string, task?: TaskItem | null) => void;
  embedded?: boolean;
  activeSessionId?: string | null;
  activeSessionTags?: SessionTag[];
};

type AddingTaskTarget = {
  stage: MetaStageKey;
  insertAfterId: string | number | null;
};

type MetaStageKey =
  | 'literature'
  | 'protocol'
  | 'search_dedupe'
  | 'title_abstract_screening'
  | 'full_text_review'
  | 'data_extraction'
  | 'quality_assessment'
  | 'data_analysis'
  | 'results_figures'
  | 'manuscript_submission'
  | 'presentation';

const STAGE_DEFINITIONS: Array<{
  key: MetaStageKey;
  icon: typeof Search;
  directories: string;
}> = [
  { key: 'literature', icon: BookOpen, directories: '00_literature' },
  { key: 'protocol', icon: Settings2, directories: '01_protocol' },
  { key: 'search_dedupe', icon: Search, directories: '02_search_dedupe' },
  { key: 'title_abstract_screening', icon: ListChecks, directories: '03_title_abstract_screening' },
  { key: 'full_text_review', icon: FileText, directories: '04_full_text_review' },
  { key: 'data_extraction', icon: Database, directories: '05_data_extraction' },
  { key: 'quality_assessment', icon: Check, directories: '06_quality_assessment' },
  { key: 'data_analysis', icon: BarChart3, directories: '07_data_analysis' },
  { key: 'results_figures', icon: BookOpenCheck, directories: '08_results_figures' },
  { key: 'manuscript_submission', icon: ClipboardList, directories: '09_manuscript_submission' },
  { key: 'presentation', icon: Sparkles, directories: '10_presentation' },
];

const META_STAGE_KEYS = STAGE_DEFINITIONS.map((stage) => stage.key);

function createStageCountRecord(): Record<MetaStageKey, number> {
  return META_STAGE_KEYS.reduce((acc, stage) => {
    acc[stage] = 0;
    return acc;
  }, {} as Record<MetaStageKey, number>);
}

function createOpenStageRecord(): Record<string, boolean> {
  return STAGE_DEFINITIONS.reduce((acc, stage) => {
    acc[stage.key] = true;
    return acc;
  }, {} as Record<string, boolean>);
}

function getStageOrdinal(stageKey: MetaStageKey) {
  const index = META_STAGE_KEYS.indexOf(stageKey);
  const directoryPrefix = STAGE_DEFINITIONS[index]?.directories.match(/^(\d+)/)?.[1];
  return directoryPrefix || String(index >= 0 ? index : 0).padStart(2, '0');
}

type TaskCapsule = {
  id: string;
  label: string;
  stage: MetaStageKey;
  prompt?: string;
  promptKey?: string;
  skills?: readonly string[];
};

const TASK_CAPSULES: TaskCapsule[] = [
  {
    id: 'literatureReview',
    label: '文献调研',
    stage: 'literature',
    prompt: '请推进 Meta 项目的文献调研阶段，并按项目记忆文件执行。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.literature],
  },
  {
    id: 'searchZotero',
    label: '检索/去重',
    stage: 'search_dedupe',
    prompt: '请推进 Meta 项目的检索与去重阶段，并按项目记忆文件中的检索来源分流规则执行。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.searchDedupe],
  },
  {
    id: 'protocol',
    label: 'Protocol',
    stage: 'protocol',
    prompt: '请推进 Meta 项目的 Protocol / PICO 阶段，并按项目记忆文件执行。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.protocol],
  },
  {
    id: 'titleAbstractScreening',
    label: '题目筛选',
    stage: 'title_abstract_screening',
    prompt: '请推进 Meta 项目的题目筛选，并按项目记忆文件执行；把题摘一筛和 AI 二筛作为同一个任务推进，先报告未筛选、已一筛、待 AI 二筛、已 AI 二筛和查漏补缺候选数量。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.titleAbstractScreening],
  },
  {
    id: 'fullTextDownload',
    label: '全文下载',
    stage: 'full_text_review',
    promptKey: 'metaProjectPreview.taskPrompts.fullTextDownload',
    skills: [...META_ANALYSIS_STAGE_SKILLS.fullTextDownload],
  },
  {
    id: 'mineruParsing',
    label: '文档解析',
    stage: 'full_text_review',
    prompt: '请整理 Meta 项目的文档解析队列和已解析产物，并按项目记忆文件执行。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.mineruParse],
  },
  {
    id: 'fullTextScreening',
    label: '全文筛选',
    stage: 'full_text_review',
    promptKey: 'metaProjectPreview.taskPrompts.fullTextScreening',
    skills: [...META_ANALYSIS_STAGE_SKILLS.fullTextScreening],
  },
  {
    id: 'dataExtraction',
    label: '数据提取',
    stage: 'data_extraction',
    prompt: '请根据当前 Meta 项目状态整理数据提取表，并按项目记忆文件执行。优先使用 meta-extraction。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.extractionQuality],
  },
  {
    id: 'qualityAssessment',
    label: '质量评估',
    stage: 'quality_assessment',
    prompt: '请推进 Meta 项目的质量评估 / 偏倚风险评估，并按项目记忆文件执行。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.qualityAssessment],
  },
  {
    id: 'diagnosticExtraction',
    label: '提取字段',
    stage: 'data_extraction',
    prompt: '请按当前 Meta 项目类型和用户指定目标整理数据提取字段与提取表，不要默认限定为诊断准确性 Meta；只处理数据提取阶段需要的字段、来源证据和缺失项，并按项目记忆文件执行。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.extractionQuality],
  },
  {
    id: 'statisticalPooling',
    label: '统计合并',
    stage: 'data_analysis',
    prompt: '请检查当前 Meta 项目是否满足统计合并条件，并按项目记忆文件准备统计路线。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.statistics],
  },
  {
    id: 'prismaManuscript',
    label: 'PRISMA 成稿',
    stage: 'manuscript_submission',
    prompt: '请基于当前真实产物起草 PRISMA 手稿，并按项目记忆文件执行。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.manuscript],
  },
  {
    id: 'presentationPromotion',
    label: '汇报推广',
    stage: 'presentation',
    prompt: '请把这个 Meta 项目整理成汇报推广材料，并按项目记忆文件执行。',
    skills: [...META_ANALYSIS_STAGE_SKILLS.promotion],
  },
] as const;

const META_TASK_STATUS_OPTIONS = ['pending', 'in-progress', 'review', 'done', 'deferred', 'cancelled'] as const;

const META_TASK_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'in-progress': 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200',
  review: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  done: 'bg-teal-50 text-teal-800 dark:bg-teal-950/30 dark:text-teal-200',
  deferred: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

function sumRecord(record?: Record<string, number>) {
  return Object.values(record || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function stageMissingHint(stage: MetaStageKey, count: number, t: any) {
  if (count > 0) return t('metaProjectPreview.stageCard.hasRecords');
  return t(`metaProjectPreview.stageMissingHints.${stage}`);
}

function inferMetaStageFromText(text?: string | null): MetaStageKey | null {
  const value = String(text || '').toLowerCase();
  if (!value.trim()) return null;
  if (/(literature review|evidence scan|evidence gap|topic framing|topic selection|scoping review|scoping|文献调研|证据综述|研究空白|选题|范围综述)/.test(value)) return 'literature';
  if (/(manuscript|submission|prisma|checklist|supplement|手稿|投稿|成稿|补充材料)/.test(value)) return 'manuscript_submission';
  if (/(presentation|promotion|slide|homepage|audio|video|poster|汇报|推广|展示|幻灯片|主页|音频|视频)/.test(value)) return 'presentation';
  if (/(quality|risk of bias|bias|grade|robins|quadas|rob 2|nos|质评|质量评估|偏倚|偏倚风险)/.test(value)) return 'quality_assessment';
  if (/(data extraction|extract|extraction|effect size|tp|fp|fn|tn|提取|效应量|提取字段|诊断提取)/.test(value)) return 'data_extraction';
  if (/(full[- ]?text|full text|pdf|mineru|ocr|全文|来源核验|来源授权|解析)/.test(value)) return 'full_text_review';
  if (/(title[/-]?abstract|abstract screening|screening|pre[- ]?screen|rescreen|筛选|题摘|题名摘要|初筛|复筛)/.test(value)) return 'title_abstract_screening';
  if (/(search|dedupe|dedup|zotero|pubmed|medline|reference|references|检索|去重|文献库|文献同步)/.test(value)) return 'search_dedupe';
  if (/(protocol|pico|peco|eligibility|outcome|research question|研究问题|方案|纳排|结局)/.test(value)) return 'protocol';
  if (/(forest|funnel|sroc|figure|table|chart|plot|prisma flow|图表|森林图|漏斗图|结果表|证据图谱)/.test(value)) return 'results_figures';
  if (/(analysis|statistic|pooling|synthesis|heterogeneity|model|meta-analysis|统计|合并|异质性|模型|敏感性|亚组)/.test(value)) return 'data_analysis';
  return null;
}

function normalizeStage(value?: string | null, text?: string | null): MetaStageKey {
  const raw = String(value || '').trim().toLowerCase();
  const stage = raw.replace(/[\s-]+/g, '_');
  const broadStageDefaults: Record<string, MetaStageKey> = {
    ideation: 'literature',
    literature: 'literature',
    research: 'literature',
    survey: 'literature',
    experiment: 'data_analysis',
    implementation: 'data_analysis',
    publication: 'manuscript_submission',
    promotion: 'presentation',
  };
  if (broadStageDefaults[stage]) {
    return inferMetaStageFromText(text) || broadStageDefaults[stage];
  }

  const direct: Record<string, MetaStageKey> = {
    literature: 'literature',
    literature_review: 'literature',
    topic_selection: 'literature',
    scoping_review: 'literature',
    protocol: 'protocol',
    pico: 'protocol',
    peco: 'protocol',
    search: 'search_dedupe',
    dedupe: 'search_dedupe',
    search_dedupe: 'search_dedupe',
    title_abstract: 'title_abstract_screening',
    title_abstract_screening: 'title_abstract_screening',
    screening: 'title_abstract_screening',
    manual_screening: 'title_abstract_screening',
    full_text: 'full_text_review',
    full_text_review: 'full_text_review',
    fulltext: 'full_text_review',
    pdf: 'full_text_review',
    mineru: 'full_text_review',
    data_extraction: 'data_extraction',
    extraction: 'data_extraction',
    quality: 'quality_assessment',
    quality_assessment: 'quality_assessment',
    risk_of_bias: 'quality_assessment',
    analysis: 'data_analysis',
    data_analysis: 'data_analysis',
    statistics: 'data_analysis',
    statistical_pooling: 'data_analysis',
    results: 'results_figures',
    figures: 'results_figures',
    results_figures: 'results_figures',
    manuscript: 'manuscript_submission',
    manuscript_submission: 'manuscript_submission',
    submission: 'manuscript_submission',
    paper: 'manuscript_submission',
    presentation: 'presentation',
  };
  if (direct[stage]) return direct[stage];
  return inferMetaStageFromText(text) || 'data_analysis';
}

function normalizeTaskStatus(value?: string | null) {
  const status = String(value || 'pending');
  return META_TASK_STATUS_OPTIONS.includes(status as typeof META_TASK_STATUS_OPTIONS[number]) ? status : 'pending';
}

function buildMetaTaskSummary(tasks: TaskItem[]) {
  const normalized = (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    status: normalizeTaskStatus(task.status),
  }));
  const total = normalized.length;
  const done = normalized.filter((task) => task.status === 'done').length;
  const inProgress = normalized.filter((task) => task.status === 'in-progress').length;
  const pending = normalized.filter((task) => task.status === 'pending').length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, inProgress, pending, progress };
}

function metaTaskStatusClass(status?: string | null) {
  return META_TASK_STATUS_CLASSES[normalizeTaskStatus(status)] || META_TASK_STATUS_CLASSES.pending;
}

function metaTaskStatusLabel(t: any, status?: string | null) {
  return t(`metaProjectPreview.taskStatuses.${normalizeTaskStatus(status)}`);
}

function metaTaskStageLabel(t: any, stage: MetaStageKey) {
  return t(`metaProjectPreview.taskStages.${stage}`);
}

function metaTaskStageShortLabel(t: any, stage: MetaStageKey) {
  return t(`metaProjectPreview.taskStageShortLabels.${stage}`);
}

function metaTaskCapsuleLabel(
  t: any,
  task: TaskCapsule,
) {
  return t(`metaProjectPreview.taskCapsules.${task.id}`, { defaultValue: task.label });
}

function resolveTaskCapsulePrompt(t: any, task: TaskCapsule) {
  const prompt = task.prompt
    || (task.promptKey && task.skills?.length
      ? t(task.promptKey, { skills: task.skills.join(', ') })
      : '');
  if (!prompt) return '';
  if (!task.skills?.length) return prompt;
  const lowerPrompt = prompt.toLowerCase();
  const hasAnySkill = task.skills.some((skill) => lowerPrompt.includes(skill.toLowerCase()));
  if (hasAnySkill) return prompt;
  return `${prompt}\n\n${t('metaProjectPreview.taskPrompts.availableSkillsLine', { skills: task.skills.join(', ') })}`;
}

function getTaskStageText(task?: TaskItem | null) {
  if (!task) return '';
  return [
    task.title,
    task.description,
    task.details,
    task.testStrategy,
    task.taskType,
    task.nextActionPrompt,
    task.guidance?.nextActionPrompt,
    task.guidance?.whyNext,
    task.whyNext,
    ...(Array.isArray(task.inputsNeeded) ? task.inputsNeeded : []),
    ...(Array.isArray(task.suggestedSkills) ? task.suggestedSkills : []),
  ].filter(Boolean).join(' ');
}

function getTaskStage(task?: TaskItem | null): MetaStageKey {
  return normalizeStage(task?.stage, getTaskStageText(task));
}

function toRelativePath(project: Project, absolutePath: string) {
  const root = String(project.fullPath || project.path || '').replace(/\\/g, '/').replace(/\/$/, '');
  const normalized = String(absolutePath || '').replace(/\\/g, '/');
  if (root && normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1);
  }
  return normalized.replace(/^\/+/, '');
}

function stageForArtifact(relativePath: string): MetaStageKey {
  const lower = relativePath.toLowerCase();
  if (lower.startsWith('00_literature/')) return 'literature';
  if (lower.startsWith('01_protocol/')) return 'protocol';
  if (lower.startsWith('02_search_dedupe/')) return 'search_dedupe';
  if (lower.startsWith('03_title_abstract_screening/')) return 'title_abstract_screening';
  if (lower.startsWith('04_full_text_review/')) return 'full_text_review';
  if (lower.startsWith('05_data_extraction/')) return 'data_extraction';
  if (lower.startsWith('06_quality_assessment/')) return 'quality_assessment';
  if (lower.startsWith('07_data_analysis/')) return 'data_analysis';
  if (lower.startsWith('08_results_figures/')) return 'results_figures';
  if (lower.startsWith('09_manuscript_submission/')) return 'manuscript_submission';
  if (lower.startsWith('10_presentation/')) return 'presentation';
  if (lower.startsWith('literature/reports/')) return 'literature';
  if (lower.startsWith('literature/references/')) return 'search_dedupe';
  if (lower.startsWith('literature/') || lower.startsWith('ideation/')) return 'literature';
  if (lower.startsWith('experiment/datasets/') || lower.includes('/extraction/')) return 'data_extraction';
  if (lower.startsWith('experiment/analysis/')) return 'data_analysis';
  if (lower.startsWith('publication/figures/') || lower.startsWith('publication/tables/')) return 'results_figures';
  if (lower.startsWith('publication/')) return 'manuscript_submission';
  if (lower.startsWith('promotion/')) return 'presentation';
  return inferMetaStageFromText(relativePath) || 'data_analysis';
}

function categorizeArtifact(relativePath: string) {
  const lower = relativePath.toLowerCase();
  if (lower.startsWith('00_literature/')) return '文献调研';
  if (lower.startsWith('01_protocol/')) return 'Protocol';
  if (lower.startsWith('02_search_dedupe/')) return '检索';
  if (lower.startsWith('03_title_abstract_screening/')) return '题摘筛选';
  if (lower.startsWith('04_full_text_review/')) return lower.endsWith('.pdf') ? 'PDF' : '全文';
  if (lower.startsWith('05_data_extraction/')) return '提取';
  if (lower.startsWith('06_quality_assessment/')) return '质评';
  if (lower.startsWith('07_data_analysis/')) return '分析';
  if (lower.startsWith('08_results_figures/')) return '结果图表';
  if (lower.startsWith('09_manuscript_submission/')) return '手稿';
  if (lower.startsWith('10_presentation/')) return '汇报';
  if (lower.startsWith('literature/reports/')) return '调研';
  if (lower.startsWith('literature/references/')) return '文献';
  if (lower.startsWith('ideation/')) return '选题';
  if (lower.endsWith('.pdf')) return 'PDF';
  if (lower.includes('/mineru/') || lower.endsWith('document.md') || lower.endsWith('tables.json')) return 'MinerU';
  if (lower.includes('/extraction/')) return '提取';
  if (lower.startsWith('experiment/datasets/')) return '数据集';
  if (lower.startsWith('experiment/analysis/')) return '分析';
  if (lower.startsWith('publication/figures/')) return '图';
  if (lower.startsWith('publication/tables/')) return '表';
  if (lower.startsWith('publication/supplementary/')) return '补充';
  if (lower.startsWith('publication/manuscript/')) return '手稿';
  if (lower.startsWith('promotion/')) return '推广';
  return '产物';
}

function flattenArtifacts(nodes: ProjectFileNode[], project: Project): ArtifactItem[] {
  const byPath = new Map<string, ArtifactItem>();
  const visit = (items: ProjectFileNode[]) => {
    for (const item of items) {
      if (item.type === 'directory') {
        visit(item.children || []);
        continue;
      }
      const relativePath = toRelativePath(project, item.path);
      byPath.set(relativePath, {
        name: item.name,
        relativePath,
        modified: item.modified || null,
        category: categorizeArtifact(relativePath),
        stage: stageForArtifact(relativePath),
      });
    }
  };
  visit(nodes);
  return [...byPath.values()].sort((left, right) => String(right.modified || '').localeCompare(String(left.modified || '')));
}

function formatTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function safeText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  return data?.message || data?.error || fallback;
}

function getBriefOverview(brief: ResearchBrief | null, t: any) {
  const sections = brief?.sections || {};
  const literature = sections.literature || {};
  const ideation = sections.ideation || {};
  const experiment = sections.experiment || {};
  const publication = sections.publication || {};

  return [
    { label: t('metaProjectPreview.briefSections.coreQuestion'), value: safeText(literature.core_research_question) || safeText(ideation.review_objective) },
    { label: t('metaProjectPreview.briefSections.picoPeco'), value: safeText(ideation.pico_or_peco) },
    { label: t('metaProjectPreview.briefSections.eligibility'), value: safeText(ideation.eligibility_criteria) },
    { label: t('metaProjectPreview.briefSections.screeningPdf'), value: safeText(experiment.screening_plan) || safeText(experiment.pdf_and_parse_plan) },
    { label: t('metaProjectPreview.briefSections.analysisPlan'), value: safeText(experiment.analysis_plan) },
    { label: t('metaProjectPreview.briefSections.manuscriptPlan'), value: safeText(publication.manuscript_outline) },
  ].filter((item) => item.value);
}

function collectProjectSessions(project: Project) {
  const sessions = ((project.sessions || []) as any[])
    .map((session) => ({ ...session, provider: 'Claude', __provider: session.__provider || 'claude' }));
  return sessions
    .sort((left, right) => new Date(right.lastActivity || right.last_activity || right.updatedAt || 0).getTime()
      - new Date(left.lastActivity || left.last_activity || left.updatedAt || 0).getTime())
    .slice(0, 6);
}

function getSessionDisplayName(session: any) {
  return session?.displayName
    || session?.summary
    || session?.title
    || session?.name
    || session?.id
    || 'Conversation';
}

function getTagStageKey(tag: Pick<SessionTag, 'tagKey'> | null | undefined): MetaStageKey {
  return normalizeStage(tag?.tagKey);
}

function collectStageKeysFromTags(tags?: Array<Partial<SessionTag> & { type?: string } | null>): MetaStageKey[] {
  const stageKeys = new Set<MetaStageKey>();
  (Array.isArray(tags) ? tags : []).forEach((tag) => {
    const tagKey = String(tag?.tagKey || '').trim();
    const tagType = String(tag?.tagType || tag?.type || '').trim();
    if (!tagKey || (tagType && tagType !== 'stage')) return;
    const stageKey = normalizeStage(tagKey);
    if (META_STAGE_KEYS.includes(stageKey)) {
      stageKeys.add(stageKey);
    }
  });
  return [...stageKeys];
}

function CollapsibleMetaCard({
  icon: Icon,
  title,
  detail,
  children,
  defaultCollapsed = false,
}: {
  icon: typeof Search;
  title: string;
  detail?: string;
  children: ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card p-3 shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground shadow-sm">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold tracking-tight text-foreground">{title}</h4>
            {detail ? <p className="truncate text-[11px] leading-4 text-muted-foreground">{detail}</p> : null}
          </div>
        </div>
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {!collapsed ? (
        <>
          <div className="my-3 h-px bg-border/70" />
          {children}
        </>
      ) : null}
    </section>
  );
}

function MetaTaskShortcutBar({
  tasks,
  onStartTask,
  t,
}: {
  tasks: readonly TaskCapsule[];
  onStartTask?: Props['onStartTask'];
  t: any;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card px-2.5 py-2 shadow-sm">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground" />
        <h4 className="text-[11px] font-medium tracking-tight text-muted-foreground">
          {t('metaProjectPreview.taskShortcutBar.title')}
        </h4>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onStartTask?.(resolveTaskCapsulePrompt(t, task), { stage: task.stage, title: metaTaskCapsuleLabel(t, task) })}
            className="group inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <Play className="h-2.5 w-2.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
            <span className="whitespace-nowrap">{metaTaskCapsuleLabel(t, task)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function MetaMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accentClass = 'border-border/70 bg-card text-muted-foreground',
  compact = false,
}: {
  icon?: typeof Search;
  label: string;
  value: number | string;
  detail: string;
  accentClass?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="min-w-0 rounded-xl border border-border/60 bg-card px-2.5 py-2 shadow-sm">
        <div className="truncate text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
        <div className="mt-1 text-lg font-semibold leading-none text-foreground">{value}</div>
        <div className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</div>
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-card p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-semibold leading-none tracking-tight text-foreground">{value}</div>
          <div className="mt-2 truncate text-xs text-muted-foreground">{detail}</div>
        </div>
        {Icon ? (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${accentClass}`}>
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetaStageCard({
  stage,
  t,
}: {
  stage: typeof STAGE_DEFINITIONS[number] & {
    count: number;
    done: boolean;
    hint: string;
    taskCount: number;
    artifactCount: number;
    current: boolean;
  };
  t: any;
}) {
  const StageIcon = stage.icon;
  const statusLabel = stage.current
    ? t('metaProjectPreview.stageCard.current')
    : stage.done
      ? t('metaProjectPreview.stageCard.hasArtifacts')
      : t('metaProjectPreview.stageCard.waiting');
  const cardTone = stage.current
    ? 'border-primary/55 bg-primary/10 shadow-primary/10 ring-1 ring-primary/25'
    : 'border-border/60 bg-card';
  const capsuleTone = stage.current
    ? 'border-primary/45 bg-primary/15 text-primary'
    : 'border-border/70 bg-card text-muted-foreground';
  const statusTone = stage.current
    ? 'border-primary/40 bg-primary text-primary-foreground'
    : 'border-transparent text-muted-foreground';

  return (
    <div
      className={`min-w-0 rounded-xl border p-2.5 shadow-sm transition-colors ${cardTone}`}
      title={stage.current && stage.artifactCount === 0 ? t('metaProjectPreview.stageCard.currentNoArtifact') : stage.hint}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${capsuleTone}`}>
            <StageIcon className="h-3 w-3 shrink-0" />
            <span className="min-w-0 truncate">{metaTaskStageShortLabel(t, stage.key)}</span>
          </span>
        </div>
        <span className={`inline-flex max-w-[5.5rem] shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusTone}`}>
          {stage.current ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
          <span className="truncate">{statusLabel}</span>
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t('metaProjectPreview.stageCard.taskCount', { count: stage.taskCount })}</span>
        <span>{t('metaProjectPreview.stageCard.artifactCount', { count: stage.artifactCount })}</span>
      </div>
    </div>
  );
}

function MetaBriefCard({
  title,
  metadata,
  sections,
  defaultCollapsed = false,
  compact = false,
  t,
}: {
  title: string;
  metadata: Array<{ label: string; value: string }>;
  sections: Array<{ label: string; value: string }>;
  defaultCollapsed?: boolean;
  compact?: boolean;
  t: any;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showBriefModal, setShowBriefModal] = useState(false);
  const hasDetailedContent = sections.length > 0;
  const visibleMetadata = compact ? metadata.slice(0, 2) : metadata;
  const hiddenMetadataCount = Math.max(metadata.length - visibleMetadata.length, 0);
  const sectionSummary = hasDetailedContent
    ? sections.length === 1
      ? t('metaProjectPreview.briefCard.summaryOne')
      : t('metaProjectPreview.briefCard.summaryMany', { count: sections.length })
    : '';

  useEffect(() => {
    setCollapsed(defaultCollapsed);
  }, [defaultCollapsed, title]);

  return (
    <>
      <div className={`flex flex-col rounded-xl border border-border/60 bg-card shadow-sm ${compact ? 'gap-1.5 p-2.5' : 'gap-2 p-3'}`}>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          className="flex w-full items-center justify-between gap-2 rounded-lg text-left transition-colors hover:bg-muted/35 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground">
              <ClipboardList className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <h4 className="truncate text-sm font-semibold tracking-tight text-foreground">
                {t('metaProjectPreview.briefCard.title')}
              </h4>
              <p className={`truncate text-[11px] leading-4 text-muted-foreground ${compact ? 'max-w-[14rem]' : ''}`}>
                {t('metaProjectPreview.briefCard.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasDetailedContent ? (
              <span className="rounded-full border border-border/70 bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {sections.length}
              </span>
            ) : null}
            {collapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        </button>

        {!collapsed ? (
          <div className={`space-y-2 ${compact ? 'max-h-[150px] overflow-y-auto pr-1' : ''}`}>
            {title ? (
              <div className="rounded-xl border border-border/60 bg-card p-2 shadow-sm">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {t('metaProjectPreview.briefCard.researchTitle')}
                </p>
                <p className={`mt-1.5 text-sm font-medium leading-5 text-foreground ${compact ? 'line-clamp-1' : 'line-clamp-2'}`}>{title}</p>
              </div>
            ) : null}

            {metadata.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {visibleMetadata.map((item) => (
                  <span key={`${item.label}-${item.value}`} className="rounded-full border border-border/60 bg-card px-2.5 py-1 shadow-sm">
                    {item.label}: <code className="rounded bg-muted px-1">{item.value}</code>
                  </span>
                ))}
                {hiddenMetadataCount > 0 ? (
                  <span className="rounded-full border border-border/60 bg-card px-2.5 py-1 shadow-sm">
                    +{hiddenMetadataCount}
                  </span>
                ) : null}
              </div>
            ) : null}

            {hasDetailedContent ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-2 shadow-sm">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {t('metaProjectPreview.briefCard.briefLabel')}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-foreground/80">{sectionSummary}</p>
                </div>
                <Button
                  size="sm"
                  className="h-8 shrink-0 rounded-full px-2.5 text-xs"
                  onClick={() => setShowBriefModal(true)}
                >
                  <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
                  {t('metaProjectPreview.briefCard.readBrief')}
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 bg-card px-3 py-3 text-xs leading-5 text-muted-foreground">
                {t('metaProjectPreview.briefCard.emptyHint')}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {showBriefModal && typeof document !== 'undefined' ? createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm md:p-6"
          onClick={() => setShowBriefModal(false)}
        >
          <div
            className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-[34px] border border-border/70 bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 bg-gradient-to-r from-zinc-50 via-white to-zinc-100 px-5 py-4 dark:from-black dark:via-neutral-950 dark:to-black">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">
                  {t('metaProjectPreview.briefCard.title')}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {title || t('metaProjectPreview.briefCard.modalSubtitleFallback')}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowBriefModal(false)}>
                {t('metaProjectPreview.briefCard.close')}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-4 p-5">
                {title ? (
                  <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      {t('metaProjectPreview.briefCard.researchTitle')}
                    </p>
                    <p className="mt-2 text-sm font-medium leading-6 text-foreground">{title}</p>
                  </div>
                ) : null}
                {metadata.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {metadata.map((item) => (
                      <span key={`modal-${item.label}-${item.value}`} className="rounded-full border border-border/60 bg-card/70 px-3 py-1 shadow-sm">
                        {item.label}: <code className="rounded bg-muted px-1">{item.value}</code>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="grid auto-rows-fr items-stretch gap-3 md:grid-cols-2">
                  {sections.map((section) => (
                    <div key={section.label} className="flex h-full flex-col rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{section.label}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{section.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function MetaArtifactButton({
  artifact,
  onFileOpen,
  trailing,
}: {
  artifact: ArtifactItem;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onFileOpen?.(artifact.relativePath)}
      className="flex w-full items-center gap-2 rounded-xl border border-border/60 bg-card px-2.5 py-2 text-left shadow-sm transition-colors hover:border-border hover:bg-accent/30"
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{artifact.name}</div>
        <div className="truncate text-[10px] text-muted-foreground">{artifact.relativePath}</div>
      </div>
      {trailing || (
        <span className="shrink-0 rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {artifact.category}
        </span>
      )}
    </button>
  );
}

function MetaStageArtifactGroup({
  stage,
  onFileOpen,
  defaultOpen = false,
  t,
}: {
  stage: typeof STAGE_DEFINITIONS[number] & { artifacts: ArtifactItem[] };
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  defaultOpen?: boolean;
  t: any;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const StageIcon = stage.icon;
  const visibleArtifacts = stage.artifacts.slice(0, 8);
  const hiddenCount = Math.max(0, stage.artifacts.length - visibleArtifacts.length);

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/90 text-muted-foreground">
          <StageIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{metaTaskStageLabel(t, stage.key)}</span>
        <span className="shrink-0 rounded-full border border-border/70 bg-card px-1.5 py-0 text-xs text-muted-foreground">
          {stage.artifacts.length}
        </span>
      </button>
      {open ? (
        <div className="mx-3 mb-3 space-y-1.5 border-l border-border pl-3">
          {visibleArtifacts.map((artifact) => (
            <MetaArtifactButton
              key={artifact.relativePath}
              artifact={artifact}
              onFileOpen={onFileOpen}
            />
          ))}
          {hiddenCount > 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-background/55 px-3 py-2 text-xs text-muted-foreground">
              还有 {hiddenCount} 个文件，进入文件树可查看完整列表。
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function MetaProjectPreview({
  selectedProject,
  onFileOpen,
  onStartTask,
  embedded = false,
  activeSessionId = null,
  activeSessionTags = [],
}: Props) {
  const { t } = useTranslation('common');
  const [metaProject, setMetaProject] = useState<MetaProject | null>(null);
  const [overview, setOverview] = useState<MetaOverview | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [researchBrief, setResearchBrief] = useState<ResearchBrief | null>(null);
  const [projectTags, setProjectTags] = useState<SessionTag[]>([]);
  const [sessionTagsById, setSessionTagsById] = useState<Record<string, SessionTag[]>>({});
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [openStages, setOpenStages] = useState<Record<string, boolean>>(() => createOpenStageRecord());
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '' });
  const [addingToStage, setAddingToStage] = useState<AddingTaskTarget | null>(null);
  const [addForm, setAddForm] = useState({ title: '', description: '' });
  const [addingTask, setAddingTask] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [statusUpdatingTaskId, setStatusUpdatingTaskId] = useState<string | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<TaskItem | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const reviewType = getMetaReviewType(selectedProject);
  const folderSchemaVersion = usesMetaNumberedFolders(selectedProject)
    ? META_PROJECT_FOLDER_SCHEMA_VERSION
    : undefined;
  const displayReviewType = metaProject?.review_type || reviewType;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const existing = await metaAnalysisApi.getProject(selectedProject.name);
      const project = existing.metaProject
        || (await metaAnalysisApi.initProject(selectedProject.name, {
          reviewType,
          title: `${selectedProject.displayName || selectedProject.name} Meta project`,
          primaryOutcome: reviewType === 'diagnostic' ? 'diagnostic accuracy' : reviewType || null,
          folderSchemaVersion,
        })).metaProject;
      setMetaProject(project);

      const [nextOverview, tasksResponse, briefResponse, tagsResponse, artifactTrees] = await Promise.all([
        metaAnalysisApi.overview(project.id),
        api.get(`/taskmaster/tasks/${encodeURIComponent(selectedProject.name)}`).catch(() => null),
        api.readFile(selectedProject.name, '.pipeline/docs/research_brief.json', { includeInternal: true }).catch(() => null),
        api.projectTags(selectedProject.name, 'stage' as any).catch(() => null),
        Promise.all(
          getMetaProjectArtifactRoots(selectedProject).map(async (root) => {
            const artifactResponse = await api.getFiles(selectedProject.name, {
              path: root,
              maxDepth: 5,
              showHidden: false,
            });
            if (!artifactResponse.ok) return [];
            return artifactResponse.json() as Promise<ProjectFileNode[]>;
          }),
        ),
      ]);

      setOverview(nextOverview);

      const taskData = tasksResponse?.ok ? await tasksResponse.json().catch(() => null) : null;
      setTasks(Array.isArray(taskData?.tasks) ? taskData.tasks : []);

      const tagsData = tagsResponse?.ok ? await tagsResponse.json().catch(() => null) : null;
      setProjectTags(Array.isArray(tagsData?.tags) ? tagsData.tags : []);

      const briefData = briefResponse?.ok ? await briefResponse.json().catch(() => null) : null;
      if (briefData?.content) {
        setResearchBrief(JSON.parse(briefData.content));
      } else {
        setResearchBrief(null);
      }

      setArtifacts(flattenArtifacts(artifactTrees.flat(), selectedProject));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }, [folderSchemaVersion, reviewType, selectedProject]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setEditingTaskId(null);
    setEditForm({ title: '', description: '' });
    setAddingToStage(null);
    setAddForm({ title: '', description: '' });
    setOpenStages(createOpenStageRecord());
    setTaskActionError(null);
    setDeleteConfirmTask(null);
    setSessionTagsById({});
    setProjectTags([]);
  }, [selectedProject.name]);

  const beginEditTask = useCallback((task: TaskItem) => {
    setTaskActionError(null);
    setEditingTaskId(String(task.id));
    setEditForm({ title: task.title || '', description: task.description || '' });
  }, []);

  const cancelEditTask = useCallback(() => {
    setEditingTaskId(null);
    setEditForm({ title: '', description: '' });
  }, []);

  const toggleStage = useCallback((stageKey: MetaStageKey) => {
    setOpenStages((current) => ({
      ...current,
      [stageKey]: !(current[stageKey] ?? true),
    }));
  }, []);

  const beginAddTask = useCallback((stageKey: MetaStageKey, insertAfterId: string | number | null = null) => {
    setTaskActionError(null);
    setEditingTaskId(null);
    setAddingToStage({ stage: stageKey, insertAfterId });
    setAddForm({ title: '', description: '' });
    setOpenStages((current) => ({ ...current, [stageKey]: true }));
  }, []);

  const cancelAddTask = useCallback(() => {
    setAddingToStage(null);
    setAddForm({ title: '', description: '' });
  }, []);

  const updateMetaTask = useCallback(async (taskId: string | number, updates: Record<string, unknown>) => {
    const response = await api.taskmaster.updateTask(
      encodeURIComponent(selectedProject.name),
      encodeURIComponent(String(taskId)),
      updates,
    );
    if (!response.ok) {
      throw new Error(await readApiError(response, t('metaProjectPreview.taskBoard.updateErrorFallback')));
    }
    await refresh();
  }, [refresh, selectedProject.name, t]);

  const handleSaveTask = useCallback(async () => {
    if (!editingTaskId || !editForm.title.trim()) return;
    setSavingTaskId(editingTaskId);
    setTaskActionError(null);
    try {
      await updateMetaTask(editingTaskId, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
      });
      cancelEditTask();
    } catch (saveError) {
      setTaskActionError(t('metaProjectPreview.taskBoard.saveError', {
        message: saveError instanceof Error ? saveError.message : String(saveError),
      }));
    } finally {
      setSavingTaskId(null);
    }
  }, [cancelEditTask, editForm.description, editForm.title, editingTaskId, t, updateMetaTask]);

  const handleAddTask = useCallback(async () => {
    if (!addingToStage || !addForm.title.trim()) return;
    setAddingTask(true);
    setTaskActionError(null);
    try {
      const response = await api.taskmaster.addTask(
        encodeURIComponent(selectedProject.name),
        {
          prompt: addForm.description.trim() || addForm.title.trim(),
          title: addForm.title.trim(),
          description: addForm.description.trim() || addForm.title.trim(),
          priority: 'medium',
          dependencies: [],
          stage: addingToStage.stage,
          insertAfterId: addingToStage.insertAfterId,
        },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response, t('metaProjectPreview.taskBoard.addErrorFallback')));
      }
      cancelAddTask();
      await refresh();
    } catch (addError) {
      setTaskActionError(t('metaProjectPreview.taskBoard.addError', {
        message: addError instanceof Error ? addError.message : String(addError),
      }));
    } finally {
      setAddingTask(false);
    }
  }, [addForm.description, addForm.title, addingToStage, cancelAddTask, refresh, selectedProject.name, t]);

  const handleTaskStatusChange = useCallback(async (task: TaskItem, status: string) => {
    if (!task.id) return;
    const taskId = String(task.id);
    setStatusUpdatingTaskId(taskId);
    setTaskActionError(null);
    try {
      await updateMetaTask(task.id, { status });
    } catch (statusError) {
      setTaskActionError(t('metaProjectPreview.taskBoard.statusError', {
        message: statusError instanceof Error ? statusError.message : String(statusError),
      }));
    } finally {
      setStatusUpdatingTaskId(null);
    }
  }, [t, updateMetaTask]);

  const handleDeleteTask = useCallback(async () => {
    if (!deleteConfirmTask?.id) return;
    const taskId = String(deleteConfirmTask.id);
    setDeletingTaskId(taskId);
    setTaskActionError(null);
    try {
      const response = await api.taskmaster.deleteTask(
        encodeURIComponent(selectedProject.name),
        encodeURIComponent(taskId),
      );
      if (!response.ok) {
        throw new Error(await readApiError(response, t('metaProjectPreview.taskBoard.deleteErrorFallback')));
      }
      setDeleteConfirmTask(null);
      await refresh();
    } catch (deleteError) {
      setTaskActionError(t('metaProjectPreview.taskBoard.deleteError', {
        message: deleteError instanceof Error ? deleteError.message : String(deleteError),
      }));
    } finally {
      setDeletingTaskId(null);
    }
  }, [deleteConfirmTask, refresh, selectedProject.name, t]);

  const handleToggleSessionStageTag = useCallback(async (session: any, tag: SessionTag) => {
    if (!selectedProject.name || !session?.id || !tag?.id) return;

    const sessionId = String(session.id);
    const currentTags: SessionTag[] = Array.isArray(sessionTagsById[sessionId])
      ? sessionTagsById[sessionId]
      : (Array.isArray(session.tags) ? session.tags : []);
    const nextTagIds = currentTags.some((currentTag) => currentTag.id === tag.id)
      ? currentTags.filter((currentTag) => currentTag.id !== tag.id).map((currentTag) => currentTag.id)
      : [...currentTags.map((currentTag) => currentTag.id), tag.id];

    setSavingSessionId(sessionId);
    setTaskActionError(null);
    try {
      const response = await api.updateSessionTags(selectedProject.name, sessionId, nextTagIds);
      if (!response.ok) {
        throw new Error(await readApiError(response, t('metaProjectPreview.sessionStageLinks.updateErrorFallback')));
      }

      const payload = await response.json().catch(() => null);
      const nextTags = Array.isArray(payload?.tags) ? payload.tags : [];
      setSessionTagsById((current) => ({
        ...current,
        [sessionId]: nextTags,
      }));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('session-tags-updated', {
          detail: {
            projectName: selectedProject.name,
            sessionId,
            provider: session.__provider || 'claude',
            tags: nextTags,
          },
        }));
      }
    } catch (tagError) {
      setTaskActionError(t('metaProjectPreview.sessionStageLinks.updateError', {
        message: tagError instanceof Error ? tagError.message : String(tagError),
      }));
    } finally {
      setSavingSessionId(null);
    }
  }, [selectedProject.name, sessionTagsById, t]);

  const artifactStageCounts = useMemo(() => artifacts.reduce<Record<MetaStageKey, number>>((acc, artifact) => {
    acc[artifact.stage] = (acc[artifact.stage] || 0) + 1;
    return acc;
  }, createStageCountRecord()), [artifacts]);

  const taskStageCounts = useMemo(() => tasks.reduce<Record<MetaStageKey, number>>((acc, task) => {
    const stage = getTaskStage(task);
    acc[stage] = (acc[stage] || 0) + 1;
    return acc;
  }, createStageCountRecord()), [tasks]);

  const recentSessions = useMemo(() => collectProjectSessions(selectedProject), [selectedProject]);
  const activeSessionStageKeys = useMemo(() => {
    const sessionId = String(activeSessionId || '');
    const activeSession = sessionId
      ? recentSessions.find((session: any) => String(session.id || '') === sessionId)
      : null;
    const tags = sessionId && sessionTagsById[sessionId]
      ? sessionTagsById[sessionId]
      : activeSessionTags.length
        ? activeSessionTags
        : (Array.isArray(activeSession?.tags) ? activeSession.tags : []);

    return collectStageKeysFromTags(tags);
  }, [activeSessionId, activeSessionTags, recentSessions, sessionTagsById]);
  const nextTask = useMemo(() => (
    tasks.find((task) => task.status === 'in-progress')
    || tasks.find((task) => task.status === 'pending')
    || tasks[0]
    || null
  ), [tasks]);
  const currentStageKeys = useMemo(() => (
    activeSessionStageKeys.length > 0
      ? activeSessionStageKeys
      : nextTask
        ? [getTaskStage(nextTask)]
        : []
  ), [activeSessionStageKeys, nextTask]);

  const stageCards = useMemo(() => STAGE_DEFINITIONS.map((stage) => {
    const taskCount = taskStageCounts[stage.key] || 0;
    const artifactCount = artifactStageCounts[stage.key] || 0;
    const count = artifactCount + taskCount;
    return {
      ...stage,
      count,
      taskCount,
      artifactCount,
      done: artifactCount > 0,
      current: currentStageKeys.includes(stage.key),
      hint: stageMissingHint(stage.key, artifactCount, t),
    };
  }), [artifactStageCounts, currentStageKeys, taskStageCounts, t]);

  const briefOverview = useMemo(() => getBriefOverview(researchBrief, t), [researchBrief, t]);
  const groupedTasks = useMemo(() => STAGE_DEFINITIONS.map((stage) => ({
    ...stage,
    tasks: tasks.filter((task) => getTaskStage(task) === stage.key),
  })), [tasks]);
  const groupedArtifacts = useMemo(() => STAGE_DEFINITIONS.map((stage) => ({
    ...stage,
    artifacts: artifacts.filter((artifact) => artifact.stage === stage.key),
  })), [artifacts]);
  useEffect(() => {
    setSessionTagsById((current) => {
      const next = { ...current };
      recentSessions.forEach((session: any) => {
        const sessionId = String(session.id || '');
        if (sessionId && !Object.prototype.hasOwnProperty.call(next, sessionId)) {
          next[sessionId] = Array.isArray(session.tags) ? session.tags : [];
        }
      });
      return next;
    });
  }, [recentSessions]);
  const metaStageTags = useMemo(() => {
    const byStageKey = new Map(
      (Array.isArray(projectTags) ? projectTags : [])
        .filter((tag) => tag?.tagType === 'stage')
        .map((tag) => [String(tag.tagKey || '').trim().toLowerCase(), tag]),
    );
    return STAGE_DEFINITIONS
      .map((stage) => byStageKey.get(stage.key))
      .filter((tag): tag is SessionTag => Boolean(tag));
  }, [projectTags]);
  const sessionStageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    metaStageTags.forEach((tag) => {
      counts[tag.tagKey] = 0;
    });
    recentSessions.forEach((session: any) => {
      const sessionId = String(session.id || '');
      const currentTags = sessionTagsById[sessionId] || session.tags || [];
      const stageKeys = new Set(
        (Array.isArray(currentTags) ? currentTags : [])
          .filter((tag: any) => tag?.tagType === 'stage' || tag?.type === 'stage')
          .map((tag: any) => String(tag.tagKey || '').trim().toLowerCase())
          .filter(Boolean),
      );
      stageKeys.forEach((stageKey) => {
        if (Object.prototype.hasOwnProperty.call(counts, stageKey)) {
          counts[stageKey] += 1;
        }
      });
    });
    return counts;
  }, [metaStageTags, recentSessions, sessionTagsById]);
  const referenceCount = overview ? overview.counts.references.total : 0;
  const searchRunCount = overview ? overview.counts.searchRuns.total : 0;
  const taskSummary = useMemo(() => buildMetaTaskSummary(tasks), [tasks]);
  const liveStageCount = stageCards.filter((stage) => stage.taskCount > 0 || stage.artifactCount > 0).length;
  const sourceSummary = overview?.dashboardSummary?.sources;
  const sourceCount = sourceSummary?.total ?? referenceCount;
  const sourceSearchRunCount = sourceSummary?.searchRuns ?? searchRunCount;
  const briefTitle = safeText(researchBrief?.meta?.title)
    || safeText(overview?.metaProject?.title)
    || safeText(metaProject?.title)
    || safeText(selectedProject.displayName)
    || safeText(selectedProject.name)
    || 'Meta project';
  const briefMetadata = [
    { label: t('metaProjectPreview.briefMeta.reviewType'), value: displayReviewType },
    { label: t('metaProjectPreview.briefMeta.disease'), value: safeText(overview?.metaProject?.disease || metaProject?.disease) },
    { label: t('metaProjectPreview.briefMeta.biomarker'), value: safeText(overview?.metaProject?.biomarker || metaProject?.biomarker) },
    { label: t('metaProjectPreview.briefMeta.population'), value: safeText(overview?.metaProject?.population || metaProject?.population) },
    { label: t('metaProjectPreview.briefMeta.outcome'), value: safeText(overview?.metaProject?.primary_outcome || metaProject?.primary_outcome) },
    { label: t('metaProjectPreview.briefMeta.updated'), value: formatTime(overview?.metaProject?.updated_at || metaProject?.updated_at) },
  ].filter((item) => item.value);

  const metricCards = [
    {
      icon: ListChecks,
      label: t('metaProjectPreview.metrics.tasks'),
      value: taskSummary.total,
      detail: taskSummary.total > 0
        ? t('metaProjectPreview.metrics.percentComplete', { percent: taskSummary.progress })
        : t('metaProjectPreview.metrics.noTasksYet'),
      accentClass: 'border-border/70 bg-card text-muted-foreground',
    },
    {
      icon: Target,
      label: t('metaProjectPreview.metrics.completed'),
      value: taskSummary.done,
      detail: taskSummary.inProgress > 0
        ? t('metaProjectPreview.metrics.activeNow', { count: taskSummary.inProgress })
        : t('metaProjectPreview.metrics.pendingCount', { count: taskSummary.pending }),
      accentClass: 'border-border/70 bg-card text-muted-foreground',
    },
    {
      icon: Beaker,
      label: t('metaProjectPreview.metrics.artifacts'),
      value: artifacts.length,
      detail: artifacts.length > 0
        ? t('metaProjectPreview.metrics.stagesPopulated', { count: liveStageCount })
        : t('metaProjectPreview.metrics.noOutputsYet'),
      accentClass: 'border-border/70 bg-card text-muted-foreground',
    },
    {
      icon: BookOpen,
      label: t('metaProjectPreview.metrics.sources'),
      value: sourceCount,
      detail: sourceCount > 0
        ? t('metaProjectPreview.metrics.searchRuns', { count: sourceSearchRunCount })
        : t('metaProjectPreview.metrics.noSourcesYet'),
      accentClass: 'border-border/70 bg-card text-muted-foreground',
    },
  ];
  const visibleArtifactGroups = groupedArtifacts.filter((stage) => stage.artifacts.length > 0);
  const nextTaskPrompt = nextTask?.nextActionPrompt || nextTask?.guidance?.nextActionPrompt || nextTask?.description || nextTask?.title || '';
  const projectDisplayName = metaProject?.title || selectedProject.displayName || selectedProject.name || 'Meta project';

  return (
    <div className={embedded ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto' : 'flex min-h-0 flex-1 flex-col overflow-y-auto p-4'}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
            {projectDisplayName}
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh Meta research panel"
            title="Refresh Meta research panel"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>

        <MetaTaskShortcutBar tasks={TASK_CAPSULES} onStartTask={onStartTask} t={t} />

        <section className="relative overflow-hidden rounded-xl border border-border/60 bg-card p-4 shadow-sm">
          {error ? (
            <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            {metricCards.map((metric) => (
              <MetaMetricCard key={metric.label} {...metric} compact={embedded} />
            ))}
          </div>

          <div className={`mt-3 grid gap-2 ${embedded ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-5'}`}>
            {stageCards.map((stage) => {
              return <MetaStageCard key={stage.key} stage={stage} t={t} />;
            })}
          </div>

          <div className="mt-3 rounded-xl border border-border/60 bg-card p-3.5 shadow-sm">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-base font-semibold tracking-tight text-foreground">{t('metaProjectPreview.currentAction.title')}</h4>
            </div>
            {nextTask ? (
              <div className="mt-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-semibold text-foreground">
                      {nextTask.title || t('metaProjectPreview.taskBoard.untitledTask')}
                    </div>
                    {nextTask.description ? (
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{nextTask.description}</div>
                    ) : null}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${metaTaskStatusClass(nextTask.status)}`}>
                    {metaTaskStatusLabel(t, nextTask.status)}
                  </span>
                </div>
                {nextTaskPrompt ? (
                  <button
                    type="button"
                    onClick={() => onStartTask?.(nextTaskPrompt, { ...nextTask, stage: getTaskStage(nextTask) })}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                  >
                    <Play className="h-3 w-3" />
                    {t('metaProjectPreview.taskBoard.continue')}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-border/60 bg-card px-4 py-4 text-xs leading-5 text-muted-foreground">
                {t('metaProjectPreview.currentAction.empty')}
              </div>
            )}
          </div>
        </section>

        {metaProject ? <SurveillanceSection metaProjectId={metaProject.id} /> : null}

        <MetaBriefCard
          title={briefTitle}
          metadata={briefMetadata}
          sections={briefOverview}
          defaultCollapsed={embedded}
          compact={embedded}
          t={t}
        />

        <CollapsibleMetaCard
          icon={ListChecks}
          title={t('metaProjectPreview.taskBoard.title')}
          detail={tasks.length
            ? t('metaProjectPreview.taskBoard.savedTaskCount', { count: tasks.length })
            : t('metaProjectPreview.taskBoard.capsuleEntry')}
          defaultCollapsed={embedded}
        >
          {taskActionError ? (
            <div className="mb-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {taskActionError}
            </div>
          ) : null}
          {!tasks.length ? (
            <div className="mb-3 rounded-xl border border-dashed border-border/60 bg-card p-3">
              <div className="mb-2 text-xs text-muted-foreground">
                {t('metaProjectPreview.taskBoard.emptyWithAddHint')}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            {groupedTasks.map((stage) => {
              const StageIcon = stage.icon;
              const stageTasks = stage.tasks;
              const isOpen = openStages[stage.key] ?? true;
              const stageOrdinal = getStageOrdinal(stage.key);
              const isAddingHere = (insertAfterId: string | number | null) => (
                addingToStage?.stage === stage.key
                && (insertAfterId === null
                  ? addingToStage.insertAfterId === null
                  : String(addingToStage.insertAfterId) === String(insertAfterId))
              );
              const renderInsertionPoint = (insertAfterId: string | number | null, key: string) => (
                isAddingHere(insertAfterId) ? (
                  <div key={key} className="border-b border-border bg-muted/20 px-3 py-2">
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        className="w-full rounded border border-border bg-background px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        value={addForm.title}
                        onChange={(event) => setAddForm((prev) => ({ ...prev, title: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleAddTask();
                          }
                          if (event.key === 'Escape') cancelAddTask();
                        }}
                        disabled={addingTask}
                        autoFocus
                        placeholder={t('metaProjectPreview.taskBoard.taskTitlePlaceholder')}
                      />
                      <textarea
                        className="min-h-[2.5rem] w-full resize-y rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        value={addForm.description}
                        onChange={(event) => setAddForm((prev) => ({ ...prev, description: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void handleAddTask();
                          }
                          if (event.key === 'Escape') cancelAddTask();
                        }}
                        disabled={addingTask}
                        rows={2}
                        placeholder={t('metaProjectPreview.taskBoard.taskDescriptionPlaceholder')}
                      />
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => void handleAddTask()}
                          disabled={addingTask || !addForm.title.trim()}
                        >
                          <Plus className="mr-1 h-3 w-3" />
                          {addingTask ? t('metaProjectPreview.taskBoard.adding') : t('metaProjectPreview.taskBoard.add')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={cancelAddTask}
                          disabled={addingTask}
                        >
                          {t('buttons.cancel')}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={key} className="group/insert relative h-0">
                    <button
                      type="button"
                      onClick={() => beginAddTask(stage.key, insertAfterId)}
                      className="absolute inset-x-0 -top-2 -bottom-2 z-10 flex items-center justify-center opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
                    >
                      <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-0.5 text-muted-foreground">
                        <Plus className="h-3 w-3" />
                        <span className="text-[10px]">{t('metaProjectPreview.taskBoard.insertTask')}</span>
                      </div>
                    </button>
                  </div>
                )
              );

              return (
                <div key={stage.key} className="overflow-hidden rounded-xl border border-border/60 bg-card pb-2 shadow-sm">
                  <div className="flex items-center hover:bg-muted/30">
                    <button
                      type="button"
                      onClick={() => toggleStage(stage.key)}
                      className="flex flex-1 items-center gap-2 px-3 py-2 text-left"
                    >
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      <span className="rounded-md border border-border/70 bg-card px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {stageOrdinal}
                      </span>
                      <StageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="min-w-0 truncate text-xs font-semibold text-foreground">{metaTaskStageLabel(t, stage.key)}</span>
                      <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">{stage.directories}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{stageTasks.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => beginAddTask(stage.key, null)}
                      className="mr-1.5 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title={t('metaProjectPreview.taskBoard.addTaskAtStartTitle')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {isOpen ? (
                    <div className="border-t border-border/60 bg-card">
                      {renderInsertionPoint(null, `${stage.key}-insert-top`)}
                      {stageTasks.length === 0 && !isAddingHere(null) ? (
                        <div className="mx-2 my-2 rounded-xl border border-dashed border-border/60 bg-card px-3 py-3 text-xs text-muted-foreground">
                          {t('metaProjectPreview.taskBoard.noTasksInStage')}
                        </div>
                      ) : null}
                      {stageTasks.map((task, index) => {
                      const prompt = task.nextActionPrompt || task.guidance?.nextActionPrompt || task.description || task.title || '';
                      const taskId = String(task.id ?? `${stage.key}-${index}`);
                      const taskStage = getTaskStage(task);
                      const canMutate = task.id !== undefined && task.id !== null;
                      const isEditing = editingTaskId === taskId;
                      const isSaving = savingTaskId === taskId;
                      const isUpdatingStatus = statusUpdatingTaskId === taskId;
                      return (
                        <div key={`${taskId}-${stage.key}`}>
                          <div
                            onDoubleClick={canMutate && !isEditing ? () => beginEditTask(task) : undefined}
                            className={`group mx-2 my-2 rounded-xl border px-3 py-2.5 transition-all ${
                              isEditing
                                ? 'border-foreground/30 bg-card'
                                : normalizeTaskStatus(task.status) === 'done'
                                  ? 'border-border/80 bg-card hover:border-border'
                                  : 'border-border/60 bg-card hover:border-border hover:bg-accent/30'
                            }`}
                            title={canMutate && !isEditing ? t('metaProjectPreview.taskBoard.doubleClickToEdit') : undefined}
	                          >
	                            <div className="flex items-start gap-2">
	                              <span
	                                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background/90 text-[11px] font-medium tabular-nums text-muted-foreground"
	                                title={canMutate ? String(task.id) : undefined}
	                              >
	                                {index + 1}
	                              </span>
	                              <div className="min-w-0 flex-1">
                                {isEditing ? (
                                  <div className="space-y-1.5">
                                    <input
                                      type="text"
                                      className="w-full rounded border border-border bg-background px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                      value={editForm.title}
                                      onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault();
                                          void handleSaveTask();
                                        }
                                        if (event.key === 'Escape') cancelEditTask();
                                      }}
                                      disabled={isSaving}
                                      autoFocus
                                      placeholder={t('metaProjectPreview.taskBoard.taskTitlePlaceholder')}
                                    />
                                    <textarea
                                      className="min-h-[2.5rem] w-full resize-y rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                      value={editForm.description}
                                      onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter' && !event.shiftKey) {
                                          event.preventDefault();
                                          void handleSaveTask();
                                        }
                                        if (event.key === 'Escape') cancelEditTask();
                                      }}
                                      disabled={isSaving}
                                      rows={2}
                                      placeholder={t('metaProjectPreview.taskBoard.taskDescriptionPlaceholder')}
                                    />
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <Button
                                        size="sm"
                                        className="h-6 px-2 text-[10px]"
                                        onClick={() => void handleSaveTask()}
                                        disabled={isSaving || !editForm.title.trim()}
                                      >
                                        <Check className="mr-1 h-3 w-3" />
                                        {isSaving ? t('metaProjectPreview.taskBoard.saving') : t('buttons.save')}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-[10px]"
                                        onClick={cancelEditTask}
                                        disabled={isSaving}
                                      >
                                        {t('buttons.cancel')}
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="line-clamp-2 text-sm font-semibold text-foreground">
                                      {task.title || t('metaProjectPreview.taskBoard.untitledTask')}
                                    </div>
                                    {task.description ? (
                                      <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.description}</div>
                                    ) : null}
                                    {canMutate ? (
                                      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground/80">
                                        <Pencil className="h-3 w-3" />
                                        {t('metaProjectPreview.taskBoard.editHint')}
                                      </div>
                                    ) : null}
                                    {Array.isArray(task.suggestedSkills) && task.suggestedSkills.length > 0 ? (
                                      <div className="mt-1.5 flex flex-wrap gap-1">
                                        {task.suggestedSkills.slice(0, 3).map((skill) => (
                                          <span key={`${taskId}-${skill}`} className="rounded border border-border/60 bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                            {skill}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </>
                                )}
                              </div>
                              {!isEditing ? (
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                  <div className="flex items-center gap-1">
                                    <label className="sr-only" htmlFor={`meta-task-status-${taskId}`}>
                                      {t('metaProjectPreview.taskBoard.statusSelectLabel')}
                                    </label>
                                    <select
                                      id={`meta-task-status-${taskId}`}
                                      value={normalizeTaskStatus(task.status)}
                                      onChange={(event) => void handleTaskStatusChange(task, event.target.value)}
                                      disabled={!canMutate || isUpdatingStatus}
                                      className={`h-7 rounded-lg border border-transparent px-2 text-[11px] font-medium shadow-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${metaTaskStatusClass(task.status)}`}
                                      aria-label={t('metaProjectPreview.taskBoard.markStatusAria', { id: task.id ?? '-' })}
                                    >
                                      {META_TASK_STATUS_OPTIONS.map((status) => (
                                        <option key={status} value={status}>
                                          {metaTaskStatusLabel(t, status)}
                                        </option>
                                      ))}
                                    </select>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 border border-border/70 px-2 text-[11px] hover:border-border"
                                      onClick={() => beginEditTask(task)}
                                      disabled={!canMutate}
                                    >
                                      <Pencil className="mr-1 h-3 w-3" />
                                      {t('buttons.edit')}
                                    </Button>
                                    <button
                                      type="button"
                                      onClick={() => setDeleteConfirmTask(task)}
                                      disabled={!canMutate}
                                      className="rounded p-1 text-muted-foreground opacity-100 transition-colors hover:bg-red-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-900/30 dark:hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"
                                      title={t('buttons.delete')}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                  {prompt ? (
                                    <Button
                                      size="sm"
                                      className="h-7 px-2.5 text-[11px] font-semibold"
                                      onClick={() => onStartTask?.(prompt, { ...task, stage: taskStage })}
                                    >
                                      <Sparkles className="mr-1.5 h-3 w-3" />
                                      <MessageSquare className="mr-1 h-3 w-3" />
                                      {t('metaProjectPreview.taskBoard.goToChatButton')}
                                    </Button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {renderInsertionPoint(task.id ?? null, `${stage.key}-insert-after-${taskId}`)}
                        </div>
                      );
                    })}
                  </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CollapsibleMetaCard>

        <CollapsibleMetaCard
          icon={FolderOpen}
          title="产物预览"
          detail={`${artifacts.length} 个文件 · 按阶段`}
          defaultCollapsed={embedded}
        >
          {artifacts.length ? (
            <div className="space-y-2">
              {visibleArtifactGroups.map((stage, index) => (
                <MetaStageArtifactGroup
                  key={stage.key}
                  stage={stage}
                  onFileOpen={onFileOpen}
                  defaultOpen={index === 0}
                  t={t}
                />
              ))}
            </div>
          ) : (
                <div className="rounded-xl border border-dashed border-border/60 bg-card px-3 py-4 text-xs leading-5 text-muted-foreground">
              暂无产物。运行对应阶段后，这里会按 00 文献调研、01 方案设计、02-08 正式实施、09 手稿投稿和 10 汇报推广分组展示。
            </div>
          )}
        </CollapsibleMetaCard>

        <CollapsibleMetaCard
          icon={GitBranch}
          title={t('metaProjectPreview.sessionStageLinks.title')}
          detail={t('metaProjectPreview.sessionStageLinks.detail', { count: recentSessions.length })}
          defaultCollapsed={embedded}
        >
          {recentSessions.length ? (
            <div className="space-y-3">
              {metaStageTags.length ? (
                <div className={`grid gap-1.5 ${embedded ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-5'}`}>
                  {metaStageTags.map((tag) => {
                    const stageKey = getTagStageKey(tag);
                    return (
                      <div key={`summary-${tag.id}`} className="rounded-xl border border-border/60 bg-card px-2.5 py-2 shadow-sm">
                        <div className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${META_TASK_STATUS_CLASSES['in-progress']}`}>
                          <span className="truncate">{metaTaskStageLabel(t, stageKey)}</span>
                        </div>
                        <div className="mt-1 text-sm font-semibold text-foreground">{sessionStageCounts[tag.tagKey] || 0}</div>
                        <div className="text-[10px] text-muted-foreground">{t('metaProjectPreview.sessionStageLinks.linkedSessions')}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 bg-card px-3 py-3 text-xs leading-5 text-muted-foreground">
                  {t('metaProjectPreview.sessionStageLinks.noStages')}
                </div>
              )}
              {recentSessions.map((session: any) => {
                const sessionId = String(session.id || '');
                const tags = sessionTagsById[sessionId] || session.tags || [];
                const stageTags = tags.filter((tag: any) => tag?.tagType === 'stage' || tag?.type === 'stage');
                const metaSessionStageTags = stageTags.filter((tag: any) => META_STAGE_KEYS.includes(String(tag.tagKey || '').trim().toLowerCase() as MetaStageKey));
                const selectedStageTagIds = new Set(metaSessionStageTags.map((tag: any) => tag.id));
                const label = getSessionDisplayName(session);
                const isSaving = savingSessionId === sessionId;
                return (
                  <div key={`${session.provider}-${session.id}`} className="rounded-xl border border-border/60 bg-card px-2.5 py-2 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground">{label}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span>{session.provider}</span>
                          {formatTime(session.lastActivity || session.last_activity || session.updatedAt) ? <span>{formatTime(session.lastActivity || session.last_activity || session.updatedAt)}</span> : null}
                        </div>
                      </div>
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {metaStageTags.map((tag) => {
                        const stageKey = getTagStageKey(tag);
                        const selected = selectedStageTagIds.has(tag.id);
                        return (
                          <button
                            key={`${sessionId}-${tag.id}`}
                            type="button"
                            onClick={() => void handleToggleSessionStageTag(session, tag)}
                            disabled={isSaving}
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                              selected
                                ? 'border-border bg-accent text-foreground'
                                : 'border-border/70 bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground'
                            } ${isSaving ? 'cursor-wait opacity-70' : ''}`}
                          >
                            {metaTaskStageLabel(t, stageKey)}
                          </button>
                        );
                      })}
                      {!metaSessionStageTags.length ? (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t('metaProjectPreview.sessionStageLinks.noStageTagsYet')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 bg-card px-3 py-4 text-xs leading-5 text-muted-foreground">
              {t('metaProjectPreview.sessionStageLinks.noSessions')}
            </div>
          )}
        </CollapsibleMetaCard>
      </div>

      {deleteConfirmTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="mb-1 text-base font-semibold text-foreground">
                    {t('metaProjectPreview.taskBoard.deleteModalTitle')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('metaProjectPreview.taskBoard.deleteModalBody', {
                      id: deleteConfirmTask.id ?? '-',
                      title: deleteConfirmTask.title || '',
                    })}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('metaProjectPreview.taskBoard.deleteModalWarning')}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-3 border-t border-border bg-muted/30 p-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDeleteConfirmTask(null)}
                disabled={deletingTaskId === String(deleteConfirmTask.id)}
              >
                {t('buttons.cancel')}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => void handleDeleteTask()}
                disabled={deletingTaskId === String(deleteConfirmTask.id)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                {deletingTaskId === String(deleteConfirmTask.id)
                  ? t('metaProjectPreview.taskBoard.deleting')
                  : t('buttons.delete')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
