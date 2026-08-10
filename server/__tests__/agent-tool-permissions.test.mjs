import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;
let database = null;

async function loadDatabase() {
  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  return database;
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-tool-permissions-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
});

afterEach(async () => {
  if (database?.db?.open) {
    database.db.close();
  }
  database = null;
  vi.resetModules();

  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;

  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('agent tool permissions', () => {
  it('stores permissions per user and provider', async () => {
    const { agentToolPermissionsDb, userDb } = await loadDatabase();
    const firstUser = userDb.createUser('permissions-user-a', 'hashed-password');
    const secondUser = userDb.createUser('permissions-user-b', 'hashed-password');

    const saved = agentToolPermissionsDb.upsertForUser(firstUser.id, 'claude', {
      allowedTools: ['Read', 'Read', 'Bash(git status:*)'],
      disallowedTools: ['Bash(rm:*)'],
      projectSortOrder: 'name',
      skipPermissions: true,
    });

    expect(saved.allowedTools).toEqual(['Read', 'Bash(git status:*)']);
    expect(saved.disallowedTools).toEqual(['Bash(rm:*)']);
    expect(saved.skipPermissions).toBe(false);
    expect(saved.projectSortOrder).toBe('name');

    const otherUserSettings = agentToolPermissionsDb.getForUser(secondUser.id, 'claude');
    expect(otherUserSettings.allowedTools).toEqual([]);
    expect(otherUserSettings.disallowedTools).toEqual([]);
  });

  it('persists remembered grants for only the current user', async () => {
    const { agentToolPermissionsDb, userDb } = await loadDatabase();
    const firstUser = userDb.createUser('grant-user-a', 'hashed-password');
    const secondUser = userDb.createUser('grant-user-b', 'hashed-password');

    agentToolPermissionsDb.upsertForUser(firstUser.id, 'claude', {
      allowedTools: ['Read'],
      disallowedTools: ['WebFetch'],
    });

    const updated = agentToolPermissionsDb.grantAllowedTool(firstUser.id, 'claude', 'WebFetch');
    expect(updated.allowedTools).toEqual(['Read', 'WebFetch']);
    expect(updated.disallowedTools).toEqual([]);

    const otherUserSettings = agentToolPermissionsDb.getForUser(secondUser.id, 'claude');
    expect(otherUserSettings.allowedTools).toEqual([]);
  });
});
