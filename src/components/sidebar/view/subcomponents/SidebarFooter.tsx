import { Github, Settings, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import { cn } from '../../../../lib/utils';

type SidebarFooterProps = {
  updateAvailable: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  onOpenTrash: () => void;
  isTrashActive: boolean;
  t: TFunction;
};

export default function SidebarFooter({ onShowSettings, onOpenTrash, isTrashActive, t }: SidebarFooterProps) {
  return (
    <footer className="flex-shrink-0 border-t border-border p-2" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}>
      <button
        type="button"
        onClick={onOpenTrash}
        className={cn(
          'flex h-9 w-full items-center gap-2 px-2.5 text-xs transition-colors hover:bg-muted hover:text-foreground',
          isTrashActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
        )}
      >
        <Trash2 className="h-4 w-4" />
        {t('common:projectDashboard.trashTitle')}
      </button>
      <button
        type="button"
        onClick={onShowSettings}
        className="flex h-9 w-full items-center gap-2 px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Settings className="h-4 w-4" />
        {t('actions.settings')}
      </button>
      <a
        href="https://github.com/medicinehelp/Auto-meta-analysis"
        target="_blank"
        rel="noreferrer"
        className="flex h-9 w-full items-center gap-2 px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Github className="h-4 w-4" />
        Open source
      </a>
    </footer>
  );
}
