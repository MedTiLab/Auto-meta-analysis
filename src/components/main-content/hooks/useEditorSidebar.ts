import { useCallback, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { AppTab, Project, ProjectSession } from '../../../types/app';
import { buildEditorResearchContext } from '../utils/editorResearchContext';
import type { DiffInfo, EditingFile, EditorSidebarMode } from '../types/types';

type UseEditorSidebarOptions = {
  activeTab: AppTab;
  selectedProject: Project | null;
  selectedSession?: ProjectSession | null;
  isMobile: boolean;
  initialWidth?: number;
};

export function useEditorSidebar({
  activeTab,
  selectedProject,
  selectedSession,
  isMobile,
  initialWidth = 600,
}: UseEditorSidebarOptions) {
  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [editorMode, setEditorMode] = useState<EditorSidebarMode>('preview');
  const editorWidth = initialWidth;
  const [editorExpanded, setEditorExpanded] = useState(false);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';

  const handleFileOpen = useCallback(
    (filePath: string, diffInfo: DiffInfo | null = null) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/$/, '');
      const relativePath = normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)
        ? normalizedPath.slice(normalizedRoot.length + 1)
        : filePath;
      const fileName = normalizedPath.split('/').pop() || filePath;

      setEditingFile({
        name: fileName,
        path: relativePath,
        projectName: selectedProject?.name,
        diffInfo,
        researchContext: buildEditorResearchContext({
          activeTab,
          selectedSession,
          filePath: relativePath,
          diffInfo,
        }),
      });
      setEditorMode(isMobile ? 'edit' : 'preview');
    },
    [activeTab, isMobile, projectRoot, selectedProject?.name, selectedSession],
  );

  const handleCloseEditor = useCallback(() => {
    setEditingFile(null);
    setEditorExpanded(false);
    setEditorMode('preview');
  }, []);

  const handleToggleEditorExpand = useCallback(() => {
    setEditorExpanded((prev) => !prev);
  }, []);

  const handleStartEditing = useCallback(() => {
    setEditorMode('edit');
  }, []);

  const handleEditingFileMove = useCallback((nextRelativePath: string, nextAbsolutePath?: string | null) => {
    const normalizedPath = nextRelativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const fileName = normalizedPath.split('/').pop() || normalizedPath;

    setEditingFile((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        name: fileName,
        path: normalizedPath,
        absolutePath: nextAbsolutePath || undefined,
        researchContext: buildEditorResearchContext({
          activeTab,
          selectedSession,
          filePath: normalizedPath,
          diffInfo: current.diffInfo,
        }),
      };
    });
  }, [activeTab, selectedSession]);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
    },
    [],
  );

  return {
    editingFile,
    editorMode,
    editorWidth,
    editorExpanded,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleStartEditing,
    handleEditingFileMove,
    handleToggleEditorExpand,
    handleResizeStart,
  };
}
