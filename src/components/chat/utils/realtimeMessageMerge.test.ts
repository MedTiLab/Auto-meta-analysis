import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/types';
import { mergeFinalAssistantMessages } from './realtimeMessageMerge';

const assistant = (content: string, isStreaming = false): ChatMessage => ({
  type: 'assistant',
  content,
  timestamp: '2026-08-09T00:00:00.000Z',
  isStreaming,
});

describe('mergeFinalAssistantMessages', () => {
  it('replaces a streamed prefix with the final SDK envelope', () => {
    const result = mergeFinalAssistantMessages(
      [assistant('测试成', true)],
      [assistant('测试成功')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ content: '测试成功', isStreaming: false });
  });

  it('does not append an exact final copy after streaming completes', () => {
    expect(mergeFinalAssistantMessages(
      [assistant('测试成功')],
      [assistant('测试成功')],
    )).toHaveLength(1);
  });

  it('keeps genuinely different assistant messages', () => {
    const result = mergeFinalAssistantMessages(
      [assistant('第一段')],
      [assistant('第二段')],
    );
    expect(result.map((message) => message.content)).toEqual(['第一段', '第二段']);
  });
});
