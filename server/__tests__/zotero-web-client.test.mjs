import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalZoteroApiKey = process.env.ZOTERO_API_KEY;
const originalZoteroUserId = process.env.ZOTERO_USER_ID;
let tempRoot = null;

async function loadClientModule() {
  vi.resetModules();
  const module = await import('../utils/zotero-web-client.js');
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  return module;
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zotero-web-client-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
});

afterEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
  if (originalZoteroApiKey === undefined) delete process.env.ZOTERO_API_KEY;
  else process.env.ZOTERO_API_KEY = originalZoteroApiKey;
  if (originalZoteroUserId === undefined) delete process.env.ZOTERO_USER_ID;
  else process.env.ZOTERO_USER_ID = originalZoteroUserId;
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('ZoteroWebClient', () => {
  it('reports environment-sourced Zotero Web credentials', async () => {
    process.env.ZOTERO_API_KEY = 'env-key';
    process.env.ZOTERO_USER_ID = '15789476';
    const { getZoteroWebCredentialStatus } = await loadClientModule();

    expect(getZoteroWebCredentialStatus(1)).toMatchObject({
      configured: true,
      userId: '15789476',
      source: 'environment',
      apiKeySource: 'environment',
      userIdSource: 'environment',
    });
  });

  it('validates an API key and extracts user access from /keys/current', async () => {
    const { inspectZoteroWebApiKey } = await loadClientModule();
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      expect(String(url)).toBe('https://api.zotero.org/keys/current');
      expect(options.headers['Zotero-API-Key']).toBe('test-key');
      return new Response(JSON.stringify({
        userID: 123,
        username: 'z-user',
        access: {
          user: {
            library: true,
            files: true,
            notes: false,
            write: true,
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    await expect(inspectZoteroWebApiKey('test-key')).resolves.toMatchObject({
      userId: '123',
      username: 'z-user',
      access: {
        library: true,
        files: true,
        notes: false,
        write: true,
      },
    });
  });

  it('creates nested collections when they do not already exist', async () => {
    const { ZoteroWebClient } = await loadClientModule();
    const created = [];
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/users/123/collections?limit=100&start=0')) {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url).endsWith('/users/123/collections') && options.method === 'POST') {
        const [body] = JSON.parse(options.body);
        const key = `C${created.length + 1}`;
        created.push({ ...body, key });
        return new Response(JSON.stringify({ successful: { 0: { key, data: { key, ...body } } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch ${options.method || 'GET'} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZoteroWebClient({ userId: '123', apiKey: 'key' });
    const pathItems = await client.ensureCollectionPath(['MedHelp', 'Project', '04 Full Text Review']);

    expect(pathItems.map((item) => item.key)).toEqual(['C1', 'C2', 'C3']);
    expect(created.map((item) => item.parentCollection)).toEqual([false, 'C1', 'C2']);
  });

  it('finds existing items by normalized DOI before creating duplicates', async () => {
    const { ZoteroWebClient } = await loadClientModule();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      expect(String(url)).toContain('q=10.1000%2Ftest');
      return new Response(JSON.stringify([{
        key: 'ITEM1',
        data: { key: 'ITEM1', title: 'Matched', DOI: 'https://doi.org/10.1000/test' },
      }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const client = new ZoteroWebClient({ userId: '123', apiKey: 'key' });
    const match = await client.findTopLevelItemForReference({ doi: '10.1000/test', title: 'Matched' });

    expect(match).toMatchObject({ key: 'ITEM1', matchReason: 'doi' });
  });

  it('creates an imported-file attachment and completes the upload registration flow', async () => {
    const filePath = path.join(tempRoot, 'paper.pdf');
    await writeFile(filePath, Buffer.from('%PDF-1.4 test'));
    const { ZoteroWebClient } = await loadClientModule();

    const fetchMock = vi.fn(async (url, options = {}) => {
      const textUrl = String(url);
      if (textUrl.endsWith('/users/123/items') && options.method === 'POST') {
        return new Response(JSON.stringify({ successful: { 0: { key: 'ATT1', data: { key: 'ATT1' } } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (textUrl.endsWith('/users/123/items/ATT1/file') && options.method === 'POST' && String(options.body).includes('md5=')) {
        return new Response(JSON.stringify({
          url: 'https://upload.zotero.test/file',
          uploadKey: 'UPLOAD1',
          prefix: '',
          suffix: '',
          contentType: 'application/pdf',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (textUrl === 'https://upload.zotero.test/file') {
        return new Response('', { status: 201 });
      }
      if (textUrl.endsWith('/users/123/items/ATT1/file') && options.method === 'POST' && String(options.body).includes('upload=UPLOAD1')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch ${options.method || 'GET'} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZoteroWebClient({ userId: '123', apiKey: 'key' });
    const result = await client.uploadStoredAttachment({
      parentItemKey: 'ITEM1',
      filePath,
      title: 'PDF full text',
      contentType: 'application/pdf',
    });

    expect(result).toMatchObject({ key: 'ATT1', uploaded: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
