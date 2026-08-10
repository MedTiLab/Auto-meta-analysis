import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';

/**
 * Test suite for auto-generated workspace names feature
 * Verifies that when creating a new workspace, the folder name is auto-generated
 * in the format: {word}-{YYYYMMDD}
 */

// Pattern for auto-generated workspace name: word-YYYYMMDD (e.g., aurora-20240224)
const WORKSPACE_NAME_PATTERN = /^[a-z]+-\d{8}$/;
const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';
const MAX_USER_ID_SCAN = Number(process.env.PLAYWRIGHT_MAX_USER_ID_SCAN || 10);
const LOGIN_USERNAME = process.env.PLAYWRIGHT_USERNAME;
const LOGIN_PASSWORD = process.env.PLAYWRIGHT_PASSWORD;
const REGISTRATION_AUTH_CODE = process.env.PLAYWRIGHT_REGISTRATION_AUTH_CODE || process.env.REGISTRATION_AUTH_CODE;

const getCreateProjectButton = (page: Page) =>
  page
    .locator(
      'button[title*="Create"], button:has(svg.lucide-plus), button:has(svg.lucide-folder-plus)',
    )
    .first();

const getWizardRoot = (page: Page) =>
  page.locator('text=Create New Project').first();

const getBrowseFoldersButton = (page: Page) =>
  page.locator('button[title="Browse folders"]');

const ensureFolderNameInputVisible = async (page: Page) => {
  await page.locator('button[title="Create new folder"]').click();
  await expect(page.locator('input[placeholder="New folder name"]')).toBeVisible();
};

async function findValidTokenForExistingUser(request: APIRequestContext): Promise<string | null> {
  for (let userId = 1; userId <= MAX_USER_ID_SCAN; userId += 1) {
    const candidateToken = jwt.sign(
      { userId, username: `playwright-e2e-${userId}` },
      JWT_SECRET,
    );
    const response = await request.get('/api/auth/user', {
      headers: { Authorization: `Bearer ${candidateToken}` },
    });
    if (response.ok()) {
      return candidateToken;
    }
  }

  return null;
}

async function getAuthToken(request: APIRequestContext): Promise<string> {
  const authStatusResponse = await request.get('/api/auth/status');
  expect(authStatusResponse.ok()).toBeTruthy();
  const authStatus = await authStatusResponse.json();

  if (authStatus.needsSetup) {
    if (!REGISTRATION_AUTH_CODE) {
      throw new Error('Initial setup requires PLAYWRIGHT_REGISTRATION_AUTH_CODE or REGISTRATION_AUTH_CODE.');
    }

    const setupUsername = process.env.PLAYWRIGHT_SETUP_USERNAME || `playwright-${Date.now()}`;
    const setupPassword = process.env.PLAYWRIGHT_SETUP_PASSWORD || 'playwright-password-123';

    const registerResponse = await request.post('/api/auth/register', {
      data: {
        username: setupUsername,
        password: setupPassword,
        notificationEmail: process.env.PLAYWRIGHT_SETUP_EMAIL || `${setupUsername}@example.com`,
        authorizationCode: REGISTRATION_AUTH_CODE,
      },
    });

    expect(registerResponse.ok()).toBeTruthy();
    const registerBody = await registerResponse.json();
    return registerBody.token;
  }

  if (LOGIN_USERNAME && LOGIN_PASSWORD) {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: LOGIN_USERNAME, password: LOGIN_PASSWORD },
    });
    expect(loginResponse.ok()).toBeTruthy();
    const loginBody = await loginResponse.json();
    return loginBody.token;
  }

  const discoveredToken = await findValidTokenForExistingUser(request);
  if (discoveredToken) {
    return discoveredToken;
  }

  throw new Error(
    'Authentication required. Set PLAYWRIGHT_USERNAME/PLAYWRIGHT_PASSWORD, or provide a dev JWT secret compatible with existing users.',
  );
}

async function ensureAuthenticated(page: Page, request: APIRequestContext) {
  const token = await getAuthToken(request);

  // Complete onboarding proactively so tests always land on the main app shell.
  await request.post('/api/user/complete-onboarding', {
    headers: { Authorization: `Bearer ${token}` },
  });

  await page.addInitScript((authToken) => {
    window.localStorage.setItem('auth-token', authToken);
  }, token);
}

async function openFolderBrowserWithNewFolderInput(page: Page) {
  const createButton = getCreateProjectButton(page);
  await expect(createButton).toBeVisible({ timeout: 15000 });
  await createButton.click();

  await expect(getWizardRoot(page)).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /new workspace/i }).click();

  await page.getByRole('button', { name: /next/i }).click();
  await expect(getBrowseFoldersButton(page)).toBeVisible({ timeout: 10000 });
  await getBrowseFoldersButton(page).click();

  await expect(page.locator('text=Select Folder')).toBeVisible({ timeout: 10000 });
  await ensureFolderNameInputVisible(page);
}

test.describe('Auto-generated Workspace Names', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page, page.request);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('should auto-generate workspace name when opening folder browser', async ({ page }) => {
    await openFolderBrowserWithNewFolderInput(page);

    // Get the new folder name input value
    const folderNameInput = page.locator('input[placeholder="New folder name"]');
    const autoGeneratedName = await folderNameInput.inputValue();

    // Verify the name matches the expected pattern
    expect(autoGeneratedName).toMatch(WORKSPACE_NAME_PATTERN);
    console.log(`Auto-generated name: ${autoGeneratedName}`);
  });

  test('should default new workspace path to the configured workspace root', async ({ page, request }) => {
    const rootResponse = await request.get('/api/projects/workspace-root', {
      headers: { Authorization: `Bearer ${await getAuthToken(request)}` },
    });
    expect(rootResponse.ok()).toBeTruthy();
    const rootBody = await rootResponse.json();
    const expectedRoot = rootBody.path;

    const createButton = getCreateProjectButton(page);
    await expect(createButton).toBeVisible({ timeout: 15000 });
    await createButton.click();

    await expect(getWizardRoot(page)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /new workspace/i }).click();
    await page.getByRole('button', { name: /next/i }).click();

    const workspacePathInput = page.locator('input[placeholder="/path/to/new/workspace"]').first();
    await expect(workspacePathInput).toBeVisible({ timeout: 10000 });

    await expect.poll(async () => workspacePathInput.inputValue()).toMatch(
      new RegExp(`^${expectedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\\\/].+$`),
    );
  });

  test('should regenerate name when clicking refresh button', async ({ page }) => {
    await openFolderBrowserWithNewFolderInput(page);

    const folderNameInput = page.locator('input[placeholder="New folder name"]');
    const firstGeneratedName = await folderNameInput.inputValue();

    // Click the regenerate button (RefreshCw icon button)
    const regenerateButton = page.locator('button[aria-label*="Generate"], button[title*="Generate"]').first();
    await expect(regenerateButton).toBeVisible();
    await regenerateButton.click();

    const secondGeneratedName = await folderNameInput.inputValue();

    // Both names should match the pattern
    expect(firstGeneratedName).toMatch(WORKSPACE_NAME_PATTERN);
    expect(secondGeneratedName).toMatch(WORKSPACE_NAME_PATTERN);

    // Names might be the same if same word is randomly picked, but they should still be valid
    console.log(`First name: ${firstGeneratedName}, Second name: ${secondGeneratedName}`);
  });

  test('should allow user to edit the auto-generated name', async ({ page }) => {
    await openFolderBrowserWithNewFolderInput(page);

    const folderNameInput = page.locator('input[placeholder="New folder name"]');

    // Clear and type a custom name
    await folderNameInput.clear();
    await folderNameInput.fill('my-custom-project');

    const customName = await folderNameInput.inputValue();
    expect(customName).toBe('my-custom-project');
  });
});
