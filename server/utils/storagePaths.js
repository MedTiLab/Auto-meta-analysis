import crypto from 'crypto';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';

export const PROJECT_DATA_DIRNAME = '.autometa';
const LEGACY_PROJECT_DATA_DIR_NAMES = ['.med-help'];
const LEGACY_SHARED_DATA_DIR_NAMES = ['.med-help', '.medautodata', '.dr-claw', '.vibelab'];
const PROJECT_SCOPED_DATA_DIRNAME = 'projects';

export function isLegacyDataImportEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.AUTOMETA_IMPORT_LEGACY_DATA || '').trim().toLowerCase()
  );
}

function normalizeResolvedPath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return null;
  }

  const trimmed = targetPath.trim();
  if (!trimmed) {
    return null;
  }

  return path.resolve(trimmed);
}

function uniqueResolvedPaths(paths = []) {
  return Array.from(new Set(
    paths
      .map((entry) => normalizeResolvedPath(entry))
      .filter(Boolean)
  ));
}

export function resolveAppDataRoot(options = {}) {
  const explicitDataDir = normalizeResolvedPath(
    options.dataDir
    || process.env.MEDAUTODATA_DATA_DIR
    || process.env.DR_CLAW_DATA_DIR
  );
  if (explicitDataDir) {
    return explicitDataDir;
  }

  const homeDir = normalizeResolvedPath(
    options.homeDir
    || process.env.HOME
    || process.env.USERPROFILE
    || os.homedir()
  );

  return path.join(homeDir || os.homedir(), PROJECT_DATA_DIRNAME);
}

export function resolveAppDatabasePath(options = {}) {
  return path.join(resolveAppDataRoot(options), 'auth.db');
}

export function resolveProjectConfigPath(options = {}) {
  return path.join(resolveAppDataRoot(options), 'project-config.json');
}

export function resolveDesktopLogFallbackPath(options = {}) {
  return path.join(resolveAppDataRoot(options), 'desktop', 'desktop.log');
}

export function resolveAppRuntimeDir(options = {}) {
  const explicitRuntimeDir = normalizeResolvedPath(
    options.runtimeDir
    || process.env.MEDAUTODATA_RUNTIME_DIR
    || process.env.DR_CLAW_RUNTIME_DIR
  );
  if (explicitRuntimeDir) {
    return explicitRuntimeDir;
  }

  return path.join(resolveAppDataRoot(options), 'runtime');
}

export function resolveReferencesPdfCacheDir(options = {}) {
  return path.join(resolveAppDataRoot(options), 'references', 'pdfs');
}

export function resolveProjectChatAttachmentsDir(projectPath) {
  return path.join(getProjectDataRoot(projectPath), 'chat-attachments');
}

export function resolveLegacyProjectConfigPaths(homeDir = os.homedir()) {
  if (!isLegacyDataImportEnabled()) {
    return [];
  }

  return uniqueResolvedPaths([
    path.join(homeDir, '.claude', 'project-config.json'),
  ]);
}

export function getLegacySharedDataRoots(homeDir = os.homedir()) {
  if (!isLegacyDataImportEnabled()) {
    return [];
  }

  return uniqueResolvedPaths(
    LEGACY_SHARED_DATA_DIR_NAMES.map((dirName) => path.join(homeDir, dirName))
  );
}

export function getLegacyProjectDataRoots(projectPath) {
  if (!isLegacyDataImportEnabled()) {
    return [];
  }

  const resolvedProjectPath = normalizeResolvedPath(projectPath);
  if (!resolvedProjectPath) {
    return [];
  }

  return uniqueResolvedPaths(
    LEGACY_PROJECT_DATA_DIR_NAMES.map((dirName) => path.join(resolvedProjectPath, dirName))
  );
}

export function getLegacyAppDataRoots(options = {}) {
  const roots = [];
  const cwd = normalizeResolvedPath(options.cwd || process.cwd());
  if (cwd) {
    roots.push(...getLegacyProjectDataRoots(cwd));
  }

  roots.push(...getLegacySharedDataRoots(options.homeDir || os.homedir()));
  return uniqueResolvedPaths(roots);
}

export function resolveLegacyDatabasePaths(homeDir = os.homedir(), cwd = process.cwd()) {
  return uniqueResolvedPaths(
    getLegacyAppDataRoots({ homeDir, cwd }).map((rootPath) => path.join(rootPath, 'auth.db'))
  );
}

export function getProjectDataRoot(projectPath) {
  const resolvedProjectPath = normalizeResolvedPath(projectPath);
  if (!resolvedProjectPath) {
    throw new Error('A project path is required');
  }

  const projectBaseName = path.basename(resolvedProjectPath).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const projectHash = crypto.createHash('sha256').update(resolvedProjectPath).digest('hex').slice(0, 16);
  return path.join(resolveAppDataRoot(), PROJECT_SCOPED_DATA_DIRNAME, `${projectBaseName}-${projectHash}`);
}

export function getProviderSessionDir(projectPath, providerDirName) {
  if (!providerDirName) {
    throw new Error('A provider session directory name is required');
  }

  return path.join(getProjectDataRoot(projectPath), providerDirName);
}

export function getProviderSessionFilePath(projectPath, providerDirName, sessionId) {
  if (!sessionId) {
    throw new Error('A session id is required');
  }

  return path.join(getProviderSessionDir(projectPath, providerDirName), `${sessionId}.jsonl`);
}

export function getLegacyProviderSessionFilePaths(providerDirName, sessionId, homeDir = os.homedir()) {
  if (!providerDirName || !sessionId) {
    return [];
  }

  return uniqueResolvedPaths(
    getLegacySharedDataRoots(homeDir).map((rootPath) => (
      path.join(rootPath, providerDirName, `${sessionId}.jsonl`)
    ))
  );
}

export function getLegacyProjectProviderSessionFilePaths(projectPath, providerDirName, sessionId) {
  if (!projectPath || !providerDirName || !sessionId) {
    return [];
  }

  return uniqueResolvedPaths(
    getLegacyProjectDataRoots(projectPath).map((rootPath) => (
      path.join(rootPath, providerDirName, `${sessionId}.jsonl`)
    ))
  );
}

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function pathExistsSync(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function findProviderSessionFile({
  projectPath = null,
  providerDirName,
  sessionId,
  homeDir = os.homedir(),
}) {
  const candidates = [];

  if (projectPath) {
    candidates.push(getProviderSessionFilePath(projectPath, providerDirName, sessionId));
    candidates.push(...getLegacyProjectProviderSessionFilePaths(projectPath, providerDirName, sessionId));
  }
  candidates.push(...getLegacyProviderSessionFilePaths(providerDirName, sessionId, homeDir));

  for (const candidatePath of candidates) {
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return projectPath && providerDirName && sessionId
    ? getProviderSessionFilePath(projectPath, providerDirName, sessionId)
    : null;
}

export async function ensureProjectProviderSessionFile({
  projectPath,
  providerDirName,
  sessionId,
  homeDir = os.homedir(),
}) {
  const projectSessionPath = getProviderSessionFilePath(projectPath, providerDirName, sessionId);
  await fsPromises.mkdir(path.dirname(projectSessionPath), { recursive: true });

  if (await pathExists(projectSessionPath)) {
    return projectSessionPath;
  }

  for (const legacyProjectPath of getLegacyProjectProviderSessionFilePaths(projectPath, providerDirName, sessionId)) {
    if (await pathExists(legacyProjectPath)) {
      await fsPromises.copyFile(legacyProjectPath, projectSessionPath);
      return projectSessionPath;
    }
  }

  for (const legacyPath of getLegacyProviderSessionFilePaths(providerDirName, sessionId, homeDir)) {
    if (await pathExists(legacyPath)) {
      await fsPromises.copyFile(legacyPath, projectSessionPath);
      return projectSessionPath;
    }
  }

  return projectSessionPath;
}
