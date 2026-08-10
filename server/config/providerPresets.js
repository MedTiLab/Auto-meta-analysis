import fs from 'fs';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { ApiFormatSchema, ProviderAuthStrategySchema } from '../providers/schema.js';

const ModelMappingSchema = z.object({
  main: z.string(),
  fable: z.string().optional(),
  haiku: z.string(),
  sonnet: z.string(),
  opus: z.string(),
});

const ProviderPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema,
  defaultModels: ModelMappingSchema,
  needsApiKey: z.boolean(),
  websiteUrl: z.string(),
  apiKeyUrl: z.string().optional(),
  promoText: z.string().optional(),
  featured: z.boolean().optional(),
  authStrategy: ProviderAuthStrategySchema.optional(),
  defaultEnv: z.record(z.string(), z.string()).optional(),
  modelContextWindows: z.record(
    z.string().min(1),
    z.number().int().min(16000).max(10000000),
  ).optional(),
});

const presetPath = fileURLToPath(new URL('./providerPresets.json', import.meta.url));
const rawPresets = JSON.parse(fs.readFileSync(presetPath, 'utf8'));

export const PROVIDER_PRESETS = z.array(ProviderPresetSchema).parse(rawPresets);

export function getProviderPreset(id) {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) || null;
}
