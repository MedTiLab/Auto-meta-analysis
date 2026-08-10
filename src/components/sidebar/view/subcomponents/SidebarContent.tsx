import type { AppTab, Project } from '../../../../types/app';
import { ScrollArea } from '../../../ui/scroll-area';
import type { TFunction } from 'i18next';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';
import SidebarScrollableNav from './SidebarScrollableNav';

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  activeTab: AppTab;
  onOpenDashboard: () => void;
  onOpenSkills: () => void;
  onOpenNews: () => void;
  onOpenReferences: () => void;
  onOpenTrash: () => void;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  updateAvailable: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  projects,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  onRefresh,
  isRefreshing,
  activeTab,
  onOpenDashboard,
  onOpenSkills,
  onOpenNews,
  onOpenReferences,
  onOpenTrash,
  onCreateProject,
  onCollapseSidebar,
  updateAvailable,
  releaseInfo,
  latestVersion,
  onShowVersionModal,
  onShowSettings,
  projectListProps,
  t,
}: SidebarContentProps) {
  return (
    <div
      className="h-full flex flex-col bg-background/80 backdrop-blur-sm md:select-none w-full"
      style={{}}
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        projectsCount={projects.length}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      <ScrollArea className="flex-1 md:px-1.5 md:py-2 overflow-y-auto overscroll-contain">
        <div className="space-y-2">
          {!isLoading && (
            <SidebarScrollableNav
              activeTab={activeTab}
              onOpenDashboard={onOpenDashboard}
              onOpenSkills={onOpenSkills}
              onOpenNews={onOpenNews}
              onOpenReferences={onOpenReferences}
              t={t}
            />
          )}
          <SidebarProjectList {...projectListProps} />
        </div>
      </ScrollArea>

      <SidebarFooter
        updateAvailable={updateAvailable}
        releaseInfo={releaseInfo}
        latestVersion={latestVersion}
        onShowVersionModal={onShowVersionModal}
        onShowSettings={onShowSettings}
        onOpenTrash={onOpenTrash}
        isTrashActive={activeTab === 'trash'}
        t={t}
      />
    </div>
  );
}
