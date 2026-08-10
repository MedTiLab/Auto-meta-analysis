import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Download, Loader2, Maximize2, MessageSquare, MessageSquarePlus, Minimize2, PenLine, RotateCcw, Save, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../ui/button';
import CodeEditor from '../../../CodeEditor';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';
import type { Project } from '../../../../types/app';
import type { ProjectFileChatContextItem } from '../../../../utils/projectFileChatContext';
import ChatContextFilePreview from './ChatContextFilePreview';

export type ChatPreviewFile = {
  key: string;
  name: string;
  relativePath: string;
  absolutePath: string | null;
  reasons: string[];
  count: number;
  lastSeenAt: string;
  originalPath: string;
  diffInfo?: unknown;
  previewNavigation?: {
    kind: 'image-gallery' | 'markdown-gallery';
    paths: string[];
  } | null;
};

type PreviewFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PreviewMode = 'preview' | 'edit';

type CodeEditorHandle = {
  save?: () => boolean | Promise<boolean>;
};

type ChatFilePreviewOverlayProps = {
  projectName: string;
  file: ChatPreviewFile;
  onClose: () => void;
  selectedProject?: Project | null;
  onStartWorkspaceQa?: (project: Project, prompt: string, options?: { projectFiles?: ProjectFileChatContextItem[] }) => void;
  onAddToCurrentChat?: (file: ProjectFileChatContextItem) => void;
};

const EDGE_PADDING = 16;
const MIN_WIDTH = 520;
const MIN_HEIGHT = 360;
const MOBILE_BREAKPOINT = 720;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx']);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function getDefaultFrame(): PreviewFrame {
  if (typeof window === 'undefined') {
    return { x: 80, y: 64, width: 960, height: 720 };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const compact = viewportWidth < MOBILE_BREAKPOINT;
  const maxWidth = Math.max(320, viewportWidth - EDGE_PADDING * 2);
  const maxHeight = Math.max(280, viewportHeight - EDGE_PADDING * 2);
  const width = compact ? maxWidth : clamp(Math.round(viewportWidth * 0.78), MIN_WIDTH, maxWidth);
  const height = compact ? maxHeight : clamp(Math.round(viewportHeight * 0.82), MIN_HEIGHT, maxHeight);

  return {
    x: Math.round((viewportWidth - width) / 2),
    y: Math.round((viewportHeight - height) / 2),
    width,
    height,
  };
}

function clampFrame(frame: PreviewFrame): PreviewFrame {
  if (typeof window === 'undefined') {
    return frame;
  }

  const maxWidth = Math.max(320, window.innerWidth - EDGE_PADDING * 2);
  const maxHeight = Math.max(280, window.innerHeight - EDGE_PADDING * 2);
  const width = clamp(frame.width, Math.min(MIN_WIDTH, maxWidth), maxWidth);
  const height = clamp(frame.height, Math.min(MIN_HEIGHT, maxHeight), maxHeight);

  return {
    width,
    height,
    x: clamp(frame.x, EDGE_PADDING, Math.max(EDGE_PADDING, window.innerWidth - width - EDGE_PADDING)),
    y: clamp(frame.y, EDGE_PADDING, Math.max(EDGE_PADDING, window.innerHeight - height - EDGE_PADDING)),
  };
}

function getParentDirectoryLabel(filePath: string, fileName: string) {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/\/$/, '');
  if (!normalizedPath || normalizedPath === fileName) {
    return '';
  }

  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  if (lastSlashIndex === -1) {
    return '';
  }

  return normalizedPath.slice(0, lastSlashIndex);
}

function getFileExtension(fileName: string) {
  const raw = fileName || '';
  const lastDot = raw.lastIndexOf('.');
  if (lastDot === -1) {
    return '';
  }
  return raw.slice(lastDot + 1).toLowerCase();
}

function normalizePreviewPath(value: string) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^file:\/\//i, '')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .trim();
}

function pathMatchesBySuffix(left: string, right: string) {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

export default function ChatFilePreviewOverlay({
  projectName,
  file,
  onClose,
  selectedProject,
  onStartWorkspaceQa,
  onAddToCurrentChat,
}: ChatFilePreviewOverlayProps) {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const { t: tCodeEditor } = useTranslation('codeEditor');
  const [activeFile, setActiveFile] = useState<ChatPreviewFile>(file);
  const [mode, setMode] = useState<PreviewMode>('preview');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [frame, setFrame] = useState<PreviewFrame>(() => getDefaultFrame());
  const [isMaximized, setIsMaximized] = useState(false);
  const codeEditorRef = useRef<CodeEditorHandle | null>(null);
  const dragStateRef = useRef<{
    kind: 'move' | 'resize';
    pointerId: number;
    startX: number;
    startY: number;
    startFrame: PreviewFrame;
  } | null>(null);

  const maximizedFrame = useMemo(() => {
    if (typeof window === 'undefined') {
      return frame;
    }

    return {
      x: EDGE_PADDING,
      y: EDGE_PADDING,
      width: Math.max(320, window.innerWidth - EDGE_PADDING * 2),
      height: Math.max(280, window.innerHeight - EDGE_PADDING * 2),
    };
  }, [frame]);

  const activeFrame = isMaximized ? maximizedFrame : frame;
  const parentDirectoryLabel = useMemo(
    () => getParentDirectoryLabel(activeFile.relativePath || activeFile.absolutePath || activeFile.originalPath, activeFile.name),
    [activeFile.absolutePath, activeFile.name, activeFile.originalPath, activeFile.relativePath],
  );
  const fullPathLabel = activeFile.relativePath || activeFile.absolutePath || activeFile.originalPath;
  const editorFile = useMemo(() => ({
    name: activeFile.name,
    path: activeFile.relativePath || activeFile.originalPath || activeFile.absolutePath || activeFile.name,
    projectName,
    diffInfo: activeFile.diffInfo,
  }), [activeFile.absolutePath, activeFile.diffInfo, activeFile.name, activeFile.originalPath, activeFile.relativePath, projectName]);
  const galleryPaths = useMemo(() => (
    activeFile.previewNavigation
      ? activeFile.previewNavigation.paths.filter(Boolean)
      : []
  ), [activeFile.previewNavigation]);
  const isImagePreview = useMemo(
    () => IMAGE_EXTENSIONS.has(getFileExtension(activeFile.name || activeFile.relativePath || activeFile.originalPath || '')),
    [activeFile.name, activeFile.originalPath, activeFile.relativePath],
  );
  const isMarkdownPreview = useMemo(
    () => MARKDOWN_EXTENSIONS.has(getFileExtension(activeFile.name || activeFile.relativePath || activeFile.originalPath || '')),
    [activeFile.name, activeFile.originalPath, activeFile.relativePath],
  );
  const supportsGalleryNavigation = useMemo(() => (
    (activeFile.previewNavigation?.kind === 'image-gallery' && isImagePreview)
    || (activeFile.previewNavigation?.kind === 'markdown-gallery' && isMarkdownPreview)
  ), [activeFile.previewNavigation?.kind, isImagePreview, isMarkdownPreview]);
  const currentPreviewPath = activeFile.relativePath || activeFile.originalPath || activeFile.absolutePath || '';
  const currentPreviewNormalizedPath = useMemo(
    () => normalizePreviewPath(currentPreviewPath),
    [currentPreviewPath],
  );
  const currentPreviewIndex = useMemo(() => {
    if (!currentPreviewNormalizedPath) {
      return -1;
    }

    const normalizedGalleryPaths = galleryPaths.map((path) => normalizePreviewPath(path));
    const exactIndex = normalizedGalleryPaths.findIndex((path) => path === currentPreviewNormalizedPath);
    if (exactIndex >= 0) {
      return exactIndex;
    }

    return normalizedGalleryPaths.findIndex((path) => pathMatchesBySuffix(path, currentPreviewNormalizedPath));
  }, [currentPreviewNormalizedPath, galleryPaths]);
  const canGoPreviousPreview = mode === 'preview' && supportsGalleryNavigation && currentPreviewIndex > 0;
  const canGoNextPreview = mode === 'preview' && supportsGalleryNavigation && currentPreviewIndex >= 0 && currentPreviewIndex < galleryPaths.length - 1;

  useEffect(() => {
    setActiveFile(file);
    setMode((current) => (current === 'edit' ? 'edit' : 'preview'));
    setFrame(getDefaultFrame());
    setIsMaximized(false);
  }, [file.key]);

  useEffect(() => {
    const handleResize = () => {
      setFrame((current) => clampFrame(current));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const startInteraction = useCallback((event: ReactPointerEvent<HTMLElement>, kind: 'move' | 'resize') => {
    if (event.button !== 0 || isMaximized) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStateRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startFrame: frame,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = moveEvent.clientX - dragState.startX;
      const deltaY = moveEvent.clientY - dragState.startY;

      if (dragState.kind === 'move') {
        setFrame(clampFrame({
          ...dragState.startFrame,
          x: dragState.startFrame.x + deltaX,
          y: dragState.startFrame.y + deltaY,
        }));
        return;
      }

      setFrame(clampFrame({
        ...dragState.startFrame,
        width: dragState.startFrame.width + deltaX,
        height: dragState.startFrame.height + deltaY,
      }));
    };

    const stopInteraction = () => {
      dragStateRef.current = null;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', stopInteraction);
      document.removeEventListener('pointercancel', stopInteraction);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = kind === 'move' ? 'move' : 'nwse-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', stopInteraction);
    document.addEventListener('pointercancel', stopInteraction);
  }, [frame, isMaximized]);

  const handleResetFrame = useCallback(() => {
    setFrame(getDefaultFrame());
    setIsMaximized(false);
  }, []);

  const handleSwitchToEdit = useCallback(() => {
    setMode('edit');
  }, []);

  const handleSaveFromFrame = useCallback(async () => {
    const saved = await codeEditorRef.current?.save?.();
    if (saved) {
      setMode('preview');
    }
  }, []);

  const buildActiveFileContext = useCallback((): ProjectFileChatContextItem => ({
    name: activeFile.name,
    path: activeFile.absolutePath || activeFile.relativePath || activeFile.originalPath,
    absolutePath: activeFile.absolutePath || null,
    kind: 'file',
  }), [activeFile.absolutePath, activeFile.name, activeFile.originalPath, activeFile.relativePath]);

  const handleAddToNewChat = useCallback(() => {
    if (!selectedProject || !onStartWorkspaceQa) {
      return;
    }

    onStartWorkspaceQa(selectedProject, '', {
      projectFiles: [buildActiveFileContext()],
    });
    onClose();
  }, [buildActiveFileContext, onClose, onStartWorkspaceQa, selectedProject]);

  const handleAddToCurrentChat = useCallback(() => {
    onAddToCurrentChat?.(buildActiveFileContext());
    onClose();
  }, [buildActiveFileContext, onAddToCurrentChat, onClose]);

  const handleDownload = useCallback(async () => {
    if (!projectName || !activeFile) {
      return;
    }

    const path = activeFile.relativePath || activeFile.absolutePath;
    if (!path) {
      return;
    }

    setDownloadBusy(true);
    try {
      const blob = await api.getFileContentBlob(projectName, path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = activeFile.name || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // best-effort; preview already exposes load failures inline
    } finally {
      setDownloadBusy(false);
    }
  }, [activeFile, projectName]);

  const switchToPreviewAt = useCallback((nextPath: string) => {
    if (!nextPath) {
      return;
    }
    const normalizedNextPath = normalizePreviewPath(nextPath);
    if (!normalizedNextPath) {
      return;
    }
    const fileName = normalizedNextPath.split('/').filter(Boolean).pop() || normalizedNextPath;
    setActiveFile((current) => ({
      ...current,
      key: `${normalizedNextPath}:${Date.now()}`,
      name: fileName,
      relativePath: normalizedNextPath,
      absolutePath: null,
      originalPath: normalizedNextPath,
      diffInfo: undefined,
    }));
    setMode('preview');
  }, []);

  const handlePreviousPreview = useCallback(() => {
    if (!canGoPreviousPreview) {
      return;
    }
    const nextPath = galleryPaths[currentPreviewIndex - 1];
    switchToPreviewAt(nextPath);
  }, [canGoPreviousPreview, currentPreviewIndex, galleryPaths, switchToPreviewAt]);

  const handleNextPreview = useCallback(() => {
    if (!canGoNextPreview) {
      return;
    }
    const nextPath = galleryPaths[currentPreviewIndex + 1];
    switchToPreviewAt(nextPath);
  }, [canGoNextPreview, currentPreviewIndex, galleryPaths, switchToPreviewAt]);

  useEffect(() => {
    const handleArrowNavigation = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && canGoPreviousPreview) {
        event.preventDefault();
        handlePreviousPreview();
        return;
      }
      if (event.key === 'ArrowRight' && canGoNextPreview) {
        event.preventDefault();
        handleNextPreview();
      }
    };

    document.addEventListener('keydown', handleArrowNavigation);
    return () => document.removeEventListener('keydown', handleArrowNavigation);
  }, [canGoNextPreview, canGoPreviousPreview, handleNextPreview, handlePreviousPreview]);

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <button
        type="button"
        aria-label={tCommon('buttons.close')}
        className="absolute inset-0 pointer-events-auto bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        className="pointer-events-auto fixed flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl"
        style={{
          left: activeFrame.x,
          top: activeFrame.y,
          width: activeFrame.width,
          height: activeFrame.height,
        }}
        role="dialog"
        aria-modal="true"
        aria-label={t('sessionContext.preview.largeTitle')}
      >
        <div
          className={cn(
            'flex min-h-[44px] cursor-move items-center justify-between gap-3 border-b border-border/70 bg-card/95 px-3 py-2',
            isMaximized && 'cursor-default',
          )}
          onPointerDown={(event) => startInteraction(event, 'move')}
          onDoubleClick={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('button')) {
              return;
            }
            setIsMaximized((current) => !current);
          }}
          title={isMaximized ? undefined : t('sessionContext.preview.dragTitle')}
        >
          <div className="flex min-w-0 items-center">
            <div className="flex min-w-0 items-baseline gap-2" title={fullPathLabel}>
              <span className="truncate text-sm font-semibold text-foreground">
                {activeFile.name || t('sessionContext.preview.titleFallback')}
              </span>
              {parentDirectoryLabel ? (
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {parentDirectoryLabel}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-shrink-0 flex-nowrap items-center gap-1" onPointerDown={(event) => event.stopPropagation()}>
            {selectedProject && onStartWorkspaceQa ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 whitespace-nowrap px-2 text-xs"
                title={tCodeEditor('actions.addToNewChat')}
                aria-label={tCodeEditor('actions.addToNewChat')}
                onClick={handleAddToNewChat}
              >
                <MessageSquarePlus className="h-4 w-4" />
                <span>{tCodeEditor('actions.addToNewChat')}</span>
              </Button>
            ) : null}
            {onAddToCurrentChat ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 whitespace-nowrap px-2 text-xs"
                title={tCodeEditor('actions.addToCurrentChat')}
                aria-label={tCodeEditor('actions.addToCurrentChat')}
                onClick={handleAddToCurrentChat}
              >
                <MessageSquare className="h-4 w-4" />
                <span>{tCodeEditor('actions.addToCurrentChat')}</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 whitespace-nowrap px-2 text-xs"
              disabled={downloadBusy}
              title={tCommon('buttons.download')}
              aria-label={tCommon('buttons.download')}
              onClick={() => {
                void handleDownload();
              }}
            >
              {downloadBusy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0" />}
              <span>{tCommon('buttons.download')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 whitespace-nowrap px-2 text-xs"
              title={mode === 'edit' ? tCodeEditor('actions.save') : t('sessionContext.preview.openEditor')}
              aria-label={mode === 'edit' ? tCodeEditor('actions.save') : t('sessionContext.preview.openEditor')}
              onClick={() => {
                if (mode === 'edit') {
                  void handleSaveFromFrame();
                } else {
                  setMode('edit');
                }
              }}
            >
              {mode === 'edit' ? <Save className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
              <span>{mode === 'edit' ? tCodeEditor('actions.save') : t('sessionContext.preview.openEditor')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title={t('sessionContext.preview.resetSize')}
              aria-label={t('sessionContext.preview.resetSize')}
              onClick={handleResetFrame}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title={isMaximized ? t('sessionContext.preview.restoreSize') : t('sessionContext.preview.maximize')}
              aria-label={isMaximized ? t('sessionContext.preview.restoreSize') : t('sessionContext.preview.maximize')}
              onClick={() => setIsMaximized((current) => !current)}
            >
              {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title={tCommon('buttons.close')}
              aria-label={tCommon('buttons.close')}
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className={cn('min-h-0 flex-1 overflow-hidden', mode === 'edit' ? 'bg-background' : 'bg-muted/20')}>
          {mode === 'edit' ? (
            <CodeEditor
              ref={codeEditorRef as any}
              file={editorFile}
              onClose={() => setMode('preview')}
              projectPath=""
              isSidebar
              hideHeader
            />
          ) : (
            <ChatContextFilePreview
              projectName={projectName}
              file={activeFile}
              onOpenInEditor={handleSwitchToEdit}
              hasImagePrevious={canGoPreviousPreview}
              hasImageNext={canGoNextPreview}
              onImagePrevious={handlePreviousPreview}
              onImageNext={handleNextPreview}
              hideHeader
              frameless
            />
          )}
        </div>

        {!isMaximized && (
          <div
            className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize touch-none"
            onPointerDown={(event) => startInteraction(event, 'resize')}
            aria-label={t('sessionContext.preview.resize')}
            title={t('sessionContext.preview.resize')}
          >
            <div className="absolute bottom-1 right-1 h-3 w-3 rounded-br-md border-b-2 border-r-2 border-muted-foreground/50" />
          </div>
        )}
      </div>
    </div>
  );
}
