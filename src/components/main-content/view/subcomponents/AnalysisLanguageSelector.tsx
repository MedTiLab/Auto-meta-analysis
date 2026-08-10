import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Code2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Project } from '../../../../types/app';
import {
  ANALYSIS_LANGUAGE_PREFERENCES,
  type AnalysisLanguagePreference,
  getStoredAnalysisLanguagePreference,
  setStoredAnalysisLanguagePreference,
} from '../../../../utils/analysisLanguagePreference';

interface AnalysisLanguageSelectorProps {
  selectedProject: Project | null;
  variant?: 'inline' | 'menu';
}

type LanguageOptionMeta = {
  value: AnalysisLanguagePreference;
  icon: JSX.Element;
};

function AnalysisLanguageIcon({ language }: { language: AnalysisLanguagePreference }) {
  if (language === 'python') {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0" aria-hidden="true">
        <path
          d="M12.2 2.2c-4.4 0-4 2-4 2v2h4.1v1H6.6c0 0-2.8-.3-2.8 4.1 0 4.4 2.4 4.2 2.4 4.2h1.4v-2c0 0-.1-2.4 2.4-2.4h4.1c0 0 2.3 0 2.3-2.3V4.6c0 0 .4-2.4-4.2-2.4Z"
          fill="#3776AB"
        />
        <circle cx="10.2" cy="4.8" r="1" fill="#fff" />
        <path
          d="M11.8 21.8c4.4 0 4-2 4-2v-2h-4.1v-1h5.7c0 0 2.8.3 2.8-4.1 0-4.4-2.4-4.2-2.4-4.2h-1.4v2c0 0 .1 2.4-2.4 2.4H9.9c0 0-2.3 0-2.3 2.3v4.1c0 0-.4 2.4 4.2 2.4Z"
          fill="#FFD43B"
        />
        <circle cx="13.8" cy="19.2" r="1" fill="#fff" />
      </svg>
    );
  }

  if (language === 'r') {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0" aria-hidden="true">
        <ellipse cx="11.4" cy="12" rx="8.4" ry="5.8" fill="#C6CDD3" />
        <ellipse cx="11.7" cy="12" rx="5.2" ry="3.2" fill="#fff" />
        <text
          x="8.2"
          y="16.1"
          fontSize="11"
          fontWeight="700"
          fill="#276DC3"
          fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        >
          R
        </text>
      </svg>
    );
  }

  return <Code2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />;
}

const MENU_OPTIONS: LanguageOptionMeta[] = [
  { value: 'python', icon: <AnalysisLanguageIcon language="python" /> },
  { value: 'r', icon: <AnalysisLanguageIcon language="r" /> },
  { value: 'auto', icon: <AnalysisLanguageIcon language="auto" /> },
];

export default function AnalysisLanguageSelector({
  selectedProject,
  variant = 'inline',
}: AnalysisLanguageSelectorProps) {
  const { t } = useTranslation('chat');
  const containerRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState<AnalysisLanguagePreference>(() => (
    getStoredAnalysisLanguagePreference(selectedProject)
  ));
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setValue(getStoredAnalysisLanguagePreference(selectedProject));
  }, [selectedProject?.fullPath, selectedProject?.name]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  if (!selectedProject) {
    return null;
  }

  if (variant === 'menu') {
    const currentOption = MENU_OPTIONS.find((option) => option.value === value) || MENU_OPTIONS[0];

    return (
      <div
        className="relative"
        ref={containerRef}
      >
        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
            isOpen ? 'bg-primary/8 text-foreground' : 'text-foreground/88 hover:bg-muted/60'
          }`}
          aria-label={t('analysisLanguage.selector.label')}
          title={t('analysisLanguage.selector.description')}
        >
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <Code2 className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{t('analysisLanguage.selector.title')}</span>
          </span>

          <span className="flex items-center gap-2 text-muted-foreground">
            {currentOption.icon}
            <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'translate-x-0.5' : ''}`} />
          </span>
        </button>

        {isOpen && (
          <div className="absolute right-full top-0 z-[60] mr-2 min-w-[12rem] overflow-hidden rounded-2xl border border-border bg-background p-1.5 shadow-2xl">
            {MENU_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  const nextValue = setStoredAnalysisLanguagePreference(selectedProject, option.value);
                  setValue(nextValue);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                  option.value === value
                    ? 'bg-primary/8 text-foreground'
                    : 'text-foreground/88 hover:bg-muted/60'
                }`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  {option.icon}
                  <span className="truncate">{t(`analysisLanguage.options.${option.value}`)}</span>
                </span>

                {option.value === value ? (
                  <Check className="h-4 w-4 flex-shrink-0 text-foreground" />
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <label
      className="hidden md:flex items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground"
      title={t('analysisLanguage.selector.description')}
    >
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <Code2 className="h-3.5 w-3.5" />
        <span>{t('analysisLanguage.selector.title')}</span>
      </span>

      <select
        value={value}
        onChange={(event) => {
          const nextValue = setStoredAnalysisLanguagePreference(
            selectedProject,
            event.target.value as AnalysisLanguagePreference,
          );
          setValue(nextValue);
        }}
        className="min-w-[96px] border-0 bg-transparent p-0 text-xs font-medium text-foreground focus:outline-none"
        aria-label={t('analysisLanguage.selector.label')}
      >
        {ANALYSIS_LANGUAGE_PREFERENCES.map((option) => (
          <option key={option} value={option}>
            {t(`analysisLanguage.options.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
