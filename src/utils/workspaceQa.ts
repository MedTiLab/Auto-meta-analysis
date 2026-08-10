const WORKSPACE_QA_DRAFT_PREFIX = 'med-help-workspace-qa-draft:';
const LEGACY_WORKSPACE_QA_DRAFT_PREFIXES = ['dr-claw-workspace-qa-draft:'];

export const WORKSPACE_QA_DRAFT_EVENT = 'med-help:workspace-qa-draft';

const getDraftKey = (projectName: string) => `${WORKSPACE_QA_DRAFT_PREFIX}${projectName}`;

export const queueWorkspaceQaDraft = (projectName: string, prompt: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getDraftKey(projectName), prompt);
  LEGACY_WORKSPACE_QA_DRAFT_PREFIXES.forEach((prefix) => {
    window.sessionStorage.removeItem(`${prefix}${projectName}`);
  });
  window.dispatchEvent(new CustomEvent(WORKSPACE_QA_DRAFT_EVENT, {
    detail: { projectName },
  }));
};

export const consumeWorkspaceQaDraft = (projectName: string): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const key = getDraftKey(projectName);
  const draft = window.sessionStorage.getItem(key);
  if (draft) {
    window.sessionStorage.removeItem(key);
    return draft;
  }

  for (const legacyPrefix of LEGACY_WORKSPACE_QA_DRAFT_PREFIXES) {
    const legacyKey = `${legacyPrefix}${projectName}`;
    const legacyDraft = window.sessionStorage.getItem(legacyKey);
    if (!legacyDraft) continue;
    window.sessionStorage.setItem(key, legacyDraft);
    window.sessionStorage.removeItem(legacyKey);
    window.sessionStorage.removeItem(key);
    return legacyDraft;
  }

  return null;
};
