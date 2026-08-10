import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import QuickSettingsPanel from '../../QuickSettingsPanel';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useTranslation } from 'react-i18next';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import ChatFilePanel from './subcomponents/ChatFilePanel';
import ChatFilePreviewOverlay from './subcomponents/ChatFilePreviewOverlay';
import MetaWorkflowStatusBar from './subcomponents/MetaWorkflowStatusBar';
import GuidedPromptStarter from './subcomponents/GuidedPromptStarter';
import { RESUMING_STATUS_TEXT } from '../types/types';
import type { ChatInterfaceProps } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import type { ChatPreviewFile } from './subcomponents/ChatFilePreviewOverlay';
import { clearSessionTimerStart } from '../utils/chatStorage';
import { Button } from '../../ui/button';
import { PanelRightOpen } from 'lucide-react';
import type { PendingAutoIntake, Project } from '../../../types/app';
import { getProviderDisplayName } from '../utils/chatFormatting';
import { normalizeProjectChatFileReference } from '../utils/filePathLinks';

const INTAKE_GREETING = `Hello! I'm your MedAutoData research assistant, here to help you set up your research pipeline.\n\nTo get started, could you tell me about your research field or topic?`;
const MIN_FILE_PANEL_WIDTH = 260;
const MIN_CHAT_PANEL_WIDTH = 320;
const DEFAULT_FILE_PANEL_WIDTH = 720;

const getAutoIntakePrompt = (pendingAutoIntake?: PendingAutoIntake | null) => {
  const prompt = pendingAutoIntake?.prompt?.trim();
  return prompt || null;
};

const getAutoIntakeTriggerId = (pendingAutoIntake?: PendingAutoIntake | null) => {
  const triggerId = pendingAutoIntake?.triggerId?.trim();
  return triggerId || null;
};

const getAutoIntakeStorageKey = (projectName: string, triggerId?: string | null) =>
  triggerId ? `intake_triggered_${projectName}_${triggerId}` : `intake_triggered_${projectName}`;

const getImportedProjectAnalysisStorageKey = (projectName: string) => `imported_project_analysis_prompt_${projectName}`;

type ChatPreviewNavigationPayload = {
  kind: 'image-gallery' | 'markdown-gallery';
  paths: string[];
};

const extractChatPreviewNavigation = (
  diffInfo: unknown,
  selectedProject?: Project | null,
): ChatPreviewNavigationPayload | null => {
  if (!diffInfo || typeof diffInfo !== 'object' || Array.isArray(diffInfo)) {
    return null;
  }
  const navigation = (diffInfo as { __chatPreviewNavigation?: unknown }).__chatPreviewNavigation;
  if (!navigation || typeof navigation !== 'object' || Array.isArray(navigation)) {
    return null;
  }
  const kind = (navigation as { kind?: unknown }).kind;
  const paths = (navigation as { paths?: unknown }).paths;
  if ((kind !== 'image-gallery' && kind !== 'markdown-gallery') || !Array.isArray(paths)) {
    return null;
  }
  const normalizedPaths = paths
    .map((value) => normalizeProjectChatFileReference(String(value || ''), selectedProject))
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .map((value) => value.relativePath);
  if (normalizedPaths.length === 0) {
    return null;
  }
  return {
    kind: kind as ChatPreviewNavigationPayload['kind'],
    paths: normalizedPaths,
  };
};

const stripChatPreviewNavigation = (diffInfo: unknown): unknown => {
  if (!diffInfo || typeof diffInfo !== 'object' || Array.isArray(diffInfo)) {
    return diffInfo;
  }
  if (!Object.prototype.hasOwnProperty.call(diffInfo, '__chatPreviewNavigation')) {
    return diffInfo;
  }
  const { __chatPreviewNavigation, ...rest } = diffInfo as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : undefined;
};

const buildChatPreviewFile = (
  filePath: string,
  selectedProject?: Project | null,
  diffInfo?: unknown,
): ChatPreviewFile | null => {
  const normalizedFilePath = normalizeProjectChatFileReference(filePath, selectedProject);
  if (!normalizedFilePath) {
    return null;
  }
  const { normalizedPath, relativePath, absolutePath } = normalizedFilePath;
  const name = relativePath.split('/').filter(Boolean).pop() || normalizedPath.split('/').filter(Boolean).pop() || normalizedPath;

  const previewNavigation = extractChatPreviewNavigation(diffInfo, selectedProject);
  const editorDiffInfo = stripChatPreviewNavigation(diffInfo);

  return {
    key: absolutePath || relativePath,
    name,
    relativePath,
    absolutePath,
    reasons: [],
    count: 1,
    lastSeenAt: new Date().toISOString(),
    originalPath: normalizedPath,
    diffInfo: editorDiffInfo,
    previewNavigation,
  };
};

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  latestMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  pendingAutoIntake,
  clearPendingAutoIntake,
  importedProjectAnalysisPrompt,
  clearImportedProjectAnalysisPrompt,
  onStartWorkspaceQa,
  newSessionMode = 'research',
  onNewSessionModeChange,
}: ChatInterfaceProps) {
  const { refreshTasks } = useTaskMaster();
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const [mobilePreviewFile, setMobilePreviewFile] = useState<ChatPreviewFile | null>(null);
  const [openPreviewFiles, setOpenPreviewFiles] = useState<ChatPreviewFile[]>([]);
  const [activePreviewFileKey, setActivePreviewFileKey] = useState<string | null>(null);
  const [isFilePanelVisible, setIsFilePanelVisible] = useState(false);
  const chatLayoutRef = useRef<HTMLDivElement | null>(null);
  const [filePanelWidth, setFilePanelWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_FILE_PANEL_WIDTH;
    const saved = Number.parseInt(window.localStorage.getItem('medhelp.filePanelWidth') || '', 10);
    const initialMaxWidth = Math.max(MIN_FILE_PANEL_WIDTH, window.innerWidth - MIN_CHAT_PANEL_WIDTH);
    return Number.isFinite(saved)
      ? Math.min(initialMaxWidth, Math.max(MIN_FILE_PANEL_WIDTH, saved))
      : DEFAULT_FILE_PANEL_WIDTH;
  });

  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);
  const lastWsDisconnectNoticeRef = useRef<number>(0);
  const handleChatFilePreviewOpen = useCallback((filePath: string, diffInfo?: unknown) => {
    const nextPreviewFile = buildChatPreviewFile(filePath, selectedProject, diffInfo);
    if (!nextPreviewFile) {
      return;
    }

    if (isMobile) {
      setMobilePreviewFile(nextPreviewFile);
      return;
    }

    setOpenPreviewFiles((currentFiles) => {
      const existingIndex = currentFiles.findIndex((file) => file.key === nextPreviewFile.key);
      if (existingIndex === -1) {
        return [...currentFiles, nextPreviewFile];
      }
      return currentFiles.map((file, index) => index === existingIndex ? nextPreviewFile : file);
    });
    setActivePreviewFileKey(nextPreviewFile.key);
    setIsFilePanelVisible(true);
    const layoutWidth = chatLayoutRef.current?.clientWidth ?? window.innerWidth;
    const maximumWidth = Math.max(MIN_FILE_PANEL_WIDTH, layoutWidth - MIN_CHAT_PANEL_WIDTH);
    setFilePanelWidth((currentWidth) => Math.max(currentWidth, Math.min(DEFAULT_FILE_PANEL_WIDTH, maximumWidth)));
  }, [isMobile, selectedProject]);

  const handlePreviewFileClose = useCallback((fileKey: string) => {
    const closingIndex = openPreviewFiles.findIndex((file) => file.key === fileKey);
    const nextActiveKey = closingIndex >= 0
      ? openPreviewFiles[closingIndex + 1]?.key ?? openPreviewFiles[closingIndex - 1]?.key ?? null
      : null;

    setOpenPreviewFiles((currentFiles) => currentFiles.filter((file) => file.key !== fileKey));
    setActivePreviewFileKey((currentKey) => currentKey === fileKey ? nextActiveKey : currentKey);
    if (openPreviewFiles.length <= 1) {
      setIsFilePanelVisible(false);
    }
  }, [openPreviewFiles]);

  useEffect(() => {
    setOpenPreviewFiles([]);
    setActivePreviewFileKey(null);
    setMobilePreviewFile(null);
    setIsFilePanelVisible(false);
  }, [selectedProject?.name]);

  const handleFilePanelResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const layoutRect = chatLayoutRef.current?.getBoundingClientRect();
    const layoutRight = layoutRect?.right ?? window.innerWidth;
    const maximumWidth = Math.max(
      MIN_FILE_PANEL_WIDTH,
      (layoutRect?.width ?? window.innerWidth) - MIN_CHAT_PANEL_WIDTH,
    );

    const handleMove = (moveEvent: PointerEvent) => {
      const availableWidth = layoutRight - moveEvent.clientX;
      setFilePanelWidth(Math.min(maximumWidth, Math.max(MIN_FILE_PANEL_WIDTH, availableWidth)));
    };
    const handleEnd = () => {
      handle.removeEventListener('pointermove', handleMove);
      handle.removeEventListener('pointerup', handleEnd);
      handle.removeEventListener('pointercancel', handleEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    handle.addEventListener('pointermove', handleMove);
    handle.addEventListener('pointerup', handleEnd);
    handle.addEventListener('pointercancel', handleEnd);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('medhelp.filePanelWidth', String(filePanelWidth));
  }, [filePanelWidth]);

  useEffect(() => {
    const layout = chatLayoutRef.current;
    if (!layout) {
      return undefined;
    }

    const clampPanelWidth = () => {
      const maximumWidth = Math.max(
        MIN_FILE_PANEL_WIDTH,
        layout.clientWidth - MIN_CHAT_PANEL_WIDTH,
      );
      setFilePanelWidth((currentWidth) => Math.min(maximumWidth, Math.max(MIN_FILE_PANEL_WIDTH, currentWidth)));
    };

    clampPanelWidth();
    const observer = new ResizeObserver(clampPanelWidth);
    observer.observe(layout);
    return () => observer.disconnect();
  }, []);

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
  }, []);

  const {
    provider,
    claudeModel,
    setClaudeModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  } = useChatProviderState({
    selectedSession,
  });

  const {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isSystemSessionChange,
    setIsSystemSessionChange,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    claudeStatus,
    setClaudeStatus,
    statusTextOverride,
    setStatusTextOverride,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
    resolveSessionStatusCheck,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    autoScrollToBottom,
    externalMessageUpdate,
    processingSessions,
    resetStreamingState,
    pendingViewSessionRef,
    onSessionInactive,
    onSessionNotProcessing,
  });

  // If the backend restarts (common when switching credentials), the WebSocket will drop.
  // Make sure we don't leave the UI stuck in a "Processing" state that blocks sending.
  useEffect(() => {
    if (ws) {
      return;
    }

    if (!isLoading) {
      return;
    }

    setIsLoading(false);
    setCanAbortSession(false);
    setClaudeStatus(null);
    setStatusTextOverride(null);
    setPendingPermissionRequests([]);
    resetStreamingState();

    // Clear any persisted "resuming" timers so refresh doesn't get stuck in RESUMING.
    const activeSessionId = selectedSession?.id || currentSessionId;
    if (activeSessionId) {
      clearSessionTimerStart(activeSessionId);
      onSessionInactive?.(activeSessionId);
      onSessionNotProcessing?.(activeSessionId);
    }

    const now = Date.now();
    if (now - lastWsDisconnectNoticeRef.current < 3000) {
      return;
    }
    lastWsDisconnectNoticeRef.current = now;

    setChatMessages((previous) => [
      ...previous,
      {
        type: 'error',
        content: 'Connection lost (backend restarted or credentials changed). Please resend your last message.',
        timestamp: new Date(),
      },
    ]);
  }, [
    isLoading,
    resetStreamingState,
    setCanAbortSession,
    setChatMessages,
    setClaudeStatus,
    setIsLoading,
    setPendingPermissionRequests,
    setStatusTextOverride,
    onSessionInactive,
    onSessionNotProcessing,
    currentSessionId,
    selectedSession?.id,
    ws,
  ]);

  const {
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
    filteredFiles,
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
    openFilePicker,
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
  } = useChatComposerState({
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
    onFileOpen: handleChatFilePreviewOpen,
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
  });

  useChatRealtimeHandlers({
    latestMessage,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setChatMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setStatusTextOverride,
    setTokenBudget,
    setIsSystemSessionChange,
    setPendingPermissionRequests,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onSessionStatusResolved: resolveSessionStatusCheck,
    onReplaceTemporarySession,
    onNavigateToSession,
  });

  const chatMessagesRef = useRef(chatMessages);
  chatMessagesRef.current = chatMessages;
  const isEmpty = chatMessages.length === 0 && !selectedSession && !currentSessionId;

  const handleRetry = useCallback(() => {
    const msgs = chatMessagesRef.current;
    let lastUserMessage: (typeof msgs)[number] | undefined;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].type === 'user') { lastUserMessage = msgs[i]; break; }
    }
    if (!lastUserMessage?.content) return;
    submitProgrammaticInput(lastUserMessage.content);
  }, [submitProgrammaticInput]);

  const handleStartTaskInChat = useCallback((prompt?: string, task?: {
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
    inputsNeeded?: string[] | null;
    suggestedSkills?: string[] | null;
    dependencies?: Array<string | number> | null;
    guidance?: {
      whyNext?: string | null;
      requiredInputs?: string[] | null;
      suggestedSkills?: string[] | null;
      nextActionPrompt?: string | null;
    } | null;
  } | null) => {
    const nextPrompt = prompt && prompt.trim()
      ? prompt.trim()
      : t('tasks.nextTaskPrompt', { defaultValue: 'Start the next task' });
    const stage = String(task?.stage || '').trim().toLowerCase();
    const guidance = task?.guidance || null;

    setPendingStageTagKeys(stage ? [stage] : []);
    setPendingTaskContext(task ? {
      id: task.id ?? null,
      title: task.title ?? null,
      stage: stage || null,
      status: task.status ?? null,
      priority: task.priority ?? null,
      description: task.description ?? null,
      details: task.details ?? null,
      testStrategy: task.testStrategy ?? null,
      taskType: task.taskType ?? null,
      nextActionPrompt: task.nextActionPrompt || guidance?.nextActionPrompt || prompt || null,
      whyNext: task.whyNext || guidance?.whyNext || null,
      requiredInputs: guidance?.requiredInputs || task.inputsNeeded || null,
      suggestedSkills: guidance?.suggestedSkills || task.suggestedSkills || null,
      dependencies: task.dependencies || null,
    } : null);
    window.setTimeout(() => {
      submitProgrammaticInput(nextPrompt);
    }, 0);
  }, [setPendingStageTagKeys, setPendingTaskContext, submitProgrammaticInput, t]);

  const autoIntakeTriggeredRef = useRef(false);
  const lastAutoIntakeTriggerIdRef = useRef<string | null>(null);
  const [pendingImportedProjectAnalysisSubmit, setPendingImportedProjectAnalysisSubmit] = React.useState<string | null>(null);
  const shouldShowImportedProjectAnalysisPrompt = useMemo(() => {
    if (!importedProjectAnalysisPrompt || !selectedProject || selectedSession || isLoading) {
      return false;
    }

    const targetProjectName = importedProjectAnalysisPrompt.project?.name;
    if (!targetProjectName || targetProjectName !== selectedProject.name) {
      return false;
    }

    if (chatMessages.length > 0) {
      return false;
    }

    if (typeof window === 'undefined') {
      return true;
    }

    const dismissedKey = getImportedProjectAnalysisStorageKey(selectedProject.name);
    return sessionStorage.getItem(dismissedKey) !== 'dismissed';
  }, [chatMessages.length, importedProjectAnalysisPrompt, isLoading, selectedProject, selectedSession]);
  useEffect(() => {
    if (!pendingImportedProjectAnalysisSubmit) {
      return;
    }

    const prompt = pendingImportedProjectAnalysisSubmit;
    setPendingImportedProjectAnalysisSubmit(null);
    submitProgrammaticInput(prompt);
  }, [pendingImportedProjectAnalysisSubmit, submitProgrammaticInput]);

  useEffect(() => {
    const triggerId = getAutoIntakeTriggerId(pendingAutoIntake);
    if (triggerId && lastAutoIntakeTriggerIdRef.current !== triggerId) {
      autoIntakeTriggeredRef.current = false;
      lastAutoIntakeTriggerIdRef.current = triggerId;
    }

    if (!pendingAutoIntake || newSessionMode !== 'research') {
      autoIntakeTriggeredRef.current = false;
      return;
    }

    if (
      autoIntakeTriggeredRef.current ||
      !selectedProject ||
      selectedSession ||
      isLoading ||
      chatMessages.length > 0
    ) return;

    const intakeKey = getAutoIntakeStorageKey(selectedProject.name, triggerId);
    if (sessionStorage.getItem(intakeKey)) {
      clearPendingAutoIntake?.();
      return;
    }

    autoIntakeTriggeredRef.current = true;
    sessionStorage.setItem(intakeKey, 'true');

    const autoIntakePrompt = getAutoIntakePrompt(pendingAutoIntake);

    if (autoIntakePrompt) {
      clearPendingAutoIntake?.();
      submitProgrammaticInput(autoIntakePrompt);
      return;
    }

    clearPendingAutoIntake?.();

    setIntakeGreeting(INTAKE_GREETING);
  }, [
    pendingAutoIntake,
    selectedProject,
    selectedSession,
    isLoading,
    chatMessages.length,
    clearPendingAutoIntake,
    setIntakeGreeting,
    submitProgrammaticInput,
    newSessionMode,
  ]);

  useEffect(() => {
    if (selectedSession?.mode) {
      onNewSessionModeChange?.(selectedSession.mode);
    }
  }, [onNewSessionModeChange, selectedSession?.id, selectedSession?.mode]);

  useEffect(() => {
    setMobilePreviewFile(null);
  }, [selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  const prevIsLoadingForProcessingRef = useRef(false);
  useEffect(() => {
    const processingSessionId = selectedSession?.id || currentSessionId;
    const shouldTrackAsProcessing = isLoading && claudeStatus?.text !== RESUMING_STATUS_TEXT;
    const loadingJustStarted = shouldTrackAsProcessing && !prevIsLoadingForProcessingRef.current;
    prevIsLoadingForProcessingRef.current = shouldTrackAsProcessing;
    if (processingSessionId && loadingJustStarted && onSessionProcessing) {
      onSessionProcessing(processingSessionId);
    }
  }, [claudeStatus?.text, currentSessionId, isLoading, onSessionProcessing, selectedSession?.id]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  useEffect(() => {
    if (!latestMessage?.type) {
      return;
    }

    if (latestMessage.type === 'claude-complete') {
      refreshTasks?.();
    }
  }, [latestMessage, refreshTasks]);

  const handleImportedProjectAnalysisDismiss = useCallback(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      sessionStorage.setItem(getImportedProjectAnalysisStorageKey(selectedProject.name), 'dismissed');
    }
    clearImportedProjectAnalysisPrompt?.();
  }, [clearImportedProjectAnalysisPrompt, selectedProject]);

  const handleImportedProjectAnalysisConfirm = useCallback(() => {
    const prompt = importedProjectAnalysisPrompt?.prompt?.trim();
    if (!prompt || !selectedProject) {
      clearImportedProjectAnalysisPrompt?.();
      return;
    }

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(getImportedProjectAnalysisStorageKey(selectedProject.name));
    }

    clearImportedProjectAnalysisPrompt?.();
    setPendingImportedProjectAnalysisSubmit(prompt);
  }, [
    clearImportedProjectAnalysisPrompt,
    importedProjectAnalysisPrompt?.prompt,
    selectedProject,
  ]);

  if (!selectedProject) {
    const selectedProviderLabel = getProviderDisplayName(provider);

    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  const chatMessagesPane = (
    <ChatMessagesPane
      scrollContainerRef={scrollContainerRef}
      onWheel={handleScroll}
      onTouchMove={handleScroll}
      isLoadingSessionMessages={isLoadingSessionMessages}
      chatMessages={chatMessages}
      selectedSession={selectedSession}
      intakeGreeting={intakeGreeting}
      currentSessionId={currentSessionId}
      provider={provider}
      isLoadingMoreMessages={isLoadingMoreMessages}
      hasMoreMessages={hasMoreMessages}
      totalMessages={totalMessages}
      sessionMessagesCount={sessionMessages.length}
      visibleMessageCount={visibleMessageCount}
      visibleMessages={visibleMessages}
      loadEarlierMessages={loadEarlierMessages}
      loadAllMessages={loadAllMessages}
      allMessagesLoaded={allMessagesLoaded}
      isLoadingAllMessages={isLoadingAllMessages}
      loadAllJustFinished={loadAllJustFinished}
      showLoadAllOverlay={showLoadAllOverlay}
      createDiff={createDiff}
      onFileOpen={handleChatFilePreviewOpen}
      onShowSettings={onShowSettings}
      onGrantToolPermission={handleGrantToolPermission}
      autoExpandTools={autoExpandTools}
      showRawParameters={showRawParameters}
      showThinking={showThinking}
      selectedProject={selectedProject}
      isLoading={isLoading}
      statusText={statusTextOverride || claudeStatus?.text}
      newSessionMode={newSessionMode}
      onRetry={handleRetry}
    />
  );

  const chatComposer = (
    <ChatComposer
      pendingPermissionRequests={pendingPermissionRequests}
      handlePermissionDecision={handlePermissionDecision}
      handleGrantToolPermission={handleGrantToolPermission}
      claudeStatus={claudeStatus ? { ...claudeStatus, text: statusTextOverride || claudeStatus.text } : claudeStatus}
      isLoading={isLoading}
      onAbortSession={handleAbortSession}
      onStartTask={handleStartTaskInChat}
      provider={provider}
      claudeModel={claudeModel}
      setClaudeModel={setClaudeModel}
      permissionMode={permissionMode}
      onModeSwitch={cyclePermissionMode}
      thinkingMode={thinkingMode}
      setThinkingMode={setThinkingMode}
      slashCommandsCount={slashCommandsCount}
      onToggleCommandMenu={handleToggleCommandMenu}
      hasInput={Boolean(input.trim()) || attachedFiles.length > 0 || attachedProjectFiles.length > 0}
      onClearInput={handleClearInput}
      isUserScrolledUp={isUserScrolledUp}
      hasMessages={chatMessages.length > 0}
      onScrollToBottom={scrollToBottomAndReset}
      onSubmit={handleSubmit}
      isDragActive={isDragActive}
      attachedFiles={attachedFiles}
      onRemoveFile={removeAttachedFile}
      attachedProjectFiles={attachedProjectFiles}
      onRemoveProjectFile={removeAttachedProjectFile}
      uploadingFiles={uploadingFiles}
      fileErrors={fileErrors}
      showFileDropdown={showFileDropdown}
      filteredFiles={filteredFiles}
      selectedFileIndex={selectedFileIndex}
      onSelectFile={selectFile}
      filteredCommands={filteredCommands}
      selectedCommandIndex={selectedCommandIndex}
      onCommandSelect={handleCommandSelect}
      onCloseCommandMenu={resetCommandMenuState}
      isCommandMenuOpen={showCommandMenu}
      frequentCommands={commandQuery ? [] : frequentCommands}
      getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
      getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
      openFilePicker={openFilePicker}
      inputHighlightRef={inputHighlightRef}
      renderInputWithMentions={renderInputWithMentions}
      textareaRef={textareaRef}
      input={input}
      setInput={setInput}
      onInputChange={handleInputChange}
      onTextareaClick={handleTextareaClick}
      onTextareaKeyDown={handleKeyDown}
      onTextareaPaste={handlePaste}
      onTextareaScrollSync={syncInputOverlayScroll}
      onTextareaInput={handleTextareaInput}
      onInputFocusChange={handleInputFocusChange}
      isInputFocused={isInputFocused}
      placeholder={t('input.placeholder', {
        provider: getProviderDisplayName(provider),
      })}
      isTextareaExpanded={isTextareaExpanded}
      sendByCtrlEnter={sendByCtrlEnter}
      projectName={selectedProject?.name}
      selectedProject={selectedProject}
      onReferenceContext={(context) => {
        setInput((prev) => prev ? `${prev}\n\n${context}` : context);
      }}
      attachedPrompt={attachedPrompt}
      onRemoveAttachedPrompt={() => setAttachedPrompt(null)}
      onUpdateAttachedPrompt={(text) =>
        setAttachedPrompt((prev) => prev ? { ...prev, promptText: text } : null)
      }
      setAttachedPrompt={setAttachedPrompt}
      centered={isEmpty}
    />
  );

  return (
    <>
      <div ref={chatLayoutRef} className={`relative h-full flex min-h-0 ${isMobile ? 'flex-col' : 'flex-row'}`}>
        {!isMobile && !isFilePanelVisible && (
          <button
            type="button"
            onClick={() => setIsFilePanelVisible(true)}
            className="absolute right-3 top-3 z-20 hidden h-9 w-9 place-items-center rounded-md border border-border bg-background/95 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground lg:grid"
            title={tCommon('tabs.files')}
            aria-label={tCommon('tabs.files')}
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!isMobile && (
            <MetaWorkflowStatusBar
              selectedProject={selectedProject}
              latestMessage={latestMessage}
              reserveTrailingControl={!isFilePanelVisible}
            />
          )}
          <div className={`flex min-h-0 flex-1 flex-col ${isEmpty ? 'justify-start overflow-y-auto pt-[18vh]' : ''}`}>
            {shouldShowImportedProjectAnalysisPrompt && (
              <div className="mx-auto mt-4 w-full max-w-3xl px-3 sm:px-4">
                <div className="rounded-xl border border-border bg-card/95 shadow-sm px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Analyze Imported Project?</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Start a new session to scan this workspace, analyze the project structure and implementation, and summarize next steps.
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="grid gap-3 sm:gap-4">
                        <span className="text-sm text-muted-foreground">Claude Agent SDK</span>
                      </div>

                      <div className="flex gap-2 sm:flex-shrink-0">
                        <Button variant="outline" onClick={handleImportedProjectAnalysisDismiss}>
                          Not Now
                        </Button>
                        <Button
                          onClick={handleImportedProjectAnalysisConfirm}
                          disabled={Boolean(pendingImportedProjectAnalysisSubmit)}
                        >
                          Analyze Project
                        </Button>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            )}

            {chatMessagesPane}
            {chatComposer}
            {isEmpty && newSessionMode === 'research' && !shouldShowImportedProjectAnalysisPrompt && (
              <GuidedPromptStarter
                projectName={selectedProject?.name || ''}
                selectedProject={selectedProject}
                setInput={setInput}
                textareaRef={textareaRef}
                setAttachedPrompt={setAttachedPrompt}
              />
            )}
          </div>
        </div>

        {!isMobile && isFilePanelVisible && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize file panel"
              className="group hidden h-full w-2 flex-shrink-0 cursor-col-resize touch-none items-center justify-center bg-transparent lg:flex"
              onPointerDown={handleFilePanelResizeStart}
            >
              <span className="h-12 w-0.5 rounded-full bg-primary/20 transition-colors group-hover:bg-primary/55 group-active:bg-primary" />
            </div>
            <aside
              className="hidden h-full flex-shrink-0 border-l border-border/60 bg-background/45 backdrop-blur-lg lg:block"
              style={{ width: `${filePanelWidth}px` }}
            >
              <ChatFilePanel
                selectedProject={selectedProject}
                openFiles={openPreviewFiles}
                activeFileKey={activePreviewFileKey}
                onShowFiles={() => setActivePreviewFileKey(null)}
                onSelectFile={setActivePreviewFileKey}
                onCloseFile={handlePreviewFileClose}
                onCollapse={() => setIsFilePanelVisible(false)}
                onFileOpen={handleChatFilePreviewOpen}
                onStartWorkspaceQa={onStartWorkspaceQa}
              />
            </aside>
          </>
        )}

      </div>

      {isMobile && mobilePreviewFile && selectedProject?.name && (
        <ChatFilePreviewOverlay
          projectName={selectedProject.name}
          file={mobilePreviewFile}
          onClose={() => setMobilePreviewFile(null)}
          selectedProject={selectedProject}
          onStartWorkspaceQa={onStartWorkspaceQa}
          onAddToCurrentChat={(file) => attachProjectFiles([file])}
        />
      )}

      <QuickSettingsPanel />
    </>
  );
}

export default React.memo(ChatInterface);
