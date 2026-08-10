import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../ui/button';
import { Check, ChevronDown, ChevronRight, Edit3, Folder, FolderOpen, MoreHorizontal, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingNameChange: (name: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project, mode?: SessionMode) => void;
  newSessionMode?: SessionMode;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

const getSessionCountDisplay = (sessions: SessionWithProvider[], hasMoreSessions: boolean): string => {
  const sessionCount = sessions.length;
  if (hasMoreSessions && sessionCount >= 5) {
    return `${sessionCount}+`;
  }

  return `${sessionCount}`;
};

type ProjectActionsMenuProps = {
  isStarred: boolean;
  onToggleStarProject: () => void;
  onStartEditingProject: () => void;
  onDeleteProject: () => void;
  t: TFunction;
  className?: string;
  buttonClassName?: string;
  buttonVisible?: boolean;
  menuClassName?: string;
  iconClassName?: string;
  onOpenChange?: (isOpen: boolean) => void;
};

function ProjectActionsMenu({
  isStarred,
  onToggleStarProject,
  onStartEditingProject,
  onDeleteProject,
  t,
  className,
  buttonClassName,
  buttonVisible,
  menuClassName,
  iconClassName,
  onOpenChange,
}: ProjectActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isButtonVisible = (buttonVisible ?? true) || isOpen;

  useEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return undefined;
    }

    const updateMenuPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const estimatedMenuWidth = 192;
      const viewportPadding = 12;
      const nextLeft = Math.min(
        window.innerWidth - estimatedMenuWidth - viewportPadding,
        Math.max(viewportPadding, rect.right - estimatedMenuWidth),
      );
      const nextTop = rect.bottom + 8;

      setMenuPosition({ top: nextTop, left: nextLeft });
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const clickedTrigger = containerRef.current?.contains(target);
      const clickedMenu = menuRef.current?.contains(target);

      if (!clickedTrigger && !clickedMenu) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggleMenu = () => {
    setIsOpen((previous) => !previous);
  };

  const handleToggleStar = () => {
    onToggleStarProject();
    setIsOpen(false);
  };

  const handleStartEditing = () => {
    onStartEditingProject();
    setIsOpen(false);
  };

  const handleDelete = () => {
    onDeleteProject();
    setIsOpen(false);
  };

  return (
    <div
      className={cn('relative flex-shrink-0', !isButtonVisible && 'pointer-events-none', className)}
      ref={containerRef}
    >
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-foreground shadow-md transition-all duration-150 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900',
          isButtonVisible ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
          isOpen && 'bg-muted shadow-md',
          buttonClassName,
        )}
        onClick={handleToggleMenu}
        aria-label={t('tooltips.projectActions')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-hidden={!isButtonVisible}
        tabIndex={isButtonVisible ? 0 : -1}
        title={t('tooltips.projectActions')}
      >
        <MoreHorizontal className={cn('h-4 w-4', iconClassName)} strokeWidth={2} />
      </button>

      {isOpen && menuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className={cn(
            'fixed min-w-[11rem] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/5 dark:border-slate-800 dark:bg-slate-950 dark:ring-white/10',
            menuClassName,
          )}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            zIndex: 9999,
          }}
          role="menu"
        >
          <button
            type="button"
            onClick={handleToggleStar}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/88 transition-colors hover:bg-muted/60"
            role="menuitem"
          >
            <Star
              className={cn(
                'h-4 w-4 flex-shrink-0',
                isStarred ? 'fill-current text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground',
              )}
              strokeWidth={1.9}
            />
            <span className="truncate">
              {isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
            </span>
          </button>

          <button
            type="button"
            onClick={handleStartEditing}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/88 transition-colors hover:bg-muted/60"
            role="menuitem"
          >
            <Edit3 className="h-4 w-4 flex-shrink-0" strokeWidth={1.9} />
            <span className="truncate">{t('actions.rename')}</span>
          </button>

          <button
            type="button"
            onClick={handleDelete}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-primary transition-colors hover:bg-primary/10"
            role="menuitem"
          >
            <Trash2 className="h-4 w-4 flex-shrink-0" strokeWidth={1.9} />
            <span className="truncate">{t('actions.delete')}</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  isStarred,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingSessions,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  newSessionMode,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  touchHandlerFactory,
  t,
}: SidebarProjectItemProps) {
  const isSelected = selectedProject?.name === project.name;
  const isEditing = editingProject === project.name;
  const hasMoreSessions = project.sessionMeta?.hasMore === true;
  const sessionCountDisplay = getSessionCountDisplay(sessions, hasMoreSessions);
  const sessionCountLabel = `${sessionCountDisplay} session${sessions.length === 1 ? '' : 's'}`;
  const [isDesktopActionsMenuOpen, setIsDesktopActionsMenuOpen] = useState(false);
  const toggleProject = () => onToggleProject(project.name);
  const toggleStarProject = () => onToggleStarProject(project.name);

  const saveProjectName = () => {
    onSaveProjectName(project.name);
  };

  const selectAndToggleProject = () => {
    if (selectedProject?.name !== project.name) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  useEffect(() => {
    if (!isSelected) {
      setIsDesktopActionsMenuOpen(false);
    }
  }, [isSelected]);

  const projectTitle = (
    <>
      <div className="min-w-0">
        <div className="truncate text-[14px] font-semibold text-foreground" title={project.displayName}>
          {project.displayName}
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground truncate">
        {sessionCountLabel}
      </div>
    </>
  );

  return (
    <div className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}>
      <div className="group md:group">
        <div className="md:hidden">
          {isEditing ? (
            <div
              className={cn(
                'mx-3 my-1 flex items-center gap-2 rounded-lg border border-border/50 bg-card p-3',
                isSelected && 'bg-primary/5 border-primary/20',
                isStarred &&
                  !isSelected &&
                  'bg-yellow-50/50 dark:bg-yellow-900/5 border-yellow-200/30 dark:border-yellow-800/30',
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center transition-colors flex-shrink-0',
                  isExpanded ? 'bg-primary/10' : 'bg-muted',
                )}
              >
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 text-primary" />
                ) : (
                  <Folder className="w-4 h-4 text-muted-foreground" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={editingName}
                  onChange={(event) => onEditingNameChange(event.target.value)}
                  className="w-full px-3 py-2 text-sm border-2 border-primary/40 focus:border-primary rounded-lg bg-background text-foreground shadow-sm focus:shadow-md transition-all duration-200 focus:outline-none"
                  placeholder={t('projects.projectNamePlaceholder')}
                  autoFocus
                  autoComplete="off"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      saveProjectName();
                    }

                    if (event.key === 'Escape') {
                      onCancelEditingProject();
                    }
                  }}
                  style={{
                    fontSize: '16px',
                    WebkitAppearance: 'none',
                    borderRadius: '8px',
                  }}
                />
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center active:scale-90 transition-all duration-150 shadow-sm active:shadow-none"
                  onClick={saveProjectName}
                  title={t('tooltips.save')}
                >
                  <Check className="w-4 h-4 text-white" />
                </button>
                <button
                  type="button"
                  className="w-8 h-8 rounded-lg bg-gray-500 dark:bg-gray-600 flex items-center justify-center active:scale-90 transition-all duration-150 shadow-sm active:shadow-none"
                  onClick={onCancelEditingProject}
                  title={t('tooltips.cancel')}
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                'mx-3 my-1 flex items-center gap-2 rounded-lg border border-border/50 bg-card p-3 transition-all duration-150',
                isSelected && 'relative z-10 bg-primary/5 border-primary/20',
                isStarred &&
                  !isSelected &&
                  'bg-yellow-50/50 dark:bg-yellow-900/5 border-yellow-200/30 dark:border-yellow-800/30',
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={selectAndToggleProject}
              >
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center transition-colors flex-shrink-0',
                    isExpanded ? 'bg-primary/10' : 'bg-muted',
                  )}
                >
                  {isExpanded ? (
                    <FolderOpen className="w-4 h-4 text-primary" />
                  ) : (
                    <Folder className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium text-foreground truncate">{project.displayName}</h3>
                  <p className="text-xs text-muted-foreground">{sessionCountLabel}</p>
                </div>

                <div className="w-6 h-6 rounded-md bg-muted/30 flex items-center justify-center flex-shrink-0">
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  )}
                </div>
              </button>

              {isSelected && (
                <ProjectActionsMenu
                  isStarred={isStarred}
                  onToggleStarProject={toggleStarProject}
                  onStartEditingProject={() => onStartEditingProject(project)}
                  onDeleteProject={() => onDeleteProject(project)}
                  t={t}
                  buttonClassName={cn('h-8 w-8 rounded-lg active:scale-90', isStarred && 'text-yellow-600 dark:text-yellow-400')}
                />
              )}
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="hidden w-full min-w-0 max-w-full md:flex items-start gap-2">
            <div
              className={cn(
                'min-w-0 max-w-full flex-1 rounded-md border border-border bg-background p-2',
                isSelected && 'border-primary/20 bg-accent/50',
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 text-primary flex-shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(event) => onEditingNameChange(event.target.value)}
                    className="block w-full min-w-0 max-w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:ring-2 focus:ring-primary/20"
                    placeholder={t('projects.projectNamePlaceholder')}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        saveProjectName();
                      }
                      if (event.key === 'Escape') {
                        onCancelEditingProject();
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                className="w-8 h-8 text-primary hover:bg-primary/10 flex items-center justify-center rounded-md transition-colors"
                onClick={saveProjectName}
                title={t('tooltips.save')}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="w-8 h-8 text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-center rounded-md transition-colors"
                onClick={onCancelEditingProject}
                title={t('tooltips.cancel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div
            className="relative hidden md:block"
          >
            <Button
              variant="ghost"
              className={cn(
                'mx-1 flex h-auto w-[calc(100%-0.5rem)] items-center justify-between rounded-lg p-2 font-normal hover:bg-accent/50',
                isSelected && isDesktopActionsMenuOpen ? 'pr-10' : 'pr-3',
                isSelected && 'bg-accent text-accent-foreground',
                isStarred &&
                  !isSelected &&
                  'bg-yellow-50/50 dark:bg-yellow-900/10 hover:bg-yellow-100/50 dark:hover:bg-yellow-900/20',
              )}
              onClick={selectAndToggleProject}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 text-primary flex-shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1 text-left">{projectTitle}</div>
              </div>

              {isExpanded ? (
                <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              )}
            </Button>

            {isSelected && (
              <ProjectActionsMenu
                isStarred={isStarred}
                onToggleStarProject={toggleStarProject}
                onStartEditingProject={() => onStartEditingProject(project)}
                onDeleteProject={() => onDeleteProject(project)}
                t={t}
                className="absolute right-1 top-1/2 -translate-y-1/2"
                buttonClassName={cn(
                  'h-7 w-7 rounded-md',
                  isStarred && 'text-yellow-600 dark:text-yellow-400',
                )}
                buttonVisible
                onOpenChange={setIsDesktopActionsMenuOpen}
              />
            )}
          </div>
        )}
      </div>

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        isLoadingSessions={isLoadingSessions}
        currentTime={currentTime}
        editingSession={editingSession}
        editingSessionName={editingSessionName}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onDeleteSession={onDeleteSession}
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        newSessionMode={newSessionMode}
        touchHandlerFactory={touchHandlerFactory}
        t={t}
      />
    </div>
  );
}
