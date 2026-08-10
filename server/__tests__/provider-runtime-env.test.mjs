import { afterEach, describe, expect, test } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  buildProviderManagedEnv,
  mergeActiveProviderManagedEnv,
  readActiveProviderManagedEnv,
  readProviderSettingsEnv,
} from '../services/providerRuntimeEnv.js';

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createConfig(index) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-provider-env-'));
  tempDirs.push(dir);
  await fs.writeFile(path.join(dir, 'providers.json'), JSON.stringify(index), 'utf8');
  return dir;
}

describe('provider runtime environment', () => {
  test('builds a native Anthropic-compatible runtime with model slots and capabilities', () => {
    const env = buildProviderManagedEnv({
      id: 'provider-1',
      presetId: 'custom',
      name: 'Native',
      apiKey: 'secret',
      authStrategy: 'auth_token',
      baseUrl: 'https://example.test/anthropic',
      apiFormat: 'anthropic',
      runtimeKind: 'anthropic_compatible',
      toolSearchEnabled: false,
      models: { main: 'model-main', haiku: '', sonnet: 'model-sonnet', opus: '' },
    });

    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://example.test/anthropic',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: 'secret',
      ENABLE_TOOL_SEARCH: 'false',
      ANTHROPIC_MODEL: 'model-main',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'model-main',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'model-sonnet',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'model-main',
    });
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toContain('adaptive_thinking');
  });

  test('routes OpenAI formats through the local protocol bridge without leaking the upstream key', () => {
    const env = buildProviderManagedEnv({
      id: 'provider-openai',
      presetId: 'custom',
      name: 'OpenAI compatible',
      apiKey: 'upstream-secret',
      baseUrl: 'https://example.test',
      apiFormat: 'openai_responses',
      runtimeKind: 'anthropic_compatible',
      models: { main: 'gpt-test', haiku: 'gpt-test', sonnet: 'gpt-test', opus: 'gpt-test' },
    }, { serverPort: 4321, proxyPath: '/proxy/providers/provider-openai' });

    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:4321/proxy/providers/provider-openai');
    expect(env.ANTHROPIC_API_KEY).toBe('proxy-managed');
    expect(Object.values(env)).not.toContain('upstream-secret');
    expect(env.ENABLE_TOOL_SEARCH).toBeUndefined();
  });

  test('loads active persisted provider and replaces stale managed values only', async () => {
    const provider = {
      id: 'active-id',
      presetId: 'kimi',
      name: 'Kimi',
      apiKey: 'kimi-secret',
      authStrategy: 'api_key',
      baseUrl: 'https://api.kimi.com/coding/',
      apiFormat: 'anthropic',
      runtimeKind: 'anthropic_compatible',
      models: { main: 'k3', haiku: 'k3', sonnet: 'k3', opus: 'k3' },
    };
    const dir = await createConfig({ activeId: provider.id, providers: [provider] });
    expect(readActiveProviderManagedEnv(dir)).toMatchObject({ ANTHROPIC_MODEL: 'k3', ANTHROPIC_API_KEY: 'kimi-secret' });

    const merged = mergeActiveProviderManagedEnv({
      ANTHROPIC_MODEL: 'stale',
      ANTHROPIC_AUTH_TOKEN: 'stale-secret',
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: 'us-east-1',
      VERTEX_REGION_CLAUDE_SONNET: 'us-east5',
      UNRELATED_SETTING: 'keep-me',
    }, dir);
    expect(merged).toMatchObject({ ANTHROPIC_MODEL: 'k3', ANTHROPIC_API_KEY: 'kimi-secret', UNRELATED_SETTING: 'keep-me' });
    expect(merged.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(merged.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(merged.AWS_REGION).toBeUndefined();
    expect(merged.VERTEX_REGION_CLAUDE_SONNET).toBeUndefined();
    expect(JSON.parse(merged.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS).k3).toBe(262144);
  });

  test('reads only string environment values from managed provider settings', async () => {
    const dir = await createConfig({ activeId: null, providers: [] });
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({
      env: { API_TIMEOUT_MS: '120000', INVALID_NUMBER: 1, INVALID_OBJECT: {} },
    }));
    expect(readProviderSettingsEnv(dir)).toEqual({ API_TIMEOUT_MS: '120000' });
  });
});
