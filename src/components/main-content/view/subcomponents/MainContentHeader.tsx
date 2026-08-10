import MobileMenuButton from './MobileMenuButton';
import MainContentTitle from './MainContentTitle';
import type { MainContentHeaderProps } from '../../types/types';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  isMobile,
  onMenuClick,
}: MainContentHeaderProps) {
  return (
    <div className="flex-shrink-0 border-b border-border/80 bg-background/70 px-3 backdrop-blur-xl pwa-header-safe sm:px-5">
      <div className="flex min-h-12 items-center gap-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          <MainContentTitle
            activeTab={activeTab}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            shouldShowTasksTab={shouldShowTasksTab}
            isMobile={isMobile}
          />
        </div>
      </div>
    </div>
  );
}
