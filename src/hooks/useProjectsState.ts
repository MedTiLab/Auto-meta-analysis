import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { api } from '../utils/api';
import { queueWorkspaceQaDraft } from '../utils/workspaceQa';
import { queueReferenceChatDraftDeferred } from '../utils/referenceChatDraft';
import { queueProjectFileChatContext } from '../utils/projectFileChatContext';
import type { ProjectFileChatContextItem } from '../utils/projectFileChatContext';
import { queueChatPromptDraftDeferred } from '../utils/chatPromptDraft';
import type { ChatPromptDraft } from '../utils/chatPromptDraft';
import type { Reference } from '../components/references/types';
import { formatReferenceChatPrompt } from '../components/references/types';
import type {
  AppSocketMessage,
  AppTab,
  ImportedProjectAnalysisPrompt,
  LoadingProgress,
  ProjectCreationOptions,
  Project,
  ProjectSession,
  ProjectsUpdatedMessage,
  PendingAutoIntake,
  SessionMode,
  SessionProvider,
  SessionTag,
  TrashProject,
  TrashSession,
} from '../types/app';

declare global {
  interface Window {
    handleProjectCreatedWithIntake?: (project: Project, options?: ProjectCreationOptions) => void;
    refreshProjects?: () => Promise<void>;
    refreshTrashProjects?: () => Promise<void>;
    refreshTrashSessions?: () => Promise<void>;
  }
}

const SESSION_MODE_STORAGE_KEY = 'med-help-new-session-mode';
const LEGACY_SESSION_MODE_STORAGE_KEYS = ['dr-claw-new-session-mode'];

const readStoredNewSessionMode = (): SessionMode => {
  if (typeof window === 'undefined') {
    return 'research';
  }

  window.sessionStorage.setItem(SESSION_MODE_STORAGE_KEY, 'research');
  LEGACY_SESSION_MODE_STORAGE_KEYS.forEach((key) => window.sessionStorage.removeItem(key));
  return 'research';
};

const persistNewSessionMode = (_mode: SessionMode = 'research') => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(SESSION_MODE_STORAGE_KEY, 'research');
  LEGACY_SESSION_MODE_STORAGE_KEYS.forEach((key) => window.sessionStorage.removeItem(key));
};

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  latestMessage: AppSocketMessage | null;
  isMobile: boolean;
  activeSessions: Set<string>;
  processingSessions: Set<string>;
};

type SessionTagsUpdatedDetail = {
  projectName: string;
  sessionId: string;
  provider?: SessionProvider;
  tags: SessionTag[];
};

type ProjectMetadataUpdatedDetail = {
  projectName: string;
  metadata?: Record<string, unknown> | null;
  project?: Project;
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.metadata) !== serialize(prevProject.metadata) ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions);

    if (baseChanged) {
      return true;
    }

    return false;
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return project.sessions ?? [];
};

const matchesSessionIdentity = (
  session: ProjectSession,
  detail: SessionTagsUpdatedDetail,
  providerHint?: SessionProvider,
): boolean => {
  if (session.id !== detail.sessionId) {
    return false;
  }

  if (!detail.provider) {
    return true;
  }

  return (session.__provider || providerHint || 'claude') === detail.provider;
};

const applySessionTagsToList = (
  sessions: ProjectSession[] | undefined,
  detail: SessionTagsUpdatedDetail,
  providerHint: SessionProvider,
): ProjectSession[] | undefined => {
  if (!Array.isArray(sessions)) {
    return sessions;
  }

  let changed = false;
  const nextSessions = sessions.map((session) => {
    if (!matchesSessionIdentity(session, detail, providerHint)) {
      return session;
    }

    if (serialize(session.tags) === serialize(detail.tags)) {
      return session;
    }

    changed = true;
    return {
      ...session,
      tags: detail.tags,
    };
  });

  return changed ? nextSessions : sessions;
};

const applySessionTagsToProject = (
  project: Project,
  detail: SessionTagsUpdatedDetail,
): Project => {
  if (!project || project.name !== detail.projectName) {
    return project;
  }

  const nextClaudeSessions = applySessionTagsToList(project.sessions, detail, 'claude');

  if (nextClaudeSessions === project.sessions) {
    return project;
  }

  return {
    ...project,
    sessions: nextClaudeSessions,
  };
};

const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) {
    return true;
  }

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);

  if (!currentSelectedProject || !updatedSelectedProject) {
    return false;
  }

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );

  if (!currentSelectedSession || !updatedSelectedSession) {
    return false;
  }

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};

  const buildTransientSession = (
    sessionId: string,
    provider: ProjectSession['__provider'] = 'claude',
    projectName?: string,
  ): ProjectSession => ({
    id: sessionId,
    name: 'Auto Research Session',
    summary: 'Auto Research Session',
    mode: 'research',
    __provider: provider,
    __projectName: projectName,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  });

export function useProjectsState({
  sessionId,
  navigate,
  latestMessage,
  isMobile,
  activeSessions,
  processingSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [trashProjects, setTrashProjects] = useState<TrashProject[]>([]);
  const [trashSessions, setTrashSessions] = useState<TrashSession[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('skills');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingTrashProjects, setIsLoadingTrashProjects] = useState(false);
  const [isLoadingTrashSessions, setIsLoadingTrashSessions] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('user');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);
  const [pendingAutoIntake, setPendingAutoIntake] = useState<PendingAutoIntake | null>(null);
  const [importedProjectAnalysisPrompt, setImportedProjectAnalysisPrompt] = useState<ImportedProjectAnalysisPrompt | null>(null);
  const [newSessionMode, setNewSessionMode] = useState<SessionMode>(() => readStoredNewSessionMode());

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsUpdateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProjectsMessageRef = useRef<ProjectsUpdatedMessage | null>(null);

  const recordProjectOpen = useCallback((project: Project | null | undefined, source = 'project_select') => {
    if (!project?.name) {
      return;
    }

    void api.user.recordProjectOpen(project, source).catch((error) => {
      console.warn('Failed to record project activity:', error);
    });
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      setIsLoadingProjects(true);
      const projectsResponse = await api.projects();
      const projectData = (await projectsResponse.json()) as Project[];

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return projectData;
        }

        return projectsHaveChanges(prevProjects, projectData)
          ? projectData
          : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  const fetchTrashProjects = useCallback(async () => {
    try {
      setIsLoadingTrashProjects(true);
      const response = await api.trashedProjects();
      if (!response.ok) {
        return;
      }

      const trashData = (await response.json()) as TrashProject[];
      setTrashProjects(trashData);
    } catch (error) {
      console.error('Error fetching trashed projects:', error);
    } finally {
      setIsLoadingTrashProjects(false);
    }
  }, []);

  const fetchTrashSessions = useCallback(async () => {
    try {
      setIsLoadingTrashSessions(true);
      const response = await api.trashedSessions();
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as TrashSession[];
      setTrashSessions(data);
    } catch (error) {
      console.error('Error fetching trashed sessions:', error);
    } finally {
      setIsLoadingTrashSessions(false);
    }
  }, []);

  const openSettings = useCallback((tab = 'user') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (activeTab === 'trash') {
      void fetchTrashProjects();
      void fetchTrashSessions();
    }
  }, [activeTab, fetchTrashProjects, fetchTrashSessions]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.refreshTrashSessions = async () => {
      await fetchTrashSessions();
    };
    return () => {
      if (window.refreshTrashSessions) {
        delete window.refreshTrashSessions;
      }
    };
  }, [fetchTrashSessions]);

  // TODO: Replace CustomEvent-based session-tags-updated with a shared state
  // manager (e.g., Zustand store or React context) to avoid global event bus coupling.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleSessionTagsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<SessionTagsUpdatedDetail>).detail;
      if (
        !detail
        || !detail.projectName
        || !detail.sessionId
        || !Array.isArray(detail.tags)
      ) {
        return;
      }

      setProjects((prevProjects) => {
        let changed = false;
        const nextProjects = prevProjects.map((project) => {
          const updatedProject = applySessionTagsToProject(project, detail);
          if (updatedProject !== project) {
            changed = true;
          }
          return updatedProject;
        });
        return changed ? nextProjects : prevProjects;
      });

      setSelectedProject((prevProject) => {
        if (!prevProject) {
          return prevProject;
        }

        const nextProject = applySessionTagsToProject(prevProject, detail);
        return nextProject;
      });

      setSelectedSession((prevSession) => {
        if (!prevSession || !matchesSessionIdentity(prevSession, detail)) {
          return prevSession;
        }

        if (serialize(prevSession.tags) === serialize(detail.tags)) {
          return prevSession;
        }

        return {
          ...prevSession,
          tags: detail.tags,
        };
      });
    };

    window.addEventListener('session-tags-updated', handleSessionTagsUpdated as EventListener);
    return () => {
      window.removeEventListener('session-tags-updated', handleSessionTagsUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const applyProjectMetadata = (project: Project, detail: ProjectMetadataUpdatedDetail): Project => {
      if (project.name !== detail.projectName) {
        return project;
      }

      return {
        ...project,
        ...(detail.project || {}),
        metadata: detail.metadata ?? detail.project?.metadata ?? project.metadata ?? null,
      };
    };

    const handleProjectMetadataUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ProjectMetadataUpdatedDetail>).detail;
      if (!detail?.projectName) {
        return;
      }

      setProjects((prevProjects) => prevProjects.map((project) => applyProjectMetadata(project, detail)));
      setSelectedProject((prevProject) => prevProject ? applyProjectMetadata(prevProject, detail) : prevProject);
    };

    window.addEventListener('project-metadata-updated', handleProjectMetadataUpdated as EventListener);
    return () => {
      window.removeEventListener('project-metadata-updated', handleProjectMetadataUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (latestMessage.type === 'session-created' && latestMessage.sessionId && latestMessage.provider) {
      const sessionMode: SessionMode = 'research';
      const createdProvider = 'claude' as const;
      const createdDisplayName = latestMessage.displayName as string | undefined;
      const createdProjectName = latestMessage.projectName as string | undefined;
      const fallbackDisplayName = 'Untitled Session';

      setProjects((prevProjects) => prevProjects.map((project) => {
        const updateSessionList = (
          sessions: ProjectSession[] | undefined,
          provider: ProjectSession['__provider'],
        ): ProjectSession[] | undefined => {
          if (!Array.isArray(sessions)) {
            return sessions;
          }

          let changed = false;
          const nextSessions = sessions.map((session) => {
            if (session.id !== latestMessage.sessionId) {
              return session;
            }

            changed = true;
            return {
              ...session,
              mode: sessionMode,
              __provider: session.__provider || provider,
            };
          });

          return changed ? nextSessions : sessions;
        };

        const nextProject = {
          ...project,
          sessions: updateSessionList(project.sessions, 'claude'),
        };

        if (createdProjectName && project.name === createdProjectName && createdProvider) {
          const arr = nextProject.sessions || [];
          const alreadyExists = arr.some((s) => s.id === latestMessage.sessionId);
          if (!alreadyExists) {
            const newSession: ProjectSession = {
              id: latestMessage.sessionId as string,
              name: createdDisplayName || fallbackDisplayName,
              summary: createdDisplayName || fallbackDisplayName,
              mode: sessionMode,
              __provider: createdProvider,
              __projectName: project.name,
              createdAt: new Date().toISOString(),
              lastActivity: new Date().toISOString(),
            };
            nextProject.sessions = [newSession, ...arr];
          }
        }

        return nextProject;
      }));

      setSelectedSession((previous) => {
        if (!previous || previous.id !== latestMessage.sessionId) {
          return previous;
        }

        const resolvedDisplayName = createdDisplayName || fallbackDisplayName;
        return {
          ...previous,
          name: resolvedDisplayName,
          summary: resolvedDisplayName,
          mode: sessionMode,
          __provider: previous.__provider || createdProvider,
          __projectName: previous.__projectName || createdProjectName,
        };
      });
    }

    if (latestMessage.type === 'loading_progress') {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }

      setLoadingProgress(latestMessage as LoadingProgress);

      if (latestMessage.phase === 'complete') {
        loadingProgressTimeoutRef.current = setTimeout(() => {
          setLoadingProgress(null);
          loadingProgressTimeoutRef.current = null;
        }, 500);
      }

      return;
    }

    if (latestMessage.type !== 'projects_updated') {
      return;
    }

    pendingProjectsMessageRef.current = latestMessage as ProjectsUpdatedMessage;

    if (projectsUpdateDebounceRef.current) {
      return;
    }

    projectsUpdateDebounceRef.current = setTimeout(() => {
      projectsUpdateDebounceRef.current = null;
      const projectsMessage = pendingProjectsMessageRef.current;
      pendingProjectsMessageRef.current = null;

      if (!projectsMessage) {
        return;
      }

      if (projectsMessage.changedFile && selectedSession && selectedProject) {
        const normalized = projectsMessage.changedFile.replace(/\\/g, '/');
        const changedFileParts = normalized.split('/');

        if (changedFileParts.length >= 2) {
          const filename = changedFileParts[changedFileParts.length - 1];
          const changedSessionId = filename.replace('.jsonl', '');

          if (changedSessionId === selectedSession.id) {
            const isSessionActive = activeSessions.has(selectedSession.id);

            if (!isSessionActive) {
              setExternalMessageUpdate((prev) => prev + 1);
            }
          }
        }
      }

      const hasActiveSession =
        (selectedSession && activeSessions.has(selectedSession.id)) ||
        (activeSessions.size > 0 && Array.from(activeSessions).some((id) => id.startsWith('new-session-')));

      const updatedProjects = projectsMessage.projects;

      if (
        hasActiveSession &&
        !isUpdateAdditive(projects, updatedProjects, selectedProject, selectedSession)
      ) {
        return;
      }

      setProjects(updatedProjects);
      if (activeTab === 'trash') {
        void fetchTrashProjects();
      }

      if (!selectedProject) {
        return;
      }

      const updatedSelectedProject = updatedProjects.find(
        (project) => project.name === selectedProject.name,
      );

      if (!updatedSelectedProject) {
        return;
      }

      if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
        setSelectedProject(updatedSelectedProject);
      }

      if (!selectedSession) {
        return;
      }

      const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (!updatedSelectedSession) {
        setSelectedSession(null);
        return;
      }

      if (serialize(updatedSelectedSession) !== serialize(selectedSession)) {
        setSelectedSession(updatedSelectedSession);
      }
    }, 250);
  }, [activeTab, activeSessions, fetchTrashProjects, latestMessage, projects, selectedProject, selectedSession]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
      if (projectsUpdateDebounceRef.current) {
        clearTimeout(projectsUpdateDebounceRef.current);
        projectsUpdateDebounceRef.current = null;
      }
      pendingProjectsMessageRef.current = null;
    };
  }, []);

  const handleNavigateToSession = useCallback((
    targetSessionId: string,
    targetProvider?: ProjectSession['__provider'],
    targetProjectName?: string,
  ) => {
    if (!targetSessionId) {
      return;
    }

    const shouldSwitchTab = !selectedSession || selectedSession.id !== targetSessionId;
    let matchedProject: Project | null = null;
    let matchedSession: ProjectSession | null = null;

    const targetProject = targetProjectName
      ? projects.find((project) => project.name === targetProjectName)
      : null;
    for (const project of projects) {
      const claudeSession = project.sessions?.find((session) => session.id === targetSessionId);
      if (claudeSession) {
        matchedProject = project;
        matchedSession = { ...claudeSession, __provider: 'claude' };
        break;
      }
    }

    const providerHint = targetProvider === 'claude' ? targetProvider : matchedSession?.__provider;
    const sessionToSelect =
      matchedSession
      || (providerHint ? buildTransientSession(targetSessionId, providerHint, targetProject?.name || selectedProject?.name) : null);

    const projectToSelect = matchedProject || targetProject;
    if (projectToSelect && selectedProject?.name !== projectToSelect.name) {
      recordProjectOpen(projectToSelect, 'session_navigation');
      setSelectedProject(projectToSelect);
    }

    if (sessionToSelect && (selectedSession?.id !== targetSessionId || selectedSession.__provider !== sessionToSelect.__provider)) {
      setSelectedSession(sessionToSelect);
    }

    if (shouldSwitchTab) {
      setActiveTab('chat');
    }

    if (sessionToSelect) {
      navigate(`/session/${targetSessionId}`);
    }
  }, [navigate, projects, recordProjectOpen, selectedProject?.name, selectedSession?.id, selectedSession?.__provider]);

  useEffect(() => {
    if (!sessionId || projects.length === 0) {
      return;
    }

    handleNavigateToSession(sessionId);
  }, [sessionId, projects, handleNavigateToSession]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      recordProjectOpen(project, 'project_select');
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab((currentTab) =>
        currentTab === 'dashboard' || currentTab === 'trash' || currentTab === 'news' || currentTab === 'skills'
          ? 'chat'
          : currentTab,
      );
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate, recordProjectOpen],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      setSelectedSession(session);

      persistNewSessionMode('research');
      setNewSessionMode('research');

      if (activeTab !== 'git' && activeTab !== 'preview') {
        setActiveTab('chat');
      }

      localStorage.setItem('selected-provider', 'claude');

      if (isMobile) {
        const sessionProjectName = session.__projectName;
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);
    },
    [activeTab, isMobile, navigate, selectedProject?.name],
  );

  const handleNewSession = useCallback(
    (project: Project, _mode: SessionMode = 'research') => {
      recordProjectOpen(project, 'new_session');
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      persistNewSessionMode('research');
      setNewSessionMode('research');
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate, recordProjectOpen],
  );

  const handleStartWorkspaceQa = useCallback(
    (project: Project, prompt: string, options?: { projectFiles?: ProjectFileChatContextItem[] }) => {
      recordProjectOpen(project, 'project_chat');
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      persistNewSessionMode('research');
      setNewSessionMode('research');
      if (prompt.trim()) {
        queueWorkspaceQaDraft(project.name, prompt);
      }
      if (options?.projectFiles?.length) {
        queueProjectFileChatContext(project.name, options.projectFiles);
      }
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate, recordProjectOpen],
  );

  const handleChatFromReference = useCallback(
    (project: Project, ref: Reference) => {
      recordProjectOpen(project, 'reference_chat');
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      persistNewSessionMode('research');
      setNewSessionMode('research');
      queueReferenceChatDraftDeferred(project.name, {
        text: formatReferenceChatPrompt(ref),
        referenceId: ref.id,
        pdfCached: ref.pdf_cached === 1,
      });
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate, recordProjectOpen],
  );

  /** Literature monitor: ingest paper into project KB + library, then open chat with draft. */
  const handleStartResearchFromNews = useCallback(
    (project: Project, prompt: string | ChatPromptDraft) => {
      recordProjectOpen(project, 'news_research');
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      persistNewSessionMode('research');
      setNewSessionMode('research');
      queueChatPromptDraftDeferred(project.name, prompt);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate, recordProjectOpen],
  );

  const handleProjectCreatedWithIntake = useCallback(
    (project: Project, options?: ProjectCreationOptions) => {
      recordProjectOpen(project, 'project_created');
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      setPendingAutoIntake(options?.autoIntake ?? null);
      setImportedProjectAnalysisPrompt(options?.importedProjectAnalysisPrompt ?? null);
      navigate('/');
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, navigate, recordProjectOpen],
  );

  const clearPendingAutoIntake = useCallback(() => setPendingAutoIntake(null), []);
  const clearImportedProjectAnalysisPrompt = useCallback(() => setImportedProjectAnalysisPrompt(null), []);

  const handleOpenDashboard = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('dashboard');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleOpenTrash = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('trash');
    void fetchTrashProjects();
    void fetchTrashSessions();
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [fetchTrashProjects, fetchTrashSessions, isMobile, navigate]);

  const handleOpenSkills = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('skills');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleOpenNews = useCallback(() => {
    setSelectedSession(null);
    setActiveTab('news');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleOpenReferences = useCallback(() => {
    setSelectedSession(null);
    setActiveTab('references');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate('/');
      }

      const filterOut = (list?: ProjectSession[]) =>
        list?.filter((session) => session.id !== sessionIdToDelete) ?? [];

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          sessions: filterOut(project.sessions),
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );

      void fetchTrashProjects();
      void fetchTrashSessions();
    },
    [fetchTrashProjects, fetchTrashSessions, navigate, selectedSession?.id],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const [projectsResponse, trashResponse] = await Promise.all([
        api.projects(),
        api.trashedProjects(),
      ]);
      const freshProjects = (await projectsResponse.json()) as Project[];
      const freshTrashProjects = trashResponse.ok ? await trashResponse.json() as TrashProject[] : [];

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, freshProjects) ? freshProjects : prevProjects,
      );
      setTrashProjects(freshTrashProjects);

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [selectedProject, selectedSession]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      isTrashLoading: isLoadingTrashProjects,
      isTrashSessionsLoading: isLoadingTrashSessions,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => openSettings('user'),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
      activeTab,
      processingSessions,
      onOpenDashboard: handleOpenDashboard,
      onOpenTrash: handleOpenTrash,
      onOpenSkills: handleOpenSkills,
      onOpenNews: handleOpenNews,
      onOpenReferences: handleOpenReferences,
      onImportedProjectCreated: handleProjectCreatedWithIntake,
      importedProjectAnalysisPrompt,
      onDismissImportedProjectAnalysisPrompt: clearImportedProjectAnalysisPrompt,
      newSessionMode,
    }),
    [
      activeTab,
      clearImportedProjectAnalysisPrompt,
      handleNewSession,
      handleOpenDashboard,
      handleOpenNews,
      handleOpenReferences,
      handleOpenSkills,
      handleOpenTrash,
      handleProjectCreatedWithIntake,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleSidebarRefresh,
      importedProjectAnalysisPrompt,
      isLoadingProjects,
      isLoadingTrashProjects,
      isLoadingTrashSessions,
      isMobile,
      loadingProgress,
      newSessionMode,
      openSettings,
      processingSessions,
      projects,
      selectedProject,
      selectedSession,
      settingsInitialTab,
      showSettings,
    ],
  );

  return {
    projects,
    trashProjects,
    trashSessions,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    isLoadingTrashProjects,
    isLoadingTrashSessions,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
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
    fetchTrashSessions,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNavigateToSession,
    handleOpenDashboard,
    handleOpenTrash,
    handleOpenSkills,
    handleOpenNews,
    handleNewSession,
    handleStartWorkspaceQa,
    handleChatFromReference,
    handleStartResearchFromNews,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
    pendingAutoIntake,
    handleProjectCreatedWithIntake,
    clearPendingAutoIntake,
    clearImportedProjectAnalysisPrompt,
  };
}
