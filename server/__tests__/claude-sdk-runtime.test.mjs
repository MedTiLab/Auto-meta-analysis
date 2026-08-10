import { describe, expect, it } from 'vitest';

import { resolveClaudeCodeExecutableInfo } from '../utils/claudeCodeExecutable.js';
import { nextWithInactivityTimeout } from '../utils/streamInactivity.js';

describe('Claude SDK runtime helpers', () => {
  it('resolves an executable for the upgraded SDK runtime', () => {
    const result = resolveClaudeCodeExecutableInfo({
      env: process.env,
      preferBundledNative: true,
    });

    expect(result.executable).toBeTruthy();
    expect(['CLAUDE_CLI_PATH', 'bundled-native', 'PATH']).toContain(result.source);
  });

  it('returns the next stream event before the inactivity timeout', async () => {
    const iterator = (async function* stream() {
      yield { type: 'assistant' };
    })()[Symbol.asyncIterator]();

    await expect(nextWithInactivityTimeout(iterator, { timeoutMs: 100 }))
      .resolves.toEqual({ done: false, value: { type: 'assistant' } });
  });

  it('interrupts a stalled stream with a classified timeout', async () => {
    const iterator = {
      next: () => new Promise(() => {}),
    };

    await expect(nextWithInactivityTimeout(iterator, {
      timeoutMs: 5,
      errorCode: 'FIRST_MESSAGE_TIMEOUT',
    })).rejects.toMatchObject({
      name: 'TimeoutError',
      code: 'FIRST_MESSAGE_TIMEOUT',
    });
  });
});
