import type { Dispatch, SetStateAction } from 'react';
import { HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppTab, Project } from '../../../types/app';

type MetaAnalysisHelpTipProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  selectedProject: Project | null;
  isMobile: boolean;
};

export default function MetaAnalysisHelpTip({
  activeTab,
  setActiveTab,
  selectedProject,
  isMobile,
}: MetaAnalysisHelpTipProps) {
  const { t } = useTranslation('common');

  if (!selectedProject || activeTab === 'metaHelp') {
    return null;
  }

  const openHelp = () => {
    setActiveTab('metaHelp');
  };

  const positionClass = isMobile
    ? 'bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-3'
    : 'bottom-5 right-5';

  return (
    <button
      type="button"
      onClick={openHelp}
      title={t('metaHelpTip.compactTitle')}
      className={`fixed ${positionClass} z-40 flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-background text-primary shadow-xl ring-1 ring-foreground/5 transition-all hover:-translate-y-0.5 hover:bg-primary/8 focus:outline-none focus:ring-2 focus:ring-primary/35`}
      aria-label={t('metaHelpTip.openAria')}
    >
      <HelpCircle className="h-5 w-5" />
    </button>
  );
}
