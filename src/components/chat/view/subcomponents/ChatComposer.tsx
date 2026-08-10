import CommandMenu from '../../../CommandMenu';
import ClaudeStatus from '../../../ClaudeStatus';
import ImageAttachment from './ImageAttachment';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import ChatInputControls from './ChatInputControls';
import ChatTaskProgressPill from './ChatTaskProgressPill';
import ReferencePicker from '../../../references/view/ReferencePicker';
import PromptBadgeDropdown from './PromptBadgeDropdown';
import ModelSelector from './ModelSelector';
import SkillDropdown from './SkillDropdown';
import { FileText, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  SetStateAction,
  TouchEvent,
} from 'react';

import type { AttachedPrompt, PendingPermissionRequest, PermissionMode, Provider } from '../../types/types';
import type { Project } from '../../../../types/app';
import type { ProjectFileChatContextItem } from '../../../../utils/projectFileChatContext';
import { CLAUDE_MODELS, normalizeClaudeStoredModelSelection } from '../../../../../shared/modelConstants';

interface MentionableFile {
  name: string;
  path: string;
}

function getFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  claudeStatus: { text: string; tokens: number; can_interrupt: boolean } | null;
  isLoading: boolean;
  onAbortSession: () => void;
  onStartTask?: (prompt?: string, task?: {
    id?: string | number | null;
    title?: string | null;
    stage?: string | null;
  } | null) => void;
  onShowAllTasks?: () => void;
  provider: Provider | string;
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  thinkingMode: string;
  setThinkingMode: Dispatch<SetStateAction<string>>;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  attachedFiles: File[];
  onRemoveFile: (index: number) => void;
  attachedProjectFiles: ProjectFileChatContextItem[];
  onRemoveProjectFile: (index: number) => void;
  uploadingFiles: Map<string, number>;
  fileErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openFilePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  isInputFocused?: boolean;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
  projectName?: string;
  selectedProject?: Project | null;
  onReferenceContext?: (context: string) => void;
  attachedPrompt: AttachedPrompt | null;
  onRemoveAttachedPrompt: () => void;
  onUpdateAttachedPrompt: (promptText: string) => void;
  setAttachedPrompt?: Dispatch<SetStateAction<AttachedPrompt | null>>;
  centered?: boolean;
  claudeModel: string;
  setClaudeModel: Dispatch<SetStateAction<string>>;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  claudeStatus,
  isLoading,
  onAbortSession,
  onStartTask,
  onShowAllTasks,
  provider,
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
  onSubmit,
  isDragActive,
  attachedFiles,
  onRemoveFile,
  attachedProjectFiles,
  onRemoveProjectFile,
  uploadingFiles,
  fileErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openFilePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  setInput,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  isInputFocused,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
  projectName,
  selectedProject,
  onReferenceContext,
  attachedPrompt,
  onRemoveAttachedPrompt,
  onUpdateAttachedPrompt,
  setAttachedPrompt,
  centered,
  claudeModel,
  setClaudeModel,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const AnyCommandMenu = CommandMenu as any;
  const textareaRect = textareaRef.current?.getBoundingClientRect();
  const commandMenuPosition = {
    top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
    left: textareaRect ? textareaRect.left : 16,
    bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
  };

  const hasQuestionPanel = pendingPermissionRequests.some((request) => request.toolName === 'AskUserQuestion');

  const mobileFloatingClass = isInputFocused
    ? 'max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:z-50 max-sm:bg-background max-sm:shadow-[0_-4px_20px_rgba(0,0,0,0.15)]'
    : isLoading
      ? 'max-sm:fixed max-sm:left-0 max-sm:right-0 max-sm:bottom-[var(--mobile-nav-total)] max-sm:z-40 max-sm:bg-background max-sm:shadow-[0_-4px_20px_rgba(0,0,0,0.12)]'
      : '';

  useEffect(() => {
    if (!isLoading || !isInputFocused) {
      return;
    }

    textareaRef.current?.blur();
    onInputFocusChange?.(false);
  }, [isInputFocused, isLoading, onInputFocusChange, textareaRef]);

  const maxWidthClass = 'max-w-5xl';

  const handleModelChange = (value: string) => {
    const normalizedModel = normalizeClaudeStoredModelSelection(value);
    setClaudeModel(normalizedModel);
    localStorage.setItem('claude-model', normalizedModel);
  };

  return (
    <div className={`px-2 pt-0 sm:px-4 sm:pt-1 md:px-4 md:pt-1 flex-shrink-0 pb-2 sm:pb-4 md:pb-6 ${mobileFloatingClass}`}>
      <div className={`${maxWidthClass} mx-auto`}>
        <PermissionRequestsBanner
          provider={provider}
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
        />
      </div>

      {!hasQuestionPanel && (
        <form onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void} className={`relative mx-auto ${maxWidthClass}`}>
          {!centered && (
            <div className="pointer-events-none absolute bottom-full left-0 right-0 pb-1.5">
              <div className="relative flex w-full flex-wrap items-center gap-2 px-2">
                <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                  {isLoading && (
                    <div className="pointer-events-auto">
                      <ClaudeStatus
                        status={claudeStatus}
                        isLoading={isLoading}
                        onAbort={onAbortSession}
                        provider={provider}
                      />
                    </div>
                  )}
                  {isUserScrolledUp && hasMessages && (
                    <button
                      type="button"
                      onClick={onScrollToBottom}
                      className="pointer-events-auto h-7 w-7 flex-shrink-0 rounded-lg bg-primary text-primary-foreground shadow-sm transition-all duration-200 hover:scale-105 hover:bg-primary/90 sm:h-8 sm:w-8"
                      title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                    >
                      <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="pointer-events-auto ml-auto flex min-w-0 justify-end">
                  <ChatTaskProgressPill
                    compact
                    hideWhenEmpty
                    onStartTask={onStartTask}
                    onShowAllTasks={onShowAllTasks}
                  />
                </div>
              </div>
            </div>
          )}

          {isDragActive && (
            <div className="absolute inset-0 bg-primary/15 border-2 border-dashed border-primary/50 rounded-3xl flex items-center justify-center z-50">
              <div className="bg-card rounded-xl p-4 shadow-lg border border-border/30">
                <svg className="w-8 h-8 text-primary mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">{t('input.dropFilesHere')}</p>
              </div>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div className="mb-2 p-2 bg-muted/40 rounded-xl">
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => (
                  <ImageAttachment
                    key={index}
                    file={file}
                    onRemove={() => onRemoveFile(index)}
                    uploadProgress={uploadingFiles.get(getFileKey(file))}
                  />
                ))}
              </div>
            </div>
          )}

          {attachedProjectFiles.length > 0 && (
            <div className="mb-2 rounded-xl bg-muted/40 p-2">
              <div className="flex flex-wrap gap-2">
                {attachedProjectFiles.map((file, index) => (
                  <div
                    key={`${file.path}:${index}`}
                    className="flex max-w-full items-center gap-2 rounded-lg border border-border/50 bg-background/80 px-2.5 py-1.5 text-sm"
                  >
                    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{file.name}</div>
                      <div className="max-w-[260px] truncate font-mono text-[11px] text-muted-foreground">
                        {file.path}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => onRemoveProjectFile(index)}
                      aria-label={t('attachedPrompt.remove')}
                      title={t('attachedPrompt.remove')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fileErrors.size > 0 && (
            <div className="mb-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
              {[...new Set(fileErrors.values())].map((error) => (
                <div key={error} className="truncate">
                  {error}
                </div>
              ))}
            </div>
          )}

          {showFileDropdown && filteredFiles.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl shadow-lg max-h-48 overflow-y-auto z-50">
              {filteredFiles.map((file, index) => (
                <div
                  key={file.path}
                  className={`px-4 py-3 cursor-pointer border-b border-border/30 last:border-b-0 touch-manipulation ${
                    index === selectedFileIndex
                      ? 'bg-primary/8 text-primary'
                      : 'hover:bg-accent/50 text-foreground'
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectFile(file);
                  }}
                >
                  <div className="font-medium text-sm">{file.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{file.path}</div>
                </div>
              ))}
            </div>
          )}

          {showReferencePicker && projectName && onReferenceContext && (
            <ReferencePicker
              projectName={projectName}
              onSelect={(context) => {
                onReferenceContext?.(context);
              }}
              onClose={() => setShowReferencePicker(false)}
            />
          )}

          <AnyCommandMenu
            commands={filteredCommands}
            selectedIndex={selectedCommandIndex}
            onSelect={onCommandSelect}
            onClose={onCloseCommandMenu}
            position={commandMenuPosition}
            isOpen={isCommandMenuOpen}
            frequentCommands={frequentCommands}
          />

          <div
            {...getRootProps()}
            className={`relative bg-card/80 backdrop-blur-sm rounded-3xl shadow-sm border border-border/75 focus-within:shadow-md focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-200 ${
              isTextareaExpanded ? 'chat-input-expanded' : ''
            }`}
          >
            <input {...getInputProps()} />
            {attachedPrompt && (
              <PromptBadgeDropdown
                prompt={attachedPrompt}
                onRemove={onRemoveAttachedPrompt}
                onUpdate={onUpdateAttachedPrompt}
              />
            )}

            <div ref={inputHighlightRef} aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
              <div className="chat-input-placeholder block w-full py-1.5 pl-5 pr-16 text-base leading-6 whitespace-pre-wrap break-words text-transparent sm:py-4">
                {renderInputWithMentions(input)}
              </div>
            </div>

            <div className="relative z-10">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={onInputChange}
                onClick={onTextareaClick}
                onKeyDown={onTextareaKeyDown}
                onPaste={onTextareaPaste}
                onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
                onFocus={() => onInputFocusChange?.(true)}
                onBlur={() => onInputFocusChange?.(false)}
                onInput={onTextareaInput}
                placeholder={placeholder}
                disabled={isLoading}
                className="chat-input-placeholder block min-h-[50px] max-h-[40vh] w-full resize-none overflow-y-auto rounded-3xl bg-transparent py-1.5 pl-5 pr-16 text-base leading-6 text-foreground transition-all duration-200 placeholder-muted-foreground/50 focus:outline-none disabled:opacity-50 sm:min-h-[80px] sm:max-h-[300px] sm:py-4"
                style={{ height: '50px' }}
              />

              <button
                type="button"
                disabled={(!input.trim() && attachedFiles.length === 0 && attachedProjectFiles.length === 0 && !attachedPrompt) || isLoading}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSubmit(event);
                }}
                onTouchStart={(event) => {
                  event.preventDefault();
                  onSubmit(event);
                }}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1 focus:ring-offset-background"
              >
                <svg className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-primary-foreground transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>

              {!centered && (
                <div
                  className={`absolute bottom-1 left-5 right-14 sm:right-40 text-xs text-muted-foreground/50 pointer-events-none hidden sm:block transition-opacity duration-200 ${
                    input.trim() ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  {sendByCtrlEnter ? t('input.hintText.ctrlEnter') : t('input.hintText.enter')}
                </div>
              )}
            </div>

            <div className="relative z-10 border-t border-border/30">
              <div className="flex items-center gap-2 px-4 py-2 max-sm:flex-wrap">
                <div className="flex items-center gap-2.5 max-sm:flex-wrap">
                  <button
                    type="button"
                    onClick={openFilePicker}
                    className="flex items-center justify-center rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent/60"
                    title={t('input.attachFiles')}
                  >
                    <Plus className="h-4 w-4" />
                  </button>

                  {projectName && onReferenceContext && (
                    <button
                      type="button"
                      onClick={() => setShowReferencePicker((previous) => !previous)}
                      className="rounded-full p-1 transition-colors hover:bg-accent/60"
                      title={t('input.attachReferences')}
                    >
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </button>
                  )}

                  {!centered && setAttachedPrompt && (
                    <SkillDropdown
                      setInput={setInput}
                      textareaRef={textareaRef}
                      setAttachedPrompt={setAttachedPrompt}
                      t={t}
                      selectedProject={selectedProject}
                    />
                  )}

                </div>

                <div className="flex-1" />

                <div className="flex items-center gap-1.5 max-sm:ml-auto max-sm:flex-wrap">
                  <ModelSelector
                    value={claudeModel}
                    options={CLAUDE_MODELS.OPTIONS}
                    onChange={handleModelChange}
                  />
                  <ChatInputControls
                    permissionMode={permissionMode}
                    onModeSwitch={onModeSwitch}
                    thinkingMode={thinkingMode}
                    setThinkingMode={setThinkingMode}
                    slashCommandsCount={slashCommandsCount}
                    onToggleCommandMenu={onToggleCommandMenu}
                    hasInput={hasInput}
                    onClearInput={onClearInput}
                    isUserScrolledUp={isUserScrolledUp}
                    hasMessages={hasMessages}
                    onScrollToBottom={onScrollToBottom}
                    hideCommandMenu
                    compact
                  />
                </div>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
