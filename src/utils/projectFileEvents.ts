export const PROJECT_FILE_MOVED_EVENT = 'project-file-moved';
export const PROJECT_FILES_CHANGED_EVENT = 'project-files-changed';

export type ProjectFilesChangedDetail = {
  projectName: string;
};

export type ProjectFileMovedDetail = {
  projectName: string;
  oldRelativePath: string;
  newRelativePath: string;
  oldAbsolutePath?: string | null;
  newAbsolutePath?: string | null;
  name: string;
};

export const dispatchProjectFilesChanged = (detail: ProjectFilesChangedDetail) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ProjectFilesChangedDetail>(PROJECT_FILES_CHANGED_EVENT, { detail }),
  );
};

export const dispatchProjectFileMoved = (detail: ProjectFileMovedDetail) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ProjectFileMovedDetail>(PROJECT_FILE_MOVED_EVENT, { detail }),
  );
  dispatchProjectFilesChanged({ projectName: detail.projectName });
};
