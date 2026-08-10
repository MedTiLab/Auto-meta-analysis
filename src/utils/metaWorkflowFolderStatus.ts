import { META_PROJECT_NUMBERED_ARTIFACT_ROOTS } from './projectKind';

export type MetaWorkflowFileTreeNode = {
  name?: string;
  path?: string;
  relativePath?: string;
  absolutePath?: string;
  type?: string;
  children?: MetaWorkflowFileTreeNode[];
};

export type MetaWorkflowFolderStatus = {
  name: typeof META_PROJECT_NUMBERED_ARTIFACT_ROOTS[number];
  path: string;
  fileCount: number;
};

const META_WORKFLOW_FOLDER_RANK = new Map<string, number>(
  META_PROJECT_NUMBERED_ARTIFACT_ROOTS.map((name, index) => [name, index]),
);

const IGNORED_FILE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

function countVisibleFiles(node: MetaWorkflowFileTreeNode): number {
  if (node.type === 'file') {
    const normalizedName = String(node.name || '').trim().toLowerCase();
    return normalizedName.startsWith('.') || IGNORED_FILE_NAMES.has(normalizedName) ? 0 : 1;
  }

  if (node.type !== 'directory' || !Array.isArray(node.children)) {
    return 0;
  }

  return node.children.reduce((count, child) => count + countVisibleFiles(child), 0);
}

export function collectMetaWorkflowFolderStatuses(
  nodes: MetaWorkflowFileTreeNode[] | null | undefined,
): MetaWorkflowFolderStatus[] {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes
    .filter((node): node is MetaWorkflowFileTreeNode & { name: MetaWorkflowFolderStatus['name'] } => (
      node.type === 'directory'
      && typeof node.name === 'string'
      && META_WORKFLOW_FOLDER_RANK.has(node.name)
    ))
    .sort((left, right) => (
      (META_WORKFLOW_FOLDER_RANK.get(left.name) ?? Number.POSITIVE_INFINITY)
      - (META_WORKFLOW_FOLDER_RANK.get(right.name) ?? Number.POSITIVE_INFINITY)
    ))
    .map((node) => ({
      name: node.name,
      path: node.relativePath || node.path || node.absolutePath || node.name,
      fileCount: countVisibleFiles(node),
    }));
}
