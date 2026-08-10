import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Project } from '../../../../types/app';
import { api } from '../../../../utils/api';
import {
  PROJECT_FILES_CHANGED_EVENT,
  type ProjectFilesChangedDetail,
} from '../../../../utils/projectFileEvents';
import {
  collectMetaWorkflowFolderStatuses,
  type MetaWorkflowFolderStatus,
} from '../../../../utils/metaWorkflowFolderStatus';
import { cn } from '../../../../lib/utils';

const FOLDER_LABEL_KEYS: Record<MetaWorkflowFolderStatus['name'], string> = {
  '00_literature': 'workflowFolders.labels.00_literature',
  '01_protocol': 'workflowFolders.labels.01_protocol',
  '02_search_dedupe': 'workflowFolders.labels.02_search_dedupe',
  '03_title_abstract_screening': 'workflowFolders.labels.03_title_abstract_screening',
  '04_full_text_review': 'workflowFolders.labels.04_full_text_review',
  '05_data_extraction': 'workflowFolders.labels.05_data_extraction',
  '06_quality_assessment': 'workflowFolders.labels.06_quality_assessment',
  '07_data_analysis': 'workflowFolders.labels.07_data_analysis',
  '08_results_figures': 'workflowFolders.labels.08_results_figures',
  '09_manuscript_submission': 'workflowFolders.labels.09_manuscript_submission',
  '10_presentation': 'workflowFolders.labels.10_presentation',
};

const COMPLETION_MESSAGE_TYPES = new Set([
  'projects_updated',
  'claude-complete',
]);

type MetaWorkflowStatusBarProps = {
  selectedProject: Project;
  latestMessage?: { type?: unknown; phase?: unknown } | null;
  reserveTrailingControl?: boolean;
};

export default function MetaWorkflowStatusBar({
  selectedProject,
  latestMessage,
  reserveTrailingControl = false,
}: MetaWorkflowStatusBarProps) {
  const { t } = useTranslation('common');
  const [folders, setFolders] = useState<MetaWorkflowFolderStatus[]>([]);

  const loadStatuses = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await api.getFiles(selectedProject.name, {
        maxDepth: 10,
        showHidden: false,
        signal,
      });
      const tree = response?.ok ? await response.json().catch(() => []) : [];
      if (signal?.aborted) {
        return;
      }
      setFolders(collectMetaWorkflowFolderStatuses(Array.isArray(tree) ? tree : []));
    } catch (error) {
      if (!signal?.aborted) {
        console.warn('Failed to load Meta workflow folder status:', error);
      }
    }
  }, [selectedProject.name]);

  useEffect(() => {
    const controller = new AbortController();
    void loadStatuses(controller.signal);
    return () => controller.abort();
  }, [loadStatuses]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleFilesChanged = (event: Event) => {
      const detail = (event as CustomEvent<ProjectFilesChangedDetail>).detail;
      if (detail?.projectName === selectedProject.name) {
        void loadStatuses();
      }
    };

    window.addEventListener(PROJECT_FILES_CHANGED_EVENT, handleFilesChanged);
    return () => window.removeEventListener(PROJECT_FILES_CHANGED_EVENT, handleFilesChanged);
  }, [loadStatuses, selectedProject.name]);

  useEffect(() => {
    const messageType = typeof latestMessage?.type === 'string' ? latestMessage.type : '';
    const completedLoading = messageType === 'loading_progress' && latestMessage?.phase === 'complete';
    if (!COMPLETION_MESSAGE_TYPES.has(messageType) && !completedLoading) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => void loadStatuses(), 300);
    return () => window.clearTimeout(timeoutId);
  }, [latestMessage, loadStatuses]);

  const currentIndex = useMemo(() => {
    const latestPopulatedIndex = folders.reduce(
      (latest, folder, index) => (folder.fileCount > 0 ? index : latest),
      -1,
    );
    return latestPopulatedIndex >= 0 ? latestPopulatedIndex : 0;
  }, [folders]);

  if (folders.length === 0) {
    return null;
  }

  return (
    <nav
      role="navigation"
      aria-label={t('workflowFolders.title')}
      className={cn(
        'flex-shrink-0 border-b border-border/70 bg-background/80 px-3 py-1.5 backdrop-blur-sm',
        reserveTrailingControl && 'pr-14',
      )}
    >
      <div className="scrollbar-hide max-w-full overflow-x-auto rounded-full border border-border/60 bg-muted/25 px-1.5 py-1 shadow-sm">
        <div className="flex w-max min-w-full items-center justify-center gap-1">
          {folders.map((folder, index) => {
            const sequence = folder.name.slice(0, 2);
            const hasFiles = folder.fileCount > 0;
            const isCurrent = index === currentIndex;
            const fileState = hasFiles
              ? t('workflowFolders.fileCount', { count: folder.fileCount })
              : t('workflowFolders.empty');
            const stateLabel = isCurrent
              ? `${t('workflowFolders.current')} · ${fileState}`
              : fileState;
            const nextHasFiles = folders[index + 1]?.fileCount > 0;

            return (
              <div key={folder.name} className="flex flex-none items-center gap-1">
                <div
                  title={`${folder.name} · ${stateLabel}`}
                  aria-label={`${t(FOLDER_LABEL_KEYS[folder.name])} · ${stateLabel}`}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'inline-flex h-7 min-w-[108px] flex-none cursor-default items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] transition-all',
                    hasFiles
                      ? 'border-emerald-300/80 bg-emerald-50/80 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/25 dark:text-emerald-200'
                      : 'border-dashed border-border/60 bg-background/45 text-muted-foreground/80',
                    isCurrent && 'shadow-sm ring-1 ring-primary/25',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full border px-1 font-mono text-[9px] font-semibold tabular-nums',
                      hasFiles
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : isCurrent
                          ? 'border-primary/50 bg-primary/5 text-foreground'
                          : 'border-border/70 bg-background/50',
                    )}
                  >
                    {sequence}
                  </span>
                  <span className="min-w-0 truncate font-medium leading-none">
                    {t(FOLDER_LABEL_KEYS[folder.name])}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                      hasFiles ? 'bg-emerald-500' : 'bg-muted-foreground/35',
                      isCurrent && hasFiles && 'animate-pulse',
                    )}
                  />
                </div>
                {index < folders.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-block h-px w-2 flex-shrink-0',
                      hasFiles && nextHasFiles ? 'bg-emerald-500/55' : 'bg-border/70',
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
