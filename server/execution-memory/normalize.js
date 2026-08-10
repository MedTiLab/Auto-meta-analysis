const TODO_TOOL_NAMES = new Set(['todowrite', 'write_todos', 'todo_write']);
const ACTIONABLE_TOOL_NAMES = new Set([
  'bash',
  'edit',
  'multiedit',
  'write',
  'writefile',
  'replace',
  'notebookedit',
  'command_execution',
  'mcp_tool_call',
  'websearch',
  'webfetch',
]);
const FILE_PATH_KEYS = ['file_path', 'path', 'target_file', 'targetPath', 'output_path'];
const STAT_LINE_PATTERN = /\b(?:p\s*[<=>]\s*0?\.\d+|hr\b|hazard ratio|or\b|odds ratio|rr\b|risk ratio|auc\b|auroc\b|f1\b|accuracy\b|sensitivity\b|specificity\b|ci\b|confidence interval|%\b)/i;

function normalizeExecutionSignals(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (payload.type === 'session-created' && payload.sessionId) {
    return [{
      type: 'session_created',
      sessionId: payload.sessionId,
      previousSessionId: payload.previousSessionId || null,
      provider: payload.provider || null,
    }];
  }

  if (payload.type === 'claude-response') {
    return normalizeStructuredProviderMessage(payload.data);
  }
  return [];
}

function normalizeStructuredProviderMessage(data) {
  if (!data || typeof data !== 'object') {
    return [];
  }

  if (data.type === 'structured_turn' || data.type === 'structured_result') {
    return normalizeMessageEnvelope(data.message);
  }

  if (data.type === 'assistant' || data.role === 'assistant' || data.role === 'user') {
    return normalizeMessageEnvelope(data.message || data);
  }

  return [];
}

function normalizeMessageEnvelope(message) {
  if (!message || typeof message !== 'object') {
    return [];
  }
  const role = message.role || null;
  const content = Array.isArray(message.content)
    ? message.content
    : typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : [];
  const signals = [];
  let assistantText = [];

  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string' && role === 'assistant') {
      assistantText.push(part.text);
      continue;
    }
    if (part.type === 'tool_use' && role === 'assistant') {
      const toolName = String(part.name || '').trim();
      const normalizedToolName = toolName.toLowerCase();
      if (TODO_TOOL_NAMES.has(normalizedToolName) && Array.isArray(part.input?.todos)) {
        signals.push({
          type: 'todo_snapshot',
          source: toolName || 'TodoWrite',
          todos: normalizeTodoItems(part.input.todos),
        });
      } else {
        signals.push({
          type: 'tool_use',
          toolCallId: part.id || null,
          parentToolUseId: part.parentToolUseId || message.parentToolUseId || null,
          toolName: toolName || 'unknown',
          toolInput: part.input && typeof part.input === 'object' ? part.input : {},
        });
      }
      continue;
    }
    if (part.type === 'tool_result' && role !== 'assistant') {
      signals.push({
        type: 'tool_result',
        toolCallId: part.tool_use_id || part.toolUseId || null,
        output: normalizeToolResultContent(part.content),
        isError: Boolean(part.is_error),
      });
    }
  }

  const text = compactWhitespace(assistantText.join('\n'));
  if (text) {
    signals.push({
      type: 'assistant_text',
      text,
      findings: extractStatFindings(text),
    });
  }

  return signals;
}

function normalizeTodoItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const title = compactWhitespace(item.title || item.content || item.description || '');
      if (!title) {
        return null;
      }
      return {
        id: String(item.id || `todo-${index + 1}`),
        title,
        status: normalizeTodoStatus(item.status),
      };
    })
    .filter(Boolean);
}

function normalizeTodoStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) {
    return 'pending';
  }
  if (raw === 'completed' || raw === 'done' || raw === 'complete') {
    return 'completed';
  }
  if (raw === 'in_progress' || raw === 'in-progress' || raw === 'active') {
    return 'in_progress';
  }
  return 'pending';
}

function normalizeToolResultContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (typeof entry?.text === 'string') {
          return entry.text;
        }
        return JSON.stringify(entry);
      })
      .join('\n');
  }
  if (content == null) {
    return '';
  }
  return JSON.stringify(content);
}

function extractArtifactPathsFromToolInput(toolName, toolInput) {
  const normalizedToolName = String(toolName || '').trim().toLowerCase();
  if (!ACTIONABLE_TOOL_NAMES.has(normalizedToolName)) {
    return [];
  }
  const paths = new Set();

  for (const key of FILE_PATH_KEYS) {
    const value = toolInput?.[key];
    if (typeof value === 'string' && value.trim()) {
      paths.add(value.trim());
    }
  }

  const filePath = typeof toolInput?.filePath === 'string' ? toolInput.filePath.trim() : null;
  if (filePath) {
    paths.add(filePath);
  }

  if (Array.isArray(toolInput?.files)) {
    for (const entry of toolInput.files) {
      if (typeof entry === 'string' && entry.trim()) {
        paths.add(entry.trim());
      }
    }
  }

  return Array.from(paths);
}

function buildImplicitMicrotaskTitle(toolName, toolInput = {}) {
  const normalizedToolName = String(toolName || '').trim();
  if (!normalizedToolName) {
    return null;
  }
  if (/bash/i.test(normalizedToolName)) {
    const command = compactWhitespace(toolInput?.command || toolInput?.cmd || '');
    return command ? `Run ${command}` : 'Run shell command';
  }
  const fileTarget = extractArtifactPathsFromToolInput(toolName, toolInput)[0] || null;
  if (fileTarget) {
    return `${normalizedToolName} ${fileTarget}`;
  }
  if (/websearch/i.test(normalizedToolName)) {
    const query = compactWhitespace(toolInput?.query || '');
    return query ? `Search ${query}` : 'Run web search';
  }
  return normalizedToolName;
}

function extractStatFindings(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  const findings = [];
  const seen = new Set();
  const candidates = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .map((entry) => compactWhitespace(entry))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.length < 20 || candidate.length > 320) {
      continue;
    }
    if (!STAT_LINE_PATTERN.test(candidate)) {
      continue;
    }
    const key = candidate.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    findings.push(candidate);
  }

  return findings;
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export {
  buildImplicitMicrotaskTitle,
  extractArtifactPathsFromToolInput,
  extractStatFindings,
  normalizeExecutionSignals,
  normalizeTodoItems,
  normalizeTodoStatus,
};
