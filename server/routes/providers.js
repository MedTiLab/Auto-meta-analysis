import express from 'express';
import { z } from 'zod';
import { PROVIDER_PRESETS } from '../config/providerPresets.js';
import { ReorderProvidersSchema, TestProviderSchema } from '../providers/schema.js';
import { providerService } from '../services/providerService.js';

const router = express.Router();

function sanitizeProvider(provider) {
  if (!provider || typeof provider !== 'object') return provider;
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey : '';
  return {
    ...provider,
    apiKey: '',
    hasApiKey: Boolean(apiKey),
    apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
  };
}

function sanitizeProviderPayload(payload) {
  return {
    ...payload,
    ...(Array.isArray(payload.providers) && { providers: payload.providers.map(sanitizeProvider) }),
    ...(Array.isArray(payload.builtIns) && { builtIns: payload.builtIns.map(sanitizeProvider) }),
  };
}

function sendError(res, error) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: error.issues.map((issue) => issue.message).join('; '), code: 'INVALID_PROVIDER_INPUT' });
  }
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error('[ERROR] Provider API:', error.message || error);
  return res.status(status).json({ error: error.message || String(error), code: error.code || 'PROVIDER_ERROR' });
}

router.get('/', async (_req, res) => {
  try {
    res.json(sanitizeProviderPayload(await providerService.listProviders()));
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/presets', (_req, res) => {
  res.json({ presets: PROVIDER_PRESETS });
});

router.get('/auth-status', async (_req, res) => {
  try {
    res.json(await providerService.checkAuthStatus());
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/settings', async (_req, res) => {
  try {
    res.json(await providerService.getManagedSettings());
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/settings', async (req, res) => {
  try {
    res.json({ ok: true, settings: await providerService.updateManagedSettings(req.body) });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/test', async (req, res) => {
  try {
    const input = TestProviderSchema.parse(req.body);
    res.json({ result: await providerService.testProviderConfig(input) });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/official', async (_req, res) => {
  try {
    await providerService.activateOfficial();
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/reorder', async (req, res) => {
  try {
    const input = ReorderProvidersSchema.parse(req.body);
    res.json(sanitizeProviderPayload(await providerService.reorderProviders(input.orderedIds)));
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/', async (req, res) => {
  try {
    res.status(201).json({ provider: sanitizeProvider(await providerService.addProvider(req.body)) });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/activate', async (req, res) => {
  try {
    await providerService.activateProvider(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/test', async (req, res) => {
  try {
    res.json({ result: await providerService.testProvider(req.params.id, req.body || {}) });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/:id', async (req, res) => {
  try {
    res.json({ provider: sanitizeProvider(await providerService.getProvider(req.params.id)) });
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/:id', async (req, res) => {
  try {
    res.json({ provider: sanitizeProvider(await providerService.updateProvider(req.params.id, req.body)) });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await providerService.deleteProvider(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
