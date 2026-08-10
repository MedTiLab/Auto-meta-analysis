import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { ArrowLeft, Download, Loader2, MessageSquare, MessageSquarePlus, PenLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../ui/button';
import ChatContextFilePreview from '../../../chat/view/subcomponents/ChatContextFilePreview';
import ProjectFileMoveControl from '../../../chat/view/subcomponents/ProjectFileMoveControl';
import { api } from '../../../../utils/api';
import {
  CODE_EDITOR_FONT_SIZE_OPTIONS,
  readCodeEditorFontSize,
  resolveCodeEditorFontSize,
  writeCodeEditorFontSize,
} from '../../../../utils/codeEditorPreferences';
import type { EditingFile } from '../../types/types';
import type { Project } from '../../../../types/app';
import type { ProjectFileChatContextItem } from '../../../../utils/projectFileChatContext';

type EditorResearchPreviewProps = {
  editingFile: EditingFile;
  projectPath?: string;
  projectName?: string;
  selectedProject?: Project | null;
  onStartWorkspaceQa?: (project: Project, prompt: string, options?: { projectFiles?: ProjectFileChatContextItem[] }) => void;
  onAddToCurrentChat?: (file: ProjectFileChatContextItem) => void;
  onStartEditing: () => void;
  onMoveFile?: (nextRelativePath: string, nextAbsolutePath?: string | null) => void;
  onClose: () => void;
  onReturnToOrigin: () => void;
};

export default function EditorResearchPreview({
  editingFile,
  projectPath,
  projectName,
  selectedProject,
  onStartWorkspaceQa,
  onAddToCurrentChat,
  onStartEditing,
  onMoveFile,
  onClose,
  onReturnToOrigin,
}: EditorResearchPreviewProps) {
  const { t } = useTranslation('codeEditor');
  const { t: tCommon } = useTranslation('common');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [fontSize, setFontSize] = useState(() => readCodeEditorFontSize());
  const previewFontSize = `${fontSize}px`;
  /** Square icon-only, aligned with file tab / CodeEditor toolbar. */
  const iconToolbarClassName =
    'h-9 w-9 min-h-0 shrink-0 !gap-0 p-0 text-muted-foreground hover:bg-muted/70 hover:text-foreground [&>svg]:!h-5 [&>svg]:!w-5';

  const previewFile = useMemo(() => {
    const normalizedProjectPath = String(projectPath || '').replace(/\\/g, '/').replace(/\/$/, '');
    const relativePath = editingFile.path;
    const absolutePath = relativePath.startsWith('/')
      ? relativePath
      : normalizedProjectPath
        ? `${normalizedProjectPath}/${String(relativePath).replace(/^\.?\//, '')}`
        : relativePath;

    return {
      name: editingFile.name,
      relativePath,
      absolutePath,
    } as const;
  }, [editingFile.name, editingFile.path, projectPath]);

  const projectFileContext = useMemo<ProjectFileChatContextItem>(() => ({
    name: previewFile.name,
    path: previewFile.absolutePath || previewFile.relativePath,
    absolutePath: previewFile.absolutePath || null,
    kind: 'file',
  }), [previewFile.absolutePath, previewFile.name, previewFile.relativePath]);

  const handleDownload = useCallback(async () => {
    if (!projectName) {
      return;
    }
    const path = previewFile.absolutePath || previewFile.relativePath;
    if (!path) {
      return;
    }
    setDownloadBusy(true);
    try {
      const blob = await api.getFileContentBlob(projectName, path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = editingFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // best-effort; no toast in this view
    } finally {
      setDownloadBusy(false);
    }
  }, [editingFile.name, previewFile.absolutePath, previewFile.relativePath, projectName]);

  useEffect(() => {
    const handleSettingsChanged = () => {
      setFontSize(readCodeEditorFontSize());
    };

    const handleStorageChanged = (event: StorageEvent) => {
      if (event.key === 'codeEditorFontSize') {
        setFontSize(resolveCodeEditorFontSize(event.newValue));
      }
    };

    window.addEventListener('codeEditorSettingsChanged', handleSettingsChanged);
    window.addEventListener('storage', handleStorageChanged);

    return () => {
      window.removeEventListener('codeEditorSettingsChanged', handleSettingsChanged);
      window.removeEventListener('storage', handleStorageChanged);
    };
  }, []);

  const handleFontSizeChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setFontSize(writeCodeEditorFontSize(event.target.value));
  }, []);

  const handleAddToNewChat = useCallback(() => {
    if (!selectedProject || !onStartWorkspaceQa) {
      return;
    }

    onStartWorkspaceQa(selectedProject, '', {
      projectFiles: [projectFileContext],
    });
  }, [onStartWorkspaceQa, projectFileContext, selectedProject]);

  const handleAddToCurrentChat = useCallback(() => {
    onAddToCurrentChat?.(projectFileContext);
  }, [onAddToCurrentChat, projectFileContext]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-start justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <div className="min-w-0 flex-1 pr-1">
          <div className="truncate text-sm font-medium text-foreground">
            {editingFile.name}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {editingFile.path}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-0.5">
          <select
            value={fontSize}
            onChange={handleFontSizeChange}
            className="h-9 w-[72px] rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-sm outline-none transition-colors hover:bg-accent focus:ring-1 focus:ring-ring"
            title={t('toolbar.fontSize')}
            aria-label={t('toolbar.fontSize')}
          >
            {CODE_EDITOR_FONT_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
          {projectName ? (
            <ProjectFileMoveControl
              projectName={projectName}
              file={previewFile}
              iconOnly
              buttonVariant="ghost"
              className={iconToolbarClassName}
              onMoved={(nextFile) => {
                onMoveFile?.(nextFile.relativePath, nextFile.absolutePath || null);
              }}
            />
          ) : null}
          {projectName && selectedProject && onStartWorkspaceQa ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={iconToolbarClassName}
              title={t('actions.addToNewChat')}
              aria-label={t('actions.addToNewChat')}
              onClick={handleAddToNewChat}
            >
              <MessageSquarePlus className="h-5 w-5 shrink-0" />
            </Button>
          ) : null}
          {projectName && onAddToCurrentChat ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={iconToolbarClassName}
              title={t('actions.addToCurrentChat')}
              aria-label={t('actions.addToCurrentChat')}
              onClick={handleAddToCurrentChat}
            >
              <MessageSquare className="h-5 w-5 shrink-0" />
            </Button>
          ) : null}
          {projectName ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={iconToolbarClassName}
              disabled={downloadBusy}
              title={tCommon('buttons.download')}
              aria-label={tCommon('buttons.download')}
              onClick={() => {
                void handleDownload();
              }}
            >
              {downloadBusy ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Download className="h-5 w-5 shrink-0" />}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={iconToolbarClassName}
            title={t('researchContext.actions.deepEdit')}
            aria-label={t('researchContext.actions.deepEdit')}
            onClick={onStartEditing}
          >
            <PenLine className="h-5 w-5 shrink-0" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={iconToolbarClassName}
            title={t('researchContext.actions.return')}
            aria-label={t('researchContext.actions.return')}
            onClick={onReturnToOrigin}
          >
            <ArrowLeft className="h-5 w-5 shrink-0" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {projectName ? (
          <ChatContextFilePreview
            projectName={projectName}
            file={previewFile as any}
            onOpenInEditor={onStartEditing}
            hideHeader
            frameless
            previewFontSize={previewFontSize}
          />
        ) : null}
      </div>
    </div>
  );
}
