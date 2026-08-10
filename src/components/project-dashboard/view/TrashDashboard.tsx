import { AlertTriangle, ArchiveRestore, FolderX, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import type { TrashProject, TrashSession } from '../../../types/app';
import { Button } from '../../ui/button';
import { formatTimeAgo } from '../../../utils/dateUtils';

type TrashDashboardProps = {
  projects: TrashProject[];
  sessions: TrashSession[];
  onRefresh: () => Promise<void> | void;
  isLoading?: boolean;
};

type DeleteMode = 'logical' | 'physical';

export default function TrashDashboard({ projects, sessions, onRefresh, isLoading = false }: TrashDashboardProps) {
  const { t } = useTranslation(['common', 'sidebar']);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrashProject | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<TrashSession | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const handleRestore = async (project: TrashProject) => {
    setErrorMessage(null);
    setLoadingKey(`restore:${project.name}`);
    try {
      const response = await api.restoreProject(project.name);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || t('sidebar:messages.deleteProjectFailed'));
      }
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('sidebar:messages.deleteProjectError'));
    } finally {
      setLoadingKey(null);
    }
  };

  const handleDelete = async (project: TrashProject, mode: DeleteMode) => {
    setErrorMessage(null);
    setLoadingKey(`${mode}:${project.name}`);
    try {
      const response = await api.deleteTrashedProject(project.name, mode);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || t('sidebar:messages.deleteProjectFailed'));
      }
      setDeleteTarget(null);
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('sidebar:messages.deleteProjectError'));
    } finally {
      setLoadingKey(null);
    }
  };

  const handleRestoreSession = async (session: TrashSession) => {
    setErrorMessage(null);
    setLoadingKey(`restore-session:${session.id}`);
    try {
      const response = await api.restoreSession(session.projectName, session.id);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || t('sidebar:messages.deleteProjectFailed'));
      }
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('sidebar:messages.deleteProjectError'));
    } finally {
      setLoadingKey(null);
    }
  };

  const handleDeleteSessionPermanently = async (session: TrashSession) => {
    setErrorMessage(null);
    setLoadingKey(`physical-session:${session.id}`);
    try {
      const response = await api.deleteSessionPermanently(session.projectName, session.id, session.provider);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || t('sidebar:messages.deleteProjectFailed'));
      }
      setDeleteSessionTarget(null);
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('sidebar:messages.deleteProjectError'));
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {errorMessage && (
          <div className="mb-4 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
            {errorMessage}
          </div>
        )}
        {isLoading ? (
          <div className="rounded-3xl border border-border bg-card/70 px-8 py-16 text-center shadow-sm">
            <div className="mx-auto h-16 w-16 animate-pulse rounded-2xl bg-muted" />
            <p className="mt-6 text-sm text-muted-foreground">{t('common:status.loading')}</p>
          </div>
        ) : projects.length === 0 && sessions.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/70 px-8 py-16 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Trash2 className="h-7 w-7" />
            </div>
            <h2 className="mt-6 text-2xl font-semibold text-foreground">{t('common:projectDashboard.trashEmptyTitle')}</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              {t('common:projectDashboard.trashEmptyDescription')}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {sessions.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  <Trash2 className="h-3.5 w-3.5" />
                  Deleted Sessions
                </div>
                <div className="space-y-3">
                  {sessions.map((session) => {
                    const restoreKey = `restore-session:${session.id}`;
                    const physicalKey = `physical-session:${session.id}`;
                    return (
                      <div
                        key={session.id}
                        className="rounded-3xl border border-border/60 bg-card/90 p-5 shadow-sm backdrop-blur"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                              <span className="rounded-full border border-border/60 px-3 py-1">
                                {session.provider}
                              </span>
                              <span className="rounded-full border border-border/60 px-3 py-1">
                                {session.projectDisplayName || session.projectName}
                              </span>
                              <span className="rounded-full border border-border/60 px-3 py-1">
                                {formatTimeAgo(session.trashedAt, currentTime, t)}
                              </span>
                            </div>
                            <h3 className="mt-2 text-xl font-semibold text-foreground">{session.displayName}</h3>
                            <p className="mt-1 break-all text-sm text-muted-foreground">{session.id}</p>
                          </div>
                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            <Button
                              variant="outline"
                              onClick={() => handleRestoreSession(session)}
                              disabled={loadingKey !== null}
                            >
                              <ArchiveRestore className="mr-2 h-4 w-4" />
                              {loadingKey === restoreKey ? t('common:status.loading') : 'Restore'}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => setDeleteSessionTarget(session)}
                              disabled={loadingKey !== null}
                            >
                              <FolderX className="mr-2 h-4 w-4" />
                              Delete
                            </Button>
                          </div>
                        </div>

                        {deleteSessionTarget?.id === session.id && (
                          <div className="mt-4 rounded-2xl border border-border bg-muted/35 p-4">
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                              <div className="flex-1">
                                <h4 className="text-sm font-semibold text-foreground">
                                  Permanently delete this session?
                                </h4>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  This will remove it from the index and delete provider files when applicable.
                                </p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <Button
                                    variant="outline"
                                    onClick={() => setDeleteSessionTarget(null)}
                                    disabled={loadingKey !== null}
                                  >
                                    {t('sidebar:actions.cancel')}
                                  </Button>
                                  <Button
                                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                                    onClick={() => handleDeleteSessionPermanently(session)}
                                    disabled={loadingKey !== null}
                                  >
                                    {loadingKey === physicalKey ? t('common:status.loading') : 'Delete permanently'}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {projects.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('common:projectDashboard.trashBadge')}
                </div>
                <div className="space-y-4">
            {projects.map((project) => {
              const restoreKey = `restore:${project.name}`;
              const logicalKey = `logical:${project.name}`;
              const physicalKey = `physical:${project.name}`;

              return (
                <div
                  key={project.name}
                  className="rounded-3xl border border-border/60 bg-card/90 p-5 shadow-sm backdrop-blur"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('common:projectDashboard.trashBadge')}
                      </div>
                      <h3 className="mt-2 text-xl font-semibold text-foreground">{project.displayName}</h3>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border/60 px-3 py-1">
                          {t('common:projectDashboard.trashDeletedAt', {
                            time: formatTimeAgo(project.trashedAt, currentTime, t),
                          })}
                        </span>
                        <span className="rounded-full border border-border/60 px-3 py-1">
                          {t('common:projectDashboard.trashSessions', { count: project.sessionCount ?? 0 })}
                        </span>
                        {!project.filesExist && (
                          <span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-muted-foreground">
                            {t('common:projectDashboard.trashFilesMissing')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Button
                        variant="outline"
                        onClick={() => handleRestore(project)}
                        disabled={loadingKey !== null || !project.canRestore}
                      >
                        <ArchiveRestore className="mr-2 h-4 w-4" />
                        {loadingKey === restoreKey
                          ? t('common:status.loading')
                          : t('common:projectDashboard.restoreProject')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setDeleteTarget(project)}
                        disabled={loadingKey !== null}
                      >
                        <FolderX className="mr-2 h-4 w-4" />
                        {t('common:projectDashboard.deleteFromTrash')}
                      </Button>
                    </div>
                  </div>

                  {deleteTarget?.name === project.name && (
                    <div className="mt-4 rounded-2xl border border-border bg-muted/35 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-foreground">
                            {t('common:projectDashboard.trashDeleteTitle')}
                          </h4>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t('common:projectDashboard.trashDeleteDescription')}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setDeleteTarget(null)}
                              disabled={loadingKey !== null}
                            >
                              {t('sidebar:actions.cancel')}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => handleDelete(project, 'logical')}
                              disabled={loadingKey !== null}
                            >
                              {loadingKey === logicalKey
                                ? t('common:status.loading')
                                : t('common:projectDashboard.logicalDelete')}
                            </Button>
                            <Button
                              className="bg-primary text-primary-foreground hover:bg-primary/90"
                              onClick={() => handleDelete(project, 'physical')}
                              disabled={loadingKey !== null}
                            >
                              {loadingKey === physicalKey
                                ? t('common:status.loading')
                                : t('common:projectDashboard.physicalDelete')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
