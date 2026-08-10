import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AttachedPrompt } from '../../types/types';

interface PromptBadgeDropdownProps {
  prompt: AttachedPrompt;
  onRemove: () => void;
  onUpdate: (text: string) => void;
}

export default function PromptBadgeDropdown({ prompt, onRemove, onUpdate }: PromptBadgeDropdownProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const [editText, setEditText] = useState(prompt.promptText);

  // Sync editText only when switching to a different scenario
  useEffect(() => {
    setEditText(prompt.promptText);
  }, [prompt.scenarioId]);

  const handleBlur = useCallback(() => {
    if (editText !== prompt.promptText) {
      onUpdate(editText);
    }
  }, [editText, prompt.promptText, onUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, []);

  return (
    <div className="px-3 pt-2.5 pb-1">
      {/* Badge chip */}
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/8 border border-primary/20 text-sm">
        <span className="text-sm leading-none">{prompt.scenarioIcon}</span>
        <span className="font-medium text-foreground/80 text-xs">{prompt.scenarioTitle}</span>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="ml-0.5 p-0.5 hover:bg-primary/10 rounded transition-colors"
          aria-expanded={isOpen}
          aria-controls="prompt-edit-area"
          title={isOpen ? t('attachedPrompt.hidePrompt') : t('attachedPrompt.showPrompt')}
        >
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-0.5 transition-colors hover:bg-muted"
          title={t('attachedPrompt.remove')}
        >
          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>

      {/* Dropdown editable area */}
      {isOpen && (
        <div className="mt-2 mb-1" id="prompt-edit-area">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-full p-2.5 text-sm bg-muted/30 border border-border/40 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary/20 text-foreground/80 min-h-[60px] max-h-[120px]"
            rows={3}
          />
        </div>
      )}
    </div>
  );
}
