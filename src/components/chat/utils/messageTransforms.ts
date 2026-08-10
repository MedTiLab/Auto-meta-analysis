import type { AttachedPrompt, ChatAttachment, ChatMessage } from '../types/types';
import {
  buildAssistantMessages,
  decodeHtmlEntities,
  unescapeWithMathProtection,
} from './chatFormatting';
import { stripInternalContextPrefix } from '../../../utils/sessionFormatting';

export interface DiffLine {
  type: 'added' | 'removed';
  content: string;
  lineNum: number;
}

export type DiffCalculator = (oldStr: string, newStr: string) => DiffLine[];

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const FILE_NOTE_HEADER = '[Files available at the following paths]';
const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
]);
const PDF_ATTACHMENT_EXTENSION = '.pdf';
const GUIDED_PROMPT_PATTERNS = [
  /^请协助我完成“(?<scenario>[^”]+)”。[\s\S]*?我的任务：\s*/u,
  /^Please help me with "(?<scenario>[^"]+)"\.[\s\S]*?My task:\s*/u,
  /^请协助我完成“(?<scenario>[^”]+)”。[^。]*?技能：(?<skills>.+?)。\s*/u,
  /^Please help me with "(?<scenario>[^"]+)"\.[^.]*?skills(?: when helpful)?: (?<skills>.+?)\.\s*/u,
];

const getAttachmentNameFromPath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] || filePath;
};

const getAttachmentKindFromPath = (filePath: string): ChatAttachment['kind'] => {
  const normalized = filePath.toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  const extension = lastDot >= 0 ? normalized.slice(lastDot) : '';

  if (IMAGE_ATTACHMENT_EXTENSIONS.has(extension)) {
    return 'image';
  }

  if (extension === PDF_ATTACHMENT_EXTENSION) {
    return 'pdf';
  }

  return 'file';
};

const extractInjectedAttachments = (value: string): { text: string; attachments: ChatAttachment[] } => {
  if (typeof value !== 'string' || !value.includes(FILE_NOTE_HEADER)) {
    return { text: value, attachments: [] };
  }

  const match = value.match(
    /(?:\r?\n){2}\[Files available at the following paths\]\r?\n(?<paths>(?:\d+\.\s+.+(?:\r?\n|$))+)\s*$/u,
  );

  if (!match?.groups?.paths) {
    return { text: value, attachments: [] };
  }

  const attachments = match.groups.paths
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/^\d+\.\s+(?<path>.+)$/u)?.groups?.path?.trim() || '')
    .filter(Boolean)
    .map((filePath) => ({
      name: getAttachmentNameFromPath(filePath),
      kind: getAttachmentKindFromPath(filePath),
      path: filePath,
    }));

  return {
    text: value.slice(0, match.index).trimEnd(),
    attachments,
  };
};

const extractInjectedGuidedPrompt = (
  value: string,
): { text: string; attachedPrompt?: AttachedPrompt } => {
  if (typeof value !== 'string' || !value.trim()) {
    return { text: value };
  }

  for (const pattern of GUIDED_PROMPT_PATTERNS) {
    const match = value.match(pattern);
    const scenarioTitle = match?.groups?.scenario?.trim();
    if (!match || !scenarioTitle) {
      continue;
    }

    return {
      text: value.slice(match[0].length).trimStart(),
      attachedPrompt: {
        scenarioId: `replayed-guided-prompt:${scenarioTitle}`,
        scenarioIcon: '🧭',
        scenarioTitle,
        promptText: match[0].trim(),
      },
    };
  }

  return { text: value };
};

const extractEmbeddedUserRequest = (rawText: string): string => {
  if (typeof rawText !== 'string' || !rawText) {
    return '';
  }

  const match = rawText.match(/User request:\s*([\s\S]*?)\s*$/i);
  return match?.[1]?.trim() || '';
};

const normalizeVisibleUserMessage = (rawText: string) => {
  const strippedText = stripInternalContextPrefix(rawText, false) || '';
  const text = strippedText || extractEmbeddedUserRequest(rawText);
  const shouldSkip =
    !rawText.trim() ||
    rawText.startsWith('<system-reminder>') ||
    text.startsWith('<system-reminder>') ||
    rawText.startsWith('Caveat:') ||
    text.startsWith('Caveat:') ||
    rawText.startsWith('This session is being continued from a previous') ||
    text.startsWith('This session is being continued from a previous') ||
    rawText.startsWith('[Request interrupted') ||
    text.startsWith('[Request interrupted');

  const isSkillRelated = rawText.includes('Base directory for this skill:');
  const visibleText = isSkillRelated ? (text || rawText.trim()) : text;
  const { text: textWithoutFileNote, attachments } = extractInjectedAttachments(visibleText);
  const { text: normalizedVisibleText, attachedPrompt } = extractInjectedGuidedPrompt(textWithoutFileNote);

  return {
    attachments,
    attachedPrompt,
    hasVisibleMetadata: attachments.length > 0 || Boolean(attachedPrompt),
    isSkillRelated,
    normalizedVisibleText,
    shouldSkip,
  };
};

/**
 * Parse answers from AskUserQuestion tool_result content.
 * Format: 'User has answered your questions: "q1"="a1", "q2"="a2". You can now...'
 */
export const parseAskUserAnswers = (resultContent: string): Record<string, string> | null => {
  if (!resultContent || !resultContent.includes('User has answered your questions:')) {
    return null;
  }
  const answers: Record<string, string> = {};
  // Match "question"="answer" pairs
  const regex = /"([^"]+)"="([^"]+)"/g;
  let match;
  while ((match = regex.exec(resultContent)) !== null) {
    answers[match[1]] = match[2];
  }
  return Object.keys(answers).length > 0 ? answers : null;
};

/**
 * Merge parsed answers into a toolInput string (JSON) for AskUserQuestion.
 */
export const mergeAnswersIntoToolInput = (toolInput: string, answers: Record<string, string>): string => {
  try {
    const parsed = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
    return JSON.stringify({ ...parsed, answers }, null, 2);
  } catch {
    return toolInput;
  }
};

const normalizeToolInput = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toAbsolutePath = (projectPath: string, filePath?: string) => {
  if (!filePath) {
    return filePath;
  }
  return filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`;
};

export const calculateDiff = (oldStr: string, newStr: string): DiffLine[] => {
  const oldLines = (oldStr ?? '').split('\n');
  const newLines = (newStr ?? '').split('\n');

  // Use LCS alignment so insertions/deletions don't cascade into a full-file "changed" diff.
  const lcsTable: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        lcsTable[oldIndex][newIndex] = lcsTable[oldIndex + 1][newIndex + 1] + 1;
      } else {
        lcsTable[oldIndex][newIndex] = Math.max(
          lcsTable[oldIndex + 1][newIndex],
          lcsTable[oldIndex][newIndex + 1],
        );
      }
    }
  }

  const diffLines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];

    if (oldLine === newLine) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (lcsTable[oldIndex + 1][newIndex] >= lcsTable[oldIndex][newIndex + 1]) {
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      oldIndex += 1;
      continue;
    }

    diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
    newIndex += 1;
  }

  while (oldIndex < oldLines.length) {
    diffLines.push({ type: 'removed', content: oldLines[oldIndex], lineNum: oldIndex + 1 });
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    diffLines.push({ type: 'added', content: newLines[newIndex], lineNum: newIndex + 1 });
    newIndex += 1;
  }

  return diffLines;
};

export const createCachedDiffCalculator = (): DiffCalculator => {
  const cache = new Map<string, DiffLine[]>();

  return (oldStr: string, newStr: string) => {
    const key = JSON.stringify([oldStr, newStr]);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const calculated = calculateDiff(oldStr, newStr);
    cache.set(key, calculated);
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
      }
    }
    return calculated;
  };
};

export const convertSessionMessages = (rawMessages: any[]): ChatMessage[] => {
  const converted: ChatMessage[] = [];
  const toolResults = new Map<
    string,
    { content: unknown; isError: boolean; timestamp: Date; toolUseResult: unknown; subagentTools?: unknown[] }
  >();

  // Normalized helper for persisted Claude message envelopes
  const getRole = (msg: any) => msg.role || msg.message?.role;
  const getContent = (msg: any) => msg.content || msg.message?.content;
  const findSubagentContainer = (parentToolUseId: string) => {
    for (let index = converted.length - 1; index >= 0; index -= 1) {
      const candidate = converted[index];
      if (!candidate.isSubagentContainer) continue;
      if (candidate.toolId === parentToolUseId || candidate.toolCallId === parentToolUseId) {
        return candidate;
      }
    }
    return null;
  };

  rawMessages.forEach((message) => {
    const role = getRole(message);
    const content = getContent(message);

    if (role === 'user' && Array.isArray(content)) {
      content.forEach((part: any) => {
        if (part.type !== 'tool_result') {
          return;
        }
        toolResults.set(part.tool_use_id, {
          content: part.content,
          isError: Boolean(part.is_error),
          timestamp: new Date(message.timestamp || Date.now()),
          toolUseResult: message.toolUseResult || null,
          subagentTools: message.subagentTools,
        });
      });
    }
  });

  rawMessages.forEach((message) => {
    const role = getRole(message);
    let content = getContent(message);

    if (role === 'user' && content) {
      let rawText = '';
      if (Array.isArray(content)) {
        const textParts: string[] = [];
        content.forEach((part: any) => {
          if (part.type === 'text') {
            textParts.push(decodeHtmlEntities(part.text));
          }
        });
        rawText = textParts.join('\n');
      } else if (typeof content === 'string') {
        rawText = decodeHtmlEntities(content);
      } else {
        rawText = decodeHtmlEntities(String(content));
      }
      const {
        attachments,
        attachedPrompt,
        hasVisibleMetadata,
        isSkillRelated,
        normalizedVisibleText,
        shouldSkip,
      } = normalizeVisibleUserMessage(rawText);

      // Check if this user message also contains tool_result parts
      const hasToolResults = Array.isArray(content) &&
        content.some((part: any) => part.type === 'tool_result');

      if (shouldSkip) {
        return;
      }

      // Parse <task-notification> blocks
      const taskNotifRegex = /<task-notification>\s*<task-id>([^<]*)<\/task-id>\s*<output-file>([^<]*)<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/g;
      const taskNotifMatch = taskNotifRegex.exec(rawText);
      if (taskNotifMatch) {
        const taskId = taskNotifMatch[1]?.trim() || null;
        const outputFile = taskNotifMatch[2]?.trim() || null;
        const status = taskNotifMatch[3]?.trim() || 'completed';
        const summary = taskNotifMatch[4]?.trim() || 'Background task finished';
        converted.push({
          type: 'assistant',
          content: summary,
          timestamp: message.timestamp || new Date().toISOString(),
          isTaskNotification: true,
          taskStatus: status,
          taskId,
          taskOutputFile: outputFile,
        });
      } else if (isSkillRelated) {
        if (!normalizedVisibleText && !hasVisibleMetadata) {
          return;
        }
        const last = converted[converted.length - 1];
        if (
          last?.type === 'user' &&
          String(last.content || '') === unescapeWithMathProtection(normalizedVisibleText) &&
          !last.attachments?.length &&
          !last.attachedPrompt &&
          !hasVisibleMetadata
        ) {
          return;
        }
        converted.push({
          type: 'user',
          content: unescapeWithMathProtection(normalizedVisibleText),
          timestamp: message.timestamp || new Date().toISOString(),
          isSkillContent: true,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(attachedPrompt ? { attachedPrompt } : {}),
        });
      } else {
        if (!normalizedVisibleText && !hasVisibleMetadata) {
          return;
        }
        const last = converted[converted.length - 1];
        if (
          last?.type === 'user' &&
          String(last.content || '') === unescapeWithMathProtection(normalizedVisibleText) &&
          !last.attachments?.length &&
          !last.attachedPrompt &&
          !hasVisibleMetadata
        ) {
          return;
        }
        converted.push({
          type: 'user',
          content: unescapeWithMathProtection(normalizedVisibleText),
          timestamp: message.timestamp || new Date().toISOString(),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(attachedPrompt ? { attachedPrompt } : {}),
        });
      }
      return;
    }

    if (message.type === 'thinking' && content) {
      converted.push({
        type: 'assistant',
        content: unescapeWithMathProtection(typeof content === 'string' ? content : JSON.stringify(content)),
        timestamp: message.timestamp || new Date().toISOString(),
        isThinking: true,
      });
      return;
    }

    if (message.type === 'tool_use' && message.toolName) {
      const parentToolUseId = message.parentToolUseId || message.parent_tool_use_id;
      const toolCallId = message.toolCallId || message.toolId;
      if (parentToolUseId) {
        const parent = findSubagentContainer(String(parentToolUseId));
        if (parent) {
          const existingChildren = parent.subagentState?.childTools || [];
          parent.subagentState = {
            childTools: [
              ...existingChildren,
              {
                toolId: String(toolCallId || `tool_${existingChildren.length + 1}`),
                toolName: message.toolName,
                toolInput: normalizeToolInput(message.toolInput),
                toolResult: null,
                timestamp: new Date(message.timestamp || Date.now()),
              },
            ],
            currentToolIndex: existingChildren.length,
            isComplete: false,
          };
          return;
        }
      }

      converted.push({
        type: 'assistant',
        content: '',
        timestamp: message.timestamp || new Date().toISOString(),
        isToolUse: true,
        toolName: message.toolName,
        toolInput: normalizeToolInput(message.toolInput),
        toolId: toolCallId,
        toolCallId: toolCallId,
      });
      return;
    }

    if (message.type === 'tool_result') {
      const parentToolUseId = message.parentToolUseId || message.parent_tool_use_id;
      if (parentToolUseId && message.toolCallId) {
        const parent = findSubagentContainer(String(parentToolUseId));
        if (parent?.subagentState?.childTools) {
          const updatedChildren = parent.subagentState.childTools.map((child) => {
            if (child.toolId !== message.toolCallId) return child;
            return {
              ...child,
              toolResult: {
                content: message.output || '',
                isError: false,
              },
            };
          });
          parent.subagentState = {
            ...parent.subagentState,
            childTools: updatedChildren,
            currentToolIndex: Math.max(parent.subagentState.currentToolIndex, updatedChildren.length - 1),
            isComplete: updatedChildren.every((child) => Boolean(child.toolResult)),
          };
          return;
        }
      }

      for (let index = converted.length - 1; index >= 0; index -= 1) {
        const convertedMessage = converted[index];
        if (!convertedMessage.isToolUse || convertedMessage.toolResult) {
          continue;
        }
        if (!message.toolCallId || convertedMessage.toolCallId === message.toolCallId) {
          convertedMessage.toolResult = {
            content: message.output || '',
            isError: false,
          };
          if (convertedMessage.toolName === 'AskUserQuestion' && message.output) {
            const parsedAnswers = parseAskUserAnswers(String(message.output));
            if (parsedAnswers) {
              convertedMessage.toolInput = mergeAnswersIntoToolInput(
                convertedMessage.toolInput as string,
                parsedAnswers,
              );
            }
          }
          break;
        }
      }
      return;
    }

    if (role === 'assistant' && content) {
      if (Array.isArray(content)) {
        content.forEach((part: any) => {
          if (part.type === 'thinking' || part.type === 'reasoning') {
            const thinkingText = part.thinking || part.reasoning || part.text || '';
            if (thinkingText.trim()) {
              converted.push({
                type: 'assistant',
                content: unescapeWithMathProtection(thinkingText),
                timestamp: message.timestamp || new Date().toISOString(),
                isThinking: true,
              });
            }
            return;
          }

          if (part.type === 'text') {
            let text = part.text;
            if (typeof text === 'string') {
              text = unescapeWithMathProtection(text);
            }
            const ts = message.timestamp || new Date().toISOString();
            converted.push(...buildAssistantMessages(typeof text === 'string' ? text : String(text), ts));
            return;
          }

          if (part.type === 'tool_use') {
            const toolResult = toolResults.get(part.id);
            const isSubagentContainer = part.name === 'Task';

            const childTools: import('../types/types').SubagentChildTool[] = [];
            if (isSubagentContainer && toolResult?.subagentTools && Array.isArray(toolResult.subagentTools)) {
              for (const tool of toolResult.subagentTools as any[]) {
                childTools.push({
                  toolId: tool.toolId,
                  toolName: tool.toolName,
                  toolInput: tool.toolInput,
                  toolResult: tool.toolResult || null,
                  timestamp: new Date(tool.timestamp || Date.now()),
                });
              }
            }

            let finalToolInput = normalizeToolInput(part.input);
            if (part.name === 'AskUserQuestion' && toolResult) {
              const resultStr = typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content);
              const parsedAnswers = parseAskUserAnswers(resultStr);
              if (parsedAnswers) {
                finalToolInput = mergeAnswersIntoToolInput(finalToolInput, parsedAnswers);
              }
            }

            converted.push({
              type: 'assistant',
              content: '',
              timestamp: message.timestamp || new Date().toISOString(),
              isToolUse: true,
              toolName: part.name,
              toolInput: finalToolInput,
              toolId: part.id,
              toolResult: toolResult
                ? {
                    content:
                      typeof toolResult.content === 'string'
                        ? toolResult.content
                        : JSON.stringify(toolResult.content),
                    isError: toolResult.isError,
                    toolUseResult: toolResult.toolUseResult,
                  }
                : null,
              toolError: toolResult?.isError || false,
              toolResultTimestamp: toolResult?.timestamp || new Date(),
              isSubagentContainer,
              subagentState: isSubagentContainer
                ? {
                    childTools,
                    currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
                    isComplete: Boolean(toolResult),
                  }
                : undefined,
            });
          }
        });
        return;
      }

      if (typeof content === 'string') {
        const normalizedContent = unescapeWithMathProtection(content);
        const ts = message.timestamp || new Date().toISOString();
        converted.push(...buildAssistantMessages(normalizedContent, ts));
      }
    }
  });

  return converted;
};
