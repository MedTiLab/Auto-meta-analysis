import { describe, expect, test } from 'vitest';
import { PROVIDER_PRESETS } from '../config/providerPresets.js';

describe('LLM provider presets', () => {
  test('ports every provider preset from the reference backend in order', () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      'official',
      'deepseek',
      'zhipuglm',
      'kimi',
      'minimax',
      'jiekouai',
      'shengsuanyun',
      'teamorouter',
      'lmstudio',
      'ollama',
      'custom',
    ]);
  });

  test('preserves provider-specific URLs, authentication and model metadata', () => {
    const byId = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]));
    expect(byId.get('deepseek')).toMatchObject({
      baseUrl: 'https://api.deepseek.com/anthropic',
      authStrategy: 'auth_token',
      defaultModels: { main: 'deepseek-v4-pro[1m]', haiku: 'deepseek-v4-flash' },
    });
    expect(byId.get('zhipuglm')?.modelContextWindows['glm-5.2[1m]']).toBe(1000000);
    expect(byId.get('kimi')).toMatchObject({
      baseUrl: 'https://api.kimi.com/coding/',
      authStrategy: 'api_key',
      defaultModels: { main: 'k3' },
    });
    expect(byId.get('minimax')?.modelContextWindows['MiniMax-M3']).toBe(1000000);
    expect(byId.get('jiekouai')).toMatchObject({ featured: true, baseUrl: 'https://api.jiekou.ai/anthropic' });
    expect(byId.get('shengsuanyun')).toMatchObject({ featured: true, baseUrl: 'https://router.shengsuanyun.com/api' });
    expect(byId.get('teamorouter')).toMatchObject({ featured: true, baseUrl: 'https://api.teamorouter.com' });
    expect(byId.get('lmstudio')).toMatchObject({ needsApiKey: false, authStrategy: 'auth_token_empty_api_key' });
    expect(byId.get('ollama')).toMatchObject({ needsApiKey: false, authStrategy: 'auth_token_empty_api_key' });
  });
});
