import {
  Loader2,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../ui/button';
import SourceIcon from './SourceIcon';
import { LITERATURE_TRIAGE_SOURCES, type NewsSourceKey, type SourceInfo } from './useNewsDashboardData';

const SOURCE_LABEL_KEYS: Record<NewsSourceKey, string> = {
  pubmed: 'sources.pubmed',
  europepmc: 'sources.europepmc',
  medrxiv: 'sources.medrxiv',
  arxiv: 'sources.arxiv',
  xiaohongshu: 'sources.xiaohongshu',
};

const SOURCE_INACTIVE_COLORS: Record<NewsSourceKey, string> = {
  pubmed: 'bg-transparent text-emerald-800/60 hover:bg-emerald-100/50 dark:text-emerald-400/60 dark:hover:bg-emerald-950/30',
  europepmc: 'bg-transparent text-teal-800/60 hover:bg-teal-100/50 dark:text-teal-400/60 dark:hover:bg-teal-950/30',
  medrxiv: 'bg-transparent text-green-800/60 hover:bg-green-100/50 dark:text-green-400/60 dark:hover:bg-green-950/30',
  arxiv: 'bg-transparent text-emerald-900/60 hover:bg-emerald-100/50 dark:text-emerald-300/60 dark:hover:bg-emerald-950/30',
  xiaohongshu: 'bg-transparent text-green-900/60 hover:bg-green-100/50 dark:text-green-300/60 dark:hover:bg-green-950/30',
};

const SOURCE_ACTIVE_COLORS: Record<NewsSourceKey, string> = {
  pubmed: 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-600/30 hover:bg-emerald-700 dark:bg-emerald-700 dark:ring-emerald-500/30 dark:hover:bg-emerald-600',
  europepmc: 'bg-teal-600 text-white shadow-md ring-2 ring-teal-600/30 hover:bg-teal-700 dark:bg-teal-700 dark:ring-teal-500/30 dark:hover:bg-teal-600',
  medrxiv: 'bg-green-600 text-white shadow-md ring-2 ring-green-600/30 hover:bg-green-700 dark:bg-green-700 dark:ring-green-500/30 dark:hover:bg-green-600',
  arxiv: 'bg-emerald-700 text-white shadow-md ring-2 ring-emerald-700/30 hover:bg-emerald-800 dark:bg-emerald-800 dark:ring-emerald-500/30 dark:hover:bg-emerald-700',
  xiaohongshu: 'bg-green-700 text-white shadow-md ring-2 ring-green-700/30 hover:bg-green-800 dark:bg-green-800 dark:ring-green-500/30 dark:hover:bg-green-700',
};

export default function SourceFilterBar({
  activeSource,
  onSelectSource,
  sources,
  isSearching,
  onSearch,
  isSearchingActive,
}: {
  activeSource: NewsSourceKey;
  onSelectSource: (key: NewsSourceKey) => void;
  sources: SourceInfo[];
  isSearching: Record<NewsSourceKey, boolean>;
  onSearch: () => void;
  isSearchingActive: boolean;
}) {
  const { t } = useTranslation('news');

  return (
    <div className="relative flex items-center rounded-xl border border-border/60 bg-card/80 p-1.5 shadow-sm backdrop-blur">
      <div className="flex flex-1 flex-wrap items-center justify-center gap-1.5 pr-[5.5rem]">
        {LITERATURE_TRIAGE_SOURCES.map((key) => {
          const label = t(SOURCE_LABEL_KEYS[key]);
          const isActive = activeSource === key;
          const info = sources.find((s) => s.key === key);
          const needsCred = info?.requiresCredentials && info.credentialStatus === 'missing';
          const searching = isSearching[key];

          return (
            <button
              key={key}
              onClick={() => onSelectSource(key)}
              className={`relative flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-all duration-200 ${
                isActive
                  ? `${SOURCE_ACTIVE_COLORS[key]} scale-[1.02]`
                  : SOURCE_INACTIVE_COLORS[key]
              }`}
            >
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SourceIcon sourceKey={key} className="h-3.5 w-3.5" inverted={isActive} />
              )}
              <span className="whitespace-nowrap">{label}</span>
              {needsCred && (
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" title={t('settings.credentialRequired')} />
              )}
            </button>
          );
        })}
      </div>

      <Button
        onClick={onSearch}
        disabled={isSearchingActive}
        className="absolute right-1.5 top-1/2 h-7 -translate-y-1/2 gap-1 rounded-lg px-2.5 text-[11px]"
        size="sm"
      >
        {isSearchingActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
        {t('actions.searchAll')}
      </Button>
    </div>
  );
}
