import { describe, expect, it } from 'vitest';

import {
  CLAUDE_MODELS,
  enforceClaudeModelForMembership,
  normalizeClaudeStoredModelSelection,
  resolveClaudeModelSelection,
} from './modelConstants.js';

describe('Claude model selections', () => {
  it('exposes Claude models rather than membership tier names', () => {
    expect(CLAUDE_MODELS.DEFAULT).toBe('opus');
    expect(CLAUDE_MODELS.OPTIONS.map((option) => option.value)).toEqual(expect.arrayContaining([
      'sonnet',
      'opus',
      'haiku',
      'opusplan',
      'sonnet[1m]',
    ]));
    expect(CLAUDE_MODELS.OPTIONS.map((option) => option.value)).not.toEqual(expect.arrayContaining([
      'free',
      'plus',
      'pro',
    ]));
  });

  it('migrates previously stored membership-tier selections', () => {
    expect(normalizeClaudeStoredModelSelection('free')).toBe('haiku');
    expect(normalizeClaudeStoredModelSelection('plus')).toBe('sonnet');
    expect(normalizeClaudeStoredModelSelection('pro')).toBe('opus');
  });

  it('passes the selected Claude model through to the SDK', () => {
    expect(resolveClaudeModelSelection('sonnet[1m]')).toBe('sonnet[1m]');
    expect(resolveClaudeModelSelection('claude-opus-4-8')).toBe('claude-opus-4-8');
  });

  it('keeps API membership enforcement separate from the UI model values', () => {
    expect(enforceClaudeModelForMembership('opus', 'free').model).toBe('haiku');
    expect(enforceClaudeModelForMembership('sonnet', 'plus').model).toBe('sonnet');
    expect(enforceClaudeModelForMembership('claude-opus-4-8', 'pro').model).toBe('claude-opus-4-8');
  });
});
