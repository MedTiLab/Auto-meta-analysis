import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalRuntimeFile = process.env.MEDAUTODATA_RUNTIME_FILE;
let tempRoot = null;

async function loadEnvModule() {
  vi.resetModules();
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  const envModule = await import('../utils/agentSessionEnv.js');
  return { database, envModule };
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-session-env-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.MEDAUTODATA_RUNTIME_FILE = path.join(tempRoot, 'ports.json');
});

afterEach(async () => {
  vi.resetModules();
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
  if (originalRuntimeFile === undefined) delete process.env.MEDAUTODATA_RUNTIME_FILE;
  else process.env.MEDAUTODATA_RUNTIME_FILE = originalRuntimeFile;
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('agent session environment', () => {
  it('injects active Zotero Web credentials from the user credential store', async () => {
    const { database, envModule } = await loadEnvModule();
    const user = database.userDb.createUser('zotero-env-user', 'hashed-password');

    database.credentialsDb.createCredential(
      user.id,
      'Zotero API Key',
      'zotero_api_key',
      'zotero-secret-key',
    );
    database.credentialsDb.createCredential(
      user.id,
      'Zotero User ID',
      'zotero_user_id',
      '123456',
    );

    const env = envModule.buildAgentSessionEnv(user.id, {
      PATH: '/usr/bin',
      ZOTERO_API_KEY: 'server-env-key',
    });

    expect(env.PATH).toBe('/usr/bin');
    expect(env.ZOTERO_API_KEY).toBe('zotero-secret-key');
    expect(env.ZOTERO_USER_ID).toBe('123456');
  });

  it('preserves existing Zotero env values when no user credentials are configured', async () => {
    const { database, envModule } = await loadEnvModule();
    const user = database.userDb.createUser('zotero-env-empty-user', 'hashed-password');

    const env = envModule.buildAgentSessionEnv(user.id, {
      ZOTERO_API_KEY: 'server-env-key',
      ZOTERO_USER_ID: 'server-user-id',
    });

    expect(env.ZOTERO_API_KEY).toBe('server-env-key');
    expect(env.ZOTERO_USER_ID).toBe('server-user-id');
  });

  it('injects the saved MinerU token and keeps the environment as fallback', async () => {
    const { database, envModule } = await loadEnvModule();
    const user = database.userDb.createUser('mineru-env-user', 'hashed-password');

    const fallbackEnv = envModule.buildAgentSessionEnv(user.id, {
      MINERU_API_TOKEN: 'server-mineru-token',
    });
    expect(fallbackEnv.MINERU_API_TOKEN).toBe('server-mineru-token');

    database.credentialsDb.createCredential(
      user.id,
      'MinerU API Token',
      'mineru_api_token',
      'user-mineru-token',
    );
    const userEnv = envModule.buildAgentSessionEnv(user.id, {
      MINERU_API_TOKEN: 'server-mineru-token',
    });
    expect(userEnv.MINERU_API_TOKEN).toBe('user-mineru-token');
  });

  it('replaces an existing MinerU token without exposing it in status', async () => {
    const { database } = await loadEnvModule();
    const { getMinerUCredentialStatus, getMinerUCredentials, saveMinerUApiToken } = await import('../utils/mineruCredentials.js');
    const user = database.userDb.createUser('mineru-settings-user', 'hashed-password');

    saveMinerUApiToken(user.id, 'first-user-token');
    const status = saveMinerUApiToken(user.id, 'replacement-user-token');
    const activeCredentials = database.credentialsDb
      .getCredentials(user.id, 'mineru_api_token')
      .filter((credential) => credential.is_active);

    expect(status).toEqual({ configured: true, source: 'user_credential' });
    expect(JSON.stringify(getMinerUCredentialStatus(user.id))).not.toContain('replacement-user-token');
    expect(getMinerUCredentials(user.id).apiToken).toBe('replacement-user-token');
    expect(activeCredentials).toHaveLength(1);
  });

  it('injects the account-free MedHelp API base URL and local owner metadata', async () => {
    const { database, envModule } = await loadEnvModule();
    const user = database.userDb.createUser('medhelp-api-env-user', 'hashed-password');

    const env = envModule.buildAgentSessionEnv(user.id, {
      PORT: '3131',
    });

    expect(env.MEDHELP_API_BASE_URL).toBe('http://127.0.0.1:3131');
    expect(env.MEDHELP_API_TOKEN).toBeUndefined();
    expect(env.MEDHELP_AUTHORIZATION).toBeUndefined();
    expect(env.MEDHELP_USER_ID).toBe(String(user.id));
    expect(env.MEDHELP_USERNAME).toBe('medhelp-api-env-user');
  });
});
