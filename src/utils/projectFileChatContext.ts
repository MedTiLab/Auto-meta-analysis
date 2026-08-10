const PROJECT_FILE_CHAT_CONTEXT_PREFIX = 'medautodata-project-file-chat-context:';

export const PROJECT_FILE_CHAT_CONTEXT_EVENT = 'medautodata:project-file-chat-context';

export interface ProjectFileChatContextItem {
  name: string;
  path: string;
  absolutePath?: string | null;
  kind?: 'file' | 'directory';
}

const getDraftKey = (projectName: string) => `${PROJECT_FILE_CHAT_CONTEXT_PREFIX}${projectName}`;

const normalizeItem = (item: ProjectFileChatContextItem): ProjectFileChatContextItem | null => {
  const name = String(item?.name || '').trim();
  const path = String(item?.path || item?.absolutePath || '').trim();

  if (!name || !path) {
    return null;
  }

  return {
    name,
    path,
    absolutePath: item.absolutePath || null,
    kind: item.kind === 'directory' ? 'directory' : 'file',
  };
};

const readQueuedItems = (projectName: string): ProjectFileChatContextItem[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.sessionStorage.getItem(getDraftKey(projectName));
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map((item) => normalizeItem(item as ProjectFileChatContextItem))
      .filter((item): item is ProjectFileChatContextItem => Boolean(item));
  } catch {
    return [];
  }
};

export const queueProjectFileChatContext = (
  projectName: string,
  itemOrItems: ProjectFileChatContextItem | ProjectFileChatContextItem[],
) => {
  if (typeof window === 'undefined') {
    return;
  }

  const incomingItems = (Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems])
    .map((item) => normalizeItem(item))
    .filter((item): item is ProjectFileChatContextItem => Boolean(item));

  if (incomingItems.length === 0) {
    return;
  }

  const itemsByPath = new Map<string, ProjectFileChatContextItem>();
  [...readQueuedItems(projectName), ...incomingItems].forEach((item) => {
    itemsByPath.set(item.path, item);
  });

  window.sessionStorage.setItem(getDraftKey(projectName), JSON.stringify(Array.from(itemsByPath.values())));
  window.dispatchEvent(new CustomEvent(PROJECT_FILE_CHAT_CONTEXT_EVENT, {
    detail: { projectName },
  }));
};

export const consumeProjectFileChatContext = (projectName: string): ProjectFileChatContextItem[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  const items = readQueuedItems(projectName);
  window.sessionStorage.removeItem(getDraftKey(projectName));
  return items;
};
