import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ProviderOAuthService } from '../services/providerOAuthService.js';

let tempDir;
let previousDataDir;
const services = [];

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-provider-oauth-'));
  previousDataDir = process.env.MEDAUTODATA_DATA_DIR;
  process.env.MEDAUTODATA_DATA_DIR = tempDir;
});

afterEach(async () => {
  services.splice(0).forEach((service) => service.dispose());
  if (previousDataDir === undefined) delete process.env.MEDAUTODATA_DATA_DIR;
  else process.env.MEDAUTODATA_DATA_DIR = previousDataDir;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('official provider OAuth service', () => {
  test('creates a Grok PKCE authorization session on a loopback callback', async () => {
    const service = new ProviderOAuthService();
    services.push(service);
    const session = await service.start('grok');
    const url = new URL(session.authorizeUrl);
    expect(url.origin).toBe('https://auth.x.ai');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(session.state);
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });

  test('refreshes expired OpenAI tokens and returns status without exposing credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const service = new ProviderOAuthService({ fetch: fetchMock });
    services.push(service);
    await service.saveTokens('openai', {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1000,
      email: 'person@example.test',
      accountId: 'account-1',
    });

    const credential = await service.getCredential('openai');
    expect(credential).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await service.status('openai')).toEqual(expect.objectContaining({ loggedIn: true }));
    expect(await service.status('openai')).not.toHaveProperty('accessToken');
    expect(await service.status('openai')).not.toHaveProperty('refreshToken');
  });

  test('removes stored provider tokens on logout', async () => {
    const service = new ProviderOAuthService();
    services.push(service);
    await service.saveTokens('grok', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    expect((await service.status('grok')).loggedIn).toBe(true);
    await service.logout('grok');
    expect(await service.status('grok')).toEqual({ loggedIn: false });
  });
});
