import crypto from 'crypto';

import {
  appendJsonl,
  ensureExecutionMemoryDir,
  moveExecutionMemoryDir,
  readJsonIfExists,
  writeJson,
} from './files.js';
import {
  buildImplicitMicrotaskTitle,
  extractArtifactPathsFromToolInput,
  normalizeExecutionSignals,
} from './normalize.js';
import {
  extractConfirmedFindingsFromArtifact,
  extractStructuredStatEntries,
} from './findings.js';
import {
  createEmptyMicrotaskState,
  refreshExecutionMemorySummaries,
} from './summary.js';
import { syncConfirmedExecutionMemoryToResearchBrief } from './brief-sync.js';
import { syncExecutionMemoryToTasks } from './task-sync.js';

const SUMMARY_RELEVANT_SIGNAL_TYPES = new Set([
  'assistant_text',
  'artifact_created',
  'todo_snapshot',
  'task_started',
  'task_completed',
  'run_started',
  'run_completed',
  'run_failed',
  'run_cancelled',
]);

const IMPLICIT_MICROTASK_ALLOWED_TOOLS = new Set([
  'bash',
  'edit',
  'multiedit',
  'write',
  'writefile',
  'replace',
  'notebookedit',
  'websearch',
  'webfetch',
]);

function createExecutionMemoryTracker(scopeRef = {}) {
  return new ExecutionMemoryTracker(scopeRef);
}

function wrapWriterWithExecutionMemory(writer, tracker) {
  if (!writer || !tracker) {
    return writer;
  }

  return new Proxy(writer, {
    get(target, property, receiver) {
      if (property === 'send') {
        return (data) => {
          void tracker.handlePayload(data);
          return target.send.call(target, data);
        };
      }
      if (property === 'setSessionId') {
        return (sessionId) => {
          void tracker.setSessionId(sessionId);
          return target.setSessionId.call(target, sessionId);
        };
      }
      if (property === 'setProjectPath') {
        return (projectPath) => {
          void tracker.setProjectPath(projectPath);
          return target.setProjectPath.call(target, projectPath);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

class ExecutionMemoryTracker {
  constructor(scopeRef = {}) {
    this.scope = scopeRef.scope === 'run' ? 'run' : 'session';
    this.projectPath = scopeRef.projectPath || null;
    this.provider = scopeRef.provider || null;
    this.sessionId = scopeRef.sessionId || null;
    this.runId = scopeRef.runId || null;
    this.currentObjective = Object.prototype.hasOwnProperty.call(scopeRef, 'currentObjective') ? scopeRef.currentObjective : undefined;
    this.currentTaskId = Object.prototype.hasOwnProperty.call(scopeRef, 'currentTaskId') ? scopeRef.currentTaskId : undefined;
    this.currentTaskTitle = Object.prototype.hasOwnProperty.call(scopeRef, 'currentTaskTitle') ? scopeRef.currentTaskTitle : undefined;
    this.stage = Object.prototype.hasOwnProperty.call(scopeRef, 'stage') ? scopeRef.stage : undefined;
    this.onPipelineStateChanged = typeof scopeRef.onPipelineStateChanged === 'function'
      ? scopeRef.onPipelineStateChanged
      : (typeof scopeRef.onConfirmedSync === 'function' ? scopeRef.onConfirmedSync : null);
    this.microtasks = null;
    this.pendingToolUses = new Map();
    this.observedKeys = new Set();
    this.queue = Promise.resolve();
  }

  getScopeRef() {
    return {
      scope: this.scope,
      projectPath: this.projectPath,
      provider: this.provider,
      sessionId: this.sessionId,
      runId: this.runId,
      currentObjective: this.currentObjective,
      currentTaskId: this.currentTaskId,
      currentTaskTitle: this.currentTaskTitle,
      stage: this.stage,
    };
  }

  async setProjectPath(projectPath) {
    if (!projectPath || projectPath === this.projectPath) {
      return;
    }
    this.projectPath = projectPath;
    this.microtasks = null;
    await this.ensureStateLoaded();
  }

  async setSessionId(sessionId) {
    if (!sessionId || sessionId === this.sessionId) {
      return;
    }
    const previousSessionId = this.sessionId;
    this.sessionId = sessionId;
    if (this.scope === 'session' && this.projectPath && previousSessionId) {
      await moveExecutionMemoryDir(
        { scope: 'session', projectPath: this.projectPath, sessionId: previousSessionId },
        { scope: 'session', projectPath: this.projectPath, sessionId },
      );
    }
    this.microtasks = null;
    await this.ensureStateLoaded();
  }

  async recordTaskStarted(task, extras = {}) {
    await this.enqueue(async () => {
      await this.ensureStateLoaded();
      this.currentTaskId = task?.id != null ? String(task.id) : null;
      this.currentTaskTitle = task?.title || null;
      this.stage = task?.stage || extras.stage || null;
      this.currentObjective = task?.title || this.currentObjective;
      this.applyMicrotaskHeader();
      await this.persistMicrotasks('task_started');
      await this.appendLedger({
        type: 'task_started',
        taskId: this.currentTaskId,
        taskTitle: this.currentTaskTitle,
        stage: this.stage,
        objective: this.currentObjective,
      });
      await this.refreshSummaries();
    });
  }

  async recordTaskCompleted(task, extras = {}) {
    await this.enqueue(async () => {
      await this.ensureStateLoaded();
      const completedTaskId = task?.id != null ? String(task.id) : null;
      const completedTaskTitle = task?.title || null;
      const stage = task?.stage || extras.stage || this.stage || null;
      const summaryText = compactWhitespace(extras.summary || completedTaskTitle || '');
      this.currentTaskId = null;
      this.currentTaskTitle = null;
      this.stage = stage;
      this.applyMicrotaskHeader();
      await this.persistMicrotasks('task_completed');
      await this.appendLedger({
        type: 'task_completed',
        taskId: completedTaskId,
        taskTitle: completedTaskTitle,
        stage,
        summary: summaryText || null,
      });
      if (summaryText) {
        await this.recordObservedFinding(summaryText, 'task_completion');
      }
      await this.refreshSummaries();
    });
  }

  async recordRunLifecycle(type, extras = {}) {
    await this.enqueue(async () => {
      await this.ensureStateLoaded();
      if (extras.currentObjective) {
        this.currentObjective = extras.currentObjective;
      }
      if (extras.stage) {
        this.stage = extras.stage;
      }
      this.applyMicrotaskHeader();
      await this.persistMicrotasks(type);
      await this.appendLedger({
        type,
        summary: compactWhitespace(extras.summary || ''),
        stage: extras.stage || this.stage || null,
      });
      await this.refreshSummaries();
    });
  }

  async handlePayload(payload) {
    const signals = normalizeExecutionSignals(payload);
    if (signals.length === 0) {
      return;
    }
    await this.enqueue(async () => {
      await this.ensureStateLoaded();
      let shouldRefresh = false;
      for (const signal of signals) {
        shouldRefresh = (await this.processSignal(signal)) || shouldRefresh;
      }
      if (shouldRefresh) {
        await this.refreshSummaries();
      }
    });
  }

  async processSignal(signal) {
    switch (signal.type) {
      case 'session_created':
        if (signal.provider) {
          this.provider = signal.provider;
        }
        if (signal.sessionId) {
          await this.setSessionId(signal.sessionId);
        }
        return false;
      case 'todo_snapshot':
        await this.applyTodoSnapshot(signal);
        return true;
      case 'tool_use':
        await this.handleToolUse(signal);
        return false;
      case 'tool_result':
        return this.handleToolResult(signal);
      case 'artifact_created':
        return this.recordArtifactCreated(signal.path, {
          kind: signal.kind || 'artifact',
          source: signal.source || null,
        });
      case 'assistant_text':
        return this.handleAssistantText(signal);
      default:
        return SUMMARY_RELEVANT_SIGNAL_TYPES.has(signal.type);
    }
  }

  async handleToolUse(signal) {
    const toolCallId = signal.toolCallId || `tool-${Date.now()}`;
    this.pendingToolUses.set(toolCallId, signal);
    await this.appendLedger({
      type: 'tool_use',
      toolCallId,
      toolName: signal.toolName,
      toolInput: signal.toolInput || {},
      parentToolUseId: signal.parentToolUseId || null,
    });

    const normalizedToolName = String(signal.toolName || '').trim().toLowerCase();
    if (!this.shouldCreateImplicitMicrotask(normalizedToolName)) {
      return;
    }
    const title = buildImplicitMicrotaskTitle(signal.toolName, signal.toolInput);
    if (!title) {
      return;
    }
    const implicitId = `implicit:${toolCallId}`;
    const existing = this.microtasks.items.find((item) => item.id === implicitId);
    if (!existing) {
      this.microtasks.items.push({
        id: implicitId,
        title,
        status: 'in_progress',
        source: 'heuristic',
        parentTaskId: this.currentTaskId,
        stage: this.stage,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        artifactPaths: [],
        evidenceIds: [],
      });
      this.applyMicrotaskHeader();
      await this.persistMicrotasks('implicit_tool_use');
    }
  }

  async handleToolResult(signal) {
    const toolCallId = signal.toolCallId || null;
    const pending = toolCallId ? this.pendingToolUses.get(toolCallId) : null;
    await this.appendLedger({
      type: 'tool_result',
      toolCallId,
      output: signal.output || '',
      isError: Boolean(signal.isError),
    });
    let wroteFinding = false;
    if (!signal.isError) {
      for (const finding of extractStructuredStatEntries(signal.output || '')) {
        const findingWritten = await this.recordConfirmedFinding(finding, pending?.toolName || 'tool_result');
        wroteFinding = findingWritten || wroteFinding;
      }
    }
    if (pending && toolCallId) {
      this.pendingToolUses.delete(toolCallId);
      const artifactPaths = !signal.isError
        ? extractArtifactPathsFromToolInput(pending.toolName, pending.toolInput)
        : [];
      for (const artifactPath of artifactPaths) {
        const artifactWritten = await this.recordArtifactCreated(artifactPath, {
          kind: 'tool_output',
          source: pending.toolName,
        });
        wroteFinding = artifactWritten || wroteFinding;
      }
      const implicitId = `implicit:${toolCallId}`;
      const implicitItem = this.microtasks.items.find((item) => item.id === implicitId);
      if (implicitItem && !signal.isError) {
        implicitItem.status = 'completed';
        implicitItem.updatedAt = new Date().toISOString();
        implicitItem.artifactPaths = dedupe([
          ...(implicitItem.artifactPaths || []),
          ...artifactPaths,
        ]);
        this.applyMicrotaskHeader();
        await this.persistMicrotasks('implicit_tool_result');
        return true;
      }
      return artifactPaths.length > 0 || wroteFinding;
    }
    return wroteFinding;
  }

  async handleAssistantText(signal) {
    const text = compactWhitespace(signal.text || '');
    if (!text || text.length < 24) {
      return false;
    }
    const noteSummary = text.slice(0, 800);
    const noteKey = buildObservedKey('assistant_note', noteSummary);
    if (!this.observedKeys.has(noteKey)) {
      this.observedKeys.add(noteKey);
      await this.appendLedger({
        type: 'assistant_note',
        summary: noteSummary,
        confirmation: 'observed',
      });
    }

    let wroteFinding = false;
    for (const finding of signal.findings || []) {
      const findingWritten = await this.recordObservedFinding(finding, 'assistant_text');
      wroteFinding = findingWritten || wroteFinding;
    }
    return wroteFinding || noteSummary.length > 120;
  }

  async applyTodoSnapshot(signal) {
    const previousItems = Array.isArray(this.microtasks.items) ? this.microtasks.items : [];
    const mergedItems = [];
    for (const incomingItem of signal.todos || []) {
      const previous = previousItems.find(
        (item) => item.id === incomingItem.id || item.title === incomingItem.title,
      );
      mergedItems.push({
        id: incomingItem.id,
        title: incomingItem.title,
        status: incomingItem.status,
        source: previous?.source || signal.source || 'TodoWrite',
        parentTaskId: previous?.parentTaskId || this.currentTaskId,
        stage: previous?.stage || this.stage,
        createdAt: previous?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        artifactPaths: previous?.artifactPaths || [],
        evidenceIds: previous?.evidenceIds || [],
      });
    }
    this.microtasks.items = mergedItems;
    this.microtasks.source = signal.source || 'TodoWrite';
    this.applyMicrotaskHeader();
    await this.persistMicrotasks('todo_snapshot');
    await this.appendLedger({
      type: 'microtasks_snapshot',
      source: signal.source || 'TodoWrite',
      itemCount: mergedItems.length,
      items: mergedItems.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
      })),
    });
  }

  async recordObservedFinding(summary, source) {
    return this.recordFinding(summary, source, 'observed');
  }

  async recordConfirmedFinding(finding, source) {
    return this.recordFinding(finding, source, 'confirmed');
  }

  async recordFinding(finding, source, confirmation = 'observed') {
    const summary = typeof finding === 'string' ? finding : finding?.summary;
    const normalized = compactWhitespace(summary);
    if (!normalized) {
      return false;
    }
    const findingKey = buildObservedKey(`finding_recorded:${confirmation}`, normalized);
    if (this.observedKeys.has(findingKey)) {
      return false;
    }
    this.observedKeys.add(findingKey);
    const payload = {
      type: 'finding_recorded',
      summary: normalized,
      source,
      confirmation,
    };
    if (finding?.sourceFile) {
      payload.sourceFile = finding.sourceFile;
    }
    await this.appendLedger(payload);
    if (finding && typeof finding === 'object' && (finding.metric || finding.value || finding.pValue || finding.ci)) {
      await this.appendLedger({
        type: 'stat_result',
        summary: normalized,
        metric: finding.metric || null,
        value: finding.value || null,
        pValue: finding.pValue || null,
        ci: finding.ci || null,
        source,
        sourceFile: finding.sourceFile || null,
      });
    }
    return true;
  }

  async recordArtifactCreated(artifactPath, metadata = {}) {
    if (!artifactPath) {
      return false;
    }
    await this.appendLedger({
      type: 'artifact_created',
      path: artifactPath,
      kind: metadata.kind || 'artifact',
      source: metadata.source || null,
    });
    let wroteFinding = false;
    for (const finding of await extractConfirmedFindingsFromArtifact(this.projectPath, artifactPath)) {
      const findingWritten = await this.recordConfirmedFinding(finding, metadata.source || 'artifact_created');
      wroteFinding = findingWritten || wroteFinding;
    }
    if (isPipelineControlFilePath(artifactPath) && this.onPipelineStateChanged) {
      await this.onPipelineStateChanged({
        type: 'pipeline_control_file_touched',
        path: artifactPath,
      });
    }
    return true;
  }

  shouldCreateImplicitMicrotask(normalizedToolName) {
    if (!IMPLICIT_MICROTASK_ALLOWED_TOOLS.has(normalizedToolName)) {
      return false;
    }
    const hasExplicitMicrotasks = Array.isArray(this.microtasks?.items)
      && this.microtasks.items.some((item) => item.source !== 'heuristic');
    return !hasExplicitMicrotasks;
  }

  async appendLedger(event) {
    const paths = await ensureExecutionMemoryDir(this.getScopeRef());
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      scope: this.scope,
      sessionId: this.sessionId || null,
      runId: this.runId || null,
      provider: this.provider || null,
      currentTaskId: this.currentTaskId || null,
      currentTaskTitle: this.currentTaskTitle || null,
      stage: this.stage || null,
      ...event,
    };
    await appendJsonl(paths.ledgerPath, entry);
    return entry;
  }

  async persistMicrotasks(reason) {
    this.applyMicrotaskHeader();
    const paths = await ensureExecutionMemoryDir(this.getScopeRef());
    this.microtasks.updatedAt = new Date().toISOString();
    this.microtasks.lastReason = reason || null;
    await writeJson(paths.microtasksPath, this.microtasks);
  }

  async refreshSummaries() {
    const snapshot = await refreshExecutionMemorySummaries(this.getScopeRef(), {
      ledgerLimit: 400,
    });
    let taskSyncResult = null;
    try {
      taskSyncResult = await syncExecutionMemoryToTasks(this.getScopeRef(), { snapshot });
    } catch (error) {
      console.warn('[ExecutionMemory] Failed to sync execution state to tasks.json:', error?.message || error);
    }
    let briefSyncResult = null;
    try {
      briefSyncResult = await syncConfirmedExecutionMemoryToResearchBrief(this.getScopeRef(), { snapshot });
    } catch (error) {
      console.warn('[ExecutionMemory] Failed to sync confirmed results to research_brief.json:', error?.message || error);
    }
    if (this.onPipelineStateChanged && (taskSyncResult?.synced || briefSyncResult?.synced)) {
      await this.onPipelineStateChanged({
        type: 'execution_memory_synced',
        briefSync: briefSyncResult?.synced ? briefSyncResult : null,
        taskSync: taskSyncResult?.synced ? taskSyncResult : null,
        stage: briefSyncResult?.stage || this.stage || null,
      });
    }
  }

  async ensureStateLoaded() {
    if (this.microtasks) {
      return this.microtasks;
    }
    if (!this.projectPath) {
      this.microtasks = createEmptyMicrotaskState(this.getScopeRef());
      return this.microtasks;
    }
    const paths = await ensureExecutionMemoryDir(this.getScopeRef());
    const existing = await readJsonIfExists(paths.microtasksPath, null);
    this.microtasks = existing || createEmptyMicrotaskState(this.getScopeRef());
    if (this.currentObjective === undefined && this.microtasks.currentObjective != null) {
      this.currentObjective = this.microtasks.currentObjective;
    }
    if (this.currentTaskId === undefined && this.microtasks.currentTaskId != null) {
      this.currentTaskId = this.microtasks.currentTaskId;
    }
    if (this.currentTaskTitle === undefined && this.microtasks.currentTaskTitle != null) {
      this.currentTaskTitle = this.microtasks.currentTaskTitle;
    }
    if (this.stage === undefined && this.microtasks.stage != null) {
      this.stage = this.microtasks.stage;
    }
    this.applyMicrotaskHeader();
    return this.microtasks;
  }

  applyMicrotaskHeader() {
    if (!this.microtasks) {
      return;
    }
    this.microtasks.scope = this.scope;
    this.microtasks.sessionId = this.scope === 'session' ? this.sessionId : null;
    this.microtasks.runId = this.scope === 'run' ? this.runId : null;
    this.microtasks.provider = this.provider || this.microtasks.provider || null;
    if (this.currentObjective !== undefined) {
      this.microtasks.currentObjective = this.currentObjective;
    } else if (!Object.prototype.hasOwnProperty.call(this.microtasks, 'currentObjective')) {
      this.microtasks.currentObjective = null;
    }
    if (this.currentTaskId !== undefined) {
      this.microtasks.currentTaskId = this.currentTaskId;
    } else if (!Object.prototype.hasOwnProperty.call(this.microtasks, 'currentTaskId')) {
      this.microtasks.currentTaskId = null;
    }
    if (this.currentTaskTitle !== undefined) {
      this.microtasks.currentTaskTitle = this.currentTaskTitle;
    } else if (!Object.prototype.hasOwnProperty.call(this.microtasks, 'currentTaskTitle')) {
      this.microtasks.currentTaskTitle = null;
    }
    if (this.stage !== undefined) {
      this.microtasks.stage = this.stage;
    } else if (!Object.prototype.hasOwnProperty.call(this.microtasks, 'stage')) {
      this.microtasks.stage = null;
    }
    if (!Array.isArray(this.microtasks.items)) {
      this.microtasks.items = [];
    }
  }

  async enqueue(work) {
    this.queue = this.queue.then(work, work);
    return this.queue;
  }
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildObservedKey(type, value) {
  return `${type}:${compactWhitespace(value).toLowerCase()}`;
}

function dedupe(values) {
  const seen = new Set();
  const deduped = [];
  for (const value of values || []) {
    const normalized = compactWhitespace(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function isPipelineControlFilePath(filePath) {
  const normalized = compactWhitespace(filePath).replace(/\\/g, '/').toLowerCase();
  return normalized === '.pipeline/tasks/tasks.json'
    || normalized === '.pipeline/docs/research_brief.json'
    || normalized === 'instance.json'
    || normalized === '.pipeline/config.json';
}

export {
  createExecutionMemoryTracker,
  wrapWriterWithExecutionMemory,
};
