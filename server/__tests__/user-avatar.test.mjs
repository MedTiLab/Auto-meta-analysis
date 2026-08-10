import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalJwtSecret = process.env.JWT_SECRET;

let tempRoot = null;
let server = null;
let database = null;
let baseUrl = null;

async function closeServer() {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  server = null;
  baseUrl = null;
}

async function startServer() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-user-avatar-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.JWT_SECRET = 'test-jwt-secret';

  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();

  const authRoutes = (await import('../routes/auth.js')).default;
  const userRoutes = (await import('../routes/user.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);

  server = await new Promise((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function requestJson(method, pathname, payload = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const body = await response.json();
  return { response, body };
}

describe('user avatars', () => {
  afterEach(async () => {
    await closeServer();

    if (database?.db?.open) {
      database.db.close();
    }
    database = null;

    vi.resetModules();

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('assigns a generated avatar and allows selecting a valid avatar', async () => {
    await startServer();

    const bcrypt = await import('bcrypt');
    const { generateToken } = await import('../middleware/auth.js');
    const user = database.userDb.createUser(
      'avatar-user',
      await bcrypt.hash('avatar-password', 12),
      'avatar@example.com',
    );
    expect(user.avatar_id).toEqual(expect.stringMatching(/^avatar-\d{2}$/));

    const token = generateToken(user);
    const rejected = await requestJson('PUT', '/api/user/profile', { avatarId: 'unknown-avatar' }, token);

    expect(rejected.response.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'Invalid avatar selection' });

    const updated = await requestJson('PUT', '/api/user/profile', { avatarId: 'avatar-12' }, token);

    expect(updated.response.status).toBe(200);
    expect(updated.body.profile.avatarId).toBe('avatar-12');

    const currentUser = await requestJson('GET', '/api/auth/user', null, token);

    expect(currentUser.response.status).toBe(200);
    expect(currentUser.body.user.avatarId).toBe('avatar-12');
  });
});
