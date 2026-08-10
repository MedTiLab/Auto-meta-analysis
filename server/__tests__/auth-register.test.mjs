import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalJwtSecret = process.env.JWT_SECRET;
const originalRegistrationReviewEnabled = process.env.REGISTRATION_REVIEW_ENABLED;
const originalAdminUsername = process.env.ADMIN_USERNAME;
const originalAdminPassword = process.env.ADMIN_PASSWORD;
const originalMaxUsers = process.env.MAX_USERS;

let tempRoot = null;
let server = null;
let database = null;
let baseUrl = null;

async function closeServer() {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server = null;
  baseUrl = null;
}

async function startAuthServer(options = {}) {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-auth-register-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REGISTRATION_REVIEW_ENABLED = options.registrationReviewEnabled ?? 'true';
  if (Object.prototype.hasOwnProperty.call(options, 'adminUsername')) {
    if (options.adminUsername === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = options.adminUsername;
  } else {
    process.env.ADMIN_USERNAME = 'admin';
  }
  if (Object.prototype.hasOwnProperty.call(options, 'adminPassword')) {
    if (options.adminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = options.adminPassword;
  } else {
    process.env.ADMIN_PASSWORD = 'admin-password';
  }
  if (options.maxUsers) process.env.MAX_USERS = options.maxUsers;
  else delete process.env.MAX_USERS;

  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();

  const authRoutes = (await import('../routes/auth.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);

  server = await new Promise((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  return database;
}

async function requestJson(method, pathname, payload, token = null) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await response.json();
  return { response, body };
}

describe('auth registration review', () => {
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
    if (originalRegistrationReviewEnabled === undefined) delete process.env.REGISTRATION_REVIEW_ENABLED;
    else process.env.REGISTRATION_REVIEW_ENABLED = originalRegistrationReviewEnabled;
    if (originalAdminUsername === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = originalAdminUsername;
    if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalAdminPassword;
    if (originalMaxUsers === undefined) delete process.env.MAX_USERS;
    else process.env.MAX_USERS = originalMaxUsers;

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('creates a pending registration request and lets an admin approve it', async () => {
    const { registrationRequestDb, userDb } = await startAuthServer();

    const registration = await requestJson('POST', '/api/auth/register', {
      username: 'review-user',
      password: 'correct-horse-battery-staple',
      notificationEmail: 'review@example.com',
    });

    expect(registration.response.status).toBe(202);
    expect(registration.body.pendingReview).toBe(true);
    expect(userDb.getUserByUsername('review-user')).toBeUndefined();

    const pending = registrationRequestDb.list('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].username).toBe('review-user');

    const adminLogin = await requestJson('POST', '/api/auth/admin/login', {
      username: 'admin',
      password: 'admin-password',
    });

    expect(adminLogin.response.status).toBe(200);
    const adminToken = adminLogin.body.token;

    const approve = await requestJson(
      'POST',
      `/api/auth/admin/registration-requests/${pending[0].id}/approve`,
      {},
      adminToken,
    );

    expect(approve.response.status).toBe(200);
    expect(approve.body.user.username).toBe('review-user');
    expect(userDb.getUserByUsername('review-user')).toBeTruthy();
    expect(registrationRequestDb.list('pending')).toHaveLength(0);
  });

  it('rejects registration when review is disabled', async () => {
    await startAuthServer({ registrationReviewEnabled: 'false' });

    const registration = await requestJson('POST', '/api/auth/register', {
      username: 'disabled-user',
      password: 'correct-horse-battery-staple',
      notificationEmail: 'disabled@example.com',
    });

    expect(registration.response.status).toBe(503);
    expect(registration.body).toEqual({ error: 'Registration review is not enabled' });
  });

  it('does not allow admin login when the admin account is not configured', async () => {
    await startAuthServer({ adminUsername: undefined, adminPassword: undefined });

    const status = await requestJson('GET', '/api/auth/admin/status');
    expect(status.response.status).toBe(200);
    expect(status.body.adminConfigured).toBe(false);

    const adminLogin = await requestJson('POST', '/api/auth/admin/login', {
      username: 'admin',
      password: 'admin-password',
    });

    expect(adminLogin.response.status).toBe(503);
    expect(adminLogin.body.error).toBe('Administrator account is not configured');
  });

  it('lets an admin list users and update membership plans', async () => {
    const { userDb } = await startAuthServer();
    userDb.createUser('member-user', 'not-a-real-hash', 'member@example.com');

    const adminLogin = await requestJson('POST', '/api/auth/admin/login', {
      username: 'admin',
      password: 'admin-password',
    });
    const adminToken = adminLogin.body.token;

    const list = await requestJson('GET', '/api/auth/admin/users', null, adminToken);
    expect(list.response.status).toBe(200);
    expect(list.body.users).toEqual([
      expect.objectContaining({
        username: 'member-user',
        membershipPlan: 'free',
        projectCount: 0,
      }),
    ]);

    const targetUser = list.body.users[0];
    const update = await requestJson(
      'PATCH',
      `/api/auth/admin/users/${targetUser.id}/membership`,
      { membershipPlan: 'plus' },
      adminToken,
    );

    expect(update.response.status).toBe(200);
    expect(update.body.user).toEqual(expect.objectContaining({
      username: 'member-user',
      membershipPlan: 'plus',
    }));
    expect(userDb.getAdminUserById(targetUser.id).membership_plan).toBe('plus');
  });

  it('lets an admin set trial periods and exposes trial metadata to the user payload', async () => {
    const { userDb } = await startAuthServer();
    const bcrypt = await import('bcrypt');
    const { generateToken } = await import('../middleware/auth.js');

    const user = userDb.createUser(
      'trial-user',
      await bcrypt.hash('trial-password', 12),
      'trial@example.com',
    );

    const token = generateToken(user);
    const currentUser = await requestJson('GET', '/api/auth/user', null, token);
    expect(currentUser.response.status).toBe(200);
    expect(currentUser.body.user).toEqual(expect.objectContaining({
      username: 'trial-user',
      trialExpiresAt: null,
      trialRemainingDays: null,
      isTrialExpired: false,
    }));

    const adminLogin = await requestJson('POST', '/api/auth/admin/login', {
      username: 'admin',
      password: 'admin-password',
    });
    const adminToken = adminLogin.body.token;

    const update = await requestJson(
      'PATCH',
      `/api/auth/admin/users/${user.id}/trial`,
      { trialDays: 14 },
      adminToken,
    );

    expect(update.response.status).toBe(200);
    expect(update.body.user).toEqual(expect.objectContaining({
      username: 'trial-user',
      trialRemainingDays: 14,
      isTrialExpired: false,
    }));

    const refreshedUser = await requestJson('GET', '/api/auth/user', null, token);
    expect(refreshedUser.response.status).toBe(200);
    expect(refreshedUser.body.user).toEqual(expect.objectContaining({
      username: 'trial-user',
      trialRemainingDays: 14,
      isTrialExpired: false,
      trialExpiresAt: expect.any(String),
      usage: expect.objectContaining({
        quotaMb: 50,
        remainingMb: 50,
        isUsageExceeded: false,
      }),
    }));
  });

  it('keeps expired trial metadata without blocking login or authenticated requests', async () => {
    const { userDb } = await startAuthServer();
    const bcrypt = await import('bcrypt');
    const { generateToken } = await import('../middleware/auth.js');

    const user = userDb.createUser(
      'expired-user',
      await bcrypt.hash('expired-password', 12),
      'expired@example.com',
    );
    const token = generateToken(user);

    const adminLogin = await requestJson('POST', '/api/auth/admin/login', {
      username: 'admin',
      password: 'admin-password',
    });
    const adminToken = adminLogin.body.token;

    const expiredUpdate = await requestJson(
      'PATCH',
      `/api/auth/admin/users/${user.id}/trial`,
      { trialExpiresAt: '2000-01-01T00:00:00.000Z' },
      adminToken,
    );

    expect(expiredUpdate.response.status).toBe(200);
    expect(expiredUpdate.body.user.isTrialExpired).toBe(true);

    const login = await requestJson('POST', '/api/auth/login', {
      username: 'expired-user',
      password: 'expired-password',
    });
    expect(login.response.status).toBe(200);
    expect(login.body.user).toEqual(expect.objectContaining({
      username: 'expired-user',
      isTrialExpired: true,
      isUsageExceeded: false,
    }));

    const currentUser = await requestJson('GET', '/api/auth/user', null, token);
    expect(currentUser.response.status).toBe(200);
    expect(currentUser.body.user).toEqual(expect.objectContaining({
      username: 'expired-user',
      isTrialExpired: true,
      isUsageExceeded: false,
    }));
  });

  it('lets an admin configure membership usage quotas and per-user overrides', async () => {
    const { projectDb, userDb } = await startAuthServer();
    const { generateToken } = await import('../middleware/auth.js');
    const user = userDb.createUser('usage-user', 'not-a-real-hash', 'usage@example.com');
    const userToken = generateToken(user);

    const adminLogin = await requestJson('POST', '/api/auth/admin/login', {
      username: 'admin',
      password: 'admin-password',
    });
    const adminToken = adminLogin.body.token;

    const userSettingsAttempt = await requestJson('GET', '/api/auth/admin/usage-settings', null, userToken);
    expect(userSettingsAttempt.response.status).toBe(401);

    const settingsUpdate = await requestJson(
      'PUT',
      '/api/auth/admin/usage-settings',
      {
        enabled: true,
        planQuotasMb: {
          free: 25,
          plus: 100,
          pro: 250,
        },
      },
      adminToken,
    );

    expect(settingsUpdate.response.status).toBe(200);
    expect(settingsUpdate.body.settings.planQuotasMb).toEqual({
      free: 25,
      plus: 100,
      pro: 250,
    });

    const quotaUpdate = await requestJson(
      'PATCH',
      `/api/auth/admin/users/${user.id}/usage-quota`,
      { usageQuotaMb: 75 },
      adminToken,
    );

    expect(quotaUpdate.response.status).toBe(200);
    expect(quotaUpdate.body.user).toEqual(expect.objectContaining({
      username: 'usage-user',
      usageQuotaOverrideMb: 75,
      usageQuotaMb: 75,
      isUsageExceeded: false,
    }));

    const quotaClear = await requestJson(
      'PATCH',
      `/api/auth/admin/users/${user.id}/usage-quota`,
      { usageQuotaMb: null },
      adminToken,
    );

    expect(quotaClear.response.status).toBe(200);
    expect(quotaClear.body.user).toEqual(expect.objectContaining({
      username: 'usage-user',
      usageQuotaOverrideMb: null,
      usageQuotaMb: 25,
    }));

    const projectPath = path.join(tempRoot, 'usage-project');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(path.join(projectPath, 'dataset.bin'), Buffer.alloc(2 * 1024 * 1024));
    projectDb.upsertProject('usage-project', user.id, 'Usage Project', projectPath);

    const lowQuotaUpdate = await requestJson(
      'PUT',
      '/api/auth/admin/usage-settings',
      {
        enabled: true,
        planQuotasMb: {
          free: 1,
          plus: 100,
          pro: 250,
        },
      },
      adminToken,
    );
    expect(lowQuotaUpdate.response.status).toBe(200);

    const list = await requestJson('GET', '/api/auth/admin/users', null, adminToken);
    expect(list.response.status).toBe(200);
    expect(list.body.users[0]).toEqual(expect.objectContaining({
      username: 'usage-user',
      usageUsedBytes: 2 * 1024 * 1024,
      usageQuotaMb: 1,
      isUsageExceeded: true,
    }));

    const reset = await requestJson(
      'POST',
      `/api/auth/admin/users/${user.id}/usage-reset`,
      {},
      adminToken,
    );

    expect(reset.response.status).toBe(200);
    expect(reset.body.user).toEqual(expect.objectContaining({
      username: 'usage-user',
      usageUsedBytes: 0,
      usageBaselineBytes: 2 * 1024 * 1024,
      usageTotalStorageBytes: 2 * 1024 * 1024,
      usageQuotaMb: 1,
      isUsageExceeded: false,
    }));
  });

  it('requires username confirmation before admin user deletion', async () => {
    const { userDb } = await startAuthServer();
    const user = userDb.createUser('delete-user', 'not-a-real-hash', 'delete@example.com');

    const adminLogin = await requestJson('POST', '/api/auth/admin/login', {
      username: 'admin',
      password: 'admin-password',
    });
    const adminToken = adminLogin.body.token;

    const rejectedDelete = await requestJson(
      'DELETE',
      `/api/auth/admin/users/${user.id}`,
      { confirmUsername: 'wrong-user', deleteFiles: false },
      adminToken,
    );

    expect(rejectedDelete.response.status).toBe(400);
    expect(userDb.getAdminUserById(user.id)).toBeTruthy();

    const acceptedDelete = await requestJson(
      'DELETE',
      `/api/auth/admin/users/${user.id}`,
      { confirmUsername: 'delete-user', deleteFiles: false },
      adminToken,
    );

    expect(acceptedDelete.response.status).toBe(200);
    expect(acceptedDelete.body.deletedUser.username).toBe('delete-user');
    expect(userDb.getAdminUserById(user.id)).toBeUndefined();
  });
});
