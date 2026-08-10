import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
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

describe('trashed sessions stay out of active project lists', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medautodata-session-trash-'));
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

  it('excludes trashed Claude sessions from getProjects while keeping them in trash', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'medautodata', 'workspace');
    const projectName = '-Users-test-workspace';
    const activeSessionId = '019d5000-0000-7000-8000-000000000010';
    const trashedSessionId = '019d5000-0000-7000-8000-000000000011';

    await mkdir(projectPath, { recursive: true });

    const user = database.userDb.createUser('tester', 'hash');

    database.projectDb.upsertProject(projectName, user.id, 'Workspace', projectPath, 0, null, {
      projectKind: 'meta',
      metaAnalysis: { folderSchemaVersion: 'meta-v2' },
    });
    database.sessionDb.upsertSessionFromSource(activeSessionId, projectName, 'claude', {
      displayName: 'Active Claude Session',
      lastActivity: '2026-03-31T10:00:00.000Z',
      messageCount: 4,
    });
    database.sessionDb.upsertSessionFromSource(trashedSessionId, projectName, 'claude', {
      displayName: 'Deleted Claude Session',
      lastActivity: '2026-03-31T09:00:00.000Z',
      messageCount: 2,
    });
    database.sessionDb.setSessionTrash(trashedSessionId, {
      trashedAt: '2026-03-31T10:30:00.000Z',
      projectName,
      provider: 'claude',
    });

    const activeProjects = await projects.getProjects(user.id);
    const workspace = activeProjects.find((entry) => entry.name === projectName);
    const trashedSessions = await projects.getTrashedSessions(user.id);

    expect(workspace).toBeTruthy();
    expect((workspace?.sessions || []).map((session) => session.id)).toEqual([activeSessionId]);
    expect(trashedSessions.map((session) => session.id)).toContain(trashedSessionId);
  });

  it('clears trash-only project metadata when restoring a project', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'medautodata', 'publication-paper');
    const projectName = '-Users-test-publication-paper';
    const trashedAt = '2026-03-31T10:30:00.000Z';

    await mkdir(projectPath, { recursive: true });

    const user = database.userDb.createUser('restore-tester', 'hash');
    const trashMetadata = {
      trashedAt,
      originalPath: projectPath,
      trashPath: '',
      claudeTrashPath: '',
      sessionCount: 0,
      displayName: 'publication-paper',
      filesExist: true,
      ownerUserId: user.id,
      instanceId: null,
    };

    database.projectDb.upsertProject(projectName, user.id, 'publication-paper', projectPath, 0, null, {
      trash: trashMetadata,
    });

    const claudeDir = path.join(tempRoot, '.claude');
    const medHelpConfigPath = path.join(tempRoot, '.medhelp', 'project-config.json');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      path.join(claudeDir, 'project-config.json'),
      JSON.stringify({
        [projectName]: {
          originalPath: projectPath,
          ownerUserId: user.id,
          trash: trashMetadata,
        },
        _deletedProjects: {
          [projectName]: {
            deletedAt: trashedAt,
            ownerUserId: user.id,
            originalPath: projectPath,
            displayName: 'publication-paper',
          },
        },
      }, null, 2),
      'utf8',
    );

    await projects.restoreProject(projectName, user.id);

    const restoredProject = database.projectDb.getProjectById(projectName);
    expect(restoredProject?.metadata).toBeNull();

    const config = JSON.parse(await readFile(medHelpConfigPath, 'utf8'));
    expect(config[projectName]?.trash).toBeUndefined();
    expect(config._deletedProjects?.[projectName]).toBeUndefined();

    const activeProjects = await projects.getProjects(user.id);
    expect(activeProjects.some((entry) => entry.name === projectName)).toBe(true);
  });
});
