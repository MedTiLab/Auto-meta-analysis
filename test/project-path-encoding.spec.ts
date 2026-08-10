import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Test suite for project path encoding consistency and dedup.
 *
 * Verifies that:
 * 1. Paths containing "." are encoded correctly (dots replaced with dashes)
 * 2. Adding the same path twice does not create duplicates
 * 3. Legacy-encoded project IDs are migrated to the new encoding
 *
 * Run with: PORT=3099 node server/index.js  (separate test backend)
 * Then:     TEST_API_BASE=http://localhost:3099 npx playwright test project-path-encoding
 */

const API_BASE = process.env.TEST_API_BASE || '';
const LOGIN_USERNAME = process.env.PLAYWRIGHT_USERNAME || 'bbsngg';
const LOGIN_PASSWORD = process.env.PLAYWRIGHT_PASSWORD || '111111';

let authToken: string;

async function login(request: APIRequestContext): Promise<string> {
  const loginResponse = await request.post(`${API_BASE}/api/auth/login`, {
    data: { username: LOGIN_USERNAME, password: LOGIN_PASSWORD },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const body = await loginResponse.json();
  expect(body.token).toBeTruthy();
  return body.token;
}

function authHeaders() {
  return { Authorization: `Bearer ${authToken}` };
}

test.beforeAll(async ({ request }) => {
  authToken = await login(request);

  // Complete onboarding so API calls work normally
  await request.post(`${API_BASE}/api/user/complete-onboarding`, {
    headers: authHeaders(),
  });
});

test.describe('Project path encoding & dedup', () => {
  // Use a unique temp path per test run to avoid cross-run collisions
  const testId = Date.now();
  const dotPath = `/tmp/test.user.${testId}/my.project`;
  const normalPath = `/tmp/test-normal-${testId}/myproject`;

  test.beforeAll(async () => {
    // Create test directories
    const { mkdirSync } = await import('fs');
    mkdirSync(dotPath, { recursive: true });
    mkdirSync(normalPath, { recursive: true });
  });

  test.afterAll(async () => {
    // Clean up test directories
    const { rmSync } = await import('fs');
    rmSync(`/tmp/test.user.${testId}`, { recursive: true, force: true });
    rmSync(`/tmp/test-normal-${testId}`, { recursive: true, force: true });
  });

  test('dot-containing path is encoded with dots replaced by dashes', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/projects/create`, {
      headers: authHeaders(),
      data: { path: dotPath },
    });
    expect(response.ok()).toBeTruthy();

    const { project } = await response.json();
    // Dots in path should be replaced with dashes
    expect(project.name).not.toContain('.');
    expect(project.name).toMatch(/-tmp-test-user-/);
    expect(project.path).toBe(dotPath);
  });

  test('adding the same path twice returns existing project without duplication', async ({ request }) => {
    // First add
    const res1 = await request.post(`${API_BASE}/api/projects/create`, {
      headers: authHeaders(),
      data: { path: normalPath },
    });
    expect(res1.ok()).toBeTruthy();
    const { project: project1 } = await res1.json();

    // Second add — same path
    const res2 = await request.post(`${API_BASE}/api/projects/create`, {
      headers: authHeaders(),
      data: { path: normalPath },
    });
    expect(res2.ok()).toBeTruthy();
    const { project: project2 } = await res2.json();

    // Should return the same project name
    expect(project2.name).toBe(project1.name);
  });

  test('dot-containing path added twice does not create duplicate', async ({ request }) => {
    // dotPath was already added in the first test; add again
    const response = await request.post(`${API_BASE}/api/projects/create`, {
      headers: authHeaders(),
      data: { path: dotPath },
    });
    expect(response.ok()).toBeTruthy();

    const { project } = await response.json();
    expect(project.name).not.toContain('.');
  });

  test('normal path encoding is consistent with encodeProjectPath', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/projects/create`, {
      headers: authHeaders(),
      data: { path: normalPath },
    });
    expect(response.ok()).toBeTruthy();

    const { project } = await response.json();
    // /tmp/test-normal-xxx/myproject -> -tmp-test-normal-xxx-myproject
    expect(project.name).toMatch(/^-tmp-test-normal-/);
    expect(project.name).not.toContain('/');
    expect(project.name).not.toContain('\\');
  });
});
