import { useTranslation } from 'react-i18next';
import { FileText, Link2, Unlink, MessageSquare, Trash2 } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import type { ProjectReference } from '../types';
import { formatAuthors } from '../types';

interface ReferenceCardProps {
  reference: ProjectReference;
  isSelected?: boolean;
  isLinked?: boolean;
  isChecked?: boolean;
  onSelect?: (ref: ProjectReference) => void;
  onToggleCheck?: (ref: ProjectReference) => void;
  onLink?: (ref: ProjectReference) => void;
  onUnlink?: (ref: ProjectReference) => void;
  onChat?: (ref: ProjectReference) => void;
  onDelete?: (ref: ProjectReference) => void;
}

export default function ReferenceCard({
  reference,
  isSelected = false,
  isLinked = false,
  isChecked = false,
  onSelect,
  onToggleCheck,
  onLink,
  onUnlink,
  onChat,
  onDelete,
}: ReferenceCardProps) {
  const { t } = useTranslation('references');
  const authorsStr = formatAuthors(reference.authors);
  const sourceLabel = t(`sources.${reference.source}`, {
    defaultValue: String(reference.source || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()),
  });
  const projectLinked = Boolean(reference.project_linked ?? isLinked);
  const hasLocalArtifact = Boolean(reference.has_local_artifact);
  const isLocalOnly = !projectLinked && hasLocalArtifact;

  return (
    <div
      className={cn(
        'group relative rounded-xl border px-4 py-3 transition-all cursor-pointer',
        isSelected
          ? 'border-foreground/30 bg-accent shadow-sm'
          : 'border-border/40 bg-card hover:border-border/60 hover:bg-accent/50',
      )}
      onClick={() => onSelect?.(reference)}
    >
      <div className="flex items-start justify-between gap-3">
        {onToggleCheck && (
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => { e.stopPropagation(); onToggleCheck(reference); }}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-foreground"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h4 className="truncate text-sm font-medium text-foreground">{reference.title}</h4>
          </div>
          {authorsStr && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{authorsStr}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {reference.year && (
              <Badge variant="secondary" className="text-[10px]">{reference.year}</Badge>
            )}
            {reference.journal && (
              <Badge variant="outline" className="max-w-[180px] truncate text-[10px]">{reference.journal}</Badge>
            )}
            {reference.source && (
              <Badge variant="outline" className="text-[10px]">{sourceLabel}</Badge>
            )}
            {reference.pdf_cached ? (
              <Badge variant="secondary" className="text-[10px]">PDF</Badge>
            ) : null}
            {projectLinked ? (
              <Badge variant="secondary" className="text-[10px]">{t('badges.projectLinked')}</Badge>
            ) : null}
            {hasLocalArtifact ? (
              <Badge variant="outline" className="text-[10px]">{t('badges.localArtifact')}</Badge>
            ) : null}
            {isLocalOnly ? (
              <Badge variant="outline" className="text-[10px]">{t('badges.localOnly')}</Badge>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onChat && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title={t('actions.chatAbout')}
              onClick={(e) => { e.stopPropagation(); onChat(reference); }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
          )}
          {projectLinked && onUnlink ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title={t('actions.unlinkFromProject')}
              onClick={(e) => { e.stopPropagation(); onUnlink(reference); }}
            >
              <Unlink className="h-3.5 w-3.5" />
            </Button>
          ) : onLink ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title={t('actions.linkToProject')}
              onClick={(e) => { e.stopPropagation(); onLink(reference); }}
            >
              <Link2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-primary hover:bg-primary/10 hover:text-primary"
              title={t('actions.delete')}
              onClick={(e) => { e.stopPropagation(); onDelete(reference); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
