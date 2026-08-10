import { describe, expect, test } from 'vitest';
import {
  normalizeProviderItems,
  providerFormFromPreset,
  providerPayloadFromForm,
} from './LlmProvidersContent';

describe('LLM provider settings helpers', () => {
  test('renders saved and built-in providers in persisted order without duplicates', () => {
    const items = normalizeProviderItems({
      providers: [{ id: 'saved-1', name: 'Gateway' }],
      builtIns: [
        { id: 'claude-official', name: 'Claude Official' },
        { id: 'openai-official', name: 'ChatGPT Official' },
        { id: 'grok-official', name: 'Grok Official' },
      ],
      providerOrder: ['openai-official', 'saved-1', 'openai-official'],
    });
    expect(items.map((item) => item.id)).toEqual([
      'openai-official',
      'saved-1',
      'claude-official',
      'grok-official',
    ]);
  });

  test('preserves preset 1M and context-window defaults in editable form state', () => {
    const form = providerFormFromPreset({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiFormat: 'anthropic',
      authStrategy: 'auth_token',
      defaultModels: {
        main: 'deepseek-v4-pro[1m]',
        haiku: 'deepseek-v4-flash',
        sonnet: 'deepseek-v4-pro[1m]',
        opus: 'deepseek-v4-pro[1m]',
      },
      modelContextWindows: { 'deepseek-v4-pro[1m]': 1000000 },
    });
    expect(form.models.main).toBe('deepseek-v4-pro');
    expect(form.model1mSupport.main).toBe(true);
    expect(form.contextWindows.main).toBe('1000000');
  });

  test('omits nullable advanced fields on create and preserves a saved key on edit', () => {
    const form = {
      ...providerFormFromPreset({
        id: 'custom',
        name: 'Custom',
        baseUrl: 'https://gateway.example.test',
        apiFormat: 'openai_responses',
        authStrategy: 'api_key',
        defaultModels: { main: 'gpt', haiku: 'gpt', sonnet: 'gpt', opus: 'gpt' },
      }),
      apiKey: '',
    };
    const createPayload = providerPayloadFromForm(form, false);
    expect(createPayload).not.toHaveProperty('modelContextWindows');
    expect(createPayload).not.toHaveProperty('autoCompactWindow');
    expect(createPayload.apiKey).toBe('');

    const editPayload = providerPayloadFromForm(form, true);
    expect(editPayload).not.toHaveProperty('apiKey');
    expect(editPayload.modelContextWindows).toBeNull();
    expect(editPayload.autoCompactWindow).toBeNull();
  });
});
