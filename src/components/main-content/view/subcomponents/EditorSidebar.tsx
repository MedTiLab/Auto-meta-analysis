import { useCallback, useMemo, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import CodeEditor from '../../../CodeEditor';
import EditorResearchPreview from './EditorResearchPreview';
import { Button } from '../../../ui/button';
import ProjectFileMoveControl from '../../../chat/view/subcomponents/ProjectFileMoveControl';
import type { EditorSidebarProps } from '../../types/types';
import type { ProjectFileChatContextItem } from '../../../../utils/projectFileChatContext';

const AnyCodeEditor = CodeEditor as any;

export default function EditorSidebar({
  editingFile,
  editorMode,
  isMobile,
  editorExpanded,
  editorWidth,
  resizeHandleRef,
  onCloseEditor,
  onStartEditing,
  onMoveFile,
  onToggleEditorExpand,
  onReturnToOrigin,
  projectPath,
  selectedProject,
  onStartWorkspaceQa,
  onAddProjectFileToCurrentChat,
  fillSpace,
}: EditorSidebarProps) {
  const [poppedOut, setPoppedOut] = useState(false);
  const { t: tCodeEditor } = useTranslation('codeEditor');
  const editorMoveFile = useMemo(() => {
    if (!editingFile) {
      return null;
    }

    const relativePath = String(editingFile.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    return {
      name: editingFile.name,
      relativePath,
      absolutePath: typeof editingFile.absolutePath === 'string' ? editingFile.absolutePath : null,
    };
  }, [editingFile]);

  const editingFileContext = useMemo<ProjectFileChatContextItem | null>(() => {
    if (!editingFile) {
      return null;
    }

    const normalizedProjectPath = String(projectPath || '').replace(/\\/g, '/').replace(/\/$/, '');
    const rawPath = String(editingFile.path || '').replace(/\\/g, '/');
    const relativePath = rawPath.replace(/^\/+/, '');
    const absolutePath = typeof editingFile.absolutePath === 'string'
      ? editingFile.absolutePath
      : rawPath.startsWith('/')
        ? rawPath
        : normalizedProjectPath && relativePath
        ? `${normalizedProjectPath}/${relativePath.replace(/^\.?\//, '')}`
        : editingFile.path;

    return {
      name: editingFile.name,
      path: absolutePath || editingFile.path,
      absolutePath: absolutePath || null,
      kind: 'file',
    };
  }, [editingFile, projectPath]);

  const handleAddEditingFileToNewChat = useCallback(() => {
    if (!editingFile || !selectedProject || !onStartWorkspaceQa) {
      return;
    }

    onStartWorkspaceQa(selectedProject, '', {
      projectFiles: editingFileContext ? [editingFileContext] : [],
    });
  }, [editingFile, editingFileContext, onStartWorkspaceQa, selectedProject]);

  if (!editingFile) {
    return null;
  }

  if (isMobile || poppedOut) {
    return (
      <AnyCodeEditor
        file={editingFile}
        onClose={() => {
          setPoppedOut(false);
          onCloseEditor();
        }}
        researchContext={editingFile.researchContext}
        onReturnToOrigin={onReturnToOrigin}
        projectPath={projectPath}
        selectedProject={selectedProject}
        onStartWorkspaceQa={onStartWorkspaceQa}
        isSidebar={false}
      />
    );
  }

  const useFlex = editorExpanded || fillSpace;
  const editorExtraHeaderActions = (
    <>
      {selectedProject?.name ? (
        <ProjectFileMoveControl
          projectName={selectedProject.name}
          file={editorMoveFile}
          iconOnly
          buttonVariant="ghost"
          className="h-8 w-8 min-h-0 p-0 !gap-0 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white [&>svg]:!h-4 [&>svg]:!w-4"
          onMoved={(nextFile) => {
            onMoveFile?.(nextFile.relativePath, nextFile.absolutePath || null);
          }}
        />
      ) : null}
      {selectedProject && onStartWorkspaceQa ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 min-h-0 p-0 !gap-0 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white [&>svg]:!h-4 [&>svg]:!w-4"
          title={tCodeEditor('actions.addToNewChat')}
          aria-label={tCodeEditor('actions.addToNewChat')}
          onClick={handleAddEditingFileToNewChat}
        >
          <MessageSquarePlus className="h-4 w-4 shrink-0" />
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <div
        ref={resizeHandleRef}
        className={`h-full overflow-hidden border-l border-border/60 bg-background ${useFlex ? 'min-w-0 flex-1' : 'flex-shrink-0'}`}
        style={useFlex ? undefined : { width: `${editorWidth}px` }}
      >
        {editorMode === 'edit' ? (
          <AnyCodeEditor
            file={editingFile}
            onClose={onCloseEditor}
            researchContext={editingFile.researchContext}
            onReturnToOrigin={onReturnToOrigin}
            projectPath={projectPath}
            selectedProject={selectedProject}
            onStartWorkspaceQa={onStartWorkspaceQa}
            isSidebar
            extraHeaderActions={editorExtraHeaderActions}
          />
        ) : (
          <EditorResearchPreview
            editingFile={editingFile}
            projectPath={projectPath}
            projectName={selectedProject?.name}
            selectedProject={selectedProject}
            onStartWorkspaceQa={onStartWorkspaceQa}
            onAddToCurrentChat={onAddProjectFileToCurrentChat}
            onStartEditing={onStartEditing}
            onMoveFile={onMoveFile}
            onClose={onCloseEditor}
            onReturnToOrigin={onReturnToOrigin}
          />
        )}
      </div>
    </>
  );
}
