import { Activity, AlertCircle, Loader2, RefreshCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { api } from '../../utils/api';
import {
  buildActivityCalendar,
  hasActivity,
  summarizeActivity,
  type ProjectActivityDay,
  type ProjectActivitySummary,
} from './projectActivityCalendarUtils';

const ACTIVITY_DAYS = 365;

const INTENSITY_CLASSES = [
  'border-border/60 bg-muted/50',
  'border-emerald-200 bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/80',
  'border-emerald-300 bg-emerald-300 dark:border-emerald-800/70 dark:bg-emerald-800',
  'border-teal-500 bg-teal-500 dark:border-teal-500/80 dark:bg-teal-500',
  'border-cyan-700 bg-cyan-700 dark:border-cyan-400/80 dark:bg-cyan-400',
];

type ProjectActivityResponse = {
  error?: string;
  activity?: {
    days?: ProjectActivityDay[];
    totals?: Partial<ProjectActivitySummary>;
  };
};

function formatDate(dateKey: string, formatter: Intl.DateTimeFormat) {
  return formatter.format(new Date(`${dateKey}T00:00:00.000Z`));
}

function formatMonth(dateKey: string, formatter: Intl.DateTimeFormat) {
  return formatter.format(new Date(`${dateKey}T00:00:00.000Z`));
}

function normalizeTotals(summary: ProjectActivitySummary, totals?: Partial<ProjectActivitySummary>): ProjectActivitySummary {
  return {
    total_opens: Number(totals?.total_opens ?? summary.total_opens) || 0,
    total_projects: Number(totals?.total_projects ?? summary.total_projects) || 0,
    active_days: Number(totals?.active_days ?? summary.active_days) || 0,
  };
}

async function requestProjectActivity(loadFailedMessage: string) {
  const response = await api.user.projectActivity({
    days: ACTIVITY_DAYS,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  });
  const data = await response.json().catch(() => ({} as ProjectActivityResponse));

  if (!response.ok) {
    throw new Error(data?.error || loadFailedMessage);
  }

  return {
    days: Array.isArray(data?.activity?.days) ? data.activity.days : [],
    totals: data?.activity?.totals,
  };
}

export default function ProjectActivityCalendar() {
  const { t, i18n } = useTranslation('settings');
  const [days, setDays] = useState<ProjectActivityDay[]>([]);
  const [totals, setTotals] = useState<Partial<ProjectActivitySummary> | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchActivity = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const activity = await requestProjectActivity(t('userAccount.projectActivity.errors.loadFailed'));
      setDays(activity.days);
      setTotals(activity.totals);
    } catch (activityError) {
      console.error('Project activity load error:', activityError);
      setError(activityError instanceof Error ? activityError.message : t('userAccount.projectActivity.errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      setError('');

      try {
        const activity = await requestProjectActivity(t('userAccount.projectActivity.errors.loadFailed'));
        if (active) {
          setDays(activity.days);
          setTotals(activity.totals);
        }
      } catch (activityError) {
        console.error('Project activity load error:', activityError);
        if (active) {
          setError(activityError instanceof Error ? activityError.message : t('userAccount.projectActivity.errors.loadFailed'));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [t]);

  const calendar = useMemo(() => buildActivityCalendar(days), [days]);
  const summary = useMemo(() => normalizeTotals(summarizeActivity(days), totals), [days, totals]);
  const hasAnyActivity = hasActivity(summary);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const dateFormatter = useMemo(() => (
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' })
  ), [i18n.language]);
  const monthFormatter = useMemo(() => (
    new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' })
  ), [i18n.language]);
  const monthLabelsByWeek = useMemo(() => (
    new Map(calendar.monthLabels.map((label) => [label.weekIndex, formatMonth(label.date, monthFormatter)]))
  ), [calendar.monthLabels, monthFormatter]);

  const statItems = [
    {
      key: 'opens',
      label: t('userAccount.projectActivity.stats.opens'),
      value: summary.total_opens,
    },
    {
      key: 'projects',
      label: t('userAccount.projectActivity.stats.projects'),
      value: summary.total_projects,
    },
    {
      key: 'activeDays',
      label: t('userAccount.projectActivity.stats.activeDays'),
      value: summary.active_days,
    },
  ];

  return (
    <div className="rounded-lg border border-border/70 bg-background/80 p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
            <Activity className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {t('userAccount.projectActivity.title')}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('userAccount.projectActivity.description')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 lg:min-w-[300px]">
          {statItems.map((item) => (
            <div key={item.key} className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {item.label}
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {numberFormatter.format(item.value)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('userAccount.projectActivity.loading')}
        </div>
      ) : error ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex min-w-0 items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </span>
          <button
            type="button"
            onClick={() => void fetchActivity()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
          >
            <RefreshCcw className="h-4 w-4" />
            {t('userAccount.projectActivity.retry')}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          {!hasAnyActivity && (
            <div className="mb-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {t('userAccount.projectActivity.empty')}
            </div>
          )}

          <div className="overflow-x-auto pb-2">
            <div className="min-w-[720px]">
              <div className="ml-9 flex gap-[3px]">
                {calendar.weeks.map((_, weekIndex) => (
                  <div key={weekIndex} className="relative h-4 w-2.5 shrink-0">
                    {monthLabelsByWeek.has(weekIndex) && (
                      <span className="absolute left-0 top-0 whitespace-nowrap text-[10px] leading-4 text-muted-foreground">
                        {monthLabelsByWeek.get(weekIndex)}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-1 flex items-start">
                <div className="mr-3 grid w-6 shrink-0 grid-rows-7 gap-[3px] text-[10px] leading-[10px] text-muted-foreground">
                  <span />
                  <span>{t('userAccount.projectActivity.weekdays.mon')}</span>
                  <span />
                  <span>{t('userAccount.projectActivity.weekdays.wed')}</span>
                  <span />
                  <span>{t('userAccount.projectActivity.weekdays.fri')}</span>
                  <span />
                </div>

                <div className="flex gap-[3px]" aria-label={t('userAccount.projectActivity.title')}>
                  {calendar.weeks.map((week, weekIndex) => (
                    <div key={weekIndex} className="flex shrink-0 flex-col gap-[3px]">
                      {week.map((cell, dayIndex) => {
                        const title = cell
                          ? t('userAccount.projectActivity.tooltip', {
                              date: formatDate(cell.date, dateFormatter),
                              opens: cell.open_count,
                              projects: cell.project_count,
                            })
                          : '';

                        return (
                          <div
                            key={`${weekIndex}-${dayIndex}`}
                            title={title}
                            aria-label={title || undefined}
                            className={cn(
                              'h-2.5 w-2.5 rounded-[3px] border transition-colors',
                              cell ? INTENSITY_CLASSES[cell.intensity] : 'border-transparent bg-transparent',
                            )}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
                <span>{t('userAccount.projectActivity.legend.less')}</span>
                <div className="flex gap-[3px]">
                  {INTENSITY_CLASSES.map((className, index) => (
                    <span
                      key={index}
                      className={cn('h-2.5 w-2.5 rounded-[3px] border', className)}
                    />
                  ))}
                </div>
                <span>{t('userAccount.projectActivity.legend.more')}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
