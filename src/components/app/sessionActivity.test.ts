import { describe, expect, it } from 'vitest';

import {
  collectActiveSessionIds,
  getActiveSessionEntryId,
  getLifecycleSessionIds,
} from './sessionActivity';

describe('sessionActivity', () => {
  it('normalizes active session entries from string and object payloads', () => {
    expect(getActiveSessionEntryId('session-a')).toBe('session-a');
    expect(getActiveSessionEntryId({ id: 'session-b', startTime: 123 })).toBe('session-b');
    expect(getActiveSessionEntryId({ sessionId: 'session-c', startTime: 456 })).toBe('session-c');
    expect(getActiveSessionEntryId({ id: '' })).toBeNull();
  });

  it('collects active session ids and preserves temporary processing ids', () => {
    const result = collectActiveSessionIds(
      {
        claude: ['claude-session'],
      },
      new Set(['new-session-1', 'completed-session']),
    );

    expect(Array.from(result).sort()).toEqual([
      'claude-session',
      'new-session-1',
    ]);
  });

  it('extracts all lifecycle ids from session migration messages', () => {
    expect(getLifecycleSessionIds({
      sessionId: 'actual-session',
      actualSessionId: 'actual-session',
      previousSessionId: 'new-session-1',
    })).toEqual(['actual-session', 'new-session-1']);
  });
});
