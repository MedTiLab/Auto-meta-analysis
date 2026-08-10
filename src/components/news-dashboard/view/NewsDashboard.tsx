import { Activity, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../../../types/app';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';

import DashboardStatCard from '../../ui/DashboardStatCard';
import SourceFilterBar from './SourceFilterBar';
import SourceSettingsDialog from './SourceSettingsDialog';
import UnifiedFeed from './UnifiedFeed';
import { useNewsDashboardData, LITERATURE_HERO_STAT_SOURCES } from './useNewsDashboardData';
import type { NewsSourceKey } from './useNewsDashboardData';

const SOURCE_LABEL_KEYS: Record<NewsSourceKey, string> = {
  pubmed: 'sources.pubmed',
  europepmc: 'sources.europepmc',
  medrxiv: 'sources.medrxiv',
  arxiv: 'sources.arxiv',
  xiaohongshu: 'sources.xiaohongshu',
};

const SOURCE_STAT_ACCENTS: Record<NewsSourceKey, string> = {
  pubmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  europepmc: 'bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
  medrxiv: 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300',
  arxiv: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  xiaohongshu: 'bg-green-200 text-green-800 dark:bg-green-900/60 dark:text-green-200',
};

type NewsDashboardProps = {
  chatTargetProject?: Project | null;
  onStartResearchPrompt?: (project: Project, prompt: string | ChatPromptDraft) => void;
};

export default function NewsDashboard({
  chatTargetProject = null,
  onStartResearchPrompt,
}: NewsDashboardProps) {
  const { t } = useTranslation('news');
  const {
    sources,
    configs,
    results,
    isSearching,
    errors,
    configDirty,
    searchLogs,
    isLoading,
    searchSource,
    updateConfig,
    saveConfig,
    resetConfig,
    clearResults,
  } = useNewsDashboardData();

  const [activeSource, setActiveSource] = useState<NewsSourceKey>('pubmed');
  const [settingsSource, setSettingsSource] = useState<NewsSourceKey | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');

  const handleSearch = useCallback(() => {
    searchSource(activeSource);
  }, [searchSource, activeSource]);

  const isSearchingActive = isSearching[activeSource];

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary/60" />
        <span className="text-sm text-muted-foreground">{t('status.loading')}</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4 sm:p-5">
        {/* Hero Section */}
        <section className="relative overflow-hidden rounded-[22px] border border-border/60 bg-[linear-gradient(180deg,rgba(247,254,250,0.98),rgba(236,253,245,0.92))] p-4 shadow-sm dark:bg-[linear-gradient(180deg,rgba(7,18,15,0.98),rgba(10,28,23,0.92))] sm:p-5">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[linear-gradient(90deg,rgba(5,150,105,0.10),rgba(16,185,129,0.05),transparent)] dark:bg-[linear-gradient(90deg,rgba(16,185,129,0.12),rgba(45,212,191,0.06),transparent)]" />

          <div className="relative grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(240px,0.62fr)]">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-800 shadow-sm dark:border-emerald-800/60 dark:bg-emerald-950/35 dark:text-emerald-200">
                <Activity className="h-3 w-3" />
                {t('hero.badge')}
              </div>

              <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {t('hero.title')}
              </h2>
              <p className="mt-1 max-w-xl text-[11px] leading-4 text-muted-foreground sm:text-xs sm:leading-5">
                {t('hero.description')}
              </p>

              <p className="mt-1.5 rounded-lg border border-border/60 bg-white/70 px-2.5 py-1.5 text-[10px] leading-4 text-muted-foreground shadow-sm dark:bg-slate-950/45">
                {chatTargetProject
                  ? t('hero.chatTarget', {
                      project: chatTargetProject.displayName || chatTargetProject.name,
                    })
                  : t('hero.selectProjectHint')}
              </p>

              <div className="mt-3">
                <SourceFilterBar
                  activeSource={activeSource}
                  onSelectSource={setActiveSource}
                  sources={sources}
                  isSearching={isSearching}
                  onSearch={handleSearch}
                  isSearchingActive={isSearchingActive}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {LITERATURE_HERO_STAT_SOURCES.map((key) => (
                <DashboardStatCard
                  key={key}
                  compact
                  label={t(SOURCE_LABEL_KEYS[key])}
                  value={results[key]?.top_papers?.length ?? 0}
                  accent={SOURCE_STAT_ACCENTS[key]}
                />
              ))}
            </div>
          </div>
        </section>

        <UnifiedFeed
          activeSource={activeSource}
          viewMode={viewMode}
          results={results}
          errors={errors}
          isSearching={isSearching}
          searchLogs={searchLogs}
          chatTargetProject={chatTargetProject}
          onStartResearchPrompt={onStartResearchPrompt}
          onSearchSource={searchSource}
          onOpenSettings={setSettingsSource}
          onClearSource={clearResults}
          onViewModeChange={setViewMode}
        />

        {/* Footer */}
        <footer className="flex items-center justify-center gap-2 pb-4 pt-1 text-[11px] text-muted-foreground/60">
          <span className="inline-flex items-center gap-1.5">
            {t('footer.poweredBy')}
            <a href="https://arxiv.org" target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors">{t('sources.arxiv')}</a>
            <span>&middot;</span>
            <a href="https://pubmed.ncbi.nlm.nih.gov" target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors">{t('sources.pubmed')}</a>
            <span>&middot;</span>
            <a href="https://europepmc.org" target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors">{t('sources.europepmc')}</a>
            <span>&middot;</span>
            <a href="https://www.medrxiv.org" target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors">{t('sources.medrxiv')}</a>
          </span>
        </footer>
      </div>

      {/* Settings dialog */}
      {settingsSource && configs[settingsSource] && (
        <SourceSettingsDialog
          sourceKey={settingsSource}
          config={configs[settingsSource]}
          onConfigChange={(cfg) => updateConfig(settingsSource, cfg)}
          onSave={() => saveConfig(settingsSource)}
          onReset={() => resetConfig(settingsSource)}
          onClose={() => setSettingsSource(null)}
          sourceInfo={sources.find((s) => s.key === settingsSource)}
          configDirty={configDirty[settingsSource] ?? false}
        />
      )}
    </div>
  );
}
