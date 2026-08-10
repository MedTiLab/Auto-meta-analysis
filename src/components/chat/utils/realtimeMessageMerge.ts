import type { ChatMessage } from '../types/types';

const isVisibleAssistantText = (message: ChatMessage): boolean => (
  message.type === 'assistant'
  && !message.isToolUse
  && !message.isThinking
  && typeof message.content === 'string'
  && message.content.length > 0
);

/** Reconcile the final SDK envelope with text already rendered from deltas. */
export const mergeFinalAssistantMessages = (
  previous: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] => {
  const merged = [...previous];

  incoming.forEach((message) => {
    if (!isVisibleAssistantText(message)) {
      merged.push(message);
      return;
    }

    let lastVisibleAssistantIndex = -1;
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      if (merged[index].type === 'user') break;
      if (isVisibleAssistantText(merged[index])) {
        lastVisibleAssistantIndex = index;
        break;
      }
    }

    if (lastVisibleAssistantIndex < 0) {
      merged.push(message);
      return;
    }

    const existing = merged[lastVisibleAssistantIndex];
    const existingContent = String(existing.content || '');
    const incomingContent = String(message.content || '');
    if (existingContent === incomingContent) {
      merged[lastVisibleAssistantIndex] = {
        ...existing,
        ...message,
        timestamp: existing.timestamp,
        isStreaming: false,
      };
      return;
    }

    if (
      existing.isStreaming
      && (incomingContent.startsWith(existingContent) || existingContent.startsWith(incomingContent))
    ) {
      merged[lastVisibleAssistantIndex] = {
        ...existing,
        ...message,
        content: incomingContent.length >= existingContent.length ? incomingContent : existingContent,
        timestamp: existing.timestamp,
        isStreaming: false,
      };
      return;
    }

    merged.push(message);
  });

  return merged;
};
