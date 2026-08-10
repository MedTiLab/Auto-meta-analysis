import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot = null;

async function loadTestModules() {
  vi.resetModules();
  const projects = await import('../projects.js');
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  return { projects, database };
}

describe('session deletion fallbacks', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-session-delete-'));
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

  it('deletes a Claude session from the index when the project directory is missing', async () => {
    const { projects, database } = await loadTestModules();
    const projectName = 'tmp-project';
    const sessionId = 'claude-session-missing-file';

    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'claude');
    expect(database.sessionDb.getSessionById(sessionId)?.provider).toBe('claude');

    await expect(projects.deleteSession(projectName, sessionId, 'claude')).resolves.toBe(true);
    expect(database.sessionDb.getSessionById(sessionId)).toBeNull();
  });

  it('removes a Claude session from its JSONL history and index', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'workspace-claude');
    const projectName = '-Users-test-workspace-claude';
    const sessionId = 'claude-session-local-file';
    const projectDir = path.join(tempRoot, '.claude', 'projects', projectName);
    const sessionFile = path.join(projectDir, 'conversation.jsonl');

    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(
      sessionFile,
      [
        JSON.stringify({ sessionId, type: 'user', message: { role: 'user', content: 'remove me' } }),
        JSON.stringify({ sessionId: 'other-session', type: 'user', message: { role: 'user', content: 'keep me' } }),
        '',
      ].join('\n'),
      'utf8',
    );

    database.projectDb.upsertProject(projectName, null, 'Workspace Claude', projectPath);
    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'claude', 'Claude Session', null, {
      projectPath,
    });

    await expect(projects.deleteSession(projectName, sessionId, 'claude')).resolves.toBe(true);
    await expect(access(sessionFile)).resolves.toBeUndefined();
    expect(await readFile(sessionFile, 'utf8')).not.toContain('remove me');
    expect(await readFile(sessionFile, 'utf8')).toContain('keep me');
    expect(database.sessionDb.getSessionById(sessionId)).toBeNull();
  });
});
