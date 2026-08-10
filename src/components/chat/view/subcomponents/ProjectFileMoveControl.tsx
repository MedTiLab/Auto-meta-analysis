import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderTree, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';
import { dispatchProjectFileMoved } from '../../../../utils/projectFileEvents';

type MoveableFile = {
  name: string;
  relativePath: string;
  absolutePath?: string | null;
};

type FileTreeNode = {
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
};

type ProjectFileMoveControlProps = {
  projectName: string;
  file: MoveableFile | null;
  onMoved?: (nextFile: MoveableFile) => void;
  compact?: boolean;
  /** Icon only (no label), with accessible title. */
  iconOnly?: boolean;
  buttonVariant?: 'default' | 'outline' | 'secondary' | 'ghost';
  className?: string;
};

const normalizeRelativePath = (value: string) =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');

const getParentDirectory = (value: string) => {
  const normalized = normalizeRelativePath(value);
  const lastSlashIndex = normalized.lastIndexOf('/');
  return lastSlashIndex === -1 ? '' : normalized.slice(0, lastSlashIndex);
};

const collectDirectories = (nodes: FileTreeNode[], prefix = ''): string[] => {
  const directories: string[] = [];

  nodes.forEach((node) => {
    if (node.type !== 'directory') {
      return;
    }

    const nextPath = prefix ? `${prefix}/${node.name}` : node.name;
    directories.push(nextPath);

    if (Array.isArray(node.children) && node.children.length > 0) {
      directories.push(...collectDirectories(node.children, nextPath));
    }
  });

  return directories;
};

export default function ProjectFileMoveControl({
  projectName,
  file,
  onMoved,
  compact = false,
  iconOnly = false,
  buttonVariant = 'ghost',
  className,
}: ProjectFileMoveControlProps) {
  const { t } = useTranslation(['chat', 'common']);
  const moveLabel = t('common:fileOperations.move');
  const [open, setOpen] = useState(false);
  const [directories, setDirectories] = useState<string[]>([]);
  const [directoryInput, setDirectoryInput] = useState('');
  const [isLoadingDirectories, setIsLoadingDirectories] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const currentDirectory = useMemo(
    () => getParentDirectory(file?.relativePath || ''),
    [file?.relativePath],
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !projectName) {
      return;
    }

    let cancelled = false;

    const loadDirectories = async () => {
      setIsLoadingDirectories(true);
      setErrorMessage(null);

      try {
        const response = await api.getFiles(projectName, { maxDepth: 8, showHidden: false });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const items = Array.isArray(data) ? data as FileTreeNode[] : [];
        const nextDirectories = Array.from(new Set(collectDirectories(items))).sort((left, right) => left.localeCompare(right, 'en'));

        if (!cancelled) {
          setDirectories(nextDirectories);
        }
      } catch (error) {
        if (!cancelled) {
          setDirectories([]);
          setErrorMessage(error instanceof Error ? error.message : t('chat:sessionContext.preview.move.loadFoldersError'));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDirectories(false);
        }
      }
    };

    void loadDirectories();

    return () => {
      cancelled = true;
    };
  }, [open, projectName, t]);

  useEffect(() => {
    if (!open) {
      setDirectoryInput('');
      setErrorMessage(null);
    }
  }, [open]);

  const filteredDirectories = useMemo(() => {
    const keyword = directoryInput.trim().toLowerCase();
    return directories
      .filter((directoryPath) => directoryPath !== currentDirectory)
      .filter((directoryPath) => !keyword || directoryPath.toLowerCase().includes(keyword))
      .slice(0, 80);
  }, [currentDirectory, directories, directoryInput]);

  const handleMove = async () => {
    if (!file) {
      return;
    }

    const destinationDir = normalizeRelativePath(directoryInput.trim());
    if (!destinationDir) {
      setErrorMessage(t('chat:sessionContext.preview.move.targetRequired'));
      return;
    }

    if (destinationDir === currentDirectory) {
      setErrorMessage(t('chat:sessionContext.preview.move.sameFolder'));
      return;
    }

    setIsMoving(true);
    setErrorMessage(null);

    try {
      const response = await api.moveFile(projectName, file.relativePath, destinationDir);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || t('chat:sessionContext.preview.move.moveFailed'));
      }

      const payload = await response.json();
      const nextFile = {
        name: payload?.name || file.name,
        relativePath: normalizeRelativePath(payload?.relativePath || file.relativePath),
        absolutePath: payload?.absolutePath || file.absolutePath || null,
      };

      if (nextFile.relativePath !== file.relativePath) {
        dispatchProjectFileMoved({
          projectName,
          oldRelativePath: normalizeRelativePath(file.relativePath),
          newRelativePath: nextFile.relativePath,
          oldAbsolutePath: file.absolutePath || null,
          newAbsolutePath: nextFile.absolutePath || null,
          name: nextFile.name,
        });
      }

      onMoved?.(nextFile);
      setOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('chat:sessionContext.preview.move.moveFailed'));
    } finally {
      setIsMoving(false);
    }
  };

  if (!file || !projectName) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        size="sm"
        variant={buttonVariant}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          !iconOnly && '!gap-1',
          iconOnly && 'h-9 w-9 p-0 !gap-0',
          !iconOnly && (className || (compact ? 'h-7 px-1.5 text-[11px]' : undefined)),
          iconOnly && className,
        )}
        title={iconOnly ? moveLabel : undefined}
        aria-label={iconOnly ? moveLabel : undefined}
      >
        <FolderTree
          className={cn('shrink-0', iconOnly ? 'h-5 w-5' : 'h-3.5 w-3.5')}
        />
        {!iconOnly ? moveLabel : null}
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] overflow-hidden rounded-2xl border border-border/70 bg-popover/95 p-3 shadow-xl backdrop-blur">
          <div className="text-xs font-semibold text-foreground">
            {t('chat:sessionContext.preview.move.title')}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t('chat:sessionContext.preview.move.currentFolder', {
              path: currentDirectory || t('chat:sessionContext.preview.move.projectRoot'),
            })}
          </div>

          <div className="mt-3 space-y-2">
            <Input
              value={directoryInput}
              onChange={(event) => setDirectoryInput(event.target.value)}
              placeholder={t('chat:sessionContext.preview.move.targetPlaceholder')}
              className="h-8 text-xs"
            />

            <div className="rounded-xl border border-border/60 bg-background/80">
              {isLoadingDirectories ? (
                <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('chat:sessionContext.preview.move.loadingFolders')}
                </div>
              ) : filteredDirectories.length > 0 ? (
                <div className="max-h-52 overflow-y-auto p-1.5">
                  {filteredDirectories.map((directoryPath) => (
                    <button
                      key={directoryPath}
                      type="button"
                      onClick={() => {
                        setDirectoryInput(directoryPath);
                        setErrorMessage(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent"
                    >
                      <FolderTree className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      <span className="truncate">{directoryPath}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  {t('chat:sessionContext.preview.move.noFolders')}
                </div>
              )}
            </div>
          </div>

          {errorMessage ? (
            <div className="mt-2 text-xs text-foreground">
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isMoving}
            >
              {t('common:buttons.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void handleMove();
              }}
              disabled={isMoving}
            >
              {isMoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderTree className="h-3.5 w-3.5" />}
              {t('chat:sessionContext.preview.move.confirm')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
