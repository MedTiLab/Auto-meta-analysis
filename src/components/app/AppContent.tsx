import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';

import { useWebSocket } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useInteractionTelemetry } from '../../hooks/useInteractionTelemetry';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { isTelemetryEnabled, TELEMETRY_SETTINGS_EVENT } from '../../utils/telemetry';
import {
  clearSessionAbortRequested,
  clearSessionTimerStart,
  clearTemporarySessionTimerStarts,
  persistSessionTimerStart,
} from '../chat/utils/chatStorage';
import { collectActiveSessionIds, getLifecycleSessionIds } from './sessionActivity';

const SESSION_FINISHED_MESSAGE_TYPES = new Set([
  'claude-complete',
  'session-aborted',
  'claude-error',
]);

export default function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, latestMessage, isConnected } = useWebSocket();
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const hasNormalizedDesktopSidebar = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return 248;
    const saved = Number.parseInt(window.localStorage.getItem('medhelp.sidebarWidth') || '', 10);
    return Number.isFinite(saved) ? Math.min(360, Math.max(220, saved)) : 248;
  });

  const handleSidebarResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(Math.min(360, Math.max(220, moveEvent.clientX)));
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
    window.localStorage.setItem('medhelp.sidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);

  const {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
    syncProcessingSessions,
  } = useSessionProtection();

  const {
    projects,
    trashProjects,
    trashSessions,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    isLoadingTrashProjects,
    isInputFocused,
    externalMessageUpdate,
    importedProjectAnalysisPrompt,
    newSessionMode,
    setNewSessionMode,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    fetchTrashProjects,
    sidebarSharedProps,
    handleProjectSelect,
    handleNavigateToSession,
    handleStartWorkspaceQa,
    handleChatFromReference,
    handleStartResearchFromNews,
    pendingAutoIntake,
    handleProjectCreatedWithIntake,
    clearPendingAutoIntake,
    clearImportedProjectAnalysisPrompt,
  } = useProjectsState({
    sessionId,
    navigate,
    latestMessage,
    isMobile,
    activeSessions,
    processingSessions,
  });

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    sendMessage({ type: 'get-active-sessions' });
  }, [isConnected, sendMessage]);

  useEffect(() => {
    const messageType = typeof latestMessage?.type === 'string' ? latestMessage.type : '';
    const messageSessionId =
      typeof latestMessage?.sessionId === 'string' && latestMessage.sessionId.trim()
        ? latestMessage.sessionId
        : null;
    const lifecycleSessionIds = getLifecycleSessionIds(latestMessage);
    const primarySessionId = messageSessionId || lifecycleSessionIds[0] || null;

    if (!primarySessionId) {
      return;
    }

    if (messageType === 'session-created') {
      lifecycleSessionIds
        .filter((sessionId) => sessionId !== primarySessionId)
        .forEach((sessionId) => {
          clearSessionTimerStart(sessionId);
          clearSessionAbortRequested(sessionId);
          markSessionAsInactive(sessionId);
          markSessionAsNotProcessing(sessionId);
        });

      clearTemporarySessionTimerStarts();
      if (Number.isFinite(latestMessage.startTime)) {
        persistSessionTimerStart(primarySessionId, latestMessage.startTime);
      }
      replaceTemporarySession(primarySessionId);
      return;
    }

    if (messageType === 'session-status') {
      if (latestMessage.isProcessing) {
        if (Number.isFinite(latestMessage.startTime)) {
          persistSessionTimerStart(primarySessionId, latestMessage.startTime);
        }
        markSessionAsActive(primarySessionId);
        markSessionAsProcessing(primarySessionId);
        return;
      }

      clearSessionTimerStart(primarySessionId);
      clearSessionAbortRequested(primarySessionId);
      markSessionAsInactive(primarySessionId);
      markSessionAsNotProcessing(primarySessionId);
      return;
    }

    if (!SESSION_FINISHED_MESSAGE_TYPES.has(messageType)) {
      return;
    }

    const sessionIdsToClear = lifecycleSessionIds.length > 0 ? lifecycleSessionIds : [primarySessionId];
    sessionIdsToClear.forEach((sessionId) => {
      clearSessionTimerStart(sessionId);
      clearSessionAbortRequested(sessionId);
      markSessionAsInactive(sessionId);
      markSessionAsNotProcessing(sessionId);
    });
    clearTemporarySessionTimerStarts();
  }, [
    latestMessage,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsNotProcessing,
    markSessionAsProcessing,
    replaceTemporarySession,
  ]);

  useEffect(() => {
    if (latestMessage?.type !== 'active-sessions') {
      return;
    }

    syncProcessingSessions(collectActiveSessionIds(latestMessage.sessions, processingSessions));
  }, [latestMessage, processingSessions, syncProcessingSessions]);

  useInteractionTelemetry({
    selectedProjectName: selectedProject?.name || null,
    selectedSessionId: selectedSession?.id || sessionId || null,
    activeTab: activeTab || null,
    routePath: location.pathname || null,
  });

  useEffect(() => {
    window.refreshProjects = fetchProjects;

    return () => {
      if (window.refreshProjects === fetchProjects) {
        delete window.refreshProjects;
      }
    };
  }, [fetchProjects]);

  useEffect(() => {
    window.refreshTrashProjects = fetchTrashProjects;

    return () => {
      if (window.refreshTrashProjects === fetchTrashProjects) {
        delete window.refreshTrashProjects;
      }
    };
  }, [fetchTrashProjects]);

  useEffect(() => {
    window.openSettings = openSettings;

    return () => {
      if (window.openSettings === openSettings) {
        delete window.openSettings;
      }
    };
  }, [openSettings]);

  useEffect(() => {
    window.handleProjectCreatedWithIntake = handleProjectCreatedWithIntake;

    return () => {
      if (window.handleProjectCreatedWithIntake === handleProjectCreatedWithIntake) {
        delete window.handleProjectCreatedWithIntake;
      }
    };
  }, [handleProjectCreatedWithIntake]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const syncTelemetrySetting = () => {
      sendMessage({
        type: 'telemetry-settings',
        enabled: isTelemetryEnabled(),
      });
    };

    syncTelemetrySetting();
    window.addEventListener(TELEMETRY_SETTINGS_EVENT, syncTelemetrySetting);
    return () => {
      window.removeEventListener(TELEMETRY_SETTINGS_EVENT, syncTelemetrySetting);
    };
  }, [isConnected, sendMessage]);

  useEffect(() => {
    if (isMobile || hasNormalizedDesktopSidebar.current) {
      return;
    }

    hasNormalizedDesktopSidebar.current = true;
    if (!sidebarVisible) {
      setPreference('sidebarVisible', true);
    }
  }, [isMobile, setPreference, sidebarVisible]);

  const SIDEBAR_COLLAPSED_WIDTH = 48; // matches SidebarCollapsed w-12
  const desktopSidebarWidth = sidebarVisible ? sidebarWidth : SIDEBAR_COLLAPSED_WIDTH;

  return (
    <div className="oss-shell fixed inset-0 flex text-foreground">
      {!isMobile ? (
        <div
          className="h-full flex-shrink-0 relative transition-[width] duration-150 ease-out"
          style={{ width: desktopSidebarWidth }}
        >
          <div
            className="h-full border-r border-border"
          >
            <Sidebar {...sidebarSharedProps} />
          </div>
          {sidebarVisible && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none transition-colors hover:bg-primary/15 active:bg-primary/25"
              onPointerDown={handleSidebarResizeStart}
            />
          )}
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative w-[85vw] max-w-sm sm:w-80 h-full bg-card border-r border-border/40 transform transition-transform duration-150 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <MainContent
          projects={projects}
          trashProjects={trashProjects}
          trashSessions={trashSessions}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          latestMessage={latestMessage}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          isTrashLoading={isLoadingTrashProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionActive={markSessionAsActive}
          onSessionInactive={markSessionAsInactive}
          onSessionProcessing={markSessionAsProcessing}
          onSessionNotProcessing={markSessionAsNotProcessing}
          processingSessions={processingSessions}
          onReplaceTemporarySession={replaceTemporarySession}
          onNavigateToSession={(targetSessionId: string, targetProvider?, targetProjectName?) =>
            handleNavigateToSession(targetSessionId, targetProvider, targetProjectName)}
          onShowSettings={() => setShowSettings(true)}
          externalMessageUpdate={externalMessageUpdate}
          pendingAutoIntake={pendingAutoIntake}
          clearPendingAutoIntake={clearPendingAutoIntake}
          importedProjectAnalysisPrompt={importedProjectAnalysisPrompt}
          clearImportedProjectAnalysisPrompt={clearImportedProjectAnalysisPrompt}
          onProjectSelect={handleProjectSelect}
          onStartWorkspaceQa={handleStartWorkspaceQa}
          onChatFromReference={handleChatFromReference}
          onStartResearchFromNews={handleStartResearchFromNews}
          newSessionMode={newSessionMode}
          onNewSessionModeChange={setNewSessionMode}
        />
      </div>

    </div>
  );
}
