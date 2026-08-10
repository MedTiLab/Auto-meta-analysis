import React from 'react';
import { useTranslation } from 'react-i18next';
import ThinkingModeSelector from './ThinkingModeSelector';
import type { PermissionMode } from '../../types/types';

interface ChatInputControlsProps {
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  thinkingMode: string;
  setThinkingMode: React.Dispatch<React.SetStateAction<string>>;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
  hideCommandMenu?: boolean;
  compact?: boolean;
}

export default function ChatInputControls({
  permissionMode,
  onModeSwitch,
  thinkingMode,
  setThinkingMode,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
  hideCommandMenu,
  compact,
}: ChatInputControlsProps) {
  const { t } = useTranslation('chat');
  return (
    <>
      <button
        type="button"
        onClick={onModeSwitch}
        className={`${compact ? 'w-[8.5rem] whitespace-nowrap truncate px-2 py-1 rounded-lg text-[11px] text-center justify-center' : 'px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs sm:text-sm'} font-medium border transition-all duration-200 ${
          permissionMode === 'default'
            ? 'bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted'
            : permissionMode === 'acceptEdits'
              ? 'bg-primary/10 text-primary border-primary/25 hover:bg-primary/15'
              : 'bg-primary/5 text-primary border-primary/20 hover:bg-primary/10'
        }`}
        title={t('input.clickToChangeMode')}
      >
        <div className={`flex items-center gap-1.5 ${compact ? 'justify-center' : ''}`}>
          <div
            className={`w-1.5 h-1.5 shrink-0 rounded-full ${
              permissionMode === 'default'
                ? 'bg-muted-foreground'
                : permissionMode === 'acceptEdits'
                  ? 'bg-primary'
                  : 'bg-primary'
            }`}
          />
          <span>
            {permissionMode === 'default' && t('permissionModes.default')}
            {permissionMode === 'acceptEdits' && t('permissionModes.acceptEdits')}
            {permissionMode === 'plan' && t('permissionModes.plan')}
          </span>
        </div>
      </button>

      <ThinkingModeSelector
        selectedMode={thinkingMode}
        onModeChange={setThinkingMode}
        onClose={() => {}}
        className=""
        compact={compact}
      />

      {!hideCommandMenu && (
        <button
          type="button"
          onClick={onToggleCommandMenu}
          className="relative w-7 h-7 sm:w-8 sm:h-8 text-muted-foreground hover:text-foreground rounded-lg flex items-center justify-center transition-colors hover:bg-accent/60"
          title={t('input.showAllCommands')}
        >
          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
            />
          </svg>
          {slashCommandsCount > 0 && (
            <span
              className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center"
            >
              {slashCommandsCount}
            </span>
          )}
        </button>
      )}

      {hasInput && !compact && (
        <button
          type="button"
          onClick={onClearInput}
          className="w-7 h-7 sm:w-8 sm:h-8 bg-card hover:bg-accent/60 border border-border/50 rounded-lg flex items-center justify-center transition-all duration-200 group shadow-sm"
          title={t('input.clearInput', { defaultValue: 'Clear input' })}
        >
          <svg
            className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground group-hover:text-foreground transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {isUserScrolledUp && hasMessages && !compact && (
        <button
          onClick={onScrollToBottom}
          className="w-7 h-7 sm:w-8 sm:h-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm flex items-center justify-center transition-all duration-200 hover:scale-105"
          title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
        >
          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </>
  );
}
