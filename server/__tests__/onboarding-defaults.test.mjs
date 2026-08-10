import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

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

describe('onboarding defaults', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medautodata-onboarding-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
  });

  afterEach(async () => {
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

  it('marks newly created users as having completed onboarding', async () => {
    const { userDb } = await loadDatabaseModule();
    const user = userDb.createUser('fresh-user', 'hash');

    expect(userDb.hasCompletedOnboarding(user.id)).toBe(true);
  });

  it('upgrades legacy users who still have onboarding disabled', async () => {
    const dbDir = path.dirname(process.env.DATABASE_PATH);
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const legacyDb = new Database(process.env.DATABASE_PATH);
    legacyDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        notification_email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        is_active BOOLEAN DEFAULT 1,
        git_name TEXT,
        git_email TEXT,
        has_completed_onboarding BOOLEAN DEFAULT 0,
        memory_enabled BOOLEAN DEFAULT 1
      );
      INSERT INTO users (username, password_hash, notification_email, has_completed_onboarding)
      VALUES ('legacy-user', 'hash', 'legacy@example.com', 0);
    `);
    legacyDb.close();

    const { userDb } = await loadDatabaseModule();
    const legacyUser = userDb.getUserByUsername('legacy-user');

    expect(userDb.hasCompletedOnboarding(legacyUser.id)).toBe(true);
    expect(userDb.getProfile(legacyUser.id).avatar_id).toEqual(expect.stringMatching(/^avatar-\d{2}$/));
  });
});
