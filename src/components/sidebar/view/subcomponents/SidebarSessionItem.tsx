import { Check, Clock, Edit2, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import { cn } from '../../../../lib/utils';
import { Badge } from '../../../ui/badge';
import { Button } from '../../../ui/button';
import type { SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';

const STAGE_TAG_TONE_BY_KEY: Record<string, string> = {
  literature: 'border-primary/20 bg-primary/5 text-primary',
  survey: 'border-primary/20 bg-primary/5 text-primary',
  ideation: 'border-primary/20 bg-primary/5 text-primary',
  experiment: 'border-primary/20 bg-primary/5 text-primary',
  publication: 'border-primary/20 bg-primary/5 text-primary',
  promotion: 'border-primary/20 bg-primary/5 text-primary',
};

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;

  const saveEditedSession = () => {
    onSaveEditingSession(project.name, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.name, session.id, sessionView.sessionName, session.__provider);
  };

  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.name);
  };

  const stageTags = Array.isArray(session.tags)
    ? session.tags.filter((tag) => tag?.tagType === 'stage')
    : [];
  const visibleStageTags = stageTags.slice(0, 2);
  const hiddenStageCount = Math.max(0, stageTags.length - visibleStageTags.length);
  const stageTagBadges = stageTags.length > 0 ? (
    <div className="mt-1 flex flex-wrap gap-1">
      {visibleStageTags.map((tag) => (
        <span
          key={`${session.id}-${tag.id}`}
          className={cn(
            'inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium',
            STAGE_TAG_TONE_BY_KEY[tag.tagKey || ''] || 'border-primary/20 bg-primary/5 text-primary',
          )}
        >
          {tag.label}
        </span>
      ))}
      {hiddenStageCount > 0 ? (
        <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
          +{hiddenStageCount}
        </span>
      ) : null}
    </div>
  ) : null;

  const metadata = (
    <>
      <div className="mt-0.5 flex min-w-0 items-center gap-1">
        <Clock className="h-2.5 w-2.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
        </span>
        <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
          <Badge variant="secondary" className="min-w-[1.5rem] justify-center px-1 py-0 text-xs">
            {sessionView.messageCount}
          </Badge>
        </div>
      </div>
      {stageTagBadges}
    </>
  );

  return (
    <div className="group relative">
      {sessionView.isActive ? (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        </div>
      ) : null}

      <div className="md:hidden">
        <div
          className={cn(
            'relative mx-3 my-0.5 rounded-md border bg-card p-2 transition-all duration-150 active:scale-[0.98]',
            isSelected ? 'border-primary/20 bg-primary/5' : 'border-border/30',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-foreground">{sessionView.sessionName}</div>
              {metadata}
            </div>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary/15"
              onClick={(event) => {
                event.stopPropagation();
                requestDeleteSession();
              }}
              title={t('tooltips.deleteSession')}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <Button
          variant="ghost"
          className={cn(
            'mx-1 h-auto w-[calc(100%-0.5rem)] justify-start rounded-lg p-2 text-left font-normal transition-colors duration-200 hover:bg-accent/50',
            isSelected && 'bg-accent pr-16 text-accent-foreground',
          )}
          onClick={() => onSessionSelect(session, project.name)}
        >
          <div className="min-w-0 w-full">
            <div className="truncate text-[14px] font-normal text-foreground/90">{sessionView.sessionName}</div>
            {metadata}
          </div>
        </Button>

        {isSelected ? (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {editingSession === session.id ? (
              <>
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') saveEditedSession();
                    if (event.key === 'Escape') onCancelEditingSession();
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground hover:bg-muted/80"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary hover:bg-primary/15"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartEditingSession(session.id, session.summary || t('projects.newSession'));
                  }}
                  title={t('tooltips.editSessionName')}
                >
                  <Edit2 className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary hover:bg-primary/15"
                  onClick={(event) => {
                    event.stopPropagation();
                    requestDeleteSession();
                  }}
                  title={t('tooltips.deleteSession')}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
