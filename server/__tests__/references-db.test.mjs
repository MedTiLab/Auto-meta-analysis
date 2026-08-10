import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadDatabaseModule() {
  vi.resetModules();
  return import('../database/db.js');
}

describe('referencesDb batch lookups', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-references-db-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalDatabasePath;
    }

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('returns references by ids in request order', async () => {
    const { initializeDatabase, referencesDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const createdUser = userDb.createUser('ref-test-user', 'hashed-password');
    const userId = createdUser.id;
    const ids = referencesDb.importReferences(userId, [
      {
        title: 'Paper A',
        authors: [{ family: 'Alpha', given: 'Ann' }],
        year: 2024,
        abstract: 'First paper',
        journal: 'Journal A',
        itemType: 'article',
        keywords: ['screening'],
        citationKey: 'Alpha2024A',
      },
      {
        title: 'Paper B',
        authors: [{ family: 'Beta', given: 'Ben' }],
        year: 2025,
        abstract: 'Second paper',
        journal: 'Journal B',
        itemType: 'article',
        keywords: ['cohort'],
        citationKey: 'Beta2025B',
      },
    ], 'bibtex');

    const result = referencesDb.getReferencesByIds(userId, [ids[1], ids[0]]);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(ids[1]);
    expect(result[0]?.title).toBe('Paper B');
    expect(result[1]?.id).toBe(ids[0]);
    expect(result[1]?.authors).toEqual([{ family: 'Alpha', given: 'Ann' }]);
  });

  it('bulk deletes references by id list', async () => {
    const { initializeDatabase, referencesDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const createdUser = userDb.createUser('ref-delete-user', 'hashed-password');
    const userId = createdUser.id;
    const [referenceId] = referencesDb.importReferences(userId, [
      {
        title: 'Paper To Delete',
        authors: [{ family: 'Gamma', given: 'Gina' }],
        year: 2026,
        abstract: 'Deletion candidate.',
        journal: 'Cleanup Journal',
        itemType: 'article',
        keywords: ['cleanup'],
        citationKey: 'Gamma2026Delete',
      },
    ], 'bibtex');

    const deleted = referencesDb.bulkDeleteReferences(userId, [referenceId]);

    expect(deleted).toBe(1);
    expect(referencesDb.getReference(referenceId, userId)).toBeNull();
  });
});
