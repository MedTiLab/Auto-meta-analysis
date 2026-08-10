const EXPLICIT_SESSION_MODES = new Set(['research', 'workspace_qa']);

function normalizeSessionModeValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeSessionMode(value) {
  return normalizeSessionModeValue(value) === 'workspace_qa' ? 'workspace_qa' : 'research';
}

export function readExplicitSessionModeValue(value) {
  const normalized = normalizeSessionModeValue(value);
  return EXPLICIT_SESSION_MODES.has(normalized) ? normalized : null;
}

export function extractSessionModeFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return 'research';
  }

  return readExplicitSessionModeFromMetadata(metadata) || 'research';
}

export function readExplicitSessionModeFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  return readExplicitSessionModeValue(metadata.sessionMode)
    || readExplicitSessionModeValue(metadata.mode);
}

export function extractSessionModeFromText(value) {
  const text = String(value || '');
  if (/\[Context:\s*session-mode=workspace_qa\]/i.test(text)) {
    return 'workspace_qa';
  }
  if (/\[Context:\s*session-mode=research\]/i.test(text)) {
    return 'research';
  }
  return null;
}

export function inferSessionModeFromUserMessage(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const strongWorkspacePatterns = [
    /\bpull request\b/i,
    /\bgit\b/i,
    /\bcommit\b/i,
    /\bpush\b/i,
    /\brepo(?:sitory)?\b/i,
    /提交/,
    /推送/,
    /仓库/,
  ];
  if (strongWorkspacePatterns.some((pattern) => pattern.test(text))) {
    return 'workspace_qa';
  }

  const gitBranchPatterns = [
    /\bgit\s+branch(?:es)?\b/i,
    /git.*分支/i,
    /分支.*git/i,
  ];
  if (gitBranchPatterns.some((pattern) => pattern.test(text))) {
    return 'workspace_qa';
  }

  const researchPatterns = [
    /\bresearch\b/i,
    /\bpaper(?:s)?\b/i,
    /\bdataset(?:s)?\b/i,
    /\bexperiment(?:s|al)?\b/i,
    /\bhypothesis\b/i,
    /\bsurvey\b/i,
    /\bbenchmark(?:s)?\b/i,
    /\bliterature\b/i,
    /研究/,
    /论文/,
    /实验/,
    /数据集/,
    /调研/,
    /综述/,
    /假设/,
  ];
  if (researchPatterns.some((pattern) => pattern.test(text))) {
    return 'research';
  }

  return null;
}
