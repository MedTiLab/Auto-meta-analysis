import express from 'express';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import { addProjectManually, extractProjectDirectory, getWorkspaceRootFromConfig, setWorkspaceRootInConfig } from '../projects.js';
import { resolveDefaultWorkspacesRoot } from '../utils/workspacePaths.js';
import { isLegacyDataImportEnabled } from '../utils/storagePaths.js';
import { IS_PLATFORM } from '../constants/config.js';
import {
  META_FOLDER_SCHEMA_VERSION,
  META_LEGACY_STAGE_DIRS,
  getMetaStageDirs,
  normalizeMetaFolderSchemaVersion,
} from '../utils/meta-analysis-artifacts.js';

const router = express.Router();
const META_PROJECT_TEMPLATE_ID = 'medical-meta-project';
const META_PROJECT_WORKFLOW = 'meta';
const META_PROJECT_ARTIFACT_ROOTS = META_LEGACY_STAGE_DIRS;

function sanitizeGitError(message, token) {
  if (!message || !token) return message;
  return message.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
}

function sanitizeArchiveFilename(input) {
  const normalized = String(input || 'project')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 120);

  return normalized || 'project';
}

function normalizeProjectKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'meta';
  }
  if (normalized === 'meta' || normalized === 'meta_analysis' || normalized === 'meta-analysis') {
    return 'meta';
  }
  return null;
}

function normalizeMetaReviewType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized;
}

function getDefaultPrimaryOutcomeForReviewType(reviewType) {
  if (reviewType === 'diagnostic') {
    return 'diagnostic accuracy';
  }
  return reviewType || null;
}

function resolveMetaFolderSchemaVersion(metaOptions = {}, currentMeta = {}) {
  return normalizeMetaFolderSchemaVersion(metaOptions.folderSchemaVersion || currentMeta.folderSchemaVersion)
    || META_FOLDER_SCHEMA_VERSION;
}

function mergeProjectKindMetadata(existingMetadata, projectKind, metaOptions = {}) {
  const current = existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata)
    ? existingMetadata
    : {};
  const next = {
    ...current,
    projectKind,
  };

  const currentMeta = current.metaAnalysis && typeof current.metaAnalysis === 'object' && !Array.isArray(current.metaAnalysis)
    ? current.metaAnalysis
    : {};
  const { workflowRoot: _legacyWorkflowRoot, reviewType: _legacyReviewType, ...currentMetaWithoutLegacyRoot } = currentMeta;
  const folderSchemaVersion = resolveMetaFolderSchemaVersion(metaOptions, currentMeta);
  const reviewType = normalizeMetaReviewType(metaOptions.reviewType || currentMeta.reviewType);
  next.projectKind = 'meta';
  next.metaAnalysis = {
    ...currentMetaWithoutLegacyRoot,
    workflow: META_PROJECT_WORKFLOW,
    templateId: META_PROJECT_TEMPLATE_ID,
    artifactRoots: getMetaStageDirs(null, { folderSchemaVersion }),
    folderSchemaVersion,
    ...(reviewType ? { reviewType } : {}),
    ...(metaOptions.metaProjectId ? { metaProjectId: metaOptions.metaProjectId } : {}),
  };

  return next;
}

async function ensureMetaProjectResearchBrief(projectPath, options = {}) {
  const docsDir = path.join(projectPath, '.pipeline', 'docs');
  const tasksDir = path.join(projectPath, '.pipeline', 'tasks');
  const briefPath = path.join(docsDir, 'research_brief.json');
  const tasksPath = path.join(tasksDir, 'tasks.json');
  const configPath = path.join(projectPath, '.pipeline', 'config.json');

  try {
    await fs.access(briefPath);
    return;
  } catch {
    // Create a default Meta brief only when the project has no brief yet.
  }

  const templatePath = path.resolve(process.cwd(), 'server', 'taskmaster-templates', `${META_PROJECT_TEMPLATE_ID}.json`);
  const rawTemplate = await fs.readFile(templatePath, 'utf8');
  const template = JSON.parse(rawTemplate);
  const now = new Date().toISOString().split('T')[0];
  const brief = {
    schemaVersion: '1.1',
    templateId: template.id,
    meta: {
      title: options.title || '',
      lead_author: '',
      target_venue: '',
      review_type: normalizeMetaReviewType(options.reviewType),
      date: now,
      workflow: META_PROJECT_WORKFLOW,
      artifact_roots: getMetaStageDirs(projectPath, {
        folderSchemaVersion: options.folderSchemaVersion,
      }),
      folder_schema_version: resolveMetaFolderSchemaVersion(options),
    },
    sections: {
      literature: {},
      ideation: {},
      experiment: {},
      publication: {},
      promotion: {},
    },
    pipeline: template.pipeline,
  };

  await fs.mkdir(docsDir, { recursive: true });
  await fs.mkdir(tasksDir, { recursive: true });
  await fs.writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
  try {
    await fs.access(configPath);
  } catch {
    await fs.writeFile(configPath, `${JSON.stringify({
      version: '1.0',
      provider: 'medhelp-web',
      initializedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
  }
  try {
    await fs.access(tasksPath);
  } catch {
    await fs.writeFile(tasksPath, `${JSON.stringify({ master: { tasks: [] } }, null, 2)}\n`, 'utf8');
  }
}

async function initializeMetaProjectForWorkspace(project, projectPath, userId, options = {}) {
  if (!project?.name || !projectPath || !userId) {
    return project;
  }

  const [{ metaAnalysisDb, projectDb }, { ensureMetaAnalysisProjectDirs }] = await Promise.all([
    import('../database/db.js'),
    import('../utils/meta-analysis-artifacts.js'),
  ]);
  const reviewType = normalizeMetaReviewType(options.reviewType);
  const folderSchemaVersion = normalizeMetaFolderSchemaVersion(
    options.folderSchemaVersion
    || project.metadata?.metaAnalysis?.folderSchemaVersion,
  ) || META_FOLDER_SCHEMA_VERSION;
  ensureMetaAnalysisProjectDirs(projectPath, { folderSchemaVersion });
  await ensureMetaProjectResearchBrief(projectPath, {
    reviewType,
    title: options.title || project.displayName || project.name,
    folderSchemaVersion,
  });

  let metaProject = metaAnalysisDb.getMetaProjectByProjectId(userId, project.name);
  if (!metaProject) {
    metaProject = metaAnalysisDb.createMetaProject(userId, {
      projectId: project.name,
      reviewType,
      title: options.title || `${project.displayName || project.name} Meta project`,
      primaryOutcome: options.primaryOutcome ?? getDefaultPrimaryOutcomeForReviewType(reviewType),
      protocolJson: {},
    });
  } else if (metaProject.review_type !== reviewType) {
    metaProject = metaAnalysisDb.updateMetaProject(userId, metaProject.id, { reviewType });
  }

  const nextMetadata = mergeProjectKindMetadata(project.metadata, 'meta', {
    reviewType,
    metaProjectId: metaProject?.id,
    folderSchemaVersion,
  });
  projectDb.setProjectMetadata(project.name, nextMetadata);

  return {
    ...project,
    metadata: nextMetadata,
    metaProject,
  };
}

const WORKSPACE_ARCHIVE_SCOPES = {
  all: {
    relativePath: '',
    archiveRoot: '',
    filenameSuffix: '',
  },
  publication: {
    relativePath: 'Publication',
    archiveRoot: 'Publication',
    filenameSuffix: 'Publication',
  },
  experimentAnalysis: {
    relativePath: 'Experiment',
    archiveRoot: 'Experiment',
    filenameSuffix: 'Experiment',
  },
};

const META_NUMBERED_WORKSPACE_ARCHIVE_SCOPES = {
  all: WORKSPACE_ARCHIVE_SCOPES.all,
  publication: {
    roots: [
      { relativePath: '09_manuscript_submission', archiveRoot: '09_manuscript_submission' },
      { relativePath: '08_results_figures', archiveRoot: '08_results_figures' },
      { relativePath: '10_presentation', archiveRoot: '10_presentation' },
    ],
    filenameSuffix: 'Meta-Submission',
  },
  experimentAnalysis: {
    roots: [
      { relativePath: '04_full_text_review', archiveRoot: '04_full_text_review' },
      { relativePath: '05_data_extraction', archiveRoot: '05_data_extraction' },
      { relativePath: '06_quality_assessment', archiveRoot: '06_quality_assessment' },
      { relativePath: '07_data_analysis', archiveRoot: '07_data_analysis' },
      { relativePath: '08_results_figures', archiveRoot: '08_results_figures' },
    ],
    filenameSuffix: 'Meta-Analysis',
  },
};

function getProjectRecordMetadata(projectRecord) {
  const metadata = projectRecord?.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata;
  }

  if (typeof metadata === 'string' && metadata.trim()) {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return {};
}

function usesMetaNumberedArchiveFolders(projectRecord) {
  const metadata = getProjectRecordMetadata(projectRecord);
  return normalizeProjectKind(metadata.projectKind || metadata.kind) === 'meta'
    && normalizeMetaFolderSchemaVersion(metadata.metaAnalysis?.folderSchemaVersion) === META_FOLDER_SCHEMA_VERSION;
}

export function resolveWorkspaceArchiveScope(requestedScope = 'all', projectRecord = null) {
  const scopeKey = String(requestedScope || 'all');
  const scopes = usesMetaNumberedArchiveFolders(projectRecord)
    ? META_NUMBERED_WORKSPACE_ARCHIVE_SCOPES
    : WORKSPACE_ARCHIVE_SCOPES;
  return scopes[scopeKey] || null;
}

function getWorkspaceArchiveScopeRoots(archiveScope) {
  if (Array.isArray(archiveScope?.roots) && archiveScope.roots.length > 0) {
    return archiveScope.roots;
  }
  if (archiveScope?.relativePath) {
    return [{
      relativePath: archiveScope.relativePath,
      archiveRoot: archiveScope.archiveRoot,
    }];
  }
  return [];
}

export const DEFAULT_WORKSPACE_ARCHIVE_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const WORKSPACE_ARCHIVE_EXCLUSION_NOTICE_NAME = 'ARCHIVE_EXCLUSIONS.txt';

const RAW_DATA_ARCHIVE_SEGMENTS = new Set([
  'raw',
  'raw-data',
  'raw-dataset',
  'raw-datasets',
  'original-data',
  'original-dataset',
  'original-datasets',
  'source-data',
  'source-dataset',
  'source-datasets',
  'source-files',
  'source-database',
  'source-databases',
  'input-data',
  'input-dataset',
  'input-datasets',
  'rawdata',
  'originaldata',
  'sourcedata',
  'inputdata',
  '原始数据',
  '原始资料',
  '源数据',
]);

const RAW_DATA_FILE_EXTENSIONS = new Set([
  'arrow',
  'csv',
  'db',
  'dta',
  'duckdb',
  'feather',
  'h5',
  'hdf5',
  'jsonl',
  'ndjson',
  'parquet',
  'rda',
  'rdata',
  'rds',
  'sas7bdat',
  'sav',
  'sqlite',
  'sqlite3',
  'tsv',
  'xls',
  'xlsx',
  'xpt',
  'zip',
]);

function getWorkspaceArchiveMaxFileBytes() {
  const configured = Number(process.env.WORKSPACE_ARCHIVE_MAX_FILE_BYTES);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_WORKSPACE_ARCHIVE_MAX_FILE_BYTES;
}

function normalizeArchiveNameToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeArchiveRelativePath(relativeArchivePath) {
  const normalizedPath = String(relativeArchivePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  return normalizedPath;
}

function getArchivePathSegments(relativeArchivePath) {
  const normalizedPath = normalizeArchiveRelativePath(relativeArchivePath);
  return normalizedPath.split('/').filter(Boolean);
}

function isRawDataArchivePath(relativeArchivePath, isDirectory) {
  const pathSegments = getArchivePathSegments(relativeArchivePath);
  const normalizedSegments = pathSegments.map(normalizeArchiveNameToken);

  if (normalizedSegments.some((segment) => RAW_DATA_ARCHIVE_SEGMENTS.has(segment))) {
    return true;
  }

  if (isDirectory || pathSegments.length === 0) {
    return false;
  }

  const fileName = pathSegments[pathSegments.length - 1];
  const extension = path.extname(fileName).slice(1).toLowerCase();
  if (!RAW_DATA_FILE_EXTENSIONS.has(extension)) {
    return false;
  }

  const stem = normalizeArchiveNameToken(path.basename(fileName, path.extname(fileName)));
  return RAW_DATA_ARCHIVE_SEGMENTS.has(stem);
}

export function classifyWorkspaceArchiveEntry(relativeArchivePath, {
  isDirectory = false,
  isSymbolicLink = false,
  size = 0,
  maxFileBytes = getWorkspaceArchiveMaxFileBytes(),
} = {}) {
  const normalizedPath = normalizeArchiveRelativePath(relativeArchivePath);

  if (!normalizedPath) {
    return { include: true };
  }

  const pathSegments = getArchivePathSegments(normalizedPath);
  if (pathSegments.some((segment) => segment.startsWith('.'))) {
    return { include: false, reason: 'hidden_path' };
  }

  if (isSymbolicLink) {
    return { include: false, reason: 'symbolic_link' };
  }

  if (pathSegments.length === 1) {
    if (!isDirectory) {
      return { include: false, reason: 'root_file' };
    }
  }

  if (isRawDataArchivePath(normalizedPath, isDirectory)) {
    return { include: false, reason: 'raw_data' };
  }

  if (!isDirectory && Number.isFinite(size) && size > maxFileBytes) {
    return { include: false, reason: 'large_file', maxFileBytes };
  }

  return { include: true };
}

export function shouldIncludeWorkspaceArchiveEntry(relativeArchivePath, isDirectory) {
  return classifyWorkspaceArchiveEntry(relativeArchivePath, { isDirectory }).include;
}

function recordSkippedArchiveEntry(skippedEntries, relativeArchivePath, decision) {
  if (!Array.isArray(skippedEntries) || !decision || decision.include) {
    return;
  }

  skippedEntries.push({
    path: normalizeArchiveRelativePath(relativeArchivePath),
    reason: decision.reason || 'excluded',
    maxFileBytes: decision.maxFileBytes,
  });
}

function formatArchiveBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 'unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatWorkspaceArchiveExclusionReason(entry) {
  switch (entry.reason) {
    case 'hidden_path':
      return 'hidden path';
    case 'root_file':
      return 'root-level file';
    case 'symbolic_link':
      return 'symbolic link';
    case 'raw_data':
      return 'raw/original data';
    case 'large_file':
      return `larger than ${formatArchiveBytes(entry.maxFileBytes)}`;
    default:
      return entry.reason || 'excluded';
  }
}

export function buildWorkspaceArchiveExclusionNotice(skippedEntries, {
  maxFileBytes = getWorkspaceArchiveMaxFileBytes(),
} = {}) {
  if (!Array.isArray(skippedEntries) || skippedEntries.length === 0) {
    return null;
  }

  const maxListedEntries = 500;
  const listedEntries = skippedEntries.slice(0, maxListedEntries);
  const lines = [
    'Some workspace files were intentionally excluded from this download.',
    '',
    `Rules: hidden paths, root-level files, symbolic links, raw/original data paths, and files larger than ${formatArchiveBytes(maxFileBytes)} are excluded.`,
    '',
    ...listedEntries.map((entry) => `- ${entry.path} (${formatWorkspaceArchiveExclusionReason(entry)})`),
  ];

  if (skippedEntries.length > listedEntries.length) {
    lines.push(`- ${skippedEntries.length - listedEntries.length} more excluded entries are not shown.`);
  }

  lines.push('');
  return lines.join('\n');
}

export async function addWorkspaceArchiveEntries(archive, absoluteDirPath, relativeArchiveDir = '', {
  skippedEntries = [],
  maxFileBytes = getWorkspaceArchiveMaxFileBytes(),
} = {}) {
  const entries = await fs.readdir(absoluteDirPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

  for (const entry of entries) {
    const absoluteEntryPath = path.join(absoluteDirPath, entry.name);
    const relativeArchivePath = relativeArchiveDir
      ? `${relativeArchiveDir}/${entry.name}`
      : entry.name;

    const initialDecision = classifyWorkspaceArchiveEntry(relativeArchivePath, {
      isDirectory: entry.isDirectory(),
      isSymbolicLink: entry.isSymbolicLink(),
      maxFileBytes,
    });
    if (!initialDecision.include) {
      recordSkippedArchiveEntry(skippedEntries, relativeArchivePath, initialDecision);
      continue;
    }

    if (entry.isDirectory()) {
      const stats = await fs.stat(absoluteEntryPath);
      archive.addFile(`${relativeArchivePath}/`, Buffer.alloc(0), '', stats);
      await addWorkspaceArchiveEntries(archive, absoluteEntryPath, relativeArchivePath, { skippedEntries, maxFileBytes });
      continue;
    }

    if (entry.isFile()) {
      const stats = await fs.stat(absoluteEntryPath);
      const fileDecision = classifyWorkspaceArchiveEntry(relativeArchivePath, {
        isDirectory: false,
        isSymbolicLink: false,
        size: stats.size,
        maxFileBytes,
      });
      if (!fileDecision.include) {
        recordSkippedArchiveEntry(skippedEntries, relativeArchivePath, fileDecision);
        continue;
      }

      const data = await fs.readFile(absoluteEntryPath);
      archive.addFile(relativeArchivePath, data, '', stats);
    }
  }
}

// User-configurable workspace root with a platform-aware AutoMeta default.
const DEFAULT_WORKSPACES_ROOT = resolveDefaultWorkspacesRoot();
const LEGACY_DEFAULT_WORKSPACES_ROOTS = [
  path.join(os.homedir(), 'dr-claw'),
  path.join(os.homedir(), 'vibelab'),
];

function isTruthyEnvValue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function isProjectPathLockEnabled() {
  return isTruthyEnvValue(process.env.MEDAUTODATA_LOCK_PROJECT_PATHS);
}

export async function getWorkspaceRootForUser(_user) {
  // OSS uses one shared default project location. Keep this exported name for
  // existing callers, but never derive a folder from an account or user id.
  const workspaceRoot = await getWorkspacesRoot();
  await fs.mkdir(workspaceRoot, { recursive: true });
  return workspaceRoot;
}

async function getWorkspaceBaseRootForResponse() {
  return getWorkspacesRoot();
}

function sanitizeWorkspaceFolderName(value) {
  const sanitized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+$/, '')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);

  return sanitized || `project-${Date.now()}`;
}

async function resolveUniqueWorkspacePath(rootPath, requestedName) {
  const folderName = sanitizeWorkspaceFolderName(requestedName);
  let candidatePath = path.join(rootPath, folderName);

  for (let index = 2; index < 1000; index += 1) {
    try {
      await fs.access(candidatePath);
      candidatePath = path.join(rootPath, `${folderName}-${index}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return candidatePath;
      }
      throw error;
    }
  }

  return path.join(rootPath, `${folderName}-${Date.now()}`);
}

function getCompatibleWorkspaceRootSync() {
  if (process.env.WORKSPACES_ROOT) {
    return process.env.WORKSPACES_ROOT;
  }

  if (fsSync.existsSync(DEFAULT_WORKSPACES_ROOT)) {
    return DEFAULT_WORKSPACES_ROOT;
  }

  if (isLegacyDataImportEnabled()) {
    return LEGACY_DEFAULT_WORKSPACES_ROOTS.find((legacyRoot) => fsSync.existsSync(legacyRoot)) || DEFAULT_WORKSPACES_ROOT;
  }

  return DEFAULT_WORKSPACES_ROOT;
}

function expandWorkspaceRootInput(inputPath) {
  const value = String(inputPath || '').trim();
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

// Dynamic workspace root: config file > env var > compatible default root
export async function getWorkspacesRoot() {
  const configRoot = await getWorkspaceRootFromConfig();
  return configRoot || getCompatibleWorkspaceRootSync();
}

// Keep a synchronous fallback for backward compat (used only at import time)
export const WORKSPACES_ROOT = getCompatibleWorkspaceRootSync();

// System-critical paths that should never be used as workspace directories
export const FORBIDDEN_PATHS = [
  // Unix
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/dev',
  '/proc',
  '/sys',
  '/var',
  '/boot',
  '/root',
  '/lib',
  '/lib64',
  '/opt',
  '/tmp',
  '/run',
  // Windows
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\$Recycle.Bin'
];

/**
 * Validates that a path is safe for workspace operations
 * @param {string} requestedPath - The path to validate
 * @param {{user?: object}} options
 * @returns {Promise<{valid: boolean, resolvedPath?: string, error?: string}>}
 */
export async function validateWorkspacePath(requestedPath, options = {}) {
  try {
    // Resolve to absolute path
    let absolutePath = path.resolve(requestedPath);

    // Check if path is a forbidden system directory
    const normalizedPath = path.normalize(absolutePath);
    if (FORBIDDEN_PATHS.includes(normalizedPath) || normalizedPath === '/') {
      return {
        valid: false,
        error: 'Cannot use system-critical directories as workspace locations'
      };
    }

    // Additional check for paths starting with forbidden directories
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalizedPath === forbidden ||
          normalizedPath.startsWith(forbidden + path.sep)) {
        // Exception: /var/tmp and similar user-accessible paths might be allowed
        // but /var itself and most /var subdirectories should be blocked
        if (forbidden === '/var' &&
            (normalizedPath.startsWith('/var/tmp') ||
             normalizedPath.startsWith('/var/folders'))) {
          continue; // Allow these specific cases
        }

        return {
          valid: false,
          error: `Cannot create workspace in system directory: ${forbidden}`
        };
      }
    }

    // Try to resolve the real path (following symlinks)
    let realPath;
    try {
      // Check if path exists to resolve real path
      await fs.access(absolutePath);
      realPath = await fs.realpath(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Path doesn't exist yet - check parent directory
        let parentPath = path.dirname(absolutePath);
        try {
          const parentRealPath = await fs.realpath(parentPath);

          // Reconstruct the full path with real parent
          realPath = path.join(parentRealPath, path.basename(absolutePath));
        } catch (parentError) {
          if (parentError.code === 'ENOENT') {
            // Parent doesn't exist either - use the absolute path as-is
            realPath = absolutePath;
          } else {
            throw parentError;
          }
        }
      } else {
        throw error;
      }
    }

    // In OSS mode, custom paths under the user's home directory remain valid even if
    // the default suggested storage root is narrower (for example ~/medautodata).
    const currentWorkspacesRoot = await getWorkspaceRootForUser(options.user);
    await fs.mkdir(currentWorkspacesRoot, { recursive: true });
    const resolvedWorkspaceRoot = await fs.realpath(currentWorkspacesRoot);
    const resolvedUserHome = await fs.realpath(os.homedir());
    const allowedRoots = (IS_PLATFORM || isProjectPathLockEnabled())
      ? [resolvedWorkspaceRoot]
      : [resolvedWorkspaceRoot, resolvedUserHome];

    const isWithinAllowedRoot = allowedRoots.some((allowedRoot) => (
      realPath.startsWith(allowedRoot + path.sep) || realPath === allowedRoot
    ));

    // Ensure the resolved path is contained within the allowed workspace root
    if (!isWithinAllowedRoot) {
      return {
        valid: false,
        error: isProjectPathLockEnabled()
          ? `Workspace path must be within the default project location: ${currentWorkspacesRoot}`
          : IS_PLATFORM
          ? `Workspace path must be within the allowed workspace root: ${currentWorkspacesRoot}`
          : `Workspace path must be within your home directory or the configured workspace root: ${currentWorkspacesRoot}`
      };
    }

    // Additional symlink check for existing paths
    try {
      await fs.access(absolutePath);
      const stats = await fs.lstat(absolutePath);

      if (stats.isSymbolicLink()) {
        // Resolve target
        const linkTarget = await fs.readlink(absolutePath);
        const resolvedTarget = path.resolve(path.dirname(absolutePath), linkTarget);
        const realTarget = await fs.realpath(resolvedTarget);

        const symlinkWithinAllowedRoot = allowedRoots.some((allowedRoot) => (
          realTarget.startsWith(allowedRoot + path.sep) || realTarget === allowedRoot
        ));

        if (!symlinkWithinAllowedRoot) {
          return {
            valid: false,
            error: 'Symlink target is outside the allowed workspace root'
          };
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // Path doesn't exist - that's fine for new workspace creation
    }

    return {
      valid: true,
      resolvedPath: realPath
    };

  } catch (error) {
    return {
      valid: false,
      error: `Path validation failed: ${error.message}`
    };
  }
}

/**
 * Get current workspace root path
 * GET /api/projects/workspace-root
 */
router.get('/workspace-root', async (req, res) => {
  try {
    const baseRoot = await getWorkspaceBaseRootForResponse();
    const currentRoot = await getWorkspaceRootForUser(req.user);
    const defaultRoot = process.env.WORKSPACES_ROOT || DEFAULT_WORKSPACES_ROOT;
    res.json({
      path: currentRoot,
      defaultPath: defaultRoot,
      basePath: baseRoot,
      lockedToDefault: isProjectPathLockEnabled(),
      lockedToUser: false,
    });
  } catch (error) {
    console.error('Error getting workspace root:', error);
    res.status(500).json({ error: 'Failed to get workspace root' });
  }
});

/**
 * Set workspace root path
 * PUT /api/projects/workspace-root
 */
router.put('/workspace-root', async (req, res) => {
  try {
    const { path: newPath } = req.body;

    // If null/empty, reset to default
    if (!newPath) {
      await setWorkspaceRootInConfig(null);
      const defaultRoot = process.env.WORKSPACES_ROOT || DEFAULT_WORKSPACES_ROOT;
      return res.json({ success: true, path: defaultRoot });
    }

    const absolutePath = path.resolve(expandWorkspaceRootInput(newPath));

    // Validate the path exists and is a directory
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(400).json({ error: 'Directory does not exist' });
      }
      throw error;
    }

    // Check it's not a forbidden system path
    const normalizedPath = path.normalize(absolutePath);
    if (FORBIDDEN_PATHS.includes(normalizedPath) || normalizedPath === '/') {
      return res.status(400).json({ error: 'Cannot use system-critical directories' });
    }

    await setWorkspaceRootInConfig(absolutePath);
    res.json({ success: true, path: absolutePath });
  } catch (error) {
    console.error('Error setting workspace root:', error);
    res.status(500).json({ error: 'Failed to set workspace root' });
  }
});

/**
 * Download a workspace as a zip archive
 * GET /api/projects/:projectName/download
 */
router.get('/:projectName/download', async (req, res) => {
  try {
    const { projectName } = req.params;
    const { projectDb } = await import('../database/db.js');
    const projectRecord = projectDb.getProjectById(projectName);

    if (projectRecord?.user_id && req.user?.id && Number(projectRecord.user_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectPath = projectRecord?.path || await extractProjectDirectory(projectName);
    if (!projectPath) {
      return res.status(404).json({ error: 'Project path not found' });
    }

    const resolvedPath = await fs.realpath(projectPath);
    const projectStats = await fs.stat(resolvedPath);
    if (!projectStats.isDirectory()) {
      return res.status(400).json({ error: 'Project path is not a directory' });
    }

    const requestedScope = String(req.query.scope || 'all');
    const archiveScope = resolveWorkspaceArchiveScope(requestedScope, projectRecord);
    if (!archiveScope) {
      return res.status(400).json({ error: 'Invalid download scope' });
    }

    const AdmZip = (await import('adm-zip')).default;
    const archive = new AdmZip();
    const skippedEntries = [];
    const maxFileBytes = getWorkspaceArchiveMaxFileBytes();
    const archiveScopeRoots = getWorkspaceArchiveScopeRoots(archiveScope);

    if (archiveScopeRoots.length > 0) {
      let archivedRootCount = 0;
      for (const archiveRoot of archiveScopeRoots) {
        const scopedPath = path.join(resolvedPath, archiveRoot.relativePath);
        const resolvedScopedPath = await fs.realpath(scopedPath).catch(() => null);
        if (!resolvedScopedPath) {
          continue;
        }

        const relativeFromProject = path.relative(resolvedPath, resolvedScopedPath);
        if (relativeFromProject.startsWith('..') || path.isAbsolute(relativeFromProject)) {
          return res.status(400).json({ error: 'Download scope is outside the project' });
        }

        const scopedStats = await fs.stat(resolvedScopedPath);
        if (!scopedStats.isDirectory()) {
          return res.status(400).json({ error: `Download scope is not a directory: ${archiveRoot.archiveRoot}` });
        }

        archive.addFile(`${archiveRoot.archiveRoot}/`, Buffer.alloc(0), '', scopedStats);
        await addWorkspaceArchiveEntries(archive, resolvedScopedPath, archiveRoot.archiveRoot, { skippedEntries, maxFileBytes });
        archivedRootCount += 1;
      }

      if (archivedRootCount === 0) {
        return res.status(404).json({ error: `Folder not found: ${archiveScopeRoots.map((root) => root.archiveRoot).join(', ')}` });
      }
    } else {
      await addWorkspaceArchiveEntries(archive, resolvedPath, '', { skippedEntries, maxFileBytes });
    }

    const exclusionNotice = buildWorkspaceArchiveExclusionNotice(skippedEntries, { maxFileBytes });
    if (exclusionNotice) {
      archive.addFile(
        WORKSPACE_ARCHIVE_EXCLUSION_NOTICE_NAME,
        Buffer.from(exclusionNotice, 'utf8'),
      );
    }

    const archiveBuffer = archive.toBuffer();
    const archiveBaseName = sanitizeArchiveFilename(projectRecord?.display_name || path.basename(resolvedPath) || projectName);
    const archiveName = `${archiveBaseName}${archiveScope.filenameSuffix ? `-${archiveScope.filenameSuffix}` : ''}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(archiveName)}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`);
    res.setHeader('Content-Length', String(archiveBuffer.length));
    res.send(archiveBuffer);
  } catch (error) {
    console.error('Error downloading workspace archive:', error);
    res.status(500).json({ error: error.message || 'Failed to create workspace archive' });
  }
});

/**
 * Create a new workspace
 * POST /api/projects/create-workspace
 *
 * Body:
 * - workspaceType: 'existing' | 'new'
 * - path: string (workspace path)
 * - githubUrl?: string (optional, for new workspaces)
 * - githubTokenId?: number (optional, ID of stored token)
 * - newGithubToken?: string (optional, one-time token)
 */
router.post('/create-workspace', async (req, res) => {
  try {
    const {
      workspaceType,
      path: requestedWorkspacePath,
      githubUrl,
      githubTokenId,
      newGithubToken,
      displayName,
      projectKind: rawProjectKind,
      metaAnalysis,
    } = req.body;
    const projectKind = normalizeProjectKind(rawProjectKind);
    if (!projectKind) {
      return res.status(400).json({ error: 'projectKind must be meta in this Meta-only app' });
    }
    const metaReviewType = normalizeMetaReviewType(metaAnalysis?.reviewType);
    const metaFolderSchemaVersion = normalizeMetaFolderSchemaVersion(metaAnalysis?.folderSchemaVersion)
      || META_FOLDER_SCHEMA_VERSION;

    // Validate required fields
    const lockProjectPaths = isProjectPathLockEnabled();

    const requiresWorkspacePath = workspaceType === 'existing' || !lockProjectPaths;
    if (!workspaceType || (requiresWorkspacePath && !requestedWorkspacePath)) {
      return res.status(400).json({ error: 'workspaceType and path are required' });
    }

    if (!['existing', 'new'].includes(workspaceType)) {
      return res.status(400).json({ error: 'workspaceType must be "existing" or "new"' });
    }

    let workspacePath = requestedWorkspacePath;
    if (lockProjectPaths && workspaceType === 'new') {
      const userRoot = await getWorkspaceRootForUser(req.user);
      const requestedName = displayName || (requestedWorkspacePath ? path.basename(path.resolve(requestedWorkspacePath)) : '');
      workspacePath = await resolveUniqueWorkspacePath(userRoot, requestedName);
    }

    // Validate path safety before any operations
    const validation = await validateWorkspacePath(workspacePath, { user: req.user });
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid workspace path',
        details: validation.error
      });
    }

    const absolutePath = validation.resolvedPath;

    // Handle existing workspace
    if (workspaceType === 'existing') {
      // Check if the path exists
      try {
        await fs.access(absolutePath);
        const stats = await fs.stat(absolutePath);

        if (!stats.isDirectory()) {
          return res.status(400).json({ error: 'Path exists but is not a directory' });
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          return res.status(404).json({ error: 'Workspace path does not exist' });
        }
        throw error;
      }

      // Add the existing workspace to the project list
      let project = await addProjectManually(
        absolutePath,
        displayName,
        req.user?.id,
        mergeProjectKindMetadata(null, projectKind, {
          reviewType: metaReviewType,
          folderSchemaVersion: metaFolderSchemaVersion,
        }),
      );
      if (projectKind === 'meta') {
        project = await initializeMetaProjectForWorkspace(project, absolutePath, req.user?.id, {
          reviewType: metaReviewType,
          folderSchemaVersion: metaFolderSchemaVersion,
        });
      }

      return res.json({
        success: true,
        project,
        message: 'Existing workspace added successfully'
      });
    }

    // Handle new workspace creation
    if (workspaceType === 'new') {
      // Create the directory if it doesn't exist
      await fs.mkdir(absolutePath, { recursive: true });

      // If GitHub URL is provided, clone the repository
      if (githubUrl) {
        let githubToken = null;

        // Get GitHub token if needed
        if (githubTokenId) {
          // Fetch token from database
          const token = await getGithubTokenById(githubTokenId, req.user.id);
          if (!token) {
            // Clean up created directory
            await fs.rm(absolutePath, { recursive: true, force: true });
            return res.status(404).json({ error: 'GitHub token not found' });
          }
          githubToken = token.github_token;
        } else if (newGithubToken) {
          githubToken = newGithubToken;
        }

        // Extract repo name from URL for the clone destination
        const normalizedUrl = githubUrl.replace(/\/+$/, '').replace(/\.git$/, '');
        const repoName = normalizedUrl.split('/').pop() || 'repository';
        const clonePath = path.join(absolutePath, repoName);

        // Check if clone destination already exists to prevent data loss
        try {
          await fs.access(clonePath);
          return res.status(409).json({
            error: 'Directory already exists',
            details: `The destination path "${clonePath}" already exists. Please choose a different location or remove the existing directory.`
          });
        } catch (err) {
          // Directory doesn't exist, which is what we want
        }

        // Clone the repository into a subfolder
        try {
          await cloneGitHubRepository(githubUrl, clonePath, githubToken);
        } catch (error) {
          // Only clean up if clone created partial data (check if dir exists and is empty or partial)
          try {
            const stats = await fs.stat(clonePath);
            if (stats.isDirectory()) {
              await fs.rm(clonePath, { recursive: true, force: true });
            }
          } catch (cleanupError) {
            // Directory doesn't exist or cleanup failed - ignore
          }
          throw new Error(`Failed to clone repository: ${error.message}`);
        }

        // Add the cloned repo path to the project list
        let project = await addProjectManually(
          clonePath,
          displayName,
          req.user?.id,
          mergeProjectKindMetadata(null, projectKind, {
            reviewType: metaReviewType,
            folderSchemaVersion: metaFolderSchemaVersion,
          }),
        );
        if (projectKind === 'meta') {
          project = await initializeMetaProjectForWorkspace(project, clonePath, req.user?.id, {
            reviewType: metaReviewType,
            folderSchemaVersion: metaFolderSchemaVersion,
          });
        }

        return res.json({
          success: true,
          project,
          message: 'New workspace created and repository cloned successfully'
        });
      }

      // Add the new workspace to the project list (no clone)
      let project = await addProjectManually(
        absolutePath,
        displayName,
        req.user?.id,
        mergeProjectKindMetadata(null, projectKind, {
          reviewType: metaReviewType,
          folderSchemaVersion: metaFolderSchemaVersion,
        }),
      );
      if (projectKind === 'meta') {
        project = await initializeMetaProjectForWorkspace(project, absolutePath, req.user?.id, {
          reviewType: metaReviewType,
          folderSchemaVersion: metaFolderSchemaVersion,
        });
      }

      return res.json({
        success: true,
        project,
        message: 'New workspace created successfully'
      });
    }

  } catch (error) {
    console.error('Error creating workspace:', error);
    res.status(500).json({
      error: error.message || 'Failed to create workspace',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

router.patch('/:projectName/metadata', async (req, res) => {
  try {
    const { projectDb } = await import('../database/db.js');
    const project = projectDb.getProjectById(req.params.projectName);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (project.user_id && project.user_id !== req.user?.id) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const rawProjectKind = payload.projectKind || payload.kind;
    const projectKind = normalizeProjectKind(rawProjectKind);
    if (rawProjectKind && !projectKind) {
      return res.status(400).json({ error: 'projectKind must be meta in this Meta-only app' });
    }

    const metaPayload = payload.metaAnalysis && typeof payload.metaAnalysis === 'object' && !Array.isArray(payload.metaAnalysis)
      ? payload.metaAnalysis
      : {};
    const nextMetadata = mergeProjectKindMetadata(project.metadata, 'meta', {
      reviewType: metaPayload.reviewType,
      metaProjectId: metaPayload.metaProjectId,
      folderSchemaVersion: metaPayload.folderSchemaVersion || META_FOLDER_SCHEMA_VERSION,
    });
    projectDb.setProjectMetadata(req.params.projectName, nextMetadata);

    let metaProject = null;
    const projectPath = await extractProjectDirectory(req.params.projectName);
    const initialized = await initializeMetaProjectForWorkspace(
      {
        name: req.params.projectName,
        displayName: project.display_name,
        fullPath: projectPath,
        path: projectPath,
        metadata: nextMetadata,
      },
      projectPath,
      req.user?.id,
      {
        reviewType: metaPayload.reviewType,
        folderSchemaVersion: nextMetadata.metaAnalysis?.folderSchemaVersion,
      },
    );
    metaProject = initialized.metaProject || null;

    return res.json({
      success: true,
      metadata: metaProject
        ? mergeProjectKindMetadata(nextMetadata, 'meta', {
            reviewType: metaProject.review_type,
            metaProjectId: metaProject.id,
          })
        : nextMetadata,
      metaProject,
    });
  } catch (error) {
    console.error('Error updating project metadata:', error);
    return res.status(500).json({ error: error.message || 'Failed to update project metadata' });
  }
});

/**
 * Helper function to get GitHub token from database
 */
async function getGithubTokenById(tokenId, userId) {
  const { getDatabase } = await import('../database/db.js');
  const db = await getDatabase();

  const credential = await db.get(
    'SELECT * FROM user_credentials WHERE id = ? AND user_id = ? AND credential_type = ? AND is_active = 1',
    [tokenId, userId, 'github_token']
  );

  // Return in the expected format (github_token field for compatibility)
  if (credential) {
    return {
      ...credential,
      github_token: credential.credential_value
    };
  }

  return null;
}

/**
 * Clone repository with progress streaming (SSE)
 * GET /api/projects/clone-progress
 */
router.get('/clone-progress', async (req, res) => {
  const { path: workspacePath, githubUrl, githubTokenId, newGithubToken } = req.query;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    if (isProjectPathLockEnabled()) {
      sendEvent('error', {
        message: 'Custom clone destinations are disabled. Create a new server-managed project instead.',
        lockedToUser: true,
      });
      res.end();
      return;
    }

    if (!workspacePath || !githubUrl) {
      sendEvent('error', { message: 'workspacePath and githubUrl are required' });
      res.end();
      return;
    }

    const validation = await validateWorkspacePath(workspacePath, { user: req.user });
    if (!validation.valid) {
      sendEvent('error', { message: validation.error });
      res.end();
      return;
    }

    const absolutePath = validation.resolvedPath;

    await fs.mkdir(absolutePath, { recursive: true });

    let githubToken = null;
    if (githubTokenId) {
      const token = await getGithubTokenById(parseInt(githubTokenId), req.user.id);
      if (!token) {
        await fs.rm(absolutePath, { recursive: true, force: true });
        sendEvent('error', { message: 'GitHub token not found' });
        res.end();
        return;
      }
      githubToken = token.github_token;
    } else if (newGithubToken) {
      githubToken = newGithubToken;
    }

    const normalizedUrl = githubUrl.replace(/\/+$/, '').replace(/\.git$/, '');
    const repoName = normalizedUrl.split('/').pop() || 'repository';
    const clonePath = path.join(absolutePath, repoName);

    // Check if clone destination already exists to prevent data loss
    try {
      await fs.access(clonePath);
      sendEvent('error', { message: `Directory "${repoName}" already exists. Please choose a different location or remove the existing directory.` });
      res.end();
      return;
    } catch (err) {
      // Directory doesn't exist, which is what we want
    }

    let cloneUrl = githubUrl;
    if (githubToken) {
      try {
        const url = new URL(githubUrl);
        url.username = githubToken;
        url.password = '';
        cloneUrl = url.toString();
      } catch (error) {
        // SSH URL or invalid - use as-is
      }
    }

    sendEvent('progress', { message: `Cloning into '${repoName}'...` });

    const gitProcess = spawn('git', ['clone', '--progress', cloneUrl, clonePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0'
      }
    });

    let lastError = '';

    gitProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        sendEvent('progress', { message });
      }
    });

    gitProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      lastError = message;
      if (message) {
        sendEvent('progress', { message });
      }
    });

    gitProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          const project = await addProjectManually(clonePath, null, req.user?.id);
          sendEvent('complete', { project, message: 'Repository cloned successfully' });
        } catch (error) {
          sendEvent('error', { message: `Clone succeeded but failed to add project: ${error.message}` });
        }
      } else {
        const sanitizedError = sanitizeGitError(lastError, githubToken);
        let errorMessage = 'Git clone failed';
        if (lastError.includes('Authentication failed') || lastError.includes('could not read Username')) {
          errorMessage = 'Authentication failed. Please check your credentials.';
        } else if (lastError.includes('Repository not found')) {
          errorMessage = 'Repository not found. Please check the URL and ensure you have access.';
        } else if (lastError.includes('already exists')) {
          errorMessage = 'Directory already exists';
        } else if (sanitizedError) {
          errorMessage = sanitizedError;
        }
        try {
          await fs.rm(clonePath, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error('Failed to clean up after clone failure:', sanitizeGitError(cleanupError.message, githubToken));
        }
        sendEvent('error', { message: errorMessage });
      }
      res.end();
    });

    gitProcess.on('error', (error) => {
      if (error.code === 'ENOENT') {
        sendEvent('error', { message: 'Git is not installed or not in PATH' });
      } else {
        sendEvent('error', { message: error.message });
      }
      res.end();
    });

    req.on('close', () => {
      gitProcess.kill();
    });

  } catch (error) {
    sendEvent('error', { message: error.message });
    res.end();
  }
});

/**
 * Helper function to clone a GitHub repository
 */
function cloneGitHubRepository(githubUrl, destinationPath, githubToken = null) {
  return new Promise((resolve, reject) => {
    let cloneUrl = githubUrl;

    if (githubToken) {
      try {
        const url = new URL(githubUrl);
        url.username = githubToken;
        url.password = '';
        cloneUrl = url.toString();
      } catch (error) {
        // SSH URL - use as-is
      }
    }

    const gitProcess = spawn('git', ['clone', '--progress', cloneUrl, destinationPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0'
      }
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        let errorMessage = 'Git clone failed';

        if (stderr.includes('Authentication failed') || stderr.includes('could not read Username')) {
          errorMessage = 'Authentication failed. Please check your GitHub token.';
        } else if (stderr.includes('Repository not found')) {
          errorMessage = 'Repository not found. Please check the URL and ensure you have access.';
        } else if (stderr.includes('already exists')) {
          errorMessage = 'Directory already exists';
        } else if (stderr) {
          errorMessage = stderr;
        }

        reject(new Error(errorMessage));
      }
    });

    gitProcess.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Git is not installed or not in PATH'));
      } else {
        reject(error);
      }
    });
  });
}

export default router;
