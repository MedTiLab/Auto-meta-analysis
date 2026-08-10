import { useState, useRef, useEffect } from 'react';
import { Brain, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { thinkingModes } from '../../constants/thinkingModes';

type ThinkingModeSelectorProps = {
  selectedMode: string;
  onModeChange: (modeId: string) => void;
  onClose?: () => void;
  className?: string;
  compact?: boolean;
};

function ThinkingModeSelector({
  selectedMode,
  onModeChange,
  onClose,
  className = '',
  compact,
}: ThinkingModeSelectorProps) {
  const { t } = useTranslation('chat');

  const translatedModes = thinkingModes.map(mode => {
    return {
      ...mode,
      name: t(`thinkingMode.modes.${mode.id}.name`),
      description: t(`thinkingMode.modes.${mode.id}.description`),
    };
  });

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        if (onClose) onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const currentMode = translatedModes.find(mode => mode.id === selectedMode) || translatedModes[0];
  const IconComponent = currentMode.icon || Brain;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`${compact ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-lg'} flex items-center justify-center border border-border/60 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary/30 dark:bg-gray-800 dark:text-slate-200 dark:hover:bg-gray-700`}
        title={t('thinkingMode.buttonTitle', { mode: currentMode.name })}
      >
        <IconComponent className={`${compact ? 'w-3.5 h-3.5' : 'w-5 h-5'} ${currentMode.color}`} />
      </button>

      {isOpen && (
        <div className={`absolute bottom-full right-0 mb-2 ${compact ? 'w-52' : 'w-64'} max-h-[min(400px,70vh)] bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-y-auto`}>
          <div className={`${compact ? 'px-2.5 py-2' : 'p-3'} border-b border-gray-200 dark:border-gray-700`}>
            <div className="flex items-center justify-between">
              <h3 className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-gray-900 dark:text-white`}>
                {t('thinkingMode.selector.title')}
              </h3>
              <button
                onClick={() => {
                  setIsOpen(false);
                  if (onClose) onClose();
                }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} text-gray-500`} />
              </button>
            </div>
            {!compact && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('thinkingMode.selector.description')}
              </p>
            )}
          </div>

          <div className="py-0.5">
            {translatedModes.map((mode) => {
              const ModeIcon = mode.icon;
              const isSelected = mode.id === selectedMode;

              return (
                <button
                  key={mode.id}
                  onClick={() => {
                    onModeChange(mode.id);
                    setIsOpen(false);
                    if (onClose) onClose();
                  }}
                  className={`w-full ${compact ? 'px-2.5 py-1.5' : 'px-4 py-3'} text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${isSelected ? 'bg-gray-50 dark:bg-gray-700' : ''
                    }`}
                >
                  <div className={`flex items-start ${compact ? 'gap-2' : 'gap-3'}`}>
                    <div className={`mt-0.5 ${mode.color}`}>
                      <ModeIcon className={`${compact ? 'w-3.5 h-3.5' : 'w-5 h-5'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-medium ${compact ? 'text-[11px]' : 'text-sm'} ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
                          }`}>
                          {mode.name}
                        </span>
                        {isSelected && (
                          <span className={`${compact ? 'text-[9px] px-1.5 py-px' : 'text-xs px-2 py-0.5'} bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded`}>
                            {t('thinkingMode.selector.active')}
                          </span>
                        )}
                      </div>
                      {!compact && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {mode.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {!compact && (
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <p className="text-xs text-gray-600 dark:text-gray-400">
                <strong>Tip:</strong> {t('thinkingMode.selector.tip')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ThinkingModeSelector;
