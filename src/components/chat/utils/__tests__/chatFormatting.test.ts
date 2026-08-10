import { describe, it, expect } from 'vitest';
import { buildAssistantMessages } from '../chatFormatting';

describe('buildAssistantMessages', () => {
  const timestamp = new Date('2025-01-01T00:00:00Z');

  it('returns single message for plain text', () => {
    const result = buildAssistantMessages('Hello world', timestamp);
    expect(result).toEqual([
      { type: 'assistant', content: 'Hello world', timestamp },
    ]);
  });

  it('does not add isThinking to non-thinking messages', () => {
    const result = buildAssistantMessages('plain text', timestamp);
    expect(result[0]).not.toHaveProperty('isThinking');
  });

  it('preserves timestamp', () => {
    const result = buildAssistantMessages('final', timestamp);
    expect(result[0]?.timestamp).toBe(timestamp);
  });
});
