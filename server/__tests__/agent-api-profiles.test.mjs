import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalRuntimeFile = process.env.MEDAUTODATA_RUNTIME_FILE;
const originalSecretKey = process.env.MEDHELP_SECRET_KEY;
let tempRoot = null;

async function loadModules() {
  vi.resetModules();
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  const envModule = await import('../utils/agentSessionEnv.js');
  return { database, envModule };
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-api-profiles-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.MEDAUTODATA_RUNTIME_FILE = path.join(tempRoot, 'ports.json');
  process.env.MEDHELP_SECRET_KEY = 'test-secret-key';
});

afterEach(async () => {
  vi.resetModules();
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
  if (originalRuntimeFile === undefined) delete process.env.MEDAUTODATA_RUNTIME_FILE;
  else process.env.MEDAUTODATA_RUNTIME_FILE = originalRuntimeFile;
  if (originalSecretKey === undefined) delete process.env.MEDHELP_SECRET_KEY;
  else process.env.MEDHELP_SECRET_KEY = originalSecretKey;
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('agent API profiles', () => {
  it('stores user API secrets encrypted and injects the selected profile env', async () => {
    const { database, envModule } = await loadModules();
    const user = database.userDb.createUser('api-profile-user', 'hashed-password');

    const profile = database.agentApiProfilesDb.createUserProfile(user.id, {
      name: 'Customer Gateway',
      apiKey: 'sk-ant-customer-secret',
      baseUrl: 'https://gateway.example.com/',
      runtimeModel: 'claude-test-runtime',
      modelPlan: 'plus',
    });
    database.agentApiProfilesDb.setUserSelection(user.id, { mode: 'profile', profileId: profile.id });

    expect(profile.hasSecret).toBe(true);
    expect(profile.secret).toBeUndefined();
    expect(profile.secretLast4).toBe('cret');
    expect(profile.modelPlan).toBe('all');

    const rawRow = database.db.prepare('SELECT encrypted_secret FROM agent_api_profiles WHERE id = ?').get(profile.id);
    expect(rawRow.encrypted_secret).not.toContain('customer-secret');

    const env = envModule.buildAgentSessionEnv(user.id, { PATH: '/usr/bin' });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-customer-secret');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://gateway.example.com');
    expect(env.ANTHROPIC_API_URL).toBe('https://gateway.example.com');
    expect(env.ANTHROPIC_MODEL).toBe('claude-test-runtime');
    expect(env.MEDHELP_MODEL_PLAN).toBeUndefined();
    expect(env.MEDHELP_AGENT_API_PROFILE_ID).toBe(String(profile.id));
  });

  it('allows personal API profiles without an account plan', async () => {
    const { database, envModule } = await loadModules();
    const user = database.userDb.createUser('local-api-profile-user', 'hashed-password');

    const profile = database.agentApiProfilesDb.createUserProfile(user.id, {
      name: 'Local Gateway',
      apiKey: 'sk-ant-local-secret',
    });
    database.agentApiProfilesDb.setUserSelection(user.id, { mode: 'profile', profileId: profile.id });

    const env = envModule.buildAgentSessionEnv(user.id, {});
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-local-secret');
    expect(env.MEDHELP_AGENT_API_PROFILE_SCOPE).toBe('user');
  });

  it('keeps the selected personal profile independent of legacy membership fields', async () => {
    const { database, envModule } = await loadModules();
    const user = database.userDb.createUser('personal-api-profile-user', 'hashed-password');

    const personalProfile = database.agentApiProfilesDb.createUserProfile(user.id, {
      name: 'Personal Gateway',
      apiKey: 'sk-ant-personal-secret',
    });
    database.agentApiProfilesDb.setUserSelection(user.id, { mode: 'profile', profileId: personalProfile.id });
    database.agentApiProfilesDb.createSystemProfile({
      name: 'System Default',
      apiKey: 'system-default-secret',
      modelPlan: 'free',
    });

    const env = envModule.buildAgentSessionEnv(user.id, {});
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-personal-secret');
    expect(env.MEDHELP_AGENT_API_PROFILE_SCOPE).toBe('user');
  });

  it('round-robins matching system profiles when user is on system auto', async () => {
    const { database, envModule } = await loadModules();
    const user = database.userDb.createUser('round-robin-user', 'hashed-password');

    database.agentApiProfilesDb.createSystemProfile({
      name: 'System A',
      apiKey: 'system-a-secret',
      modelPlan: 'pro',
    });
    database.agentApiProfilesDb.createSystemProfile({
      name: 'System B',
      apiKey: 'system-b-secret',
      modelPlan: 'pro',
    });
    database.agentApiProfilesDb.setSystemStrategy('round_robin');

    const first = envModule.buildAgentSessionEnv(user.id, {});
    const second = envModule.buildAgentSessionEnv(user.id, {});
    const third = envModule.buildAgentSessionEnv(user.id, {});

    expect([first.ANTHROPIC_API_KEY, second.ANTHROPIC_API_KEY]).toEqual([
      'system-a-secret',
      'system-b-secret',
    ]);
    expect(third.ANTHROPIC_API_KEY).toBe('system-a-secret');
  });
});
