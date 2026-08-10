import { PanelLeftClose, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isLoading,
  projectsCount,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  return (
    <header className="flex-shrink-0 border-b border-border px-3 pb-3 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-foreground">MEDHELP</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">OPEN RESEARCH AGENT</p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-40"
            aria-label={t('tooltips.refresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onCollapseSidebar}
            className="hidden h-8 w-8 place-items-center text-muted-foreground hover:text-foreground md:grid"
            aria-label={t('tooltips.hideSidebar')}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!isLoading && (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={onCreateProject}
            className="flex h-9 w-full items-center justify-center gap-2 bg-primary/90 px-3 text-xs font-medium text-primary-foreground shadow-sm shadow-primary/15 hover:bg-primary"
          >
            <Plus className="h-4 w-4" />
            {t('projects.newProject')}
          </button>

          {projectsCount > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                placeholder={t('projects.searchPlaceholder')}
                className="h-9 w-full border-b border-border bg-transparent pl-8 pr-8 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-foreground"
              />
              {searchFilter && (
                <button
                  type="button"
                  onClick={onClearSearchFilter}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
