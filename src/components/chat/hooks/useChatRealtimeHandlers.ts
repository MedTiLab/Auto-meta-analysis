import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  buildAssistantMessages,
  decodeHtmlEntities,
  formatUsageLimitText,
  unescapeWithMathProtection,
} from '../utils/chatFormatting';
import { mergeAnswersIntoToolInput, parseAskUserAnswers } from '../utils/messageTransforms';
import { mergeFinalAssistantMessages } from '../utils/realtimeMessageMerge';
import {
  clearSessionAbortRequested,
  clearSessionTimerStart,
  isSessionAbortRequested,
  moveSessionTimerStart,
  persistSessionTimerStart,
  safeLocalStorage,
} from '../utils/chatStorage';
import { RESUMING_STATUS_TEXT } from '../types/types';
import i18n from '../../../i18n/config';
import type { ChatMessage, PendingPermissionRequest } from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';

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

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type LatestChatMessage = {
  type?: string;
  data?: any;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: string;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: Dispatch<SetStateAction<{ text: string; tokens: number; can_interrupt: boolean; startTime?: number } | null>>;
  setStatusTextOverride: Dispatch<SetStateAction<string | null>>;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onSessionStatusResolved?: (sessionId?: string | null, isProcessing?: boolean) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (
    sessionId: string,
    sessionProvider?: SessionProvider,
    targetProjectName?: string,
  ) => void;
}

const appendStreamingChunk = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  chunk: string,
  newline = false,
) => {
  if (!chunk) return;

  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
      const nextContent = newline
        ? last.content
          ? `${last.content}\n${chunk}`
          : chunk
        : `${last.content || ''}${chunk}`;
      updated[lastIndex] = { ...last, content: nextContent };
    } else {
      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
    }
    return updated;
  });
};

const finalizeStreamingMessage = (setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>) => {
  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && last.isStreaming) {
      const normalizedContent = unescapeWithMathProtection(formatUsageLimitText(String(last.content || '')));
      const messages = buildAssistantMessages(normalizedContent, last.timestamp || new Date());
      updated.splice(
        lastIndex,
        1,
        ...messages.map((message) => ({
          ...last,
          content: message.content,
          isStreaming: false,
          isThinking: message.isThinking || false,
        })),
      );
    }
    return updated;
  });
};

const isLegacyTaskMasterInstallError = (value: unknown): boolean => {
  const normalized = String(value || '').toLowerCase();
  return normalized.includes('taskmaster') && (normalized.includes('not installed') || normalized.includes('not configured'));
};

export function useChatRealtimeHandlers({
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
  onSessionStatusResolved,
  onReplaceTemporarySession,
  onNavigateToSession,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);
  const firstTokenLoggedRef = useRef(false);

  const flushAndFinalizePendingStream = () => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    const chunk = streamBufferRef.current;
    streamBufferRef.current = '';
    appendStreamingChunk(setChatMessages, chunk, false);
    finalizeStreamingMessage(setChatMessages);
  };

  const clearLoadingIndicators = () => {
    setIsLoading(false);
    setCanAbortSession(false);
    setClaudeStatus(null);
    setStatusTextOverride(null);
  };

  const markSessionsAsCompleted = (...sessionIds: Array<string | null | undefined>) => {
    sessionIds
      .filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0)
      .forEach((sessionId) => {
        clearSessionTimerStart(sessionId);
        onSessionInactive?.(sessionId);
        onSessionNotProcessing?.(sessionId);
        onSessionStatusResolved?.(sessionId, false);
      });
  };

  const persistStartTime = (startTime?: number | null, ...sessionIds: Array<string | null | undefined>) => {
    if (!Number.isFinite(startTime)) return;
    const targetSessionId = sessionIds.find((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0);
    if (targetSessionId) {
      persistSessionTimerStart(targetSessionId, startTime as number);
    }
  };

  const syncClaudeStatusStartTime = (startTime?: number | null, fallbackText = 'Processing') => {
    if (!Number.isFinite(startTime)) return;
    setClaudeStatus((previous) => ({
      text: previous?.text || fallbackText,
      tokens: previous?.tokens || 0,
      can_interrupt: previous?.can_interrupt !== undefined ? previous.can_interrupt : true,
      startTime: startTime as number,
    }));
  };

  const handleStructuredAssistantMessage = (structuredData: any, rawData: any) => {
    setStatusTextOverride(null);

    const parentToolUseId = rawData?.parentToolUseId;
    const newMessages: any[] = [];
    const childToolUpdates: { parentId: string; child: any }[] = [];

    structuredData.content.forEach((part: any) => {
      if (part.type === 'thinking' || part.type === 'reasoning') {
        const thinkingText = part.thinking || part.reasoning || part.text || '';
        if (thinkingText.trim()) {
          newMessages.push({
            type: 'assistant',
            content: unescapeWithMathProtection(thinkingText),
            timestamp: new Date(),
            isThinking: true,
            isStreaming: true,
          });
        }
        return;
      }

      if (part.type === 'tool_use') {
        if (part.name === 'Bash') {
          setStatusTextOverride(i18n.t('chat:status.runningCode'));
        }

        if (parentToolUseId) {
          childToolUpdates.push({
            parentId: parentToolUseId,
            child: {
              toolId: part.id,
              toolName: part.name,
              toolInput: part.input,
              toolResult: null,
              timestamp: new Date(),
            },
          });
          return;
        }

        const isSubagentContainer = part.name === 'Task';
        newMessages.push({
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          isToolUse: true,
          toolName: part.name,
          toolInput: part.input ? JSON.stringify(part.input, null, 2) : '',
          toolId: part.id,
          toolResult: null,
          isSubagentContainer,
          subagentState: isSubagentContainer
            ? { childTools: [], currentToolIndex: -1, isComplete: false }
            : undefined,
        });
        return;
      }

      if (part.type === 'text' && part.text?.trim()) {
        const content = formatUsageLimitText(decodeHtmlEntities(part.text));
        newMessages.push(...buildAssistantMessages(content, new Date()));
      }
    });

    if (newMessages.length > 0 || childToolUpdates.length > 0) {
      setChatMessages((previous) => {
        let updated = previous;
        if (childToolUpdates.length > 0) {
          updated = updated.map((message) => {
            if (!message.isSubagentContainer) return message;
            const updates = childToolUpdates.filter((update) => update.parentId === message.toolId);
            if (updates.length === 0) return message;
            const existingChildren = message.subagentState?.childTools || [];
            return {
              ...message,
              subagentState: {
                childTools: [...existingChildren, ...updates.map((update) => update.child)],
                currentToolIndex: existingChildren.length + updates.length - 1,
                isComplete: false,
              },
            };
          });
        }
        return newMessages.length > 0
          ? mergeFinalAssistantMessages(updated, newMessages)
          : updated;
      });
    }
  };

  const handleSimpleAssistantMessage = (structuredData: any) => {
    const content = formatUsageLimitText(decodeHtmlEntities(structuredData.content));
    setChatMessages((previous) => mergeFinalAssistantMessages(
      previous,
      buildAssistantMessages(content, new Date()),
    ));
  };

  const handleUserToolResults = (structuredData: any, rawData: any) => {
    const parentToolUseId = rawData?.parentToolUseId;
    const toolResults = structuredData.content.filter((part: any) => part.type === 'tool_result');
    const textParts = structuredData.content.filter((part: any) => part.type === 'text');

    if (textParts.length > 0) {
      const textContent = textParts.map((part: any) => part.text || '').join('\n');
      const isSkillText =
        textContent.includes('Base directory for this skill:') ||
        textContent.startsWith('<command-name>') ||
        textContent.startsWith('<command-message>') ||
        textContent.startsWith('<command-args>') ||
        (toolResults.length > 0 && !textContent.startsWith('<system-reminder>'));
      if (isSkillText && textContent.trim()) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'user',
            content: textContent,
            timestamp: new Date(),
            isSkillContent: true,
          },
        ]);
      }
    }

    if (toolResults.length === 0) return;

    setStatusTextOverride(null);
    setChatMessages((previous) =>
      previous.map((message) => {
        for (const part of toolResults) {
          if (parentToolUseId && message.toolId === parentToolUseId && message.isSubagentContainer) {
            const updatedChildren = message.subagentState!.childTools.map((child: any) => {
              if (child.toolId !== part.tool_use_id) return child;
              return {
                ...child,
                toolResult: {
                  content: part.content,
                  isError: part.is_error,
                  timestamp: new Date(),
                },
              };
            });
            if (updatedChildren !== message.subagentState!.childTools) {
              return {
                ...message,
                subagentState: {
                  ...message.subagentState!,
                  childTools: updatedChildren,
                },
              };
            }
          }

          if (message.isToolUse && message.toolId === part.tool_use_id) {
            const result: any = {
              ...message,
              toolResult: {
                content: part.content,
                isError: part.is_error,
                timestamp: new Date(),
              },
            };
            if (message.toolName === 'AskUserQuestion' && part.content) {
              const resultText = typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
              const parsedAnswers = parseAskUserAnswers(resultText);
              if (parsedAnswers) {
                result.toolInput = mergeAnswersIntoToolInput(String(message.toolInput || '{}'), parsedAnswers);
              }
            }
            if (message.isSubagentContainer && message.subagentState) {
              result.subagentState = {
                ...message.subagentState,
                isComplete: true,
              };
            }
            return result;
          }
        }
        return message;
      }),
    );
  };

  useEffect(() => {
    if (!latestMessage || lastProcessedMessageRef.current === latestMessage) return;
    lastProcessedMessageRef.current = latestMessage;

    const rawData = latestMessage.data;
    const rawType =
      rawData && typeof rawData === 'object' && typeof rawData.type === 'string'
        ? String(rawData.type)
        : null;
    const isStreamingEnvelope = rawType
      ? [
          'content_block_start',
          'content_block_delta',
          'content_block_stop',
          'message_start',
          'message_delta',
          'message_stop',
          'system',
        ].includes(rawType)
      : false;
    const messageData =
      !isStreamingEnvelope &&
      rawData &&
      typeof rawData === 'object' &&
      (rawType === 'assistant' || rawType === 'result' || rawType === 'user') &&
      rawData.message
        ? rawData.message
        : rawData?.message || rawData;
    const structuredMessageData =
      messageData && typeof messageData === 'object' ? (messageData as Record<string, any>) : null;
    const rawStructuredData =
      latestMessage.data && typeof latestMessage.data === 'object'
        ? (latestMessage.data as Record<string, any>)
        : null;

    const globalMessageTypes = ['projects_updated', 'taskmaster-project-updated', 'session-created', 'session-aborted'];
    const isGlobalMessage = globalMessageTypes.includes(String(latestMessage.type));
    const lifecycleMessageTypes = new Set(['claude-complete', 'session-aborted', 'claude-error']);

    const isClaudeSystemInit =
      latestMessage.type === 'claude-response' &&
      structuredMessageData &&
      structuredMessageData.type === 'system' &&
      structuredMessageData.subtype === 'init';

    const systemInitSessionId = isClaudeSystemInit ? structuredMessageData?.session_id : null;
    const activeViewSessionId = selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;
    const isSystemInitForView = systemInitSessionId && (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
    const shouldBypassSessionFilter = isGlobalMessage || Boolean(isSystemInitForView);
    const isUnscopedError =
      !latestMessage.sessionId &&
      pendingViewSessionRef.current &&
      !pendingViewSessionRef.current.sessionId &&
      latestMessage.type === 'claude-error';

    const handleBackgroundLifecycle = (sessionId?: string) => {
      if (!sessionId) return;
      clearSessionTimerStart(sessionId);
      onSessionInactive?.(sessionId);
      onSessionNotProcessing?.(sessionId);
      onSessionStatusResolved?.(sessionId, false);
    };

    if (!shouldBypassSessionFilter) {
      if (!activeViewSessionId) {
        if (latestMessage.sessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
          handleBackgroundLifecycle(latestMessage.sessionId);
        }
        if (!isUnscopedError) return;
      }

      if (!latestMessage.sessionId && !isUnscopedError) return;

      if (latestMessage.sessionId !== activeViewSessionId) {
        if (latestMessage.sessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
          handleBackgroundLifecycle(latestMessage.sessionId);
        }
        return;
      }
    }

    const suppressWhileAbortRequestedTypes = new Set(['claude-response', 'claude-output', 'claude-status']);
    if (isSessionAbortRequested(latestMessage.sessionId || null) && suppressWhileAbortRequestedTypes.has(String(latestMessage.type))) {
      return;
    }

    switch (latestMessage.type) {
      case 'session-created': {
        if (!latestMessage.sessionId) break;
        const createdSessionId = latestMessage.sessionId;
        const previousSessionId =
          typeof latestMessage.previousSessionId === 'string' && latestMessage.previousSessionId.trim()
            ? latestMessage.previousSessionId
            : null;
        const shouldAdoptCreatedSession =
          !currentSessionId ||
          currentSessionId.startsWith('new-session-') ||
          (previousSessionId !== null && currentSessionId === previousSessionId) ||
          (previousSessionId !== null && selectedSession?.id === previousSessionId);

        if (!shouldAdoptCreatedSession) break;

        const pendingStartTime = pendingViewSessionRef.current?.startedAt;
        const temporarySessionId = currentSessionId?.startsWith('new-session-') ? currentSessionId : null;
        if (temporarySessionId) {
          moveSessionTimerStart(temporarySessionId, createdSessionId);
        }
        if (previousSessionId && previousSessionId !== createdSessionId) {
          moveSessionTimerStart(previousSessionId, createdSessionId);
          onSessionInactive?.(previousSessionId);
          onSessionNotProcessing?.(previousSessionId);
          onSessionStatusResolved?.(previousSessionId, false);
        }
        persistStartTime(
          typeof latestMessage.startTime === 'number' ? latestMessage.startTime : pendingStartTime,
          createdSessionId,
        );
        if (selectedProject && latestMessage.mode && createdSessionId) {
          safeLocalStorage.setItem(`session_mode_${selectedProject.name}_${createdSessionId}`, String(latestMessage.mode));
        }
        sessionStorage.setItem('pendingSessionId', createdSessionId);
        if (
          pendingViewSessionRef.current &&
          (!pendingViewSessionRef.current.sessionId || pendingViewSessionRef.current.sessionId === previousSessionId)
        ) {
          pendingViewSessionRef.current.sessionId = createdSessionId;
        }
        setIsSystemSessionChange(true);
        onReplaceTemporarySession?.(createdSessionId);
        onNavigateToSession?.(createdSessionId, 'claude', selectedProject?.name);
        setPendingPermissionRequests((previous) =>
          previous.map((request) =>
            request.sessionId ? request : { ...request, sessionId: createdSessionId },
          ),
        );
        break;
      }

      case 'token-budget':
        if (latestMessage.data) {
          setTokenBudget(latestMessage.data);
        }
        break;

      case 'claude-response': {
        if (messageData && typeof messageData === 'object' && messageData.type) {
          if (Number.isFinite(messageData.startTime)) {
            persistStartTime(messageData.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
            syncClaudeStatusStartTime(messageData.startTime);
          }
          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            if (!firstTokenLoggedRef.current && typeof window !== 'undefined') {
              const metrics = window.__medautodataChatMetrics;
              if (metrics?.enabled && typeof metrics.lastSendAt === 'number') {
                metrics.firstTokenAt = performance.now();
                firstTokenLoggedRef.current = true;
              }
            }
            setIsLoading(true);
            setStatusTextOverride(null);
            streamBufferRef.current += decodeHtmlEntities(messageData.delta.text);
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 30);
            }
            return;
          }
          if (
            messageData.type === 'content_block_delta'
            && (messageData.delta?.thinking || messageData.delta?.type === 'thinking_delta')
          ) {
            setIsLoading(true);
            setStatusTextOverride(i18n.t('chat:status.reasoning'));
            return;
          }
          if (messageData.type === 'content_block_stop') {
            flushAndFinalizePendingStream();
            return;
          }
        }

        if (isClaudeSystemInit && structuredMessageData?.session_id && isSystemInitForView) {
          if (!currentSessionId || structuredMessageData.session_id !== currentSessionId) {
            setIsSystemSessionChange(true);
            onNavigateToSession?.(structuredMessageData.session_id, 'claude', selectedProject?.name);
            return;
          }
        }

        if (structuredMessageData && Array.isArray(structuredMessageData.content) && structuredMessageData.role === 'assistant') {
          flushAndFinalizePendingStream();
          handleStructuredAssistantMessage(structuredMessageData, rawStructuredData);
        } else if (
          structuredMessageData &&
          structuredMessageData.role === 'assistant' &&
          typeof structuredMessageData.content === 'string' &&
          structuredMessageData.content.trim()
        ) {
          flushAndFinalizePendingStream();
          handleSimpleAssistantMessage(structuredMessageData);
        }

        if (structuredMessageData?.role === 'user' && Array.isArray(structuredMessageData.content)) {
          handleUserToolResults(structuredMessageData, rawStructuredData);
        }
        break;
      }

      case 'claude-output': {
        const cleaned = String(latestMessage.data || '');
        if (cleaned.trim()) {
          streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
          if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;
              appendStreamingChunk(setChatMessages, chunk, true);
            }, 30);
          }
        }
        break;
      }

      case 'claude-complete': {
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        const completedSessionId = latestMessage.sessionId || currentSessionId || pendingSessionId;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        clearSessionAbortRequested(completedSessionId);
        markSessionsAsCompleted(completedSessionId, currentSessionId, selectedSession?.id, pendingSessionId);
        if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          sessionStorage.removeItem('pendingSessionId');
        }
        if (selectedProject && latestMessage.exitCode === 0) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        setPendingPermissionRequests([]);
        break;
      }

      case 'claude-error': {
        if (isLegacyTaskMasterInstallError(latestMessage.error)) break;
        const erroredSessionId =
          latestMessage.sessionId ||
          pendingViewSessionRef.current?.sessionId ||
          currentSessionId ||
          selectedSession?.id ||
          null;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        clearSessionAbortRequested(erroredSessionId);
        markSessionsAsCompleted(erroredSessionId, currentSessionId, selectedSession?.id);
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        if (pendingSessionId && (!erroredSessionId || pendingSessionId === erroredSessionId)) {
          sessionStorage.removeItem('pendingSessionId');
        }
        setPendingPermissionRequests([]);
        const details = typeof latestMessage.details === 'string' ? latestMessage.details.trim() : '';
        const errorContent = details
          ? `Error: ${latestMessage.error}\n\n<details><summary>Technical details</summary>\n\n\`\`\`text\n${details.slice(0, 8000)}\n\`\`\`\n</details>`
          : `Error: ${latestMessage.error}`;
        setChatMessages((previous) => {
          const last = previous[previous.length - 1];
          if (last?.type === 'error' && String(last.content || '') === errorContent) {
            return previous;
          }
          return [
            ...previous,
            {
              type: 'error',
              content: errorContent,
              timestamp: new Date(),
              errorType: latestMessage.errorType,
              isRetryable: latestMessage.isRetryable === true,
            },
          ];
        });
        break;
      }

      case 'session-aborted': {
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        const abortedSessionId = latestMessage.sessionId || currentSessionId;
        if (abortedSessionId) {
          clearSessionTimerStart(abortedSessionId);
        }
        if (pendingSessionId && pendingSessionId === abortedSessionId) {
          clearSessionTimerStart(pendingSessionId);
        }
        clearLoadingIndicators();
        clearSessionAbortRequested(abortedSessionId);
        setPendingPermissionRequests([]);
        if (latestMessage.success !== false) {
          markSessionsAsCompleted(abortedSessionId, currentSessionId, selectedSession?.id, pendingSessionId);
          if (pendingSessionId && (!abortedSessionId || pendingSessionId === abortedSessionId)) {
            sessionStorage.removeItem('pendingSessionId');
          }
          setChatMessages((previous) => [...previous, { type: 'assistant', content: 'Session interrupted by user.', timestamp: new Date() }]);
        } else {
          setChatMessages((previous) => [...previous, { type: 'error', content: 'Session has already finished.', timestamp: new Date() }]);
        }
        break;
      }

      case 'session-status': {
        const statusSessionId = latestMessage.sessionId;
        if (isSessionAbortRequested(statusSessionId) && latestMessage.isProcessing !== false) return;
        const isCurrentSession = statusSessionId === currentSessionId || (selectedSession && statusSessionId === selectedSession.id);
        if (isCurrentSession && latestMessage.isProcessing) {
          persistStartTime(latestMessage.startTime, statusSessionId, currentSessionId, selectedSession?.id);
          setIsLoading(true);
          setCanAbortSession(true);
          onSessionProcessing?.(statusSessionId);
          onSessionStatusResolved?.(statusSessionId, true);
          if (Number.isFinite(latestMessage.startTime)) {
            syncClaudeStatusStartTime(latestMessage.startTime, RESUMING_STATUS_TEXT);
          }
        } else if (isCurrentSession && latestMessage.isProcessing === false) {
          clearSessionAbortRequested(statusSessionId);
          clearSessionTimerStart(statusSessionId);
          clearLoadingIndicators();
          onSessionNotProcessing?.(statusSessionId);
          onSessionStatusResolved?.(statusSessionId, false);
        }
        break;
      }

      case 'claude-permission-request': {
        const { requestId, toolName, input: toolInput } = latestMessage;
        if (!requestId || !toolName) break;
        setPendingPermissionRequests((previous) => {
          if (previous.some((request) => request.requestId === requestId)) return previous;
          return [
            ...previous,
            {
              requestId,
              toolName,
              input: toolInput,
              sessionId: latestMessage.sessionId || currentSessionId,
              receivedAt: new Date(),
            },
          ];
        });
        setIsLoading(true);
        setCanAbortSession(true);
        break;
      }

      case 'claude-permission-cancelled': {
        const { requestId } = latestMessage;
        if (requestId) {
          setPendingPermissionRequests((previous) => previous.filter((request) => request.requestId !== requestId));
        }
        break;
      }

      case 'claude-status': {
        const statusData = latestMessage.data;
        if (!statusData) break;
        persistStartTime(statusData.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
        const statusInfo = {
          text: statusData.message || statusData.status || (typeof statusData === 'string' ? statusData : 'Working...'),
          tokens: statusData.tokens || statusData.token_count || 0,
          can_interrupt: statusData.can_interrupt !== undefined ? statusData.can_interrupt : true,
          startTime: statusData.startTime,
        };
        setClaudeStatus((previous) => ({
          ...statusInfo,
          startTime: Number.isFinite(statusInfo.startTime) ? statusInfo.startTime : previous?.startTime,
        }));
        setIsLoading(true);
        setCanAbortSession(statusInfo.can_interrupt);
        break;
      }

      default:
        break;
    }
  }, [
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
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onSessionStatusResolved,
    onReplaceTemporarySession,
    onNavigateToSession,
  ]);
}
