const REFERENCE_CHAT_DRAFT_PREFIX = 'medautodata-reference-chat-draft:';

export const REFERENCE_CHAT_DRAFT_EVENT = 'medautodata:reference-chat-draft';

export interface ReferenceChatDraft {
  text: string;
  referenceId: string;
  pdfCached: boolean;
}

const getDraftKey = (projectName: string) => `${REFERENCE_CHAT_DRAFT_PREFIX}${projectName}`;

export const queueReferenceChatDraft = (projectName: string, draft: ReferenceChatDraft) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getDraftKey(projectName), JSON.stringify(draft));
  window.dispatchEvent(new CustomEvent(REFERENCE_CHAT_DRAFT_EVENT, {
    detail: { projectName },
  }));
};

/**
 * Queue the reference after the chat view has had a chance to mount.
 *
 * The library view and chat view are mutually exclusive. Dispatching synchronously
 * while switching views can let React Strict Mode's throw-away mount consume the
 * draft before the real composer is ready, leaving the input empty.
 */
export const queueReferenceChatDraftDeferred = (projectName: string, draft: ReferenceChatDraft) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.setTimeout(() => {
    queueReferenceChatDraft(projectName, draft);
  }, 0);
};

export const consumeReferenceChatDraft = (projectName: string): ReferenceChatDraft | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const key = getDraftKey(projectName);
  const raw = window.sessionStorage.getItem(key);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(key);
  try {
    return JSON.parse(raw) as ReferenceChatDraft;
  } catch {
    return null;
  }
};
