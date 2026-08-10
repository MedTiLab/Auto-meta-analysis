import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot = null;

async function loadDatabaseModule() {
  vi.resetModules();
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  return database;
}

describe('project database foreign keys', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medautodata-project-fk-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('does not fail when stale project config references a deleted user id', async () => {
    const database = await loadDatabaseModule();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    database.projectDb.upsertProject(
      'orphan-project',
      999999,
      'Orphan Project',
      path.join(tempRoot, 'orphan-project'),
      0,
      null,
      { manuallyAdded: true },
    );

    const row = database.projectDb.getProjectById('orphan-project');
    expect(row).toMatchObject({
      id: 'orphan-project',
      user_id: null,
      display_name: 'Orphan Project',
    });
    expect(row.metadata).toMatchObject({ manuallyAdded: true });
    expect(consoleError).not.toHaveBeenCalledWith(
      'Error upserting project metadata:',
      expect.stringContaining('FOREIGN KEY constraint failed'),
    );
  });
});
