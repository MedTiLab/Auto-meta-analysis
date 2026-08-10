import express from 'express';
import { llmOAuthService } from '../services/providerOAuthService.js';

const router = express.Router();
const SUPPORTED = new Set(['openai', 'grok']);

function assertProvider(value) {
  const provider = String(value || '').toLowerCase();
  if (!SUPPORTED.has(provider)) {
    const error = new Error(`Unsupported OAuth provider: ${value}`);
    error.status = 404;
    throw error;
  }
  return provider;
}

function sendError(res, error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error('[ERROR] Provider OAuth:', error.message || error);
  res.status(status).json({ error: error.message || String(error) });
}

router.get('/:provider', async (req, res) => {
  try {
    res.json(await llmOAuthService.status(assertProvider(req.params.provider)));
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:provider/start', async (req, res) => {
  try {
    res.json(await llmOAuthService.start(assertProvider(req.params.provider)));
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:provider', async (req, res) => {
  try {
    await llmOAuthService.logout(assertProvider(req.params.provider));
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;

export function createProviderOAuthAliasRouter(providerName) {
  const provider = assertProvider(providerName);
  const aliasRouter = express.Router();
  aliasRouter.get('/', async (_req, res) => {
    try {
      res.json(await llmOAuthService.status(provider));
    } catch (error) {
      sendError(res, error);
    }
  });
  aliasRouter.post('/start', async (_req, res) => {
    try {
      res.json(await llmOAuthService.start(provider));
    } catch (error) {
      sendError(res, error);
    }
  });
  aliasRouter.delete('/', async (_req, res) => {
    try {
      await llmOAuthService.logout(provider);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });
  return aliasRouter;
}
