import {
  Info,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Rows3,
  Settings2,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../../../types/app';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';

import NewsItemCard from './NewsItemCard';
import SourceIcon from './SourceIcon';
import type { NewsSourceKey, SearchResults } from './useNewsDashboardData';

const SOURCE_LABEL_KEYS: Record<NewsSourceKey, string> = {
  pubmed: 'sources.pubmed',
  europepmc: 'sources.europepmc',
  medrxiv: 'sources.medrxiv',
  arxiv: 'sources.arxiv',
  xiaohongshu: 'sources.xiaohongshu',
};

const SOURCE_BORDER_COLORS: Record<NewsSourceKey, string> = {
  pubmed: 'border-emerald-200/60 dark:border-emerald-800/40',
  europepmc: 'border-teal-200/60 dark:border-teal-800/40',
  medrxiv: 'border-green-200/60 dark:border-green-800/40',
  arxiv: 'border-emerald-300/70 dark:border-emerald-800/50',
  xiaohongshu: 'border-green-300/60 dark:border-green-800/40',
};

const SOURCE_HEADER_COLORS: Record<NewsSourceKey, string> = {
  pubmed: 'text-emerald-700 dark:text-emerald-300',
  europepmc: 'text-teal-700 dark:text-teal-300',
  medrxiv: 'text-green-700 dark:text-green-300',
  arxiv: 'text-emerald-800 dark:text-emerald-200',
  xiaohongshu: 'text-green-800 dark:text-green-200',
};

const SOURCE_BADGE_COLORS: Record<NewsSourceKey, string> = {
  pubmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  europepmc: 'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
  medrxiv: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  arxiv: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  xiaohongshu: 'bg-green-200 text-green-800 dark:bg-green-900/60 dark:text-green-200',
};

function SetupGuide({ sourceKey, onOpenSettings }: { sourceKey: NewsSourceKey; onOpenSettings: (key: NewsSourceKey) => void }) {
  const { t } = useTranslation('news');
  const steps = t(`setup.${sourceKey}.steps`, { returnObjects: true }) as string[];
  const note = t(`setup.${sourceKey}.note`, { defaultValue: '' });

  return (
    <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/50 p-4 dark:border-emerald-800/30 dark:bg-emerald-950/20">
      <div className="flex items-start gap-2.5">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
        <div className="space-y-2.5 min-w-0">
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">{t('setup.title')}</p>
          <ol className="list-decimal list-inside space-y-1.5">
            {Array.isArray(steps) && steps.map((step, i) => (
              <li key={i} className="text-xs text-emerald-700/80 dark:text-emerald-300/80">{step}</li>
            ))}
          </ol>
          {note && (
            <p className="border-t border-emerald-200/40 pt-2 font-mono text-[11px] text-emerald-600/60 dark:border-emerald-800/20 dark:text-emerald-400/50">
              {note}
            </p>
          )}
          <button
            onClick={() => onOpenSettings(sourceKey)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-200/80 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
          >
            <Settings2 className="h-3.5 w-3.5" /> {t('actions.openSettings')}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogPanel({ logs }: { logs: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <div className="mx-5 mb-3">
      <div
        ref={scrollRef}
        className="max-h-32 overflow-y-auto rounded-xl border border-border/40 bg-slate-950/90 p-3 font-mono text-[11px] leading-5 text-emerald-400 dark:border-border/30"
      >
        {logs.map((line, i) => (
          <div key={i} className="flex gap-2">
            <Terminal className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UnifiedFeed({
  activeSource,
  viewMode,
  results,
  errors,
  isSearching,
  searchLogs,
  chatTargetProject,
  onStartResearchPrompt,
  onSearchSource,
  onOpenSettings,
  onClearSource,
  onViewModeChange,
}: {
  activeSource: NewsSourceKey;
  viewMode: 'list' | 'card';
  results: Record<NewsSourceKey, SearchResults>;
  errors: Record<NewsSourceKey, string | null>;
  isSearching: Record<NewsSourceKey, boolean>;
  searchLogs: Record<NewsSourceKey, string[]>;
  chatTargetProject?: Project | null;
  onStartResearchPrompt?: (project: Project, prompt: string | ChatPromptDraft) => void;
  onSearchSource: (key: NewsSourceKey) => void;
  onOpenSettings: (key: NewsSourceKey) => void;
  onClearSource: (key: NewsSourceKey) => void;
  onViewModeChange: (mode: 'list' | 'card') => void;
}) {
  const { t } = useTranslation('news');

  const key = activeSource;
  const label = t(SOURCE_LABEL_KEYS[key]);
  const rawPapers = results[key]?.top_papers;
  const papers = (Array.isArray(rawPapers) ? rawPapers : []).filter(
    (p) => p.title && p.title !== '(Untitled)'
  );
  const error = errors[key];
  const searching = isSearching[key];
  const totalFound = results[key]?.total_found ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <section
        className={`overflow-hidden rounded-[28px] border ${SOURCE_BORDER_COLORS[key]} bg-card/90 shadow-sm`}
      >
        {/* Source header */}
        <div className="flex w-full items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${SOURCE_BADGE_COLORS[key]}`}>
              <SourceIcon sourceKey={key} className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className={`text-sm font-semibold ${SOURCE_HEADER_COLORS[key]}`}>{label}</h3>
              <p className="text-[11px] text-muted-foreground">
                {papers.length > 0
                  ? (totalFound > 0
                      ? t('status.resultsWithTotal', { count: papers.length, total: totalFound })
                      : t('status.resultsCount', { count: papers.length }))
                  : t('status.noResults')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <div className="inline-flex items-center rounded-lg border border-border/60 bg-background/70 p-0.5">
              <button
                type="button"
                onClick={() => onViewModeChange('list')}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                  viewMode === 'list'
                    ? 'bg-muted text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title={t('view.list')}
              >
                <Rows3 className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{t('view.list')}</span>
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('card')}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                  viewMode === 'card'
                    ? 'bg-muted text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title={t('view.card')}
              >
                <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{t('view.card')}</span>
              </button>
            </div>
            {searching && (
              <div className="flex items-center gap-1.5 rounded-lg bg-primary/5 px-2.5 py-1 text-xs text-primary dark:bg-primary/10">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('actions.searching')}
              </div>
            )}
            <button
              onClick={() => onOpenSettings(key)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap">{t('actions.settings')}</span>
            </button>
            <button
              onClick={() => onSearchSource(key)}
              disabled={searching}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
            >
              <RefreshCw className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap">{t('actions.refresh')}</span>
            </button>
            {papers.length > 0 && (
              <button
                onClick={() => onClearSource(key)}
                disabled={searching}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{t('actions.clear')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Search progress logs */}
        {(searching || (searchLogs[key]?.length > 0)) && <LogPanel logs={searchLogs[key] || []} />}

        {/* Error */}
        {error && (
          <div className="mx-5 mb-4 flex items-center gap-3 rounded-xl border border-red-200/80 bg-red-50/80 p-3 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
            <span>{error}</span>
          </div>
        )}

        {/* Results grid */}
        {papers.length > 0 ? (
          viewMode === 'card' ? (
            <div className="p-5 pt-0">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {papers.map((item, index) => (
                  <NewsItemCard
                    key={item.id}
                    item={item}
                    index={index}
                    sourceKey={key}
                    variant="card"
                    chatTargetProject={chatTargetProject}
                    onStartResearchPrompt={onStartResearchPrompt}
                  />
                ))}
              </div>
            </div>
          ) : (
          <div className="px-5 pb-5 pt-0">
            <div className="hidden lg:grid lg:grid-cols-[82px_minmax(0,1fr)_minmax(170px,220px)] lg:gap-4 border-y border-border/50 bg-slate-50/85 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground dark:bg-slate-950/45">
              <span>{t('list.rankSignal')}</span>
              <span>{t('list.paperSummary')}</span>
              <span>{t('list.screeningPanel')}</span>
            </div>

            <div className="max-h-[1200px] overflow-y-auto rounded-b-[22px] border border-t-0 border-border/50 bg-white/70 dark:bg-slate-950/30">
            {papers.map((item, index) => (
              <NewsItemCard
                key={item.id}
                item={item}
                index={index}
                sourceKey={key}
                variant="list"
                chatTargetProject={chatTargetProject}
                onStartResearchPrompt={onStartResearchPrompt}
              />
            ))}
            </div>
          </div>
          )
        ) : !searching && !error ? (
          <div className="flex flex-col gap-4 px-5 pb-5">
            <SetupGuide sourceKey={key} onOpenSettings={onOpenSettings} />
            <div className="flex flex-col items-center justify-center gap-3 py-4 text-center">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t('status.noResults')}</p>
                <p className="mt-1 text-xs text-muted-foreground/60">{t('status.noResultsHint')}</p>
              </div>
              <button
                onClick={() => onSearchSource(key)}
                className="flex items-center gap-1.5 rounded-xl border border-border/50 bg-background/80 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" /> {t('actions.startSearch')}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
