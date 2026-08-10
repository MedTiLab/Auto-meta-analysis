import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Loader2,
  Network,
  NotebookText,
  RefreshCw,
  Search,
} from 'lucide-react';

import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { cn } from '../../../lib/utils';
import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import {
  useSurveyData,
  type SurveyFile,
  type SurveyTask,
} from '../hooks/useSurveyData';
import MermaidDiagramViewer from './MermaidDiagramViewer';
import { saveSurveyDiagramSource } from '../utils/diagramWindow';
import ReferencesPanel from '../../references/view/ReferencesPanel';
import type { Reference } from '../../references/types';

type SurveyPageProps = {
  selectedProject: Project;
  onChatFromReference?: (ref: Reference) => void;
};

const RIGHT_SIDEBAR_WIDTH = 480;

type SelectedItem =
  | { type: 'file'; value: SurveyFile }
  | { type: 'task'; value: SurveyTask }
  | null;

type PreviewState = {
  loading: boolean;
  content: string | null;
  pdfUrl: string | null;
  mermaidSvg: string | null;
  error: string | null;
};

const SECTION_META = {
  papers: { icon: BookOpen },
  reports: { icon: FileText },
  graphs: { icon: Network },
  notes: { icon: NotebookText },
} as const;

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof BookOpen;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-1.5 text-muted-foreground shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function CollapsiblePanel({
  title,
  badge,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  badge?: string | number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted/30"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-muted-foreground/50" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-xs font-semibold text-foreground">{title}</h3>
              {badge !== undefined ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{badge}</Badge> : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>{collapsed ? t('surveyPage.actions.expand') : t('surveyPage.actions.collapse')}</span>
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>
      {!collapsed ? <div className="border-t border-border/40">{children}</div> : null}
    </div>
  );
}

function SurveySection({
  sectionKey,
  title,
  files,
  selectedItem,
  onSelect,
  emptyLabel,
  filter,
  collapsed,
  onToggle,
}: {
  sectionKey: keyof typeof SECTION_META;
  title: string;
  files: SurveyFile[];
  selectedItem: SelectedItem;
  onSelect: (item: SelectedItem) => void;
  emptyLabel: string;
  filter: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('common');
  const filteredFiles = files.filter((file) => {
    if (!filter) {
      return true;
    }

    const haystack = `${file.name} ${file.relativePath}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  const Icon = SECTION_META[sectionKey].icon;

  return (
    <div className="rounded-lg border border-border/50 bg-card shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/30"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-md border border-border/50 bg-card p-1 text-muted-foreground">
            <Icon className="h-3 w-3" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-xs font-semibold text-foreground">{title}</h3>
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{filteredFiles.length}</Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>{collapsed ? t('surveyPage.actions.expand') : t('surveyPage.actions.collapse')}</span>
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>
      {!collapsed ? (
        <div className="border-t border-border/40 p-1.5">
          {filteredFiles.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 px-2 py-4 text-center text-xs text-muted-foreground">
              {emptyLabel}
            </div>
          ) : (
            filteredFiles.map((file) => {
              const isSelected = selectedItem?.type === 'file' && selectedItem.value.id === file.id;
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => onSelect({ type: 'file', value: file })}
                  className={cn(
                    'mb-1 flex w-full items-start justify-between rounded-md border px-2 py-1.5 text-left transition-colors last:mb-0',
                    isSelected
                      ? 'border-foreground/30 bg-accent'
                      : 'border-transparent bg-card hover:border-border/60 hover:bg-accent/60',
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-foreground">{file.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{file.relativePath}</div>
                  </div>
                  <Badge variant="secondary" className="ml-2 shrink-0 px-1.5 py-0 text-[10px] uppercase">
                    {file.extension.replace('.', '') || 'file'}
                  </Badge>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function StageFileList({
  files,
  selectedItem,
  onSelect,
  filter,
  emptyLabel,
}: {
  files: SurveyFile[];
  selectedItem: SelectedItem;
  onSelect: (item: SelectedItem) => void;
  filter: string;
  emptyLabel: string;
}) {
  const filteredFiles = files.filter((file) => {
    if (!filter) {
      return true;
    }

    const haystack = `${file.name} ${file.relativePath}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  if (filteredFiles.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-2 py-4 text-center text-xs text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {filteredFiles.map((file) => {
        const isSelected = selectedItem?.type === 'file' && selectedItem.value.id === file.id;
        return (
          <button
            key={file.id}
            type="button"
            onClick={() => onSelect({ type: 'file', value: file })}
            className={cn(
              'flex w-full items-start justify-between rounded-md border px-2 py-1.5 text-left transition-colors',
              isSelected
                ? 'border-foreground/30 bg-accent'
                : 'border-transparent bg-card hover:border-border/60 hover:bg-accent/60',
            )}
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">{file.name}</div>
              <div className="truncate text-[10px] text-muted-foreground">{file.relativePath}</div>
            </div>
            <Badge variant="secondary" className="ml-2 shrink-0 px-1.5 py-0 text-[10px] uppercase">
              {file.extension.replace('.', '') || 'file'}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}

function PreviewContent({
  file,
  preview,
  onOpenMermaidWindow,
}: {
  file: SurveyFile;
  preview: PreviewState;
  onOpenMermaidWindow: () => void;
}) {
  const { t } = useTranslation('common');

  return (
    <>
      {file.previewKind === 'pdf' && preview.pdfUrl ? (
        <iframe
          title={file.name}
          src={preview.pdfUrl}
          className="h-full w-full rounded-xl border border-border/50 bg-background shadow-sm"
        />
      ) : null}

      {preview.mermaidSvg ? (
        <MermaidDiagramViewer svg={preview.mermaidSvg} onOpenInWindow={onOpenMermaidWindow} />
      ) : null}

      {file.previewKind === 'html' && preview.content ? (
        <iframe
          title={file.name}
          srcDoc={preview.content}
          sandbox="allow-scripts allow-same-origin"
          className="h-full w-full rounded-xl border border-border/50 bg-white shadow-sm"
        />
      ) : null}

      {file.previewKind === 'markdown' && preview.content ? (
        <div className="prose prose-sm max-w-none rounded-xl border border-border/50 bg-background/60 p-6 shadow-sm dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content}</ReactMarkdown>
        </div>
      ) : null}

      {(file.previewKind === 'json' || file.previewKind === 'text') && preview.content ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-background/80 p-5 text-sm text-foreground shadow-sm">
          {preview.content}
        </pre>
      ) : null}

      {file.previewKind === 'unsupported' ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
          {t('surveyPage.preview.unsupported')}
        </div>
      ) : null}
    </>
  );
}

function TaskPreview({ task }: { task: SurveyTask }) {
  const { t } = useTranslation('common');

  return (
    <div className="rounded-xl border border-border/50 bg-card">
      <div className="border-b border-border/40 px-5 py-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{task.title}</h3>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline">{t('surveyPage.preview.surveyTask')}</Badge>
          <Badge variant="secondary">{task.status || 'pending'}</Badge>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <div>
          <div className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {t('surveyPage.preview.taskDescription')}
          </div>
          <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
            {task.description || t('surveyPage.empty.noTaskDescription')}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SurveyPage({ selectedProject, onChatFromReference }: SurveyPageProps) {
  const { t } = useTranslation('common');
  const { papers, reports, graphs, notes, stageFiles, tasks, loading, error, refresh } = useSurveyData(selectedProject);
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [preview, setPreview] = useState<PreviewState>({
    loading: false,
    content: null,
    pdfUrl: null,
    mermaidSvg: null,
    error: null,
  });
  const [filter, setFilter] = useState('');
  const [collapsedPanels, setCollapsedPanels] = useState({
    tasks: true,
    library: true,
    references: true,
  });
  const [collapsedSections, setCollapsedSections] = useState({
    papers: false,
    reports: false,
    graphs: false,
    notes: false,
  });

  const togglePanel = (panel: keyof typeof collapsedPanels) => {
    setCollapsedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  };

  const toggleSection = (section: keyof typeof collapsedSections) => {
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const handleSelectItem = (item: SelectedItem) => {
    setSelectedItem(item);
  };

  const handleOpenMermaidWindow = () => {
    if (!preview.content) {
      return;
    }

    const mermaidSource = extractMermaidSource(preview.content);
    if (!mermaidSource) {
      return;
    }

    const diagramId = saveSurveyDiagramSource(mermaidSource);
    const basename = window.__ROUTER_BASENAME__ || '';
    window.open(`${basename}/survey/diagram?diagramId=${encodeURIComponent(diagramId)}`, '_blank', 'noopener,noreferrer,width=1600,height=1000');
  };

  useEffect(() => {
    const availableFiles = [...papers, ...reports, ...graphs, ...notes, ...stageFiles];

    if (selectedItem?.type === 'file') {
      const stillExists = availableFiles.some((file) => file.id === selectedItem.value.id);
      if (stillExists) {
        return;
      }
    }

    if (selectedItem?.type === 'task') {
      const stillExists = tasks.some((task) => task.id === selectedItem.value.id);
      if (stillExists) {
        return;
      }
    }

    if (availableFiles.length > 0) {
      setSelectedItem({ type: 'file', value: availableFiles[0] });
      return;
    }

    if (tasks.length > 0) {
      setSelectedItem({ type: 'task', value: tasks[0] });
      return;
    }

    setSelectedItem(null);
  }, [graphs, notes, papers, reports, selectedItem, stageFiles, tasks]);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let isCancelled = false;

    const loadPreview = async () => {
      if (!selectedItem || selectedItem.type !== 'file') {
        setPreview({ loading: false, content: null, pdfUrl: null, mermaidSvg: null, error: null });
        return;
      }

      const file = selectedItem.value;
      if (file.previewKind === 'unsupported') {
        setPreview({ loading: false, content: null, pdfUrl: null, mermaidSvg: null, error: null });
        return;
      }

      setPreview({ loading: true, content: null, pdfUrl: null, mermaidSvg: null, error: null });

      try {
        if (file.previewKind === 'pdf') {
          const blob = await api.getFileContentBlob(selectedProject.name, file.absolutePath);
          if (isCancelled) {
            return;
          }

          revokedUrl = URL.createObjectURL(blob);
          setPreview({ loading: false, content: null, pdfUrl: revokedUrl, mermaidSvg: null, error: null });
          return;
        }

        const response = await api.readFile(selectedProject.name, file.relativePath);
        if (!response.ok) {
          throw new Error(`preview:${response.status}`);
        }

        const payload = await response.json();
        const rawContent = String(payload?.content ?? '');
        const mermaidSource = extractMermaidSource(rawContent);

        if (mermaidSource) {
          const mermaid = (await import('mermaid')).default;
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
          });

          const renderId = `survey-mermaid-${Date.now().toString(36)}`;
          const { svg } = await mermaid.render(renderId, mermaidSource);
          if (!isCancelled) {
            setPreview({
              loading: false,
              content: rawContent,
              pdfUrl: null,
              mermaidSvg: svg,
              error: null,
            });
          }
          return;
        }

        let content = rawContent;
        if (file.previewKind === 'json') {
          try {
            content = JSON.stringify(JSON.parse(rawContent), null, 2);
          } catch {
            content = rawContent;
          }
        }

        setPreview({ loading: false, content, pdfUrl: null, mermaidSvg: null, error: null });
      } catch (previewError) {
        const message = previewError instanceof Error ? previewError.message : '';
        const isNotFound = message.includes('preview:404') || message === 'Not found';
        const isForbidden = message.includes('preview:403');
        if (isNotFound || isForbidden) {
          console.warn('Survey preview unavailable:', message);
        } else {
          console.warn('Failed to load survey preview:', previewError);
        }

        if (!isCancelled) {
          const errorType = isNotFound ? 'not-found' : isForbidden ? 'forbidden' : 'preview-failed';
          setPreview({ loading: false, content: null, pdfUrl: null, mermaidSvg: null, error: errorType });
        }
      }
    };

    void loadPreview();

    return () => {
      isCancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [selectedItem, selectedProject.name]);

  const sections = [
    { key: 'papers', title: t('surveyPage.sections.papers'), files: papers },
    { key: 'reports', title: t('surveyPage.sections.reports'), files: reports },
    { key: 'graphs', title: t('surveyPage.sections.graphs'), files: graphs },
    { key: 'notes', title: t('surveyPage.sections.notes'), files: notes },
  ] as const;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-auto p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('surveyPage.loading')}
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground">
              <AlertCircle className="mr-2 h-4 w-4" />
              {t('surveyPage.errors.loadFailed')}
            </div>
          ) : !selectedItem ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/60 bg-card px-6 text-center text-sm text-muted-foreground">
              {t('surveyPage.empty.noSelection')}
            </div>
          ) : selectedItem.type === 'task' ? (
            <TaskPreview task={selectedItem.value} />
          ) : preview.loading ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('surveyPage.preview.loading')}
            </div>
          ) : preview.error ? (
            <div className={`flex h-full items-center justify-center rounded-xl border px-6 text-center text-sm ${
              preview.error === 'not-found' || preview.error === 'forbidden'
                ? 'border-muted-foreground/20 bg-card text-muted-foreground'
                : 'border-border/60 bg-card text-muted-foreground'
            }`}>
              <AlertCircle className="mr-2 h-4 w-4" />
              {preview.error === 'not-found'
                ? t('surveyPage.preview.notFound')
                : preview.error === 'forbidden'
                  ? t('surveyPage.preview.forbidden')
                  : t('surveyPage.preview.failed')}
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="min-h-0 flex-1">
                <PreviewContent
                  file={selectedItem.value}
                  preview={preview}
                  onOpenMermaidWindow={handleOpenMermaidWindow}
                />
              </div>
            </div>
          )}
        </div>

        <div
          className="w-px shrink-0 bg-border/70"
          aria-hidden="true"
        />

        <div style={{ width: RIGHT_SIDEBAR_WIDTH }} className="shrink-0 flex flex-col overflow-hidden bg-card">
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('surveyPage.filterPlaceholder')}
                className="h-8 bg-background pl-8 pr-9 text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={refresh}
                aria-label={t('refresh')}
                className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SummaryCard label={t('surveyPage.summary.papers')} value={papers.length} icon={BookOpen} />
              <SummaryCard label={t('surveyPage.summary.reports')} value={reports.length} icon={FileText} />
              <SummaryCard label={t('surveyPage.summary.graphs')} value={graphs.length} icon={Network} />
              <SummaryCard label={t('surveyPage.summary.tasks')} value={tasks.length + stageFiles.length} icon={ClipboardList} />
            </div>

            <CollapsiblePanel
              title={t('surveyPage.sections.references')}
              collapsed={collapsedPanels.references}
              onToggle={() => togglePanel('references')}
            >
              <div className="p-2">
                <ReferencesPanel
                  projectName={selectedProject.name}
                  onChatFromReference={onChatFromReference}
                />
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel
              title={t('surveyPage.sections.tasks')}
              badge={tasks.length + stageFiles.length}
              collapsed={collapsedPanels.tasks}
              onToggle={() => togglePanel('tasks')}
            >
              <div className="space-y-2 p-1.5">
                <div className="flex items-center justify-between px-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <span>{t('surveyPage.labels.stageFiles')}</span>
                  <span>{stageFiles.length}</span>
                </div>
                <StageFileList
                  files={stageFiles}
                  selectedItem={selectedItem}
                  onSelect={handleSelectItem}
                  filter={filter}
                  emptyLabel={t('surveyPage.empty.noStageFiles')}
                />
                <div className="flex items-center justify-between px-1 pt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <span>{t('surveyPage.labels.taskList')}</span>
                  <span>{tasks.length}</span>
                </div>
                {tasks.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/60 px-2 py-4 text-center text-xs text-muted-foreground">
                    {t('surveyPage.empty.noTasks')}
                  </div>
                ) : (
                  tasks.map((task) => {
                    const isSelected = selectedItem?.type === 'task' && selectedItem.value.id === task.id;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => handleSelectItem({ type: 'task', value: task })}
                        className={cn(
                          'mb-1 w-full rounded-lg border px-2 py-2 text-left transition-colors last:mb-0',
                          isSelected
                            ? 'border-foreground/30 bg-accent shadow-sm'
                            : 'border-transparent bg-card hover:border-border/60 hover:bg-accent/60',
                        )}
                      >
                        <div className="text-xs font-medium text-foreground">{task.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                          {task.description || t('surveyPage.empty.noTaskDescription')}
                        </div>
                        <Badge variant="secondary" className="mt-1.5 px-1.5 py-0 text-[10px]">
                          {task.status || 'pending'}
                        </Badge>
                      </button>
                    );
                  })
                )}
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel
              title={t('surveyPage.labels.library')}
              badge={papers.length + reports.length + graphs.length + notes.length}
              collapsed={collapsedPanels.library}
              onToggle={() => togglePanel('library')}
            >
              <div className="space-y-2 p-2">
                {sections.map((section) => (
                  <SurveySection
                    key={section.key}
                    sectionKey={section.key}
                    title={section.title}
                    files={section.files}
                    selectedItem={selectedItem}
                    onSelect={handleSelectItem}
                    emptyLabel={t('surveyPage.empty.noSectionFiles', { section: section.title.toLowerCase() })}
                    filter={filter}
                    collapsed={collapsedSections[section.key]}
                    onToggle={() => toggleSection(section.key)}
                  />
                ))}
                {papers.length + reports.length + graphs.length + notes.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                    {t('surveyPage.empty.noSurveyFiles')}
                  </div>
                ) : null}
              </div>
            </CollapsiblePanel>

          </div>
        </div>
      </div>
    </div>
  );
}

function extractMermaidSource(rawContent: string) {
  const fencedMatch = rawContent.match(/```mermaid\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]?.trim()) {
    return fencedMatch[1].trim();
  }

  if (/^\s*(graph|flowchart|mindmap|timeline|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|requirementDiagram)\b/m.test(rawContent)) {
    return rawContent.trim();
  }

  return null;
}
