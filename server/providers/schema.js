/**
 * Provider types — preset-based provider configuration.
 *
 * Providers are stored under the MedAutoData application-data directory.
 * Active provider variables are injected into each backend agent session.
 */
import { z } from 'zod';
export const CLAUDE_OFFICIAL_PROVIDER_ID = 'claude-official';
export const OPENAI_OFFICIAL_PROVIDER_ID = 'openai-official';
export const GROK_OFFICIAL_PROVIDER_ID = 'grok-official';
export const BUILT_IN_PROVIDER_IDS = [
    CLAUDE_OFFICIAL_PROVIDER_ID,
    OPENAI_OFFICIAL_PROVIDER_ID,
    GROK_OFFICIAL_PROVIDER_ID,
];
export function isBuiltInProviderId(id) {
    return !!id && BUILT_IN_PROVIDER_IDS.includes(id);
}
export const ApiFormatSchema = z.enum([
    'anthropic', // Native Anthropic Messages API (passthrough, no proxy)
    'openai_chat', // OpenAI Chat Completions /v1/chat/completions
    'openai_responses', // OpenAI Responses API /v1/responses
    'azure_openai_responses', // Azure OpenAI Responses API /openai/responses
]);
export const ProviderAuthStrategySchema = z.enum([
    'api_key',
    'auth_token',
    'auth_token_empty_api_key',
    'dual_same_token',
    'dual_dummy',
    'azure_api_key',
]);
export const ProviderRuntimeKindSchema = z.enum([
    'anthropic_compatible',
    'openai_oauth',
    'grok_oauth',
]);
export const ModelMappingSchema = z.object({
    main: z.string(),
    fable: z.string().optional(),
    haiku: z.string(),
    sonnet: z.string(),
    opus: z.string(),
});
export const Model1mSupportSchema = z.object({
    main: z.boolean(),
    haiku: z.boolean(),
    sonnet: z.boolean(),
    opus: z.boolean(),
});
export const AutoCompactWindowSchema = z.number().int().min(16000).max(10000000);
export const ModelContextWindowsSchema = z.record(z.string().min(1), z.number().int().min(16000).max(10000000));
export const ToolSearchEnabledSchema = z.boolean();
export const DisableExperimentalBetasSchema = z.boolean();
export const SavedProviderSchema = z.object({
    id: z.string(),
    presetId: z.string(),
    name: z.string().min(1),
    apiKey: z.string(),
    authStrategy: ProviderAuthStrategySchema.optional(),
    baseUrl: z.string(),
    apiFormat: ApiFormatSchema.default('anthropic'),
    runtimeKind: ProviderRuntimeKindSchema.default('anthropic_compatible'),
    models: ModelMappingSchema,
    model1mSupport: Model1mSupportSchema.optional(),
    autoCompactWindow: AutoCompactWindowSchema.optional(),
    modelContextWindows: ModelContextWindowsSchema.optional(),
    toolSearchEnabled: ToolSearchEnabledSchema.optional(),
    disableExperimentalBetas: DisableExperimentalBetasSchema.optional(),
    notes: z.string().optional(),
});
export const ProvidersIndexSchema = z.object({
    schemaVersion: z.number().int().positive().optional(),
    activeId: z.string().nullable(),
    providers: z.array(SavedProviderSchema),
    providerOrder: z.array(z.string()).default([]),
});
export const CreateProviderSchema = z.object({
    presetId: z.string().min(1),
    name: z.string().min(1),
    apiKey: z.string(),
    authStrategy: ProviderAuthStrategySchema.optional(),
    baseUrl: z.string(),
    apiFormat: ApiFormatSchema.default('anthropic'),
    runtimeKind: ProviderRuntimeKindSchema.default('anthropic_compatible'),
    models: ModelMappingSchema,
    model1mSupport: Model1mSupportSchema.optional(),
    autoCompactWindow: AutoCompactWindowSchema.optional(),
    modelContextWindows: ModelContextWindowsSchema.optional(),
    toolSearchEnabled: ToolSearchEnabledSchema.optional(),
    disableExperimentalBetas: DisableExperimentalBetasSchema.optional(),
    notes: z.string().optional(),
});
export const UpdateProviderSchema = z.object({
    name: z.string().min(1).optional(),
    apiKey: z.string().optional(),
    authStrategy: ProviderAuthStrategySchema.optional(),
    baseUrl: z.string().optional(),
    apiFormat: ApiFormatSchema.optional(),
    runtimeKind: ProviderRuntimeKindSchema.optional(),
    models: ModelMappingSchema.optional(),
    model1mSupport: Model1mSupportSchema.nullable().optional(),
    autoCompactWindow: AutoCompactWindowSchema.nullable().optional(),
    modelContextWindows: ModelContextWindowsSchema.nullable().optional(),
    toolSearchEnabled: ToolSearchEnabledSchema.optional(),
    disableExperimentalBetas: DisableExperimentalBetasSchema.optional(),
    notes: z.string().optional(),
});
export const TestProviderSchema = z.object({
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    modelId: z.string().min(1),
    authStrategy: ProviderAuthStrategySchema.optional(),
    apiFormat: ApiFormatSchema.default('anthropic'),
});
export const ReorderProvidersSchema = z.object({
    // A permutation of the display provider ids, including built-in official providers.
    // The legacy saved-provider-only permutation is still accepted by ProviderService.
    orderedIds: z.array(z.string().min(1)).min(1),
});
