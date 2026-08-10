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

describe('project home-path migration', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medautodata-project-home-'));
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

  it('remaps project paths from a previous home directory to the current home', async () => {
    const { projects, database } = await loadTestModules();
    const user = database.userDb.createUser('tester', 'hash');

    const currentProjectPath = path.join(tempRoot, 'medautodata', 'workspace');
    await mkdir(currentProjectPath, { recursive: true });

    const previousHome = path.join(path.dirname(tempRoot), 'previous-user');
    const oldProjectPath = path.join(previousHome, 'medautodata', 'workspace');
    const projectName = projects.encodeProjectPath(oldProjectPath);

    database.projectDb.upsertProject(
      projectName,
      user.id,
      'Workspace',
      oldProjectPath,
      0,
      null,
      {
        manuallyAdded: true,
        projectKind: 'meta',
        metaAnalysis: { folderSchemaVersion: 'meta-v2' },
      },
    );

    const medHelpConfigPath = path.join(tempRoot, '.autometa', 'project-config.json');
    await mkdir(path.dirname(medHelpConfigPath), { recursive: true });
    await writeFile(
      medHelpConfigPath,
      JSON.stringify({
        [projectName]: {
          originalPath: oldProjectPath,
          manuallyAdded: true,
          ownerUserId: user.id,
        },
      }, null, 2),
      'utf8',
    );

    const activeProjects = await projects.getProjects(user.id);
    expect(activeProjects.some((entry) => entry.name === projectName)).toBe(true);

    const migratedEntry = database.projectDb.getProjectById(projectName);
    expect(migratedEntry?.path).toBe(currentProjectPath);

    const config = JSON.parse(await readFile(medHelpConfigPath, 'utf8'));
    expect(config[projectName]?.originalPath).toBe(currentProjectPath);
  });
});
