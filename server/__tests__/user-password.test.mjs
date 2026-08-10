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
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-user-password-'));
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

async function postJson(pathname, payload, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  return { response, body };
}

describe('user password updates', () => {
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

  it('requires the current password and allows login with the new password only', async () => {
    await startServer();

    const bcrypt = await import('bcrypt');
    const { generateToken } = await import('../middleware/auth.js');
    const user = database.userDb.createUser(
      'password-user',
      await bcrypt.hash('old-password', 12),
      'password@example.com',
    );
    const token = generateToken(user);

    const rejected = await postJson('/api/user/password', {
      currentPassword: 'wrong-password',
      newPassword: 'new-password',
    }, token);

    expect(rejected.response.status).toBe(401);
    expect(rejected.body).toEqual({ error: 'Current password is incorrect' });

    const updated = await postJson('/api/user/password', {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    }, token);

    expect(updated.response.status).toBe(200);
    expect(updated.body).toEqual({ success: true });

    const oldLogin = await postJson('/api/auth/login', {
      username: 'password-user',
      password: 'old-password',
    });

    expect(oldLogin.response.status).toBe(401);

    const newLogin = await postJson('/api/auth/login', {
      username: 'password-user',
      password: 'new-password',
    });

    expect(newLogin.response.status).toBe(200);
    expect(newLogin.body.token).toEqual(expect.any(String));
  });
});
