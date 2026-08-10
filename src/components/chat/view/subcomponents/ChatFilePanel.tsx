import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { FileText, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import CodeEditor from '../../../CodeEditor';
import FileTree from '../../../FileTree';
import type { Project } from '../../../../types/app';
import type { ProjectFileChatContextItem } from '../../../../utils/projectFileChatContext';
import type { ChatPreviewFile } from './ChatFilePreviewOverlay';

type ChatFilePanelProps = {
  selectedProject: Project;
  openFiles: ChatPreviewFile[];
  activeFileKey: string | null;
  onShowFiles: () => void;
  onSelectFile: (fileKey: string) => void;
  onCloseFile: (fileKey: string) => void;
  onCollapse: () => void;
  onFileOpen: (filePath: string, diffInfo?: unknown) => void;
  onStartWorkspaceQa?: (
    project: Project,
    prompt: string,
    options?: { projectFiles?: ProjectFileChatContextItem[] },
  ) => void;
};

const MIN_FILE_TREE_WIDTH = 260;
const MIN_PREVIEW_WIDTH = 320;
const DEFAULT_FILE_TREE_WIDTH = 360;

export default function ChatFilePanel({
  selectedProject,
  openFiles,
  activeFileKey,
  onShowFiles,
  onSelectFile,
  onCloseFile,
  onCollapse,
  onFileOpen,
  onStartWorkspaceQa,
}: ChatFilePanelProps) {
  const { t } = useTranslation('common');
  const activeFile = openFiles.find((file) => file.key === activeFileKey) ?? null;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [fileTreeWidth, setFileTreeWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_FILE_TREE_WIDTH;
    }
    const savedWidth = Number.parseInt(window.localStorage.getItem('medhelp.fileTreePanelWidth') || '', 10);
    return Number.isFinite(savedWidth)
      ? Math.max(MIN_FILE_TREE_WIDTH, savedWidth)
      : DEFAULT_FILE_TREE_WIDTH;
  });

  useEffect(() => {
    window.localStorage.setItem('medhelp.fileTreePanelWidth', String(fileTreeWidth));
  }, [fileTreeWidth]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return undefined;
    }

    const clampFileTreeWidth = () => {
      const maximumWidth = Math.max(MIN_FILE_TREE_WIDTH, panel.clientWidth - MIN_PREVIEW_WIDTH);
      setFileTreeWidth((currentWidth) => Math.min(maximumWidth, Math.max(MIN_FILE_TREE_WIDTH, currentWidth)));
    };

    clampFileTreeWidth();
    const observer = new ResizeObserver(clampFileTreeWidth);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const handleFileTreeResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const panelLeft = panel.getBoundingClientRect().left;
    const maximumWidth = Math.max(MIN_FILE_TREE_WIDTH, panel.clientWidth - MIN_PREVIEW_WIDTH);

    const handleMove = (moveEvent: PointerEvent) => {
      const requestedWidth = moveEvent.clientX - panelLeft;
      setFileTreeWidth(Math.min(maximumWidth, Math.max(MIN_FILE_TREE_WIDTH, requestedWidth)));
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
  };

  const editorFile = useMemo(() => activeFile ? {
    name: activeFile.name,
    path: activeFile.relativePath || activeFile.originalPath || activeFile.absolutePath || activeFile.name,
    projectName: selectedProject.name,
    diffInfo: activeFile.diffInfo,
  } : null, [activeFile, selectedProject.name]);

  return (
    <div ref={panelRef} className="flex h-full min-h-0 bg-background">
      <div className="h-full flex-shrink-0" style={{ width: `${fileTreeWidth}px` }}>
        <FileTree
          selectedProject={selectedProject}
          onFileOpen={onFileOpen}
          onStartWorkspaceQa={onStartWorkspaceQa}
          enableAutoRefresh={false}
          embedded
        />
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file tree"
        className="group flex h-full w-2 flex-shrink-0 cursor-col-resize touch-none items-center justify-center border-x border-border/60 bg-background"
        onPointerDown={handleFileTreeResizeStart}
      >
        <span className="h-12 w-0.5 rounded-full bg-primary/20 transition-colors group-hover:bg-primary/55 group-active:bg-primary" />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-10 flex-shrink-0 items-stretch border-b border-border bg-muted/20">
          <div
            role="tablist"
            aria-label={t('tabs.files')}
            className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
          >
            {openFiles.map((file) => {
            const active = file.key === activeFile?.key;
            return (
              <div
                key={file.key}
                className={`group flex min-w-0 flex-shrink-0 items-stretch border-r border-border transition-colors ${
                  active ? 'border-b-2 border-b-primary bg-background' : 'hover:bg-background/70'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={file.relativePath || file.name}
                  onClick={() => onSelectFile(file.key)}
                  className={`flex min-w-0 max-w-44 items-center gap-1.5 pl-3 pr-1 text-xs ${
                    active ? 'font-medium text-foreground' : 'text-muted-foreground group-hover:text-foreground'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{file.name}</span>
                </button>
                <button
                  type="button"
                  title={`${t('buttons.close')}: ${file.name}`}
                  aria-label={`${t('buttons.close')}: ${file.name}`}
                  onClick={() => onCloseFile(file.key)}
                  className="grid w-7 flex-shrink-0 place-items-center text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
            })}
          </div>
          <button
            type="button"
            onClick={onCollapse}
            title={t('buttons.close')}
            aria-label={t('buttons.close')}
            className="grid w-10 flex-shrink-0 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-muted/10">
          {activeFile && editorFile ? (
            <CodeEditor
              key={activeFile.key}
              file={editorFile}
              onClose={() => onCloseFile(activeFile.key)}
              projectPath={selectedProject.fullPath || selectedProject.path || ''}
              isSidebar
              defaultPreview
            />
          ) : (
            <button
              type="button"
              onClick={onShowFiles}
              className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"
            >
              <PanelRightOpen className="h-8 w-8 text-muted-foreground/50" />
              <span>{t('tabs.files')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
