import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZoteroLocalClient } from '../utils/zotero-client.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ZoteroLocalClient', () => {
  it('falls back to the next loopback endpoint when the first candidate is unreachable', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).startsWith('http://localhost:23119')) {
        throw new Error('connect ECONNREFUSED ::1:23119');
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZoteroLocalClient([
      'http://localhost:23119/api',
      'http://127.0.0.1:23119/api',
    ]);
    const status = await client.checkStatus();

    expect(status.available).toBe(true);
    expect(status.endpoint).toBe('http://127.0.0.1:23119/api');
    expect(client.base).toBe('http://127.0.0.1:23119/api');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports apiDisabled when Zotero responds with HTTP 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));

    const client = new ZoteroLocalClient(['http://127.0.0.1:23119/api']);
    const status = await client.checkStatus();

    expect(status.available).toBe(false);
    expect(status.running).toBe(true);
    expect(status.apiDisabled).toBe(true);
    expect(status.endpoint).toBe('http://127.0.0.1:23119/api');
  });
});
