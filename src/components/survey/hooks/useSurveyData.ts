import { useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import { PROJECT_FILE_MOVED_EVENT } from '../../../utils/projectFileEvents';
import type { Project } from '../../../types/app';

type ProjectFileNode = {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  children?: ProjectFileNode[];
};

export type SurveyFileCategory = 'papers' | 'reports' | 'graphs' | 'notes';
export type SurveyPreviewKind = 'pdf' | 'markdown' | 'json' | 'text' | 'html' | 'mermaid' | 'unsupported';

export type SurveyFile = {
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  extension: string;
  category: SurveyFileCategory;
  previewKind: SurveyPreviewKind;
};

export type SurveyTask = {
  id: string | number;
  title: string;
  description: string;
  status: string;
  stage: string;
};

type UseSurveyDataResult = {
  papers: SurveyFile[];
  reports: SurveyFile[];
  graphs: SurveyFile[];
  notes: SurveyFile[];
  stageFiles: SurveyFile[];
  tasks: SurveyTask[];
  loading: boolean;
  error: string | null;
  refreshToken: number;
  refresh: () => void;
};

export const SURVEY_STAGE_SCAN_ROOTS = [
  '00_literature/',
  '01_protocol/',
  '02_search_dedupe/',
  '03_title_abstract_screening/',
  '04_full_text_review/',
  '05_data_extraction/',
  '06_quality_assessment/',
  '07_data_analysis/',
  '08_results_figures/',
  '09_manuscript_submission/',
  '10_presentation/',
] as const;
export const SURVEY_STAGE_FILE_EXTENSIONS = [
  '.pdf',
  '.html',
  '.htm',
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.tsv',
  '.doc',
  '.docx',
  '.rtf',
  '.odt',
  '.xls',
  '.xlsx',
  '.ods',
] as const;
export const SURVEY_REFERENCE_SCAN_ROOTS = ['04_full_text_review/fulltext/'] as const;
export const SURVEY_PAPER_SCAN_ROOTS = ['09_manuscript_submission/'] as const;
export const SURVEY_REPORT_SCAN_ROOTS = ['00_literature/'] as const;
export const SURVEY_GRAPH_SCAN_ROOTS = ['08_results_figures/'] as const;
export const SURVEY_NOTE_SCAN_ROOTS = ['04_full_text_review/'] as const;
const SURVEY_ROOTS = Array.from(new Set([
  ...SURVEY_PAPER_SCAN_ROOTS,
  ...SURVEY_REPORT_SCAN_ROOTS,
  ...SURVEY_GRAPH_SCAN_ROOTS,
  ...SURVEY_NOTE_SCAN_ROOTS,
]));
const SURVEY_REFERENCE_ROOTS = [...SURVEY_REFERENCE_SCAN_ROOTS];
const LOWER_SURVEY_REFERENCE_ROOTS = SURVEY_REFERENCE_ROOTS.map((root) => root.toLowerCase());
const GENERATED_REFERENCE_ARTIFACT_FILES = new Set(['metadata.json', 'note.md', 'extract.txt']);
const TEXT_PREVIEW_EXTENSIONS = new Set(['.txt', '.csv', '.tsv']);
const DOCUMENT_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.rtf',
  '.odt',
  '.xls',
  '.xlsx',
  '.ods',
]);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const SURVEY_READABLE_EXTENSIONS = new Set([
  '.pdf',
  ...HTML_EXTENSIONS,
  ...MARKDOWN_EXTENSIONS,
  ...TEXT_PREVIEW_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
]);
const GRAPH_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.mmd', '.mermaid', '.html', '.htm']);
const STAGE_FILE_EXTENSIONS = new Set<string>(SURVEY_STAGE_FILE_EXTENSIONS);
const FINAL_PAPER_EXTENSIONS = new Set(['.pdf', '.html', '.htm', '.md', '.markdown', '.doc', '.docx']);

function toRelativePath(absolutePath: string, projectRoot: string) {
  const normalizedPath = absolutePath.replace(/\\/g, '/').trim();
  const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');

  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath.replace(/^\/+/, '');
}

function isGeneratedReferenceArtifactFile(fileName: string, normalizedRelativePath: string, siblingNames: Set<string>) {
  const normalizedFileName = fileName.toLowerCase();

  const lowerRelativePath = normalizedRelativePath.toLowerCase();
  const isReferenceArtifactPath = LOWER_SURVEY_REFERENCE_ROOTS.some((root) => lowerRelativePath.startsWith(root));
  if (!isReferenceArtifactPath) {
    return false;
  }

  if (GENERATED_REFERENCE_ARTIFACT_FILES.has(normalizedFileName)) {
    return siblingNames.has('metadata.json');
  }

  return normalizedFileName === 'paper.pdf'
    && siblingNames.has('metadata.json')
    && siblingNames.has('extract.txt');
}

function startsWithAnyRoot(relativePath: string, roots: readonly string[]) {
  return roots.some((root) => relativePath.startsWith(root));
}

function getPreviewKind(extension: string): SurveyPreviewKind {
  if (extension === '.pdf') {
    return 'pdf';
  }
  if (HTML_EXTENSIONS.has(extension)) {
    return 'html';
  }
  if (extension === '.mmd' || extension === '.mermaid') {
    return 'mermaid';
  }
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return 'markdown';
  }
  if (TEXT_PREVIEW_EXTENSIONS.has(extension)) {
    return 'text';
  }
  return 'unsupported';
}

export function flattenSurveyFiles(nodes: ProjectFileNode[], projectRoot: string): SurveyFile[] {
  const files: SurveyFile[] = [];

  const visit = (items: ProjectFileNode[]) => {
    const siblingNames = new Set(items.map((item) => item.name.toLowerCase()));

    items.forEach((item) => {
      if (item.type === 'directory' && Array.isArray(item.children)) {
        visit(item.children);
        return;
      }

      if (item.type !== 'file' || !item.path) {
        return;
      }

      const relativePath = toRelativePath(item.path, projectRoot);
      const normalizedRelativePath = relativePath.replace(/\\/g, '/');

      if (isGeneratedReferenceArtifactFile(item.name, normalizedRelativePath, siblingNames)) {
        return;
      }

      const isSurveyRoot = startsWithAnyRoot(normalizedRelativePath, SURVEY_ROOTS);
      const isSurveyReferenceRoot = startsWithAnyRoot(normalizedRelativePath, SURVEY_REFERENCE_ROOTS);

      if (!isSurveyRoot && !isSurveyReferenceRoot) {
        return;
      }

      const extensionMatch = item.name.match(/(\.[^.]+)$/);
      const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
      const lowerRelativePath = normalizedRelativePath.toLowerCase();
      const isPaperRoot = startsWithAnyRoot(normalizedRelativePath, SURVEY_PAPER_SCAN_ROOTS);
      const isReportRoot = startsWithAnyRoot(normalizedRelativePath, SURVEY_REPORT_SCAN_ROOTS);
      const isGraphRoot = startsWithAnyRoot(normalizedRelativePath, SURVEY_GRAPH_SCAN_ROOTS);
      const isNoteRoot = startsWithAnyRoot(normalizedRelativePath, SURVEY_NOTE_SCAN_ROOTS);
      const isGraph = GRAPH_EXTENSIONS.has(extension)
        && isGraphRoot
        && /(graph|network|citation|knowledge-map|literature-map|relations|mermaid)/.test(lowerRelativePath);
      const isReadableFile = SURVEY_READABLE_EXTENSIONS.has(extension);

      let category: SurveyFileCategory = 'notes';
      if (isGraph) {
        category = 'graphs';
      } else if (isPaperRoot && FINAL_PAPER_EXTENSIONS.has(extension)) {
        category = 'papers';
      } else if (isReportRoot && isReadableFile) {
        category = 'reports';
      } else if (isNoteRoot && isReadableFile) {
        category = 'notes';
      } else {
        return;
      }

      files.push({
        id: normalizedRelativePath,
        name: item.name,
        absolutePath: item.path,
        relativePath: normalizedRelativePath,
        extension,
        category,
        previewKind: getPreviewKind(extension),
      });
    });
  };

  visit(nodes);

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function flattenStageFiles(nodes: ProjectFileNode[], projectRoot: string): SurveyFile[] {
  const files: SurveyFile[] = [];

  const visit = (items: ProjectFileNode[]) => {
    const siblingNames = new Set(items.map((item) => item.name.toLowerCase()));

    items.forEach((item) => {
      if (item.type === 'directory' && Array.isArray(item.children)) {
        visit(item.children);
        return;
      }

      if (item.type !== 'file' || !item.path) {
        return;
      }

      const relativePath = toRelativePath(item.path, projectRoot);
      const normalizedRelativePath = relativePath.replace(/\\/g, '/');
      if (!startsWithAnyRoot(normalizedRelativePath, SURVEY_STAGE_SCAN_ROOTS)) {
        return;
      }

      if (isGeneratedReferenceArtifactFile(item.name, normalizedRelativePath, siblingNames)) {
        return;
      }

      const extensionMatch = item.name.match(/(\.[^.]+)$/);
      const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
      if (!STAGE_FILE_EXTENSIONS.has(extension)) {
        return;
      }

      files.push({
        id: `stage:${normalizedRelativePath}`,
        name: item.name,
        absolutePath: item.path,
        relativePath: normalizedRelativePath,
        extension,
        category: 'notes',
        previewKind: getPreviewKind(extension),
      });
    });
  };

  visit(nodes);

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function normalizeTask(rawTask: Record<string, unknown>): SurveyTask | null {
  const rawStage = String(rawTask.stage ?? rawTask.section ?? rawTask.phase ?? '').trim().toLowerCase();
  const title = String(rawTask.title ?? rawTask.name ?? '').trim();
  const description = String(rawTask.description ?? rawTask.details ?? '').trim();
  const status = String(rawTask.status ?? 'pending').trim();
  const inferredStage = rawStage
    || (/(survey|literature|reference|paper review|prior work)/i.test(`${title} ${description}`) ? 'literature' : '');

  if (!title || !['literature', 'survey'].includes(inferredStage)) {
    return null;
  }

  return {
    id: String(rawTask.id ?? title),
    title,
    description,
    status,
    stage: inferredStage === 'survey' ? 'literature' : inferredStage,
  };
}

export function useSurveyData(selectedProject: Project | null): UseSurveyDataResult {
  const [papers, setPapers] = useState<SurveyFile[]>([]);
  const [reports, setReports] = useState<SurveyFile[]>([]);
  const [graphs, setGraphs] = useState<SurveyFile[]>([]);
  const [notes, setNotes] = useState<SurveyFile[]>([]);
  const [stageFiles, setStageFiles] = useState<SurveyFile[]>([]);
  const [tasks, setTasks] = useState<SurveyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !selectedProject?.name) {
      return undefined;
    }

    const handleProjectFileMoved = (event: Event) => {
      const detail = (event as CustomEvent<{ projectName?: string }>).detail;
      if (detail?.projectName !== selectedProject.name) {
        return;
      }

      setRefreshToken((current) => current + 1);
    };

    window.addEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileMoved);
    return () => window.removeEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileMoved);
  }, [selectedProject?.name]);

  useEffect(() => {
    const projectName = selectedProject?.name;
    const projectRoot = selectedProject?.path || selectedProject?.fullPath;

    if (!projectName || !projectRoot) {
      setPapers([]);
      setReports([]);
      setGraphs([]);
      setNotes([]);
      setStageFiles([]);
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }

    const abortController = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const [filesResponse, tasksResponse] = await Promise.all([
          api.getFiles(projectName, { signal: abortController.signal }),
          api.get(`/taskmaster/tasks/${encodeURIComponent(projectName)}`),
        ]);

        if (!filesResponse.ok) {
          throw new Error(`files:${filesResponse.status}`);
        }

        const projectTree = (await filesResponse.json()) as ProjectFileNode[];
        const surveyFiles = flattenSurveyFiles(projectTree, projectRoot);
        const scannedStageFiles = flattenStageFiles(projectTree, projectRoot);

        setPapers(surveyFiles.filter((file) => file.category === 'papers'));
        setReports(surveyFiles.filter((file) => file.category === 'reports'));
        setGraphs(surveyFiles.filter((file) => file.category === 'graphs'));
        setNotes(surveyFiles.filter((file) => file.category === 'notes'));
        setStageFiles(scannedStageFiles);

        if (tasksResponse.ok) {
          const taskPayload = await tasksResponse.json();
          const surveyTasks = Array.isArray(taskPayload?.tasks)
            ? taskPayload.tasks
                .map((task: Record<string, unknown>) => normalizeTask(task))
                .filter(Boolean) as SurveyTask[]
            : [];
          setTasks(surveyTasks);
        } else {
          setTasks([]);
        }
      } catch (loadError) {
        if ((loadError as { name?: string }).name === 'AbortError') {
          return;
        }

        console.error('Failed to load survey data:', loadError);
        setError('load-failed');
        setPapers([]);
        setReports([]);
        setGraphs([]);
        setNotes([]);
        setStageFiles([]);
        setTasks([]);
      } finally {
        setLoading(false);
      }
    };

    void load();

    return () => {
      abortController.abort();
    };
  }, [refreshToken, selectedProject?.fullPath, selectedProject?.name, selectedProject?.path]);

  return {
    papers,
    reports,
    graphs,
    notes,
    stageFiles,
    tasks,
    loading,
    error,
    refreshToken,
    refresh: () => setRefreshToken((current) => current + 1),
  };
}
