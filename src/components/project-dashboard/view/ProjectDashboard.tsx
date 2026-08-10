import {
  Activity,
  ArrowRight,
  FolderOpen,
  MessageSquare,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import { Button } from '../../ui/button';
import { formatTimeAgo } from '../../../utils/dateUtils';
import type { AppTab, Project, ProjectSession } from '../../../types/app';

type ProjectDashboardProps = {
  projects: Project[];
  onProjectAction: (
    project: Project,
    tab: AppTab,
    sessionId?: string | null,
    sessionProvider?: string | null,
  ) => void;
  onProjectAutomation?: (project: Project) => void;
};

type TaskmasterMetadata = {
  taskCount?: number;
  completed?: number;
  completionPercentage?: number;
  lastModified?: string;
};

type TokenUsageTotals = {
  todayTokens: number;
  weekTokens: number;
};

type ProjectTokenUsageSummary = {
  generatedAt?: string;
  workspace: TokenUsageTotals;
  projects: Record<string, TokenUsageTotals>;
};

const PROJECT_CARD_TONE = {
  header: 'bg-primary/5',
  orb: 'bg-primary/10',
  border: 'hover:border-primary/20',
  progress: 'bg-primary',
  badge: 'border-primary/20 bg-primary/10 text-primary',
} as const;

function getProjectSessions(project: Project): ProjectSession[] {
  return project.sessions ?? [];
}

function getLastActivity(project: Project) {
  const sessionDates = getProjectSessions(project)
    .map((session) => session.updated_at || session.lastActivity || session.created_at || session.createdAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  if (sessionDates.length > 0) {
    return sessionDates[0].toISOString();
  }

  return project.createdAt ?? null;
}

function getTaskmasterMetadata(project: Project): TaskmasterMetadata | null {
  const metadata = project.taskmaster?.metadata;

  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  return metadata as TaskmasterMetadata;
}

function getProgress(project: Project) {
  const metadata = getTaskmasterMetadata(project);

  if (typeof metadata?.completionPercentage === 'number') {
    return Math.max(0, Math.min(100, metadata.completionPercentage));
  }

  return null;
}

function formatTokenCount(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  }

  return value.toLocaleString();
}

function StatCard({
  label,
  value,
  detail,
  compact = false,
}: {
  label: string;
  value: string | number;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-border/60 bg-white/86 shadow-sm dark:bg-slate-950/50 ${
        compact ? 'px-2.5 py-2' : 'p-4'
      }`}
    >
      <div
        className={`uppercase text-muted-foreground ${
          compact ? 'text-[9px] tracking-[0.14em]' : 'text-[11px] tracking-[0.22em]'
        }`}
      >
        {label}
      </div>
      <div
        className={`font-semibold tracking-tight text-foreground ${
          compact ? 'mt-0.5 text-base' : 'mt-2 text-3xl'
        }`}
      >
        {value}
      </div>
      {detail ? <div className="mt-2 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function MetricPill({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <div className="whitespace-nowrap text-[7px] uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className="text-[11px] font-semibold text-foreground">{value}</div>
    </div>
  );
}

export default function ProjectDashboard({
  projects,
  onProjectAction,
  onProjectAutomation,
}: ProjectDashboardProps) {
  const { t } = useTranslation('common');
  const now = new Date();
  const [tokenUsageSummary, setTokenUsageSummary] = useState<ProjectTokenUsageSummary | null>(null);

  const totals = useMemo(() => {
    const projectCount = projects.length;
    const projectsWithProgress = projects.filter((project) => getProgress(project) !== null);
    const trackedProjects = projectsWithProgress.length;
    const averageProgress = trackedProjects > 0
      ? Math.round(
          projectsWithProgress.reduce((sum, project) => sum + (getProgress(project) ?? 0), 0) / trackedProjects,
        )
      : null;
    const totalSessions = projects.reduce((sum, project) => sum + getProjectSessions(project).length, 0);

    const mostRecentlyActiveProject = [...projects]
      .map((project) => ({
        project,
        lastActivity: getLastActivity(project),
      }))
      .filter((entry): entry is { project: Project; lastActivity: string } => Boolean(entry.lastActivity))
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())[0] ?? null;

    return {
      projectCount,
      trackedProjects,
      averageProgress,
      totalSessions,
      mostRecentlyActiveProject,
    };
  }, [projects]);

  const projectUsageRefreshKey = useMemo(
    () => projects
      .map((project) => `${project.name}:${project.fullPath}:${getLastActivity(project) ?? ''}:${getProjectSessions(project).length}`)
      .sort()
      .join('|'),
    [projects],
  );

  useEffect(() => {
    let cancelled = false;

    if (projects.length === 0) {
      setTokenUsageSummary(null);
      return () => {
        cancelled = true;
      };
    }

    const fetchProjectTokenUsageSummary = async () => {
      try {
        const response = await api.projectTokenUsageSummary(projects);
        if (!response.ok) {
          throw new Error(`Failed to fetch token usage summary: ${response.status}`);
        }

        const data = await response.json() as ProjectTokenUsageSummary;
        if (!cancelled) {
          setTokenUsageSummary(data);
        }
      } catch (error) {
        console.error('Error fetching project token usage summary:', error);
        if (!cancelled) {
          setTokenUsageSummary(null);
        }
      }
    };

    void fetchProjectTokenUsageSummary();

    return () => {
      cancelled = true;
    };
  }, [projectUsageRefreshKey, projects]);

  if (projects.length === 0) {
    return (
      <div className="h-full overflow-auto bg-background">
        <div className="mx-auto flex h-full w-full max-w-[1600px] items-center p-4 sm:p-6">
          <div className="relative w-full overflow-hidden rounded-[32px] border border-border/60 bg-card/70 p-8 text-center shadow-sm backdrop-blur sm:p-12">
            <div className="absolute inset-x-0 top-0 h-24 bg-primary/5" />
            <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FolderOpen className="h-7 w-7" />
            </div>
            <h2 className="relative mt-5 text-3xl font-semibold tracking-tight text-foreground">
              {t('projectDashboard.emptyTitle')}
            </h2>
            <p className="relative mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
              {t('projectDashboard.emptyDescription')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6">
        <section className="relative overflow-hidden rounded-[28px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(247,247,247,0.96)_42%,rgba(242,242,242,0.98)_100%)] p-4 shadow-sm dark:bg-[linear-gradient(180deg,rgba(10,10,10,0.98)_0%,rgba(5,5,5,0.96)_36%,rgba(0,0,0,0.98)_100%)] sm:p-5">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(90deg,rgba(16,163,127,0.08),rgba(0,0,0,0.025),transparent)] dark:bg-[linear-gradient(90deg,rgba(16,163,127,0.13),rgba(255,255,255,0.035),transparent)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent via-white/24 to-white/55 dark:via-transparent dark:to-black/24" />

          <div className="relative grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(220px,0.58fr)]">
            <div className="flex min-w-0 flex-col">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200/80 bg-white/86 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-800 shadow-sm dark:border-cyan-800/60 dark:bg-cyan-950/35 dark:text-cyan-200">
                <Sparkles className="h-3.5 w-3.5" />
                {t('projectDashboard.overviewBadge')}
              </div>

              <div className="mt-3 flex flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-5">
                <div className="min-w-0 shrink-0 lg:max-w-sm xl:max-w-md">
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                    {t('projectDashboard.title')}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {t('projectDashboard.subtitle')}
                  </p>
                </div>

                <div className="grid min-w-0 flex-1 gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
                  <StatCard compact label={t('projectDashboard.summary.projects')} value={totals.projectCount} />
                  <StatCard compact label={t('projectDashboard.summary.sessions')} value={totals.totalSessions} />
                  <StatCard compact label={t('projectDashboard.summary.tracked')} value={totals.trackedProjects} />
                  <StatCard
                    compact
                    label={t('projectDashboard.summary.progress')}
                    value={totals.averageProgress === null ? t('projectDashboard.notTrackedShort') : `${totals.averageProgress}%`}
                  />
                  <StatCard
                    compact
                    label={t('projectDashboard.summary.todayTokens')}
                    value={formatTokenCount(tokenUsageSummary?.workspace?.todayTokens)}
                  />
                  <StatCard
                    compact
                    label={t('projectDashboard.summary.weekTokens')}
                    value={formatTokenCount(tokenUsageSummary?.workspace?.weekTokens)}
                  />
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col">
              <div className="flex h-full flex-col rounded-[22px] border border-border/60 bg-white/76 p-4 shadow-sm backdrop-blur dark:bg-slate-950/42">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Activity className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                  {t('projectDashboard.activityTitle')}
                </div>
                {totals.mostRecentlyActiveProject ? (
                  <div className="mt-3 flex flex-1 flex-col rounded-xl border border-border/50 bg-white/86 p-3 shadow-sm dark:bg-slate-950/46">
                    <div className="text-base font-semibold text-foreground">
                      {totals.mostRecentlyActiveProject.project.displayName}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t('projectDashboard.lastActivity', {
                        time: formatTimeAgo(totals.mostRecentlyActiveProject.lastActivity, now, t),
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-1 items-center rounded-xl border border-dashed border-border/60 bg-white/60 px-3 py-4 text-sm text-muted-foreground dark:bg-slate-950/28">
                    {t('projectDashboard.noRecentActivity')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map((project) => {
            const sessions = getProjectSessions(project);
            const metadata = getTaskmasterMetadata(project);
            const progress = getProgress(project);
            const lastActivity = getLastActivity(project);
            const projectTokenUsage = tokenUsageSummary?.projects?.[project.name];
            const tone = PROJECT_CARD_TONE;

            return (
              <article
                key={project.name}
                className={`relative overflow-hidden rounded-xl border border-border/60 bg-card p-2.5 shadow-sm transition-all duration-200 ${tone.border} hover:-translate-y-0.5 hover:shadow-md`}
              >
                <div className={`absolute inset-x-0 top-0 h-10 ${tone.header}`} />
                <div className={`absolute right-2.5 top-2.5 h-8 w-8 rounded-full blur-2xl ${tone.orb}`} />

                <div className="relative flex flex-col gap-1.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">
                      {project.displayName}
                    </h2>
                    {progress !== null ? (
                      <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${tone.badge}`}>
                        {t('projectDashboard.progressBadge', { progress })}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-border/60 bg-background/75 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                        {t('projectDashboard.notTrackedShort')}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border border-border/30 bg-background/40 px-1.5 py-1 text-[9px]">
                    <MetricPill label={t('projectDashboard.metrics.sessions')} value={sessions.length} />
                    <MetricPill label={t('projectDashboard.metrics.tasks')} value={metadata?.taskCount ?? '0'} />
                    <MetricPill label={t('projectDashboard.metrics.completed')} value={metadata?.completed ?? '0'} />
                    <MetricPill
                      label={t('projectDashboard.metrics.todayTokens')}
                      value={formatTokenCount(projectTokenUsage?.todayTokens)}
                    />
                    <MetricPill
                      label={t('projectDashboard.metrics.weekTokens')}
                      value={formatTokenCount(projectTokenUsage?.weekTokens)}
                    />
                  </div>

                  <div className="rounded-md border border-border/50 bg-background/70 px-1.5 py-1 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-[10px] font-medium text-foreground">
                        <Activity className="h-2.5 w-2.5 text-primary" />
                        {t('projectDashboard.progressTitle')}
                      </div>
                      <div className="text-[9px] text-muted-foreground">
                        {progress === null
                          ? t('projectDashboard.notTracked')
                          : t('projectDashboard.progressValue', { progress })}
                      </div>
                    </div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted/80">
                      <div
                        className={`h-full rounded-full ${tone.progress} transition-[width] duration-300`}
                        style={{ width: `${progress ?? 6}%` }}
                      />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] text-muted-foreground">
                      <span>
                        {lastActivity
                          ? t('projectDashboard.lastActivity', {
                              time: formatTimeAgo(lastActivity, now, t),
                            })
                          : t('projectDashboard.noRecentActivity')}
                      </span>
                      {metadata?.lastModified ? (
                        <span>
                          {t('projectDashboard.pipelineUpdated', {
                            time: formatTimeAgo(metadata.lastModified, now, t),
                          })}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="default"
                      size="sm"
                      className="h-6 rounded-full px-2 text-[9px]"
                      onClick={() => onProjectAction(project, 'chat')}
                    >
                      <MessageSquare className="h-3 w-3" />
                      {t('projectDashboard.openProject')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 rounded-full bg-white/60 px-2 text-[9px] backdrop-blur dark:bg-slate-950/35"
                      onClick={() => onProjectAction(project, 'files')}
                    >
                      <FolderOpen className="h-3 w-3" />
                      {t('projectDashboard.actions.files')}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-6 rounded-full border border-primary/30 bg-primary px-2 text-[9px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                      onClick={() => {
                        if (onProjectAutomation) {
                          onProjectAutomation(project);
                          return;
                        }
                        onProjectAction(project, 'chat');
                      }}
                    >
                      <Workflow className="h-3 w-3" />
                      {t('projectDashboard.actions.automation')}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
