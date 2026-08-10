import { describe, expect, it } from 'vitest';

import {
  OPEN_WEBSOCKET_STATE,
  getConnectedClientUserId,
  groupOpenClientsByUserId,
} from '../projectRealtime.js';

describe('project realtime helpers', () => {
  it('prefers authUserId when reading a websocket owner', () => {
    expect(getConnectedClientUserId({ authUserId: 2, userId: 1 })).toBe(2);
    expect(getConnectedClientUserId({ userId: 3 })).toBe(3);
    expect(getConnectedClientUserId({})).toBeNull();
  });

  it('groups only open sockets by authenticated user', () => {
    const userOneClient = { readyState: OPEN_WEBSOCKET_STATE, authUserId: 1 };
    const userTwoClient = { readyState: OPEN_WEBSOCKET_STATE, authUserId: 2 };
    const anonymousClient = { readyState: OPEN_WEBSOCKET_STATE };
    const closedClient = { readyState: 3, authUserId: 1 };

    const groups = groupOpenClientsByUserId([
      userOneClient,
      userTwoClient,
      anonymousClient,
      closedClient,
      null,
    ]);

    expect(groups.get(1)).toEqual([userOneClient]);
    expect(groups.get(2)).toEqual([userTwoClient]);
    expect(groups.get(null)).toEqual([anonymousClient]);
    expect(groups.has(3)).toBe(false);
  });
});
