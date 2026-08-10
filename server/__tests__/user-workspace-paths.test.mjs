import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;
const originalWorkspaceRoot = process.env.WORKSPACES_ROOT;
const originalProjectPathLock = process.env.MEDAUTODATA_LOCK_PROJECT_PATHS;

let tempRoot = null;
let server = null;
let database = null;
let baseUrl = null;
let user = null;

async function closeServer() {
  if (!server) return;

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  server = null;
  baseUrl = null;
}

async function startProjectsServer() {
  tempRoot = await fs.mkdtemp(path.join(path.dirname(process.cwd()), 'medautodata-user-workspaces-'));
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
  process.env.WORKSPACES_ROOT = path.join(tempRoot, 'workspaces');
  process.env.MEDAUTODATA_LOCK_PROJECT_PATHS = 'true';

  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  user = database.userDb.createUser('workspace-user', 'hashed-password');

  const projectsRoutes = (await import('../routes/projects.js')).default;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/projects', projectsRoutes);

  server = await new Promise((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function requestJson(method, pathname, payload = null) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const body = await response.json();
  return { response, body };
}

describe('single default project location', () => {
  beforeEach(async () => {
    await startProjectsServer();
  });

  afterEach(async () => {
    await closeServer();

    if (database?.db?.open) {
      database.db.close();
    }
    database = null;
    user = null;

    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (originalWorkspaceRoot === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = originalWorkspaceRoot;

    if (originalProjectPathLock === undefined) delete process.env.MEDAUTODATA_LOCK_PROJECT_PATHS;
    else process.env.MEDAUTODATA_LOCK_PROJECT_PATHS = originalProjectPathLock;

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('reports one default root without adding a user folder', async () => {
    const { response, body } = await requestJson('GET', '/api/projects/workspace-root');
    const expectedRoot = process.env.WORKSPACES_ROOT;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      path: expectedRoot,
      basePath: process.env.WORKSPACES_ROOT,
      lockedToDefault: true,
      lockedToUser: false,
    });
    expect(body.path).not.toContain(`user-${user.id}`);
  });

  it('creates new workspaces under the default root and only imports folders inside it', async () => {
    const defaultRoot = process.env.WORKSPACES_ROOT;

    const created = await requestJson('POST', '/api/projects/create-workspace', {
      workspaceType: 'new',
      displayName: 'Locked Project',
      projectKind: 'meta',
    });

    expect(created.response.status).toBe(200);
    expect(created.body.project.path.startsWith(defaultRoot + path.sep)).toBe(true);

    const ignoredPath = await requestJson('POST', '/api/projects/create-workspace', {
      workspaceType: 'new',
      path: '/tmp/should-not-be-used',
      displayName: 'Ignored Custom Path',
      projectKind: 'meta',
    });

    expect(ignoredPath.response.status).toBe(200);
    expect(ignoredPath.body.project.path.startsWith(defaultRoot + path.sep)).toBe(true);
    expect(ignoredPath.body.project.path).not.toContain('should-not-be-used');

    const existingProjectPath = path.join(defaultRoot, 'already-here');
    await fs.mkdir(existingProjectPath, { recursive: true });

    const imported = await requestJson('POST', '/api/projects/create-workspace', {
      workspaceType: 'existing',
      path: existingProjectPath,
      displayName: 'Existing Project',
      projectKind: 'meta',
    });

    expect(imported.response.status).toBe(200);
    expect(imported.body.project.path).toBe(existingProjectPath);

    const outsideProjectPath = path.join(tempRoot, 'outside-project');
    await fs.mkdir(outsideProjectPath, { recursive: true });

    const rejected = await requestJson('POST', '/api/projects/create-workspace', {
      workspaceType: 'existing',
      path: outsideProjectPath,
      displayName: 'Outside Project',
      projectKind: 'meta',
    });

    expect(rejected.response.status).toBe(400);
    expect(rejected.body.error).toBe('Invalid workspace path');
    expect(rejected.body.details).toContain('default project location');
  });

  it('updates the one global default location without storing it on the user', async () => {
    const nextRoot = path.join(tempRoot, 'chosen-default');
    await fs.mkdir(nextRoot, { recursive: true });

    const updated = await requestJson('PUT', '/api/projects/workspace-root', { path: nextRoot });
    expect(updated.response.status).toBe(200);
    expect(updated.body).toMatchObject({ success: true, path: nextRoot });

    const current = await requestJson('GET', '/api/projects/workspace-root');
    expect(current.response.status).toBe(200);
    expect(current.body.path).toBe(nextRoot);
    expect(current.body.lockedToUser).toBe(false);

    const created = await requestJson('POST', '/api/projects/create-workspace', {
      workspaceType: 'new',
      displayName: 'Shared Default',
      projectKind: 'meta',
    });
    expect(created.response.status).toBe(200);
    expect(created.body.project.path.startsWith(`${nextRoot}${path.sep}`)).toBe(true);
  });

  it('accepts a home-relative default location', async () => {
    const homeRelativeRoot = path.join(tempRoot, 'medautodata');
    await fs.mkdir(homeRelativeRoot, { recursive: true });

    const updated = await requestJson('PUT', '/api/projects/workspace-root', { path: '~/medautodata' });
    expect(updated.response.status).toBe(200);
    expect(updated.body.path).toBe(homeRelativeRoot);
  });
});
