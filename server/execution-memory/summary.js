import {
  buildExecutionMemoryMarkerKey,
  getExecutionMemoryPaths,
  readJsonIfExists,
  readJsonl,
  readTextIfExists,
  replaceMarkedSection,
  writeText,
} from './files.js';

function createEmptyMicrotaskState(scopeRef = {}) {
  return {
    version: 1,
    scope: scopeRef.scope || 'session',
    sessionId: scopeRef.sessionId || null,
    runId: scopeRef.runId || null,
    provider: scopeRef.provider || null,
    currentObjective: scopeRef.currentObjective || null,
    currentTaskId: scopeRef.currentTaskId || null,
    currentTaskTitle: scopeRef.currentTaskTitle || null,
    stage: scopeRef.stage || null,
    source: null,
    updatedAt: null,
    items: [],
  };
}

async function readExecutionMemorySnapshot(scopeRef, options = {}) {
  const ledgerLimit = Number.isFinite(options.ledgerLimit) ? Math.max(1, Number(options.ledgerLimit)) : 120;
  const paths = getExecutionMemoryPaths(scopeRef);
  const [microtasks, ledgerEvents, sessionSummary] = await Promise.all([
    readJsonIfExists(paths.microtasksPath, null),
    readJsonl(paths.ledgerPath, ledgerLimit),
    readTextIfExists(paths.sessionSummaryPath, ''),
  ]);
  const resolvedMicrotasks = microtasks || createEmptyMicrotaskState(scopeRef);
  return {
    scope: {
      ...scopeRef,
      scope: scopeRef?.scope || 'session',
      sessionId: resolvedMicrotasks.sessionId || scopeRef?.sessionId || null,
      runId: resolvedMicrotasks.runId || scopeRef?.runId || null,
    },
    paths,
    microtasks: resolvedMicrotasks,
    ledgerEvents,
    sessionSummary,
    derived: buildDerivedExecutionMemory(resolvedMicrotasks, ledgerEvents),
  };
}

async function refreshExecutionMemorySummaries(scopeRef, options = {}) {
  const snapshot = await readExecutionMemorySnapshot(scopeRef, options);
  const sessionSummary = buildSessionSummaryMarkdown(snapshot);
  const workingSummary = buildWorkingSummarySection(snapshot);
  await Promise.all([
    writeText(snapshot.paths.sessionSummaryPath, sessionSummary),
    replaceMarkedSection(
      snapshot.paths.workingSummaryPath,
      buildExecutionMemoryMarkerKey(snapshot.scope),
      workingSummary,
    ),
  ]);
  return {
    ...snapshot,
    sessionSummary,
    workingSummary,
  };
}

function buildDerivedExecutionMemory(microtasks, ledgerEvents = []) {
  const items = Array.isArray(microtasks?.items) ? microtasks.items : [];
  const openItems = items.filter((item) => item.status !== 'completed');
  const completedItems = items.filter((item) => item.status === 'completed');
  const recentArtifacts = dedupeStrings(
    ledgerEvents
      .filter((event) => event?.type === 'artifact_created' && typeof event?.path === 'string')
      .map((event) => event.path),
  ).slice(-8);
  const recentConfirmedFindings = dedupeStrings([
    ...ledgerEvents
      .filter((event) => event?.type === 'finding_recorded' && typeof event?.summary === 'string' && String(event?.confirmation || '').toLowerCase() === 'confirmed')
      .map((event) => event.summary),
    ...ledgerEvents
      .filter((event) => event?.type === 'stat_result' && typeof event?.summary === 'string')
      .map((event) => event.summary),
  ]).slice(-6);
  const recentObservedFindings = dedupeStrings(
    ledgerEvents
      .filter((event) => event?.type === 'finding_recorded' && typeof event?.summary === 'string' && String(event?.confirmation || '').toLowerCase() !== 'confirmed')
      .map((event) => event.summary),
  ).slice(-6);
  const recentNotes = dedupeStrings(
    ledgerEvents
      .filter((event) => event?.type === 'assistant_note' && typeof event?.summary === 'string')
      .map((event) => event.summary),
  ).slice(-4);

  return {
    totalMicrotasks: items.length,
    completedMicrotasks: completedItems.length,
    openMicrotasks: openItems.length,
    openItems,
    completedItems,
    recentArtifacts,
    recentConfirmedFindings,
    recentObservedFindings,
    recentNotes,
  };
}

function buildSessionSummaryMarkdown(snapshot) {
  const { microtasks, derived, scope } = snapshot;
  const lines = [];
  const scopeLabel = scope.scope === 'run'
    ? `Auto Research Run ${scope.runId || 'unknown'}`
    : `Session ${scope.sessionId || 'unknown'}`;

  lines.push(`# Execution Memory Summary`);
  lines.push('');
  lines.push(`Scope: ${scopeLabel}`);
  if (microtasks.provider) {
    lines.push(`Provider: ${microtasks.provider}`);
  }
  if (microtasks.updatedAt) {
    lines.push(`Updated: ${microtasks.updatedAt}`);
  }
  lines.push('');

  lines.push(`## Objective`);
  lines.push(microtasks.currentObjective || 'No execution objective recorded yet.');
  lines.push('');

  lines.push(`## Current Task`);
  lines.push(microtasks.currentTaskTitle || 'No active task recorded.');
  lines.push('');

  lines.push(`## Open Microtasks`);
  if (derived.openItems.length === 0) {
    lines.push(`- None`);
  } else {
    for (const item of derived.openItems.slice(0, 8)) {
      lines.push(`- [ ] ${item.title}`);
    }
  }
  lines.push('');

  lines.push(`## Completed Microtasks`);
  if (derived.completedItems.length === 0) {
    lines.push(`- None`);
  } else {
    for (const item of derived.completedItems.slice(-8)) {
      lines.push(`- [x] ${item.title}`);
    }
  }
  lines.push('');

  lines.push(`## Confirmed Artifacts`);
  if (derived.recentArtifacts.length === 0) {
    lines.push(`- None`);
  } else {
    for (const artifactPath of derived.recentArtifacts) {
      lines.push(`- ${artifactPath}`);
    }
  }
  lines.push('');

  lines.push(`## Confirmed Findings`);
  if (derived.recentConfirmedFindings.length === 0) {
    lines.push(`- None`);
  } else {
    for (const finding of derived.recentConfirmedFindings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push('');

  lines.push(`## Observed Findings`);
  if (derived.recentObservedFindings.length === 0) {
    lines.push(`- None`);
  } else {
    for (const finding of derived.recentObservedFindings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push('');

  if (derived.recentNotes.length > 0) {
    lines.push(`## Recent Notes`);
    for (const note of derived.recentNotes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function buildWorkingSummarySection(snapshot) {
  const { microtasks, derived, scope } = snapshot;
  const title = scope.scope === 'run'
    ? `## Auto Research Run ${scope.runId || 'unknown'}`
    : `## Session ${scope.sessionId || 'unknown'}`;
  const lines = [title];

  if (microtasks.updatedAt) {
    lines.push(`Updated: ${microtasks.updatedAt}`);
  }
  lines.push('');
  lines.push(`Objective: ${microtasks.currentObjective || 'No objective recorded yet.'}`);
  lines.push('');

  lines.push(`Current task: ${microtasks.currentTaskTitle || 'No active task recorded.'}`);
  lines.push('');

  lines.push(`Open microtasks:`);
  if (derived.openItems.length === 0) {
    lines.push(`- None`);
  } else {
    for (const item of derived.openItems.slice(0, 8)) {
      lines.push(`- ${item.title}`);
    }
  }
  lines.push('');

  lines.push(`Completed microtasks:`);
  if (derived.completedItems.length === 0) {
    lines.push(`- None`);
  } else {
    for (const item of derived.completedItems.slice(-8)) {
      lines.push(`- ${item.title}`);
    }
  }
  lines.push('');

  lines.push(`Confirmed artifacts:`);
  if (derived.recentArtifacts.length === 0) {
    lines.push(`- None`);
  } else {
    for (const artifactPath of derived.recentArtifacts) {
      lines.push(`- ${artifactPath}`);
    }
  }
  lines.push('');

  lines.push(`Confirmed findings:`);
  if (derived.recentConfirmedFindings.length === 0) {
    lines.push(`- None`);
  } else {
    for (const finding of derived.recentConfirmedFindings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push('');

  lines.push(`Observed findings:`);
  if (derived.recentObservedFindings.length === 0) {
    lines.push(`- None`);
  } else {
    for (const finding of derived.recentObservedFindings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

function buildExecutionPromptContext(snapshot) {
  const { microtasks, derived } = snapshot;
  const hasMeaningfulContent = Boolean(
    microtasks.currentObjective
    || microtasks.currentTaskTitle
    || derived.openItems.length
    || derived.completedItems.length
    || derived.recentArtifacts.length
    || derived.recentConfirmedFindings.length
    || derived.recentObservedFindings.length,
  );
  if (!hasMeaningfulContent) {
    return '';
  }

  const lines = ['<execution_memory>'];
  if (microtasks.currentObjective) {
    lines.push(`Current objective: ${microtasks.currentObjective}`);
  }
  if (microtasks.currentTaskTitle) {
    lines.push(`Current task: ${microtasks.currentTaskTitle}`);
  }
  if (derived.openItems.length > 0) {
    lines.push('Open microtasks:');
    for (const item of derived.openItems.slice(0, 5)) {
      lines.push(`- ${item.title}`);
    }
  }
  if (derived.completedItems.length > 0) {
    lines.push('Recently completed microtasks:');
    for (const item of derived.completedItems.slice(-5)) {
      lines.push(`- ${item.title}`);
    }
  }
  if (derived.recentArtifacts.length > 0) {
    lines.push('Recent confirmed artifacts:');
    for (const artifactPath of derived.recentArtifacts.slice(-5)) {
      lines.push(`- ${artifactPath}`);
    }
  }
  if (derived.recentConfirmedFindings.length > 0) {
    lines.push('Confirmed findings:');
    for (const finding of derived.recentConfirmedFindings.slice(-4)) {
      lines.push(`- ${finding}`);
    }
  }
  if (derived.recentObservedFindings.length > 0) {
    lines.push('Observed findings:');
    for (const finding of derived.recentObservedFindings.slice(-4)) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push('Use this execution memory to continue from the latest confirmed state and avoid repeating completed work.');
  lines.push('</execution_memory>');
  return lines.join('\n');
}

async function buildExecutionMemoryPromptPrefix(scopeRef, command, options = {}) {
  if (!scopeRef?.projectPath) {
    return command;
  }
  const snapshot = await readExecutionMemorySnapshot(scopeRef, {
    ledgerLimit: options.ledgerLimit || 80,
  });
  const prefix = buildExecutionPromptContext(snapshot);
  if (!prefix) {
    return command;
  }
  const body = String(command || '').trim() || options.fallbackCommand || 'Continue from the latest confirmed execution state.';
  return `${prefix}\n\nUser request:\n${body}`;
}

function dedupeStrings(values) {
  const seen = new Set();
  const deduped = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

export {
  buildExecutionMemoryPromptPrefix,
  buildExecutionPromptContext,
  buildSessionSummaryMarkdown,
  buildWorkingSummarySection,
  createEmptyMicrotaskState,
  readExecutionMemorySnapshot,
  refreshExecutionMemorySummaries,
};
