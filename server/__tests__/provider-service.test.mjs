import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { BUILT_IN_PROVIDER_IDS } from '../providers/schema.js';
import { ProviderService } from '../services/providerService.js';

let tempDir;
let previousProviderDir;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-provider-service-'));
  previousProviderDir = process.env.MEDAUTODATA_PROVIDER_DIR;
  process.env.MEDAUTODATA_PROVIDER_DIR = tempDir;
});

afterEach(async () => {
  if (previousProviderDir === undefined) delete process.env.MEDAUTODATA_PROVIDER_DIR;
  else process.env.MEDAUTODATA_PROVIDER_DIR = previousProviderDir;
  await fs.rm(tempDir, { recursive: true, force: true });
});

function providerInput(overrides = {}) {
  return {
    presetId: 'custom',
    name: 'Test Provider',
    apiKey: 'sk-test',
    authStrategy: 'api_key',
    baseUrl: 'https://api.example.test',
    apiFormat: 'openai_chat',
    models: { main: 'test-main', haiku: '', sonnet: 'test-sonnet', opus: '' },
    ...overrides,
  };
}

describe('ProviderService', () => {
  test('persists CRUD, activation and provider order atomically', async () => {
    const service = new ProviderService();
    const initial = await service.listProviders();
    expect(initial.providers).toEqual([]);
    expect(initial.providerOrder).toEqual(BUILT_IN_PROVIDER_IDS);

    const created = await service.addProvider(providerInput());
    expect(created.models).toEqual({ main: 'test-main', haiku: 'test-main', sonnet: 'test-sonnet', opus: 'test-main' });
    await service.activateProvider(created.id);
    expect((await service.listProviders()).activeId).toBe(created.id);

    const updated = await service.updateProvider(created.id, { name: 'Updated', autoCompactWindow: 200000 });
    expect(updated).toMatchObject({ name: 'Updated', autoCompactWindow: 200000 });
    await expect(service.deleteProvider(created.id)).rejects.toMatchObject({ status: 409 });

    await service.activateOfficial();
    await service.deleteProvider(created.id);
    expect((await service.listProviders()).providers).toEqual([]);

    const stat = await fs.stat(path.join(tempDir, 'providers.json'));
    expect(stat.mode & 0o077).toBe(0);
  });

  test('supports both full display order and legacy saved-provider order', async () => {
    const service = new ProviderService();
    const first = await service.addProvider(providerInput({ name: 'First' }));
    const second = await service.addProvider(providerInput({ name: 'Second' }));

    const legacy = await service.reorderProviders([second.id, first.id]);
    expect(legacy.providers.map((provider) => provider.id)).toEqual([second.id, first.id]);

    const fullOrder = ['grok-official', second.id, 'claude-official', first.id, 'openai-official'];
    const full = await service.reorderProviders(fullOrder);
    expect(full.providerOrder).toEqual(fullOrder);
  });

  test('rejects unknown presets and invalid reorder requests', async () => {
    const service = new ProviderService();
    await expect(service.addProvider(providerInput({ presetId: 'missing' }))).rejects.toMatchObject({ status: 400 });
    await expect(service.reorderProviders(['made-up'])).rejects.toMatchObject({ status: 400 });
  });
});
