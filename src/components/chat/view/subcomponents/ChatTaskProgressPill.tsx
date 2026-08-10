import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, ListChecks, Play, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTaskMaster } from '../../../../contexts/TaskMasterContext';

type TaskItem = {
  id?: string | number;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  stage?: string;
  details?: string;
  testStrategy?: string;
  taskType?: string;
  nextActionPrompt?: string;
  whyNext?: string;
  inputsNeeded?: string[];
  suggestedSkills?: string[];
  dependencies?: Array<string | number>;
  guidance?: {
    requiredInputs?: string[];
    suggestedSkills?: string[];
    nextActionPrompt?: string;
    whyNext?: string;
  } | null;
};

interface ChatTaskProgressPillProps {
  onStartTask?: (prompt?: string, task?: TaskItem | null) => void;
  onShowAllTasks?: (() => void) | null;
  className?: string;
  compact?: boolean;
  hideWhenEmpty?: boolean;
}

type TaskMasterContextValue = {
  tasks?: TaskItem[];
  nextTask?: TaskItem | null;
  isLoadingTasks?: boolean;
};

const STAGE_ALIASES: Record<string, string> = {
  analysis: 'experiment',
  experiment_dev: 'experiment',
  experimentdev: 'experiment',
  presentation: 'promotion',
};

const normalizeStage = (stage?: string | null) => {
  const normalized = String(stage || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STAGE_ALIASES[normalized] || normalized;
};

const isDoneStatus = (status?: string) => String(status || '').toLowerCase() === 'done';
const isActiveStatus = (status?: string) => ['in-progress', 'review', 'pending'].includes(String(status || '').toLowerCase());

export default function ChatTaskProgressPill({
  onStartTask,
  onShowAllTasks,
  className = '',
  compact = false,
  hideWhenEmpty = false,
}: ChatTaskProgressPillProps) {
  const { t } = useTranslation('chat');
  const {
    tasks = [],
    nextTask,
    isLoadingTasks,
  } = useTaskMaster() as TaskMasterContextValue;
  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((task) => isDoneStatus(task.status)).length;
    const inProgress = tasks.filter((task) => task.status === 'in-progress').length;
    const pending = tasks.filter((task) => task.status === 'pending').length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, inProgress, pending, progress };
  }, [tasks]);

  const actionPrompt = nextTask?.nextActionPrompt || nextTask?.guidance?.nextActionPrompt || '';
  const whyNext = nextTask?.whyNext || nextTask?.guidance?.whyNext || '';
  const hasTasks = summary.total > 0;
  const isLoading = Boolean(isLoadingTasks);
  const activeTask = nextTask || tasks.find((task) => isActiveStatus(task.status)) || null;
  const currentStageKey = normalizeStage(activeTask?.stage);
  const currentStageLabel = currentStageKey
    ? t(`tasks.stages.${currentStageKey}`, { defaultValue: activeTask?.stage || currentStageKey })
    : '';
  const stageTasks = currentStageKey
    ? tasks.filter((task) => normalizeStage(task.stage) === currentStageKey)
    : [];
  const stageDone = stageTasks.filter((task) => isDoneStatus(task.status)).length;
  const stageProgressText = currentStageLabel
    ? stageTasks.length > 0
      ? t('tasks.compact.stageProgress', {
          stage: currentStageLabel,
          done: stageDone,
          total: stageTasks.length,
          defaultValue: 'Stage {{stage}} · {{done}}/{{total}} done',
        })
      : t('tasks.compact.stageOnly', {
          stage: currentStageLabel,
          defaultValue: 'Stage {{stage}}',
        })
    : '';

  if (hideWhenEmpty && !hasTasks && !isLoading) {
    return null;
  }

  return (
    <div className={`relative ${compact ? 'min-w-0' : 'w-full mt-2 mb-2'} ${className}`}>
      {expanded && (
        <div
          className={
            compact
              ? 'absolute bottom-full left-0 z-20 mb-2 w-[min(420px,calc(100vw-2rem))] space-y-2 rounded-xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-xl backdrop-blur'
              : 'absolute bottom-full left-0 right-0 z-20 mb-2 space-y-2 rounded-xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-xl backdrop-blur'
          }
        >
          {hasTasks ? (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${summary.progress}%` }}
                />
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {currentStageLabel && <span>{t('tasks.compact.stageLabel')}: {currentStageLabel}</span>}
                <span>{t('tasks.compact.done')}: {summary.done}</span>
                <span>{t('tasks.compact.inProgress')}: {summary.inProgress}</span>
                <span>{t('tasks.compact.pending')}: {summary.pending}</span>
              </div>

              {whyNext && (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {whyNext}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('tasks.compact.emptyHint', {
                defaultValue: 'Talk to the Agent to generate and configure a research pipeline.',
              })}
            </p>
          )}

          {onShowAllTasks && (
            <button
              type="button"
              onClick={onShowAllTasks}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-foreground transition-colors hover:bg-muted/70"
            >
              <ListChecks className="h-3.5 w-3.5" />
              {t('tasks.compact.allTasks')}
            </button>
          )}
        </div>
      )}

      <div
        className={
          compact
            ? 'flex h-10 max-w-[min(430px,calc(100vw-2rem))] items-center gap-2 rounded-lg border border-border/70 bg-card/95 px-3 py-1.5 shadow-sm backdrop-blur'
            : 'flex items-center gap-2 rounded-xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur'
        }
      >
        <div className={`flex flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ${compact ? 'h-6 w-6' : 'h-7 w-7'}`}>
          {hasTasks && summary.done === summary.total ? (
            <CheckCircle2 className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          ) : (
            <Target className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className={`truncate text-muted-foreground ${compact ? 'text-[11px]' : 'text-xs'}`}>
            {isLoading
              ? t('tasks.loading', { defaultValue: 'Loading tasks...' })
              : stageProgressText || (hasTasks
                ? t('tasks.compact.progress', {
                    done: summary.done,
                    total: summary.total,
                    pending: summary.pending,
                  })
                : t('tasks.compact.noTasks', { defaultValue: 'No tasks yet. Start by chatting with the Agent.' }))}
          </p>
          <p className={`truncate font-medium text-foreground ${compact ? 'text-xs' : 'text-sm'}`}>
            {nextTask?.title ||
              (hasTasks
                ? t('tasks.compact.allDone')
                : t('tasks.compact.emptyTitle', { defaultValue: 'Task progress unavailable' }))}
          </p>
        </div>

        {nextTask && !compact && (
          <button
            type="button"
            onClick={() => onStartTask?.(actionPrompt, nextTask)}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Play className="h-3 w-3" />
            {t('tasks.compact.useInChat')}
          </button>
        )}

        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          className={`inline-flex items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted/70 ${compact ? 'h-7 w-7' : 'h-8 w-8'}`}
          title={expanded ? t('tasks.compact.collapse') : t('tasks.compact.expand')}
        >
          {expanded ? <ChevronDown className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : <ChevronUp className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
        </button>
      </div>
    </div>
  );
}
