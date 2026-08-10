import crypto from 'crypto';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { getOpenAIOAuthFilePath } from './openaiOfficialProvider.js';
import { getGrokOAuthFilePath } from './grokOfficialProvider.js';

const OPENAI = {
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  scope: 'openid profile email offline_access',
  callbackPath: '/auth/callback',
  callbackPort: 1455,
};

const GROK = {
  authorizeUrl: 'https://auth.x.ai/oauth2/authorize',
  tokenUrl: 'https://auth.x.ai/oauth2/token',
  clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
  scope: 'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write',
  callbackPath: '/callback',
  callbackPort: 0,
};

const SESSION_TTL_MS = 10 * 60 * 1000;
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

function providerConfig(provider) {
  if (provider === 'openai') return OPENAI;
  if (provider === 'grok') return GROK;
  throw new Error(`Unsupported OAuth provider: ${provider}`);
}

function tokenFile(provider) {
  return provider === 'openai' ? getOpenAIOAuthFilePath() : getGrokOAuthFilePath();
}

function base64UrlSha256(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function randomValue(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseJwtClaims(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function extractAccountId(claims) {
  return claims?.chatgpt_account_id
    || claims?.['https://api.openai.com/auth']?.chatgpt_account_id
    || claims?.organizations?.[0]?.id
    || null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeTokenError(value) {
  return String(value || '')
    .replace(/"((?:access_token|refresh_token|id_token|code|code_verifier))"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/\b(access_token|refresh_token|id_token|code|code_verifier)=([^&\s]+)/gi, '$1=[redacted]')
    .slice(0, 500);
}

function callbackHtml(success, message) {
  const color = success ? '#16a34a' : '#dc2626';
  const title = success ? 'Login successful' : 'Login failed';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa}.card{max-width:640px;text-align:center;padding:40px;background:#fff;border-radius:12px;box-shadow:0 4px 16px #00000010}h1{color:${color}}pre{white-space:pre-wrap;word-break:break-word}</style>
</head><body><div class="card"><h1>${title}</h1><pre>${escapeHtml(message)}</pre></div>${success ? '<script>setTimeout(()=>window.close(),1500)</script>' : ''}</body></html>`;
}

export class ProviderOAuthService {
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    this.sessions = new Map();
  }

  async loadTokens(provider) {
    try {
      return JSON.parse(await fs.readFile(tokenFile(provider), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async saveTokens(provider, tokens) {
    const filePath = tokenFile(provider);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tempPath, filePath);
      await fs.chmod(filePath, 0o600).catch(() => {});
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async logout(provider) {
    providerConfig(provider);
    await fs.rm(tokenFile(provider), { force: true });
  }

  async start(provider) {
    const config = providerConfig(provider);
    this.closeSession(provider);
    const codeVerifier = randomValue(64);
    const state = randomValue(32);
    const nonce = randomValue(16);
    const server = http.createServer();

    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.callbackPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve(server.address().port);
      });
    });
    const host = provider === 'openai' ? 'localhost' : '127.0.0.1';
    const redirectUri = `http://${host}:${port}${config.callbackPath}`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scope,
      state,
      code_challenge: base64UrlSha256(codeVerifier),
      code_challenge_method: 'S256',
    });
    if (provider === 'openai') {
      params.set('id_token_add_organizations', 'true');
      params.set('codex_cli_simplified_flow', 'true');
    } else {
      params.set('nonce', nonce);
    }
    const session = {
      provider,
      state,
      codeVerifier,
      redirectUri,
      createdAt: Date.now(),
      server,
      timer: null,
    };
    session.timer = setTimeout(() => this.closeSession(provider), SESSION_TTL_MS);
    session.timer.unref?.();
    this.sessions.set(provider, session);

    server.on('request', async (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== config.callbackPath) {
        res.writeHead(404).end('Not Found');
        return;
      }
      try {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const oauthError = url.searchParams.get('error');
        if (oauthError) throw new Error(`OAuth provider returned: ${oauthError}`);
        if (!code || returnedState !== state) throw new Error('Missing authorization code or invalid OAuth state');
        await this.complete(provider, code, state);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(callbackHtml(true, 'Authorization is complete. You can close this window.'));
      } catch (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(callbackHtml(false, error.message || String(error)));
      } finally {
        this.closeSession(provider);
      }
    });

    return { authorizeUrl: `${config.authorizeUrl}?${params}`, state, redirectUri };
  }

  async complete(provider, code, state) {
    const config = providerConfig(provider);
    const session = this.sessions.get(provider);
    if (!session || session.state !== state || Date.now() - session.createdAt > SESSION_TTL_MS) {
      throw new Error(`${provider} OAuth session not found or expired`);
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      redirect_uri: session.redirectUri,
      code_verifier: session.codeVerifier,
    });
    const response = await this.fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': provider === 'openai' ? 'codex-cli/0.144.0' : 'medautodata-grok-oauth/1.0',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const errorBody = sanitizeTokenError(await response.text().catch(() => ''));
      throw new Error(`${provider} token exchange failed: HTTP ${response.status}${errorBody ? `: ${errorBody}` : ''}`);
    }
    const payload = await response.json();
    const tokens = this.normalizeTokens(provider, payload);
    await this.saveTokens(provider, tokens);
    return tokens;
  }

  normalizeTokens(provider, payload, existing = {}) {
    if (!payload.access_token) throw new Error(`${provider} OAuth response did not include an access token`);
    const claims = parseJwtClaims(payload.id_token) || parseJwtClaims(payload.access_token);
    const refreshToken = payload.refresh_token || existing.refreshToken || null;
    if (!refreshToken) throw new Error(`${provider} OAuth response did not include a refresh token`);
    return {
      accessToken: payload.access_token,
      refreshToken,
      expiresAt: Date.now() + (payload.expires_in || 3600) * 1000,
      idToken: payload.id_token || existing.idToken || null,
      email: claims?.email || existing.email || null,
      accountId: provider === 'openai' ? (extractAccountId(claims) || existing.accountId || null) : null,
      clientId: providerConfig(provider).clientId,
    };
  }

  async refresh(provider, tokens) {
    const config = providerConfig(provider);
    if (!tokens.refreshToken) return null;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      refresh_token: tokens.refreshToken,
    });
    if (provider === 'openai') body.set('scope', 'openid profile email');
    const response = await this.fetch(config.tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return null;
    const updated = this.normalizeTokens(provider, await response.json(), tokens);
    await this.saveTokens(provider, updated);
    return updated;
  }

  async getCredential(provider) {
    let tokens = await this.loadTokens(provider);
    if (!tokens) return null;
    if (tokens.expiresAt && tokens.expiresAt - Date.now() <= EXPIRY_SKEW_MS) {
      tokens = await this.refresh(provider, tokens);
    }
    return tokens?.accessToken ? tokens : null;
  }

  async status(provider) {
    const tokens = await this.getCredential(provider);
    if (!tokens) return { loggedIn: false };
    return {
      loggedIn: true,
      expiresAt: tokens.expiresAt,
      email: tokens.email,
      ...(provider === 'openai' && { accountId: tokens.accountId }),
    };
  }

  closeSession(provider) {
    const session = this.sessions.get(provider);
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    session.server.close();
    this.sessions.delete(provider);
  }

  dispose() {
    for (const provider of [...this.sessions.keys()]) this.closeSession(provider);
  }
}

export const llmOAuthService = new ProviderOAuthService();
