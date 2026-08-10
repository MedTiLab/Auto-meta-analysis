import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';
import type { FileRejection } from 'react-dropzone';
import { useTranslation } from 'react-i18next';
import { authenticatedFetch } from '../../../utils/api';
import { getStoredAnalysisLanguagePreference } from '../../../utils/analysisLanguagePreference';
import { getProjectKind } from '../../../utils/projectKind';
import { isTelemetryEnabled } from '../../../utils/telemetry';

import { grantToolPermission } from '../utils/chatPermissions';
import {
  clearSessionAbortRequested,
  getProviderSettingsKey,
  markSessionAbortRequested,
  persistSessionTimerStart,
  safeLocalStorage,
} from '../utils/chatStorage';
import { consumeWorkspaceQaDraft, WORKSPACE_QA_DRAFT_EVENT } from '../../../utils/workspaceQa';
import { consumeReferenceChatDraft, REFERENCE_CHAT_DRAFT_EVENT } from '../../../utils/referenceChatDraft';
import { consumeChatPromptDraft, CHAT_PROMPT_DRAFT_EVENT } from '../../../utils/chatPromptDraft';
import {
  consumeProjectFileChatContext,
  PROJECT_FILE_CHAT_CONTEXT_EVENT,
  type ProjectFileChatContextItem,
} from '../../../utils/projectFileChatContext';
import type {
  AttachedPrompt,
  ChatAttachment,
  ChatImage,
  ChatMessage,
  PendingPermissionRequest,
  PermissionMode,
  TokenBudget,
} from '../types/types';
import { useFileMentions } from './useFileMentions';
import { type SlashCommand, useSlashCommands } from './useSlashCommands';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import { escapeRegExp } from '../utils/chatFormatting';

const DEFAULT_CLAUDE_THINKING_MODE = 'none';

type ClaudeEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type ClaudeThinkingOptions = {
  thinking?: { type: 'adaptive' };
  effort?: ClaudeEffortLevel;
};

const isClaudeEffortLevel = (modeId: string): modeId is ClaudeEffortLevel =>
  modeId === 'low'
  || modeId === 'medium'
  || modeId === 'high'
  || modeId === 'xhigh'
  || modeId === 'max';

const getClaudeThinkingOptions = (modeId: string): ClaudeThinkingOptions =>
  isClaudeEffortLevel(modeId)
    ? { thinking: { type: 'adaptive' }, effort: modeId }
    : {};

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type PendingTaskContext = {
  id?: string | number | null;
  title?: string | null;
  stage?: string | null;
  status?: string | null;
  priority?: string | null;
  description?: string | null;
  details?: string | null;
  testStrategy?: string | null;
  taskType?: string | null;
  nextActionPrompt?: string | null;
  whyNext?: string | null;
  requiredInputs?: string[] | null;
  suggestedSkills?: string[] | null;
  dependencies?: Array<string | number> | null;
};

interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  claudeModel: string;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  isLoading: boolean;
  canAbortSession: boolean;
  tokenBudget: TokenBudget | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionActive?: (sessionId?: string | null) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  pendingViewSessionRef: { current: PendingViewSession | null };
  scrollToBottom: () => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSessionMessages?: Dispatch<SetStateAction<any[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: Dispatch<SetStateAction<{ text: string; tokens: number; can_interrupt: boolean; startTime?: number } | null>>;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
}

declare global {
  interface Window {
    __medautodataChatMetrics?: {
      enabled: boolean;
      lastSendAt?: number;
      lastProvider?: SessionProvider;
      lastSessionId?: string | null;
      lastCommandType?: string;
      firstTokenAt?: number;
    };
  }
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

interface UploadedProjectFile {
  name?: string;
  path?: string;
  size?: number;
}

const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

const PROGRAMMATIC_SUBMIT_MAX_RETRIES = 12;
const PROGRAMMATIC_SUBMIT_RETRY_DELAY_MS = 50;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
const CHAT_ATTACHMENT_STORAGE_SCOPE = 'project-chat-attachments';

const isChatMetricsEnabled = () => {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('debug-ws-metrics') === '1';
  } catch {
    return false;
  }
};

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
]);

const PDF_EXTENSION = '.pdf';

function getAttachmentKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function getFileExtension(file: File) {
  const lowerName = file.name.toLowerCase();
  const lastDot = lowerName.lastIndexOf('.');
  return lastDot >= 0 ? lowerName.slice(lastDot) : '';
}

function isImageAttachment(file: File) {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(getFileExtension(file));
}

function isPdfAttachment(file: File) {
  return file.type === 'application/pdf' || getFileExtension(file) === PDF_EXTENSION;
}

function getAttachmentKind(file: File) {
  if (isImageAttachment(file)) {
    return 'image';
  }
  if (isPdfAttachment(file)) {
    return 'pdf';
  }
  return 'file';
}

function getAttachmentKindFromPath(filePath: string): ChatAttachment['kind'] {
  const normalizedPath = String(filePath || '').toLowerCase();
  const lastDot = normalizedPath.lastIndexOf('.');
  const extension = lastDot >= 0 ? normalizedPath.slice(lastDot) : '';

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }

  if (extension === PDF_EXTENSION) {
    return 'pdf';
  }

  return 'file';
}

function formatRejectedFileMessage(rejection: FileRejection) {
  const attachmentKey = getAttachmentKey(rejection.file);
  const name = rejection.file?.name || 'Unknown file';
  const messages = rejection.errors.map((error) => {
    if (error.code === 'file-too-large') {
      return 'File too large (max 50MB)';
    }
    if (error.code === 'too-many-files') {
      return 'Too many files (max 5)';
    }
    return error.message;
  });

  return {
    attachmentKey,
    message: `${name}: ${messages.join(', ') || 'File rejected'}`,
  };
}

const isTemporarySessionId = (sessionId: string | null | undefined) =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

const getRouteSessionId = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const match = window.location.pathname.match(/^\/session\/([^/]+)$/);
  if (!match?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  claudeModel,
  permissionMode,
  cyclePermissionMode,
  isLoading,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionActive,
  onInputFocusChange,
  onFileOpen,
  onShowSettings,
  pendingViewSessionRef,
  scrollToBottom,
  setChatMessages,
  setSessionMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
}: UseChatComposerStateArgs) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachedProjectFiles, setAttachedProjectFiles] = useState<ProjectFileChatContextItem[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, number>>(new Map());
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [thinkingMode, setThinkingMode] = useState(DEFAULT_CLAUDE_THINKING_MODE);
  const [intakeGreeting, setIntakeGreeting] = useState<string | null>(null);
  const [pendingStageTagKeys, setPendingStageTagKeys] = useState<string[]>([]);
  const [pendingTaskContext, setPendingTaskContext] = useState<PendingTaskContext | null>(null);
  const [attachedPrompt, setAttachedPrompt] = useState<AttachedPrompt | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const handleSubmitRef = useRef<
    ((event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => Promise<void>) | null
  >(null);
  const submitInFlightRef = useRef(false);
  const inputValueRef = useRef(input);
  const abortTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (abortTimeoutRef.current) {
        clearTimeout(abortTimeoutRef.current);
        abortTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setPendingStageTagKeys([]);
    setPendingTaskContext(null);
  }, [selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    if (!isLoading) {
      submitInFlightRef.current = false;
    }
  }, [isLoading]);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'clear':
          setChatMessages([]);
          setSessionMessages?.([]);
          break;

        case 'help':
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: data.content,
              timestamp: Date.now(),
            },
          ]);
          break;

        case 'model': {
          const availableModels = Object.entries(data.available || {})
            .map(([modelProvider, models]) => {
              const label = modelProvider.charAt(0).toUpperCase() + modelProvider.slice(1);
              return `${label}: ${(Array.isArray(models) ? models : []).join(', ')}`;
            })
            .join('\n\n');
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: `**Current Model**: ${data.current.model}\n\n**Available Models**:\n\n${availableModels}`,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'cost': {
          const costMessage = `**Token Usage**: ${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**Estimated Cost**:\n- Input: $${data.cost.input}\n- Output: $${data.cost.output}\n- **Total**: $${data.cost.total}\n\n**Model**: ${data.model}`;
          setChatMessages((previous) => [
            ...previous,
            { type: 'assistant', content: costMessage, timestamp: Date.now() },
          ]);
          break;
        }

        case 'status': {
          const statusMessage = `**System Status**\n\n- Version: ${data.version}\n- Uptime: ${data.uptime}\n- Model: ${data.model}\n- Provider: ${data.provider}\n- Node.js: ${data.nodeVersion}\n- Platform: ${data.platform}`;
          setChatMessages((previous) => [
            ...previous,
            { type: 'assistant', content: statusMessage, timestamp: Date.now() },
          ]);
          break;
        }

        case 'memory':
          if (data.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⚠️ ${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `📝 ${data.message}\n\nPath: \`${data.path}\``,
                timestamp: Date.now(),
              },
            ]);
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        case 'rewind':
          if (data.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⚠️ ${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setChatMessages((previous) => previous.slice(0, -data.steps * 2));
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⏪ ${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          }
          break;

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [onFileOpen, onShowSettings, setChatMessages, setSessionMessages],
  );

  const handleCustomCommand = useCallback(async (result: CommandExecutionResult) => {
    const { content, hasBashCommands } = result;

    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: '❌ Command execution cancelled',
            timestamp: Date.now(),
          },
        ]);
        return;
      }
    }

    const commandContent = content || '';
    setInput(commandContent);
    inputValueRef.current = commandContent;

    // Defer submit to next tick so the command text is reflected in UI before dispatching.
    setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
      }
    }, 0);
  }, [setChatMessages]);

  const submitProgrammaticInput = useCallback((content: string) => {
    const nextContent = content || '';
    setInput(nextContent);
    inputValueRef.current = nextContent;

    const attemptSubmit = (attempt = 0) => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
        return;
      }

      if (attempt >= PROGRAMMATIC_SUBMIT_MAX_RETRIES) {
        console.warn('[Chat] Programmatic submit skipped because handleSubmit was not ready');
        return;
      }

      setTimeout(() => {
        attemptSubmit(attempt + 1);
      }, PROGRAMMATIC_SUBMIT_RETRY_DELAY_MS);
    };

    setTimeout(() => {
      attemptSubmit();
    }, 0);
  }, []);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectName: selectedProject.name,
          sessionId: currentSessionId,
          provider,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch('/api/commands/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin') {
          handleBuiltInCommand(result);
          setInput('');
          inputValueRef.current = '';
        } else if (result.type === 'custom') {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: `Error executing command: ${message}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [
      currentSessionId,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      setChatMessages,
      tokenBudget,
    ],
  );

  const {
    slashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const handleAttachmentFiles = useCallback((files: File[]) => {
    const validFiles: File[] = [];

    files.forEach((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return;
        }

        const attachmentKey = getAttachmentKey(file);

        if (!file.size) {
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(attachmentKey, `${file.name || 'Unknown file'}: Empty files are not supported`);
            return next;
          });
          return;
        }

        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(attachmentKey, `${file.name || 'Unknown file'}: File too large (max 50MB)`);
            return next;
          });
          return;
        }

        validFiles.push(file);
      } catch (error) {
        console.error('Error validating file:', error, file);
      }
    });

    if (validFiles.length > 0) {
      setFileErrors((previous) => {
        const next = new Map(previous);
        validFiles.forEach((file) => {
          next.delete(getAttachmentKey(file));
        });
        return next;
      });

      setAttachedFiles((previous) => {
        const deduped = [...previous];
        validFiles.forEach((file) => {
          const nextKey = getAttachmentKey(file);
          if (!deduped.some((existing) => getAttachmentKey(existing) === nextKey)) {
            deduped.push(file);
          }
        });
        return deduped.slice(0, MAX_ATTACHMENTS);
      });
    }
  }, []);

  const handleRejectedFiles = useCallback((rejections: FileRejection[]) => {
    if (!Array.isArray(rejections) || rejections.length === 0) {
      return;
    }

    setFileErrors((previous) => {
      const next = new Map(previous);
      rejections.forEach((rejection) => {
        const { attachmentKey, message } = formatRejectedFileMessage(rejection);
        next.set(attachmentKey, message);
      });
      return next;
    });
  }, []);

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFiles((previous) => {
      const next = [...previous];
      const [removedFile] = next.splice(index, 1);

      if (removedFile) {
        const attachmentKey = getAttachmentKey(removedFile);
        setFileErrors((previousErrors) => {
          const nextErrors = new Map(previousErrors);
          nextErrors.delete(attachmentKey);
          return nextErrors;
        });
        setUploadingFiles((previousUploads) => {
          const nextUploads = new Map(previousUploads);
          nextUploads.delete(attachmentKey);
          return nextUploads;
        });
      }

      return next;
    });
  }, []);

  const attachProjectFiles = useCallback((files: ProjectFileChatContextItem[]) => {
    if (!Array.isArray(files) || files.length === 0) {
      return;
    }

    setAttachedProjectFiles((previous) => {
      const filesByPath = new Map<string, ProjectFileChatContextItem>();
      [...previous, ...files].forEach((file) => {
        const path = String(file?.path || file?.absolutePath || '').trim();
        const name = String(file?.name || path.split('/').filter(Boolean).pop() || path).trim();
        if (!path || !name) {
          return;
        }
        filesByPath.set(path, {
          name,
          path,
          absolutePath: file.absolutePath || null,
          kind: file.kind === 'directory' ? 'directory' : 'file',
        });
      });
      return Array.from(filesByPath.values()).slice(0, MAX_ATTACHMENTS);
    });
  }, []);

  const removeAttachedProjectFile = useCallback((index: number) => {
    setAttachedProjectFiles((previous) => {
      const next = [...previous];
      next.splice(index, 1);
      return next;
    });
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (item.kind !== 'file') {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleAttachmentFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        if (files.length > 0) {
          handleAttachmentFiles(files);
        }
      }
    },
    [handleAttachmentFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_ATTACHMENT_SIZE_BYTES,
    maxFiles: MAX_ATTACHMENTS,
    onDrop: handleAttachmentFiles,
    onDropRejected: handleRejectedFiles,
    noClick: true,
    noKeyboard: true,
  });

  const uploadPreviewImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return [];
      }

      const formData = new FormData();
      files.forEach((file) => {
        formData.append('images', file);
      });

      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(selectedProject?.name || '')}/upload-images`, {
        method: 'POST',
        headers: {},
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload images');
      }

      const result = await response.json();
      return Array.isArray(result.images) ? (result.images as ChatImage[]) : [];
    },
    [selectedProject?.name],
  );

  const uploadFilesToProject = useCallback(
    async (files: File[]) => {
      if (!selectedProject || files.length === 0) {
        return [];
      }

      const formData = new FormData();
      const targetDir = `${Date.now()}`;
      formData.append('storageScope', CHAT_ATTACHMENT_STORAGE_SCOPE);
      formData.append('targetDir', targetDir);
      files.forEach((file) => {
        formData.append('files', file);
      });

      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(selectedProject.name)}/upload-files`, {
        method: 'POST',
        headers: {},
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload files');
      }

      const result = await response.json();
      return Array.isArray(result.files) ? (result.files as UploadedProjectFile[]) : [];
    },
    [selectedProject],
  );

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      event.preventDefault();
      const currentInput = inputValueRef.current;
      if (
        (
          !currentInput.trim()
          && attachedFiles.length === 0
          && attachedProjectFiles.length === 0
          && !attachedPrompt
        )
        || isLoading
        || !selectedProject
      ) {
        return;
      }

      if (submitInFlightRef.current) {
        return;
      }
      submitInFlightRef.current = true;

      const trimmedInput = currentInput.trim();
      if (trimmedInput.startsWith('/')) {
        const firstSpace = trimmedInput.indexOf(' ');
        const commandName = firstSpace > 0 ? trimmedInput.slice(0, firstSpace) : trimmedInput;
        const matchedCommand = slashCommands.find((command: SlashCommand) => command.name === commandName);

        if (matchedCommand) {
          try {
            await executeCommand(matchedCommand, trimmedInput);
            setInput('');
            inputValueRef.current = '';
            setAttachedPrompt(null);
            setAttachedFiles([]);
            setAttachedProjectFiles([]);
            setUploadingFiles(new Map());
            setFileErrors(new Map());
            resetCommandMenuState();
            setIsTextareaExpanded(false);
            if (textareaRef.current) {
              textareaRef.current.style.height = 'auto';
            }
          } finally {
            submitInFlightRef.current = false;
          }
          return;
        }
      }

      const normalizedInput = currentInput.trim();
      clearSessionAbortRequested();
      let messageContent = normalizedInput;

      // Prepend attached prompt text if present
      if (attachedPrompt) {
        if (currentInput.trim()) {
          messageContent = `${attachedPrompt.promptText}\n\n${normalizedInput}`;
        } else {
          messageContent = attachedPrompt.promptText;
        }
      }

      const claudeThinkingOptions = getClaudeThinkingOptions(thinkingMode);

      // Inject intake greeting context for the first message after auto-intake
      if (intakeGreeting) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: intakeGreeting,
            timestamp: new Date(),
          },
        ]);
        messageContent = `[Context: You have already greeted me as MedAutoData's research assistant and asked about my research project. Continue the intake conversation without re-greeting.]\n\n${messageContent}`;
        setIntakeGreeting(null);
      }

      let uploadedImages: ChatImage[] = [];
      let messageAttachments: ChatAttachment[] = [];

      if (attachedFiles.length > 0) {
        let uploadedFiles: UploadedProjectFile[] = [];

        try {
          uploadedFiles = await uploadFilesToProject(attachedFiles);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('File upload failed:', error);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error',
              content: `Failed to upload files: ${message}`,
              timestamp: new Date(),
            },
          ]);
          submitInFlightRef.current = false;
          return;
        }

        messageAttachments = attachedFiles.map((file, index) => {
          const uploadedFile = uploadedFiles[index];
          const uploadedPath = uploadedFile?.path && typeof uploadedFile.path === 'string' ? uploadedFile.path : undefined;

          return {
            name: file.name,
            kind: getAttachmentKind(file),
            mimeType: file.type || undefined,
            path: uploadedPath,
          };
        });

        const imageFiles = attachedFiles.filter((file) => isImageAttachment(file));
        if (imageFiles.length > 0) {
          try {
            uploadedImages = await uploadPreviewImages(imageFiles);
          } catch (error) {
            console.error('Image preview upload failed:', error);
          }
        }
      }

      if (attachedProjectFiles.length > 0) {
        messageAttachments = [
          ...messageAttachments,
          ...attachedProjectFiles.map((file) => ({
            name: file.name,
            kind: getAttachmentKindFromPath(file.path),
            path: file.path,
          })),
        ];
      }

      const availableFilePaths = messageAttachments
        .map((attachment) => attachment.path)
        .filter((path): path is string => Boolean(path));

      if (availableFilePaths.length > 0) {
        const fileNote = `\n\n[Files available at the following paths]\n${availableFilePaths
          .map((path, index) => `${index + 1}. ${path}`)
          .join('\n')}`;
        messageContent = `${messageContent}${fileNote}`;
      }

      const userMessage: ChatMessage = {
        type: 'user',
        content: normalizedInput,
        isOptimistic: true,
        images: uploadedImages.length > 0 ? uploadedImages : undefined,
        attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
        timestamp: new Date(),
        ...(attachedPrompt ? { attachedPrompt } : {}),
      };

      setChatMessages((previous) => [...previous, userMessage]);
      if (abortTimeoutRef.current) {
        clearTimeout(abortTimeoutRef.current);
        abortTimeoutRef.current = null;
      }
      const turnStartTime = Date.now();
      setIsLoading(true);
      setCanAbortSession(true);
      setClaudeStatus({
        text: 'Processing',
        tokens: 0,
        can_interrupt: true,
        startTime: turnStartTime,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      // Reuse the session currently represented by the route or pending view state.
      // This prevents interrupted chats from being treated as brand new sessions.
      const routedSessionId = getRouteSessionId();
      
      // If we're on the root path with no routed session AND no selected session, 
      // treat it as an explicit new session start and clear any stale provider-specific session IDs.
      const isExplicitNewSessionStart = window.location.pathname === '/' && !routedSessionId && !selectedSession?.id;
      if (isExplicitNewSessionStart && typeof window !== 'undefined') {
        sessionStorage.removeItem('pendingSessionId');
      }

      const pendingViewSessionId = isExplicitNewSessionStart
        ? null
        : pendingViewSessionRef.current?.sessionId || null;
      const effectiveSessionId = isExplicitNewSessionStart
        ? null
        : currentSessionId ||
          selectedSession?.id ||
          routedSessionId ||
          pendingViewSessionId;
      const isNewSession = !effectiveSessionId;
      const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;

      if (!effectiveSessionId && !selectedSession?.id) {
        if (typeof window !== 'undefined') {
          // Reset stale pending IDs from previous interrupted runs before creating a new one.
          sessionStorage.removeItem('pendingSessionId');
        }
        pendingViewSessionRef.current = { sessionId: sessionToActivate, startedAt: Date.now() };
      }
      persistSessionTimerStart(sessionToActivate, turnStartTime);
      onSessionActive?.(sessionToActivate);

      const getToolsSettings = async () => {
        const fallbackSettings = () => {
          try {
            const settingsKey = getProviderSettingsKey(provider);
            const savedSettings = safeLocalStorage.getItem(settingsKey);
            if (savedSettings) {
              return JSON.parse(savedSettings);
            }
          } catch (error) {
            console.error('Error loading cached tools settings:', error);
          }

          return {
            allowedTools: [],
            disallowedTools: [],
            skipPermissions: false,
          };
        };

        try {
          const response = await authenticatedFetch(`/api/settings/agent-permissions/${encodeURIComponent(provider || 'claude')}`);
          const data = await response.json().catch(() => ({}));
          if (response.ok && data.settings) {
            safeLocalStorage.setItem(getProviderSettingsKey(provider), JSON.stringify({
              ...data.settings,
              skipPermissions: false,
              lastUpdated: data.settings.updatedAt || new Date().toISOString(),
            }));
            return data.settings;
          }
          throw new Error(data.error || 'Failed to load server tool settings');
        } catch (error) {
          console.error('Error loading server tools settings:', error);
          return fallbackSettings();
        }
      };

      const toolsSettings = await getToolsSettings();
      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
      const projectKind = getProjectKind(selectedProject);
      const analysisLanguage = getStoredAnalysisLanguagePreference(selectedProject);
      const taskContextPayload = pendingTaskContext
        ? {
            id: pendingTaskContext.id != null ? String(pendingTaskContext.id) : undefined,
            title: pendingTaskContext.title || undefined,
            stage: pendingTaskContext.stage || undefined,
            status: pendingTaskContext.status || undefined,
            priority: pendingTaskContext.priority || undefined,
            description: pendingTaskContext.description || undefined,
            details: pendingTaskContext.details || undefined,
            testStrategy: pendingTaskContext.testStrategy || undefined,
            taskType: pendingTaskContext.taskType || undefined,
            nextActionPrompt: pendingTaskContext.nextActionPrompt || undefined,
            whyNext: pendingTaskContext.whyNext || undefined,
            requiredInputs: Array.isArray(pendingTaskContext.requiredInputs) ? pendingTaskContext.requiredInputs : undefined,
            suggestedSkills: Array.isArray(pendingTaskContext.suggestedSkills) ? pendingTaskContext.suggestedSkills : undefined,
            dependencies: Array.isArray(pendingTaskContext.dependencies)
              ? pendingTaskContext.dependencies.map((dependency) => String(dependency))
              : undefined,
          }
        : undefined;
      const telemetryEnabled = isTelemetryEnabled();
      const metricsEnabled = isChatMetricsEnabled();

      console.log('[DEBUG] useChatComposerState - provider:', provider);
      console.log('[DEBUG] useChatComposerState - effectiveSessionId:', effectiveSessionId);

      if (isNewSession) {
        const sessionModeContext = '[Context: session-mode=research]\n[Context: This is a research workflow session. Follow the normal project research instructions and pipeline behavior.]\n\n';
        messageContent = `${sessionModeContext}${messageContent}`;
      }

      if (metricsEnabled && typeof window !== 'undefined') {
        window.__medautodataChatMetrics = {
          enabled: true,
          lastSendAt: performance.now(),
          lastProvider: provider,
          lastSessionId: effectiveSessionId,
          lastCommandType: 'claude-command',
        };
      }

      if (selectedProject?.name && taskContextPayload?.id) {
        try {
          await authenticatedFetch(`/api/taskmaster/update-task/${encodeURIComponent(selectedProject.name)}/${encodeURIComponent(taskContextPayload.id)}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              status: 'in-progress',
            }),
          });
        } catch (error) {
          console.error('Failed to mark task in-progress before send:', error);
        }
      }

      console.log('[DEBUG] Sending claude-command');
      sendMessage({
        type: 'claude-command',
        command: messageContent,
        clientSessionId: sessionToActivate,
        options: {
          projectPath: resolvedProjectPath,
          cwd: resolvedProjectPath,
          projectName: selectedProject?.name,
          sessionId: effectiveSessionId,
          resume: Boolean(effectiveSessionId),
          clientSessionId: sessionToActivate,
          toolsSettings,
          permissionMode,
          model: claudeModel,
          ...claudeThinkingOptions,
          images: uploadedImages.length > 0 ? uploadedImages : undefined,
          analysisLanguage,
          projectKind,
          telemetryEnabled,
          sessionMode: 'research',
          stageTagKeys: pendingStageTagKeys,
          stageTagSource: 'task_context',
          taskContext: taskContextPayload,
        },
      });

      setInput('');
      inputValueRef.current = '';
      setPendingStageTagKeys([]);
      setPendingTaskContext(null);
      resetCommandMenuState();
      setAttachedFiles([]);
      setAttachedProjectFiles([]);
      setUploadingFiles(new Map());
      setFileErrors(new Map());
      setIsTextareaExpanded(false);
      setThinkingMode(DEFAULT_CLAUDE_THINKING_MODE);
      setAttachedPrompt(null);

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    },
    [
      attachedFiles,
      attachedProjectFiles,
      attachedPrompt,
      claudeModel,
      currentSessionId,
      executeCommand,
      isLoading,
      onSessionActive,
      pendingViewSessionRef,
      permissionMode,
      provider,
      resetCommandMenuState,
      scrollToBottom,
      selectedProject,
      selectedSession?.id,
      sendMessage,
      setCanAbortSession,
      setChatMessages,
      setClaudeStatus,
      setIsLoading,
      setIsUserScrolledUp,
      pendingStageTagKeys,
      pendingTaskContext,
      slashCommands,
      thinkingMode,
      t,
      intakeGreeting,
      uploadFilesToProject,
      uploadPreviewImages,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [selectedProject?.name]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    const applyDraft = (draft: string) => {
      setInput(draft);
      inputValueRef.current = draft;

      setTimeout(() => {
        if (!textareaRef.current) {
          return;
        }

        textareaRef.current.focus();
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        const cursor = draft.length;
        textareaRef.current.setSelectionRange(cursor, cursor);
        const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
        setIsTextareaExpanded(textareaRef.current.scrollHeight > lineHeight * 2);
      }, 0);
    };

    const applyQueuedProjectFiles = () => {
      const projectFileDrafts = consumeProjectFileChatContext(selectedProject.name);
      if (projectFileDrafts.length > 0) {
        attachProjectFiles(projectFileDrafts);
      }
    };

    const applyQueuedDraft = () => {
      const chatPromptDraft = consumeChatPromptDraft(selectedProject.name);
      if (chatPromptDraft) {
        setAttachedPrompt(chatPromptDraft.attachedPrompt ?? null);
        setPendingStageTagKeys(Array.isArray(chatPromptDraft.stageTagKeys) ? chatPromptDraft.stageTagKeys : []);
        setPendingTaskContext(chatPromptDraft.taskContext ? (chatPromptDraft.taskContext as PendingTaskContext) : null);
        if (chatPromptDraft.input?.trim()) {
          if (chatPromptDraft.autoSubmit) {
            window.setTimeout(() => {
              submitProgrammaticInput(chatPromptDraft.input);
            }, 0);
          } else {
            applyDraft(chatPromptDraft.input);
          }
        }
        applyQueuedProjectFiles();
        return;
      }
      const wqDraft = consumeWorkspaceQaDraft(selectedProject.name);
      if (wqDraft) {
        setAttachedPrompt(null);
        applyDraft(wqDraft);
        applyQueuedProjectFiles();
        return;
      }
      const refDraft = consumeReferenceChatDraft(selectedProject.name);
      if (refDraft) {
        setAttachedPrompt(null);
        applyDraft(refDraft.text);

        if (refDraft.pdfCached && refDraft.referenceId) {
          (async () => {
            try {
              const res = await authenticatedFetch(`/api/references/${refDraft.referenceId}/pdf`);
              if (res.ok) {
                const blob = await res.blob();
                const file = new File([blob], `${refDraft.referenceId}.pdf`, { type: 'application/pdf' });
                setAttachedFiles((prev: File[]) => [...prev, file].slice(0, 5));
              }
            } catch {
              // PDF fetch failed — user still has text context
            }
          })();
        }
      }
      applyQueuedProjectFiles();
    };

    applyQueuedDraft();

    const handleQueuedDraft = (event: Event) => {
      const customEvent = event as CustomEvent<{ projectName?: string }>;
      if (customEvent.detail?.projectName !== selectedProject.name) {
        return;
      }
      applyQueuedDraft();
    };

    window.addEventListener(CHAT_PROMPT_DRAFT_EVENT, handleQueuedDraft);
    window.addEventListener(WORKSPACE_QA_DRAFT_EVENT, handleQueuedDraft);
    window.addEventListener(REFERENCE_CHAT_DRAFT_EVENT, handleQueuedDraft);
    window.addEventListener(PROJECT_FILE_CHAT_CONTEXT_EVENT, handleQueuedDraft);
    return () => {
      window.removeEventListener(CHAT_PROMPT_DRAFT_EVENT, handleQueuedDraft);
      window.removeEventListener(WORKSPACE_QA_DRAFT_EVENT, handleQueuedDraft);
      window.removeEventListener(REFERENCE_CHAT_DRAFT_EVENT, handleQueuedDraft);
      window.removeEventListener(PROJECT_FILE_CHAT_CONTEXT_EVENT, handleQueuedDraft);
    };
  }, [attachProjectFiles, selectedProject?.name, setInput, setAttachedPrompt, submitProgrammaticInput]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    if (input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    // Re-run when input changes so restored drafts get the same autosize behavior as typed text.
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
    const expanded = textareaRef.current.scrollHeight > lineHeight * 2;
    setIsTextareaExpanded(expanded);
  }, [input]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        setPendingStageTagKeys([]);
        setPendingTaskContext(null);
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (event.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      target.style.height = 'auto';
      target.style.height = `${target.scrollHeight}px`;
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);

      const lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      setIsTextareaExpanded(target.scrollHeight > lineHeight * 2);
    },
    [setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    setPendingStageTagKeys([]);
    setAttachedFiles([]);
    setAttachedProjectFiles([]);
    setUploadingFiles(new Map());
    setFileErrors(new Map());
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    // Even if we *think* we can't abort (stale UI state, WS reconnects, backend restart),
    // try best-effort to stop the active session and always unblock the UI.
    setCanAbortSession(false);
    // Make the UI pause immediately (don't wait for backend ack).
    setIsLoading(false);
    setClaudeStatus(null);

    const pendingSessionId =
      typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
    const candidateSessionIds = [
      currentSessionId,
      pendingViewSessionRef.current?.sessionId || null,
      pendingSessionId,
      selectedSession?.id || null,
    ];

    const targetSessionId =
      candidateSessionIds.find((sessionId) => Boolean(sessionId) && !isTemporarySessionId(sessionId)) || null;

    if (!targetSessionId) {
      setIsLoading(false);
      setClaudeStatus(null);
      setChatMessages((previous) => [
        ...previous,
        {
          type: 'error',
          content: 'Could not stop session: no active session found.',
          timestamp: new Date(),
        },
      ]);
      return;
    }

    sendMessage({
      type: 'abort-session',
      sessionId: targetSessionId,
      provider,
    });
    markSessionAbortRequested(targetSessionId);

    if (abortTimeoutRef.current) {
      clearTimeout(abortTimeoutRef.current);
    }
    abortTimeoutRef.current = null;
  }, [currentSessionId, pendingViewSessionRef, provider, selectedSession?.id, sendMessage, setCanAbortSession, setChatMessages, setClaudeStatus, setIsLoading]);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion || provider !== 'claude') {
        return { success: false };
      }
      return grantToolPermission(suggestion.entry, provider);
    },
    [provider],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: 'claude-permission-response',
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      // Update the local chatMessage toolInput so answered questions render with selections
      if (decision?.updatedInput && typeof decision.updatedInput === 'object' && 'answers' in (decision.updatedInput as Record<string, unknown>)) {
        const updated = decision.updatedInput as Record<string, unknown>;
        setChatMessages((previous) => {
          const msgs = [...previous];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].toolName === 'AskUserQuestion' && msgs[i].isToolUse) {
              msgs[i] = { ...msgs[i], toolInput: updated };
              break;
            }
          }
          return msgs;
        });
      }

      setPendingPermissionRequests((previous) => {
        const next = previous.filter((request) => !validIds.includes(request.requestId));
        if (next.length === 0) {
          setClaudeStatus(null);
        }
        return next;
      });
    },
    [sendMessage, setChatMessages, setClaudeStatus, setPendingPermissionRequests],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    attachedPrompt,
    setAttachedPrompt,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    removeAttachedFile,
    attachedProjectFiles,
    attachProjectFiles,
    removeAttachedProjectFile,
    uploadingFiles,
    fileErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openFilePicker: open,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    intakeGreeting,
    setIntakeGreeting,
    setPendingStageTagKeys,
    setPendingTaskContext,
    submitProgrammaticInput,
  };
}
