import express from 'express';
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

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'user-feedback-'));
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

describe('user feedback', () => {
  it('stores feedback per signed-in user', async () => {
    const { userDb, userFeedbackDb } = await loadDatabase();
    const firstUser = userDb.createUser('feedback-user-a', 'hashed-password', 'a@example.com');
    const secondUser = userDb.createUser('feedback-user-b', 'hashed-password', 'b@example.com');

    const feedback = userFeedbackDb.create(firstUser.id, {
      category: 'unknown',
      title: '  Feature request  ',
      content: '  Please add export controls.  ',
      contact: 'a@example.com',
      pageUrl: 'http://localhost/settings',
      userAgent: 'vitest',
      metadata: { language: 'en' },
    });

    expect(feedback).toMatchObject({
      userId: firstUser.id,
      category: 'other',
      title: 'Feature request',
      content: 'Please add export controls.',
      contact: 'a@example.com',
      pageUrl: 'http://localhost/settings',
      userAgent: 'vitest',
      status: 'new',
      metadata: { language: 'en' },
    });
    expect(userFeedbackDb.listForUser(secondUser.id)).toEqual([]);
  });

  it('accepts feedback through the settings route and rejects empty content', async () => {
    const { userDb, userFeedbackDb } = await loadDatabase();
    const user = userDb.createUser('feedback-route-user', 'hashed-password', 'route@example.com');
    const settingsRoutes = (await import('../routes/settings.js')).default;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = user;
      next();
    });
    app.use('/api/settings', settingsRoutes);

    const server = app.listen(0);
    try {
      const port = server.address().port;
      const response = await fetch(`http://127.0.0.1:${port}/api/settings/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'feedback-test-agent',
        },
        body: JSON.stringify({
          category: 'suggestion',
          title: 'Improve settings',
          content: 'Please make help easier to find.',
          contact: 'route@example.com',
          pageUrl: 'http://localhost/settings?tab=helpFeedback',
          language: 'en',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.feedback).toMatchObject({
        userId: user.id,
        category: 'suggestion',
        title: 'Improve settings',
        content: 'Please make help easier to find.',
        userAgent: 'feedback-test-agent',
      });
      expect(userFeedbackDb.listForUser(user.id)).toHaveLength(1);

      const emptyResponse = await fetch(`http://127.0.0.1:${port}/api/settings/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '   ' }),
      });
      expect(emptyResponse.status).toBe(400);
    } finally {
      await closeServer(server);
    }
  });
});
