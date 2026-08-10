import path from 'path';

import { extractTasksFromData, normalizeTaskStatus } from '../pipeline/state.js';
import { readJsonIfExists, writeJson } from './files.js';

const DEFAULT_TASKS_TAG = 'master';
const EXECUTION_MEMORY_DETAILS_START = 'Execution memory sync:';
const EXECUTION_MEMORY_DETAILS_END = 'End execution memory sync.';

async function syncExecutionMemoryToTasks(scopeRef, options = {}) {
  const projectPath = scopeRef?.projectPath;
  if (!projectPath) {
    return { synced: false, reason: 'missing_project_path' };
  }

  const tasksPath = path.join(projectPath, '.pipeline', 'tasks', 'tasks.json');
  let rawTasks;
  try {
    rawTasks = await readJsonIfExists(tasksPath, null);
  } catch (error) {
    return { synced: false, reason: 'tasks_invalid', error: error?.message || String(error) };
  }
  if (!rawTasks) {
    return { synced: false, reason: 'tasks_missing' };
  }

  const { currentTag, tasks } = extractTasksFromData(rawTasks);
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { synced: false, reason: 'tasks_empty' };
  }

  const snapshot = options.snapshot || null;
  if (!snapshot) {
    return { synced: false, reason: 'missing_snapshot' };
  }

  const resolution = resolveTargetTask(tasks, snapshot, scopeRef);
  if (!resolution) {
    return { synced: false, reason: 'target_task_not_found' };
  }

  const task = tasks[resolution.index];
  const evidence = collectTaskEvidence(task, snapshot, scopeRef);
  const currentStatus = normalizeTaskStatus(task.status);
  const nextTask = { ...task };
  let changed = false;

  if (evidence.shouldMarkDone && currentStatus !== 'done') {
    nextTask.status = 'done';
    changed = true;
  } else if (evidence.shouldMarkReview && currentStatus !== 'review' && currentStatus !== 'done') {
    nextTask.status = 'review';
    changed = true;
  } else if (evidence.shouldBeInProgress && currentStatus === 'pending') {
    nextTask.status = 'in-progress';
    changed = true;
  }

  const nextDetails = mergeExecutionMemoryDetailsBlock(task.details, evidence);
  if (nextDetails !== task.details) {
    nextTask.details = nextDetails;
    changed = true;
  }

  if (!changed) {
    return { synced: false, reason: 'unchanged', taskId: String(task.id) };
  }

  nextTask.updatedAt = new Date().toISOString();
  const nextTasks = [...tasks];
  nextTasks[resolution.index] = nextTask;
  const nextPayload = applyTasksToRaw(rawTasks, currentTag, nextTasks);
  await writeJson(tasksPath, nextPayload);

  return {
    synced: true,
    taskId: String(nextTask.id),
    taskTitle: nextTask.title || null,
    status: nextTask.status || null,
    tasksPath,
    reason: evidence.shouldMarkDone
      ? 'marked_done'
      : evidence.shouldMarkReview
        ? 'marked_review'
        : 'marked_in_progress',
  };
}

function resolveTargetTask(tasks, snapshot, scopeRef) {
  const preferredTaskId = firstNonEmpty([
    scopeRef?.currentTaskId,
    snapshot?.microtasks?.currentTaskId,
  ]);
  if (preferredTaskId != null) {
    const taskIndex = tasks.findIndex((task) => String(task.id) === String(preferredTaskId));
    if (taskIndex >= 0) {
      return { index: taskIndex, source: 'task_id' };
    }
  }

  const preferredTaskTitle = firstNonEmpty([
    scopeRef?.currentTaskTitle,
    snapshot?.microtasks?.currentTaskTitle,
    extractTaskTitleFromObjective(snapshot?.microtasks?.currentObjective || ''),
  ]);
  if (preferredTaskTitle) {
    const normalizedPreferred = normalizeTitle(preferredTaskTitle);
    const exactIndex = tasks.findIndex((task) => normalizeTitle(task.title) === normalizedPreferred);
    if (exactIndex >= 0) {
      return { index: exactIndex, source: 'task_title_exact' };
    }

    const fuzzyIndex = tasks.findIndex((task) => {
      const normalizedTaskTitle = normalizeTitle(task.title);
      return normalizedTaskTitle && (
        normalizedTaskTitle.includes(normalizedPreferred)
        || normalizedPreferred.includes(normalizedTaskTitle)
      );
    });
    if (fuzzyIndex >= 0) {
      return { index: fuzzyIndex, source: 'task_title_fuzzy' };
    }
  }

  return null;
}

function collectTaskEvidence(task, snapshot, scopeRef) {
  const taskId = String(task.id);
  const taskTitle = compactWhitespace(task.title || '');
  const reviewTask = isReviewTask(task);
  const currentTaskId = firstNonEmpty([scopeRef?.currentTaskId, snapshot?.microtasks?.currentTaskId]);
  const ledgerEvents = Array.isArray(snapshot?.ledgerEvents) ? snapshot.ledgerEvents : [];
  const microtaskItems = Array.isArray(snapshot?.microtasks?.items) ? snapshot.microtasks.items : [];

  const taskEvents = ledgerEvents.filter((event) => matchesTask(event, taskId, taskTitle));
  const boundMicrotasks = microtaskItems.filter((item) => matchesTask(item, taskId, taskTitle));
  const completedMicrotasks = boundMicrotasks
    .filter((item) => String(item?.status || '').toLowerCase() === 'completed')
    .map((item) => item.title)
    .filter(Boolean);
  const openMicrotasks = boundMicrotasks.filter((item) => String(item?.status || '').toLowerCase() !== 'completed');

  const confirmedArtifacts = dedupeStrings(
    taskEvents
      .filter((event) => event?.type === 'artifact_created' && typeof event?.path === 'string')
      .map((event) => event.path),
  );
  const touchedFiles = dedupeStrings(
    confirmedArtifacts.filter((artifactPath) => !isPipelineControlArtifactPath(artifactPath)),
  );
  const reportArtifacts = dedupeStrings(
    touchedFiles.filter((artifactPath) => isReportArtifactPath(artifactPath)),
  );
  const confirmedFindings = dedupeStrings([
    ...taskEvents
      .filter((event) => event?.type === 'finding_recorded' && String(event?.confirmation || '').toLowerCase() === 'confirmed')
      .map((event) => event.summary),
    ...taskEvents
      .filter((event) => event?.type === 'stat_result' && typeof event?.summary === 'string')
      .map((event) => event.summary),
  ]);
  const assistantNotes = taskEvents
    .filter((event) => event?.type === 'assistant_note' && typeof event?.summary === 'string')
    .map((event) => event.summary);
  const latestNotes = dedupeStrings(assistantNotes).slice(-2).map((note) => clipText(note, 240));

  const explicitTaskCompleted = taskEvents.some((event) => event?.type === 'task_completed');
  const hasCompletionCue = assistantNotes.some((note) => hasTaskCompletionCue(note, taskTitle));
  const hasReviewActivityCue = reviewTask && assistantNotes.some((note) => hasReviewActivitySignal(note, taskTitle));
  const hasReviewApprovalSignal = reviewTask && assistantNotes.some((note) => hasReviewApprovalCue(note, taskTitle));
  const hasConfirmedOutputs = confirmedArtifacts.length > 0 || confirmedFindings.length > 0;
  const hasReviewOutcome = reviewTask && (
    hasConfirmedOutputs
    || completedMicrotasks.length > 0
    || hasReviewActivityCue
  );
  const isCurrentTask = currentTaskId != null && String(currentTaskId) === taskId;
  const hasExecutionActivity = isCurrentTask || taskEvents.some((event) => (
    event?.type === 'tool_use'
    || event?.type === 'tool_result'
    || event?.type === 'artifact_created'
    || event?.type === 'stat_result'
    || event?.type === 'finding_recorded'
  )) || boundMicrotasks.length > 0;

  const shouldMarkDone = reviewTask
    ? (
      explicitTaskCompleted
      || (hasReviewOutcome && hasReviewApprovalSignal)
      || (hasConfirmedOutputs && hasCompletionCue)
    )
    : (
      explicitTaskCompleted
      || (hasConfirmedOutputs && hasCompletionCue)
      || (hasConfirmedOutputs && boundMicrotasks.length > 0 && openMicrotasks.length === 0 && completedMicrotasks.length > 0)
    );
  const shouldMarkReview = reviewTask && hasReviewOutcome && !shouldMarkDone;
  const syncStatus = shouldMarkDone ? 'done' : shouldMarkReview ? 'review' : 'in-progress';

  return {
    taskId,
    taskTitle,
    reviewTask,
    shouldBeInProgress: hasExecutionActivity,
    shouldMarkDone,
    shouldMarkReview,
    touchedFiles,
    reportArtifacts,
    confirmedArtifacts,
    confirmedFindings,
    completedMicrotasks: dedupeStrings(completedMicrotasks),
    latestNotes,
    lastUpdatedAt: new Date().toISOString(),
    syncStatus,
  };
}

function mergeExecutionMemoryDetailsBlock(existingDetails, evidence) {
  const shouldWriteBlock = evidence.shouldMarkDone
    || evidence.shouldMarkReview
    || evidence.touchedFiles.length > 0
    || evidence.reportArtifacts.length > 0
    || evidence.confirmedArtifacts.length > 0
    || evidence.confirmedFindings.length > 0
    || evidence.completedMicrotasks.length > 0
    || evidence.latestNotes.length > 0;
  if (!shouldWriteBlock) {
    return existingDetails || '';
  }

  const lines = [
    EXECUTION_MEMORY_DETAILS_START,
    `Updated: ${evidence.lastUpdatedAt}`,
    `Status: ${evidence.syncStatus || 'in-progress'}`,
  ];
  if (evidence.completedMicrotasks.length > 0) {
    lines.push(`Completed microtasks: ${evidence.completedMicrotasks.join('; ')}`);
  }
  if (evidence.touchedFiles.length > 0) {
    lines.push(`Touched files: ${evidence.touchedFiles.join('; ')}`);
  }
  if (evidence.reportArtifacts.length > 0) {
    lines.push(`Report artifacts: ${evidence.reportArtifacts.join('; ')}`);
  }
  if (evidence.confirmedArtifacts.length > 0) {
    lines.push(`Confirmed artifacts: ${evidence.confirmedArtifacts.join('; ')}`);
  }
  if (evidence.confirmedFindings.length > 0) {
    lines.push(`Confirmed findings: ${evidence.confirmedFindings.join('; ')}`);
  }
  if (evidence.latestNotes.length > 0) {
    lines.push(`Latest update: ${evidence.latestNotes.join(' || ')}`);
  }
  lines.push(EXECUTION_MEMORY_DETAILS_END);
  const nextBlock = lines.join('\n');

  const pattern = new RegExp(
    `${escapeRegExp(EXECUTION_MEMORY_DETAILS_START)}[\\s\\S]*?${escapeRegExp(EXECUTION_MEMORY_DETAILS_END)}`,
    'm',
  );
  const existing = String(existingDetails || '').trim();
  if (pattern.test(existing)) {
    return existing.replace(pattern, nextBlock);
  }
  return existing ? `${existing}\n\n${nextBlock}` : nextBlock;
}

function applyTasksToRaw(rawTasks, currentTag, nextTasks) {
  if (Array.isArray(rawTasks)) {
    return nextTasks;
  }
  if (rawTasks?.tasks && Array.isArray(rawTasks.tasks)) {
    return {
      ...rawTasks,
      tasks: nextTasks,
    };
  }

  const tag = currentTag || DEFAULT_TASKS_TAG;
  return {
    ...(rawTasks && typeof rawTasks === 'object' ? rawTasks : {}),
    [tag]: {
      ...((rawTasks && typeof rawTasks === 'object' && rawTasks[tag] && typeof rawTasks[tag] === 'object') ? rawTasks[tag] : {}),
      tasks: nextTasks,
    },
  };
}

function extractTaskTitleFromObjective(objective) {
  const match = String(objective || '').match(/(?:^|\n)Task:\s*(.+)$/im);
  return match?.[1] ? compactWhitespace(match[1]) : '';
}

function hasTaskCompletionCue(note, taskTitle) {
  const normalizedNote = normalizeTitle(note);
  if (!normalizedNote || !/\b(completed|finished|done)\b/.test(normalizedNote) && !/(已完成|完成了|完成任务)/.test(String(note || ''))) {
    return false;
  }
  const normalizedTitle = normalizeTitle(taskTitle);
  if (!normalizedTitle) {
    return normalizedNote.includes('task');
  }
  return normalizedNote.includes(normalizedTitle) || normalizedNote.includes('task');
}

function hasReviewActivitySignal(note, taskTitle) {
  const normalizedNote = normalizeTitle(note);
  if (!normalizedNote) {
    return false;
  }

  const hasReviewKeyword = /\b(review(ed|er)?|quality gate|audit(ed)?|peer review|sign off|signoff|approval)\b/.test(normalizedNote)
    || /(审核|审阅|复核|评审|把关)/.test(String(note || ''));
  if (!hasReviewKeyword) {
    return false;
  }

  const normalizedTitle = normalizeTitle(taskTitle);
  if (!normalizedTitle) {
    return true;
  }

  return normalizedNote.includes(normalizedTitle)
    || normalizedNote.includes('task')
    || normalizedNote.includes('quality gate');
}

function hasReviewApprovalCue(note, taskTitle) {
  const normalizedNote = normalizeTitle(note);
  if (!normalizedNote) {
    return false;
  }

  const hasApprovalKeyword = /\b(pass(ed)?|approve[ds]?|accepted?|cleared|satisfied|signed off|sign off complete|ready to move forward|ready to proceed)\b/.test(normalizedNote)
    || /(审核通过|通过审核|已批准|已审阅通过|可进入下一步|可以推进|质量门通过)/.test(String(note || ''));
  if (!hasApprovalKeyword) {
    return false;
  }

  return hasReviewActivitySignal(note, taskTitle)
    || hasTaskCompletionCue(note, taskTitle);
}

function isReviewTask(task) {
  const sourceBlueprintId = String(task?.sourceBlueprintId || '').trim().toLowerCase();
  if (sourceBlueprintId.endsWith('.quality_gate')) {
    return true;
  }

  const combined = `${task?.title || ''} ${task?.description || ''}`;
  const normalized = normalizeTitle(combined);
  return /\b(review|quality gate|audit|peer review|reviewer|approval)\b/.test(normalized)
    || /(审核|审阅|复核|评审|把关|质量门)/.test(combined);
}

function isPipelineControlArtifactPath(value) {
  const normalized = String(value || '').trim().replace(/\\/g, '/').toLowerCase();
  return normalized.startsWith('.pipeline/')
    || normalized.includes('/.pipeline/')
    || normalized === 'instance.json';
}

function isReportArtifactPath(value) {
  const normalized = String(value || '').trim().replace(/\\/g, '/').toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized.includes('/report/')
    || normalized.includes('/reports/')
    || normalized.includes('/review/')
    || normalized.endsWith('.pdf')
    || normalized.endsWith('.docx')
    || normalized.endsWith('.pptx')
    || /\b(report|review|summary|findings|notes|memo|changelog|change-log)\b/.test(normalized);
}

function matchesTask(entry, taskId, taskTitle) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  const candidateIds = [
    entry.taskId,
    entry.currentTaskId,
    entry.parentTaskId,
  ]
    .filter((value) => value != null)
    .map((value) => String(value));
  if (candidateIds.includes(String(taskId))) {
    return true;
  }

  const normalizedTaskTitle = normalizeTitle(taskTitle);
  if (!normalizedTaskTitle) {
    return false;
  }

  const candidateTitles = [
    entry.taskTitle,
    entry.currentTaskTitle,
    entry.title,
  ]
    .filter((value) => typeof value === 'string')
    .map((value) => normalizeTitle(value));
  return candidateTitles.some((value) => value && (
    value === normalizedTaskTitle
    || value.includes(normalizedTaskTitle)
    || normalizedTaskTitle.includes(value)
  ));
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function normalizeTitle(value) {
  return compactWhitespace(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clipText(value, maxLength = 240) {
  const normalized = compactWhitespace(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const deduped = [];
  for (const value of values) {
    const normalized = compactWhitespace(value);
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export {
  syncExecutionMemoryToTasks,
};
