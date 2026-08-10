import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDataDir = process.env.MEDAUTODATA_DATA_DIR;
const originalLegacyDataDir = process.env.DR_CLAW_DATA_DIR;
const originalLegacyImport = process.env.AUTOMETA_IMPORT_LEGACY_DATA;

let tempRoot = null;

async function loadStoragePaths() {
  vi.resetModules();
  return import('../utils/storagePaths.js');
}

describe('storage path defaults', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-storage-paths-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    delete process.env.MEDAUTODATA_DATA_DIR;
    delete process.env.DR_CLAW_DATA_DIR;
    delete process.env.AUTOMETA_IMPORT_LEGACY_DATA;
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDataDir === undefined) delete process.env.MEDAUTODATA_DATA_DIR;
    else process.env.MEDAUTODATA_DATA_DIR = originalDataDir;

    if (originalLegacyDataDir === undefined) delete process.env.DR_CLAW_DATA_DIR;
    else process.env.DR_CLAW_DATA_DIR = originalLegacyDataDir;

    if (originalLegacyImport === undefined) delete process.env.AUTOMETA_IMPORT_LEGACY_DATA;
    else process.env.AUTOMETA_IMPORT_LEGACY_DATA = originalLegacyImport;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('defaults the app data root to ~/.autometa', async () => {
    const {
      resolveAppDataRoot,
      resolveAppDatabasePath,
      resolveDesktopLogFallbackPath,
      resolveAppRuntimeDir,
      resolveProjectChatAttachmentsDir,
      resolveProjectConfigPath,
    } = await loadStoragePaths();
    const projectChatAttachmentsDir = resolveProjectChatAttachmentsDir(path.join(tempRoot, 'workspace-demo'));

    expect(resolveAppDataRoot()).toBe(path.join(tempRoot, '.autometa'));
    expect(resolveAppDatabasePath()).toBe(path.join(tempRoot, '.autometa', 'auth.db'));
    expect(resolveProjectConfigPath()).toBe(path.join(tempRoot, '.autometa', 'project-config.json'));
    expect(resolveDesktopLogFallbackPath()).toBe(path.join(tempRoot, '.autometa', 'desktop', 'desktop.log'));
    expect(resolveAppRuntimeDir()).toBe(path.join(tempRoot, '.autometa', 'runtime'));
    expect(projectChatAttachmentsDir).toContain(path.join('.autometa', 'projects'));
    expect(projectChatAttachmentsDir).not.toContain(path.join('workspace-demo', '.med-help'));
  });

  it('keeps project-scoped app state under ~/.autometa/projects', async () => {
    const { getProjectDataRoot } = await loadStoragePaths();
    const projectPath = path.join(tempRoot, 'workspace-demo');
    const projectDataRoot = getProjectDataRoot(projectPath);

    expect(projectDataRoot).toMatch(new RegExp(`^${path.join(tempRoot, '.autometa', 'projects').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(projectDataRoot).toContain(path.join('.autometa', 'projects'));
    expect(projectDataRoot).not.toContain(path.join('workspace-demo', '.med-help'));
  });

  it('does not import legacy data unless explicitly enabled', async () => {
    const { resolveLegacyDatabasePaths } = await loadStoragePaths();
    const projectPath = path.join(tempRoot, 'workspace-demo');

    expect(resolveLegacyDatabasePaths(tempRoot, projectPath)).toEqual([]);

    process.env.AUTOMETA_IMPORT_LEGACY_DATA = 'true';
    const legacyCandidates = resolveLegacyDatabasePaths(tempRoot, projectPath);

    expect(legacyCandidates).toContain(path.join(projectPath, '.med-help', 'auth.db'));
    expect(legacyCandidates).toContain(path.join(tempRoot, '.medautodata', 'auth.db'));
  });
});
