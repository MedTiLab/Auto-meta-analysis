import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'fs/promises';
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

describe('project kind classification', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medautodata-project-kind-'));
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

  it('keeps legacy indexed projects visible and hydrates Meta-compatible metadata', async () => {
    const { projects, database } = await loadTestModules();
    const user = database.userDb.createUser('legacy-owner', 'hash');
    const projectName = 'legacy-with-stale-meta-row';
    const projectPath = path.join(tempRoot, 'medautodata', projectName);

    await mkdir(projectPath, { recursive: true });
    database.projectDb.upsertProject(projectName, user.id, 'Legacy Project', projectPath);
    database.metaAnalysisDb.createMetaProject(user.id, {
      projectId: projectName,
      reviewType: 'diagnostic',
      title: 'Old Meta Row',
    });

    const activeProjects = await projects.getProjects(user.id);
    const project = activeProjects.find((entry) => entry.name === projectName);

    expect(project).toBeDefined();
    expect(project?.metadata?.projectKind).toBe('meta');
    expect(project?.metadata?.metaAnalysis?.workflow).toBe('meta');
  });

  it('hydrates Meta metadata only when the project is explicitly marked as Meta', async () => {
    const { projects, database } = await loadTestModules();
    const user = database.userDb.createUser('meta-owner', 'hash');
    const projectName = 'explicit-meta-project';
    const projectPath = path.join(tempRoot, 'medautodata', projectName);

    await mkdir(projectPath, { recursive: true });
    database.projectDb.upsertProject(projectName, user.id, 'Meta Project', projectPath, 0, null, {
      projectKind: 'meta',
    });
    const metaProject = database.metaAnalysisDb.createMetaProject(user.id, {
      projectId: projectName,
      reviewType: 'prognostic',
      title: 'Explicit Meta Project',
    });

    const activeProjects = await projects.getProjects(user.id);
    const project = activeProjects.find((entry) => entry.name === projectName);

    expect(project?.metadata?.projectKind).toBe('meta');
    expect(project?.metadata?.metaAnalysis?.workflow).toBe('meta');
    expect(project?.metadata?.metaAnalysis?.reviewType).toBe('prognostic');
    expect(project?.metadata?.metaAnalysis?.metaProjectId).toBe(metaProject.id);
  });

  it('does not default new Meta records to diagnostic accuracy when no review type is provided', async () => {
    const { database } = await loadTestModules();
    const user = database.userDb.createUser('meta-default-owner', 'hash');
    const projectName = 'unspecified-meta-project';
    const projectPath = path.join(tempRoot, 'medautodata', projectName);
    await mkdir(projectPath, { recursive: true });
    database.projectDb.upsertProject(projectName, user.id, 'Unspecified Meta Project', projectPath);

    const metaProject = database.metaAnalysisDb.createMetaProject(user.id, {
      projectId: projectName,
    });

    expect(metaProject.review_type).toBe('');
    expect(metaProject.primary_outcome).toBeNull();
    expect(metaProject.title).toBe('Untitled Meta project');
  });
});
