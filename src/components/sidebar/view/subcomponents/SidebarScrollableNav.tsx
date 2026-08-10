import { Blocks, BookOpen, Library } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { AppTab } from '../../../../types/app';

type SidebarScrollableNavProps = {
  activeTab: AppTab;
  onOpenDashboard: () => void;
  onOpenSkills: () => void;
  onOpenNews: () => void;
  onOpenReferences: () => void;
  t: TFunction;
};

export default function SidebarScrollableNav({ activeTab, onOpenSkills, onOpenNews, onOpenReferences, t }: SidebarScrollableNavProps) {
  return (
    <div className="space-y-1 px-2 pb-2">
      <button
        type="button"
        onClick={onOpenSkills}
        className={`flex h-9 w-full items-center gap-2 px-2.5 text-sm font-medium transition-colors ${activeTab === 'skills' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'}`}
      >
        <Blocks className="h-4 w-4" />
        {t('common:projectDashboard.skillsTitle')}
      </button>
      <button
        type="button"
        onClick={onOpenNews}
        className={`flex h-9 w-full items-center gap-2 px-2.5 text-sm font-medium transition-colors ${activeTab === 'news' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'}`}
      >
        <BookOpen className="h-4 w-4" />
        PubMed
      </button>
      <button
        type="button"
        onClick={onOpenReferences}
        className={`flex h-9 w-full items-center gap-2 px-2.5 text-sm font-medium transition-colors ${activeTab === 'references' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'}`}
      >
        <Library className="h-4 w-4" />
        Zotero 文献库
      </button>
    </div>
  );
}
