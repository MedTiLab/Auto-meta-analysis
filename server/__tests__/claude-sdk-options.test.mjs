import { describe, expect, it } from 'vitest';

import { mapCliOptionsToSDK } from '../claude-sdk.js';

describe('Claude SDK options', () => {
  it('passes the selected model and adaptive thinking effort to the SDK', () => {
    const options = mapCliOptionsToSDK({
      model: 'sonnet[1m]',
      thinking: { type: 'adaptive' },
      effort: 'xhigh',
      env: {},
    });

    expect(options.model).toBe('sonnet[1m]');
    expect(options.thinking).toEqual({ type: 'adaptive' });
    expect(options.effort).toBe('xhigh');
  });

  it('does not forward unsupported effort values', () => {
    const options = mapCliOptionsToSDK({ model: 'opus', effort: 'extreme' });
    expect(options.model).toBe('opus');
    expect(options).not.toHaveProperty('effort');
  });
});
