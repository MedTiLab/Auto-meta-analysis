import React, { useEffect } from 'react';
import ErrorBoundary from '../../ErrorBoundary';
import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import type { MainContentProps } from '../types/types';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { queueChatPromptDraftDeferred } from '../../../utils/chatPromptDraft';

const ChatInterface = React.lazy(() => import('../../chat/view/ChatInterface')) as any;
const SkillsDashboard = React.lazy(() => import('../../SkillsDashboard')) as any;
const PubMedDashboard = React.lazy(() => import('../../news-dashboard/view/PubMedDashboard')) as any;
const GlobalReferencesDashboard = React.lazy(() => import('../../references/view/GlobalReferencesDashboard')) as any;
const TrashDashboard = React.lazy(() => import('../../project-dashboard/view/TrashDashboard')) as any;

function LazyFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
    </div>
  );
}

function MainContent({
  projects,
  trashProjects,
  trashSessions,
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  latestMessage,
  isMobile,
  onMenuClick,
  isLoading,
  isTrashLoading,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  externalMessageUpdate,
  pendingAutoIntake,
  clearPendingAutoIntake,
  importedProjectAnalysisPrompt,
  clearImportedProjectAnalysisPrompt,
  onProjectSelect,
  onStartWorkspaceQa,
  onChatFromReference,
  onStartResearchFromNews,
  newSessionMode,
  onNewSessionModeChange,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter } = preferences;

  useEffect(() => {
    if (['dashboard', 'survey', 'files', 'git', 'researchlab', 'metaHelp', 'tasks', 'preview', 'context'].includes(activeTab)) {
      setActiveTab(selectedProject ? 'chat' : 'skills');
    }
  }, [activeTab, selectedProject, setActiveTab]);

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (activeTab === 'news') {
    const targetProject = selectedProject || projects[0] || null;
    return (
      <div className="flex h-full flex-col">
        <MainContentHeader
          activeTab="news"
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowTasksTab={false}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <React.Suspense fallback={<LazyFallback />}>
            <PubMedDashboard
              chatTargetProject={targetProject}
              onStartResearchPrompt={targetProject && onStartResearchFromNews
                ? (project: any, prompt: any) => onStartResearchFromNews(project, prompt)
                : undefined}
            />
          </React.Suspense>
        </div>
      </div>
    );
  }

  if (activeTab === 'references') {
    const targetProject = selectedProject || projects[0] || null;
    return (
      <div className="flex h-full flex-col">
        <MainContentHeader
          activeTab="references"
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowTasksTab={false}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <React.Suspense fallback={<LazyFallback />}>
            <GlobalReferencesDashboard
              chatTargetProject={targetProject}
              onChatFromReference={targetProject && onChatFromReference
                ? (project: any, reference: any) => onChatFromReference(project, reference)
                : undefined}
            />
          </React.Suspense>
        </div>
      </div>
    );
  }

  if (activeTab === 'trash') {
    const refreshTrash = async () => {
      await Promise.all([
        window.refreshTrashProjects?.(),
        window.refreshTrashSessions?.(),
      ]);
    };

    return (
      <div className="flex h-full flex-col">
        <MainContentHeader
          activeTab="trash"
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowTasksTab={false}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <React.Suspense fallback={<LazyFallback />}>
            <TrashDashboard
              projects={trashProjects}
              sessions={trashSessions}
              onRefresh={refreshTrash}
              isLoading={isTrashLoading}
            />
          </React.Suspense>
        </div>
      </div>
    );
  }

  if (activeTab === 'skills' || !selectedProject) {
    const targetProject = selectedProject || projects[0] || null;
    const sendSkillToChat = targetProject
      ? (command: string) => {
          onProjectSelect(targetProject);
          queueChatPromptDraftDeferred(targetProject.name, command);
          setActiveTab('chat');
        }
      : undefined;

    return (
      <div className="flex h-full flex-col">
        <MainContentHeader
          activeTab="skills"
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowTasksTab={false}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <React.Suspense fallback={<LazyFallback />}>
            <SkillsDashboard onSendToChat={sendSkillToChat} />
          </React.Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        shouldShowTasksTab={false}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <ErrorBoundary showDetails>
          <React.Suspense fallback={<LazyFallback />}>
            <ChatInterface
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              ws={ws}
              sendMessage={sendMessage}
              latestMessage={latestMessage}
              onFileOpen={() => undefined}
              onInputFocusChange={onInputFocusChange}
              onSessionActive={onSessionActive}
              onSessionInactive={onSessionInactive}
              onSessionProcessing={onSessionProcessing}
              onSessionNotProcessing={onSessionNotProcessing}
              processingSessions={processingSessions}
              onReplaceTemporarySession={onReplaceTemporarySession}
              onNavigateToSession={onNavigateToSession}
              onShowSettings={onShowSettings}
              autoExpandTools={autoExpandTools}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              autoScrollToBottom={autoScrollToBottom}
              sendByCtrlEnter={sendByCtrlEnter}
              externalMessageUpdate={externalMessageUpdate}
              onShowAllTasks={() => undefined}
              pendingAutoIntake={pendingAutoIntake}
              clearPendingAutoIntake={clearPendingAutoIntake}
              importedProjectAnalysisPrompt={importedProjectAnalysisPrompt}
              clearImportedProjectAnalysisPrompt={clearImportedProjectAnalysisPrompt}
              onStartWorkspaceQa={onStartWorkspaceQa}
              newSessionMode={newSessionMode}
              onNewSessionModeChange={onNewSessionModeChange}
            />
          </React.Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default React.memo(MainContent);
