/**
 * PROJECT DISCOVERY AND MANAGEMENT SYSTEM
 * ========================================
 *
 * This module manages project discovery for Claude CLI sessions.
 *
 * ## Architecture Overview
 *
 * 1. **Claude Projects** (stored in ~/.claude/projects/)
 *    - Each project is a directory named with the project path encoded (/ replaced with -)
 *    - Contains .jsonl files with conversation history including 'cwd' field
 *    - Project metadata stored in ~/.medhelp/project-config.json
 *
 * ## Project Discovery Strategy
 *
 * 1. **Claude Projects Discovery**:
 *    - Scan ~/.claude/projects/ directory for Claude project folders
 *    - Extract actual project path from .jsonl files (cwd field)
 *    - Fall back to decoded directory name if no sessions exist
 *
 * 2. **Manual Project Addition**:
 *    - Users can manually add project paths via UI
 *    - Stored in ~/.medhelp/project-config.json with 'manuallyAdded' flag
 *    - Allows adding Meta workspaces before any Claude session exists
 *
 * - **Project relocation breaks history**: If a project directory is moved or renamed,
 *   old Claude project history may not be discoverable unless the old path is known and manually added.
 *
 * ## Error Handling
 *
 * - Missing ~/.claude directory is handled gracefully with automatic creation
 * - ENOENT errors are caught and handled without crashing
 * - Empty arrays returned when no projects/sessions exist
 *
 * ## Caching Strategy
 *
 * - Project directory extraction is cached to minimize file I/O
 * - Cache is cleared when project configuration changes
 * - Session data is fetched on-demand, not cached
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import os from 'os';
import { stripInternalContextPrefix } from './utils/sessionFormatting.js';
import {
  extractSessionModeFromMetadata,
  extractSessionModeFromText,
  inferSessionModeFromUserMessage,
  normalizeSessionMode,
  readExplicitSessionModeFromMetadata,
} from './utils/sessionMode.js';
import {
  resolveLegacyProjectConfigPaths,
  resolveProjectConfigPath,
} from './utils/storagePaths.js';
import {
  META_FOLDER_SCHEMA_VERSION,
  META_NUMBERED_STAGE_DIRS,
  META_NUMBERED_WORKFLOW_DIRS,
  META_LEGACY_STAGE_DIRS,
  getMetaStageDirs,
  isNumberedMetaFolderSchema,
  normalizeMetaFolderSchemaVersion,
} from './utils/meta-analysis-artifacts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRCLAW_SKILLS_DIR = path.join(__dirname, '..', 'skills');
const PROJECT_SKILL_FOLDERS = ['.claude', '.agents'];
const PROJECT_PIPELINE_FOLDERS = ['Literature', 'Ideation', 'Experiment', 'Publication', 'Promotion'];
const PROJECT_PUBLICATION_SUBDIRS = ['manuscript', 'figures', 'tables', 'supplementary'];
const DEPRECATED_PROJECT_PUBLICATION_SUBDIRS = ['attachments', 'cover_letter', 'journal_targets'];
const META_NUMBERED_CODE_SUBDIRS = [
  '02_search_dedupe/code',
  '03_title_abstract_screening/code',
  '04_full_text_review/code',
  '05_data_extraction/code',
  '06_quality_assessment/code',
  '07_data_analysis/code',
  '08_results_figures/code',
  '09_manuscript_submission/code',
  '10_presentation/code',
];
const META_PROJECT_TEMPLATE_ID = 'medical-meta-project';
const META_PROJECT_WORKFLOW = 'meta';
const META_PROJECT_ARTIFACT_ROOTS = META_LEGACY_STAGE_DIRS;
const META_ONLY_PROJECT_SKILLS = new Set([
  'citation-management',
  'data-stats-analysis',
  'data-transform',
  'data-visualization-biomedical',
  'data-viz-plots',
  'diagnostic-data-extraction',
  'diagnostic-meta-analysis',
  'docx',
  'hypothesis-generation',
  'inno-humanizer',
  'inno-paper-reviewer',
  'inno-paper-writing',
  'inno-rebuttal',
  'inno-reference-audit',
  'legal-pdf-acquisition',
  'literature-review',
  'making-academic-presentations',
  'manuscript-editor',
  'matplotlib',
  'meta-analysis-workflow',
  'meta-extraction',
  'meta-pipeline-planner',
  'meta-screening-rescreen',
  'meta-statistics-r',
  'meta-zotero-fulltext-handoff',
  'mineru-pdf-parser',
  'nature-data',
  'nature-polishing',
  'openalex-database',
  'paper-2-web',
  'paper-download',
  'paper-fetcher',
  'paper-lookup',
  'peer-review',
  'pdf-evidence-extraction',
  'plotly',
  'polars',
  'pptx-posters',
  'prisma-manuscript-writer',
  'pubmed-database',
  'pubmed-search-strategy',
  'public-literature-download',
  'real-literature-trace',
  'research-paper-downloader',
  'scholar-evaluation',
  'scientific-brainstorming',
  'scientific-critical-thinking',
  'scientific-slides',
  'scientific-visualization',
  'scientific-writing',
  'scikit-survival',
  'seaborn',
  'statistical-analysis',
  'statsmodels',
  'venue-templates',
  'zotero-medautodata-library',
]);

function normalizeExplicitProjectKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'meta' || normalized === 'meta_analysis' || normalized === 'meta-analysis') {
    return 'meta';
  }
  return null;
}

function normalizeProjectKind(value) {
  return normalizeExplicitProjectKind(value) || 'meta';
}

function projectKindFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  return normalizeExplicitProjectKind(metadata.projectKind)
    || normalizeExplicitProjectKind(metadata.kind);
}

async function inferProjectKindForPath(projectPath, options = {}) {
  const explicitProjectKind = options?.projectKind ?? options?.metadata?.projectKind;
  const normalizedExplicitProjectKind = normalizeExplicitProjectKind(explicitProjectKind);
  if (normalizedExplicitProjectKind) {
    return normalizedExplicitProjectKind;
  }

  if (!projectPath) {
    return 'meta';
  }

  const absolutePath = path.resolve(projectPath);

  try {
    const { projectDb } = await import('./database/db.js');
    const project = projectDb.getProjectByPath(absolutePath);
    const dbKind = projectKindFromMetadata(project?.metadata);
    if (dbKind) {
      return dbKind;
    }
  } catch (err) {
    console.warn('[projects] Failed to infer project kind from index:', err.message);
  }

  return 'meta';
}

const CURRENT_DEFAULT_WORKSPACES_ROOT = path.join(os.homedir(), 'medautodata');
const LEGACY_DEFAULT_WORKSPACES_ROOTS = [
  path.join(os.homedir(), 'dr-claw'),
  path.join(os.homedir(), 'vibelab'),
];
const DELETED_PROJECTS_CONFIG_KEY = '_deletedProjects';

let projectConfigMutationQueue = Promise.resolve();

function isProjectTrashed(projectInfo = null, dbEntry = null) {
  return Boolean(projectInfo?.trash?.trashedAt || dbEntry?.metadata?.trash?.trashedAt);
}

function getSuppressedProjectMetadata(projectName, config = null, projectInfo = null) {
  return projectInfo?.deleted || config?.[DELETED_PROJECTS_CONFIG_KEY]?.[projectName] || null;
}

function isProjectSuppressed(projectName, config = null, projectInfo = null) {
  return Boolean(getSuppressedProjectMetadata(projectName, config, projectInfo)?.deletedAt);
}

function isSessionTrashed(session = null) {
  return Boolean(session?.metadata?.trash?.trashedAt);
}

function getProjectOwnerUserId(projectInfo = null, dbEntry = null) {
  return dbEntry?.user_id
    ?? projectInfo?.ownerUserId
    ?? projectInfo?.trash?.ownerUserId
    ?? projectInfo?.deleted?.ownerUserId
    ?? null;
}

function getDeletedProjectsStore(config) {
  if (!config[DELETED_PROJECTS_CONFIG_KEY] || typeof config[DELETED_PROJECTS_CONFIG_KEY] !== 'object') {
    config[DELETED_PROJECTS_CONFIG_KEY] = {};
  }

  return config[DELETED_PROJECTS_CONFIG_KEY];
}

function clearDeletedProjectMetadata(config, projectName) {
  if (!config?.[DELETED_PROJECTS_CONFIG_KEY]?.[projectName]) {
    return;
  }

  delete config[DELETED_PROJECTS_CONFIG_KEY][projectName];
  if (Object.keys(config[DELETED_PROJECTS_CONFIG_KEY]).length === 0) {
    delete config[DELETED_PROJECTS_CONFIG_KEY];
  }
}

async function readProjectInstanceId(projectPath) {
  if (!projectPath) {
    return null;
  }

  try {
    const instanceRaw = await fs.readFile(path.join(projectPath, 'instance.json'), 'utf8');
    const instanceData = JSON.parse(instanceRaw);
    return typeof instanceData?.instance_id === 'string' && instanceData.instance_id.trim()
      ? instanceData.instance_id.trim()
      : null;
  } catch (_) {
    return null;
  }
}

async function mutateProjectConfig(mutator) {
  const operation = projectConfigMutationQueue.then(async () => {
    const config = await loadProjectConfig();
    const result = await mutator(config);
    await saveProjectConfig(config);
    return result;
  });

  projectConfigMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function pathExists(targetPath) {
  if (!targetPath) {
    return false;
  }

  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function resolveProviderSessionProjectPath(projectName, sessionId = null) {
  const { projectDb, sessionDb } = await import('./database/db.js');
  const indexedSession = sessionId ? sessionDb.getSessionById(sessionId) : null;
  return indexedSession?.metadata?.projectPath
    || projectDb.getProjectById(projectName)?.path
    || await extractProjectDirectory(projectName).catch(() => null);
}

async function bootstrapProjectsIndexFromLegacySources(config, projectDb, userId = null, visibleWorkspaceRoots = []) {
  const candidateProjectNames = new Set(Object.keys(config).filter((key) => !key.startsWith('_')));
  const claudeProjectsRoot = path.join(os.homedir(), '.claude', 'projects');

  try {
    const entries = await fs.readdir(claudeProjectsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidateProjectNames.add(entry.name);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[projects] Failed to read Claude projects for bootstrap:', error.message);
    }
  }

  let seededCount = 0;

  for (const projectName of candidateProjectNames) {
    const projectInfo = config[projectName];
    if (isProjectSuppressed(projectName, config, projectInfo)) {
      continue;
    }

    let projectPath = projectInfo?.originalPath || projectInfo?.path || null;
    if (!projectPath) {
      projectPath = await extractProjectDirectory(projectName);
    }
    if (!projectPath) {
      continue;
    }

    const isManuallyAdded = Boolean(projectInfo?.manuallyAdded);
    if (!isManuallyAdded && visibleWorkspaceRoots.length > 0 && !await isPathWithinWorkspaceRoots(projectPath, visibleWorkspaceRoots)) {
      continue;
    }

    const existing = projectDb.getProjectById(projectName);
    const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(projectInfo, existing) ?? userId ?? null;
    const metadata = { ...(existing?.metadata || {}) };

    if (isManuallyAdded) {
      metadata.manuallyAdded = true;
    } else {
      delete metadata.manuallyAdded;
    }

    if (projectInfo?.trash?.trashedAt) {
      metadata.trash = {
        ...projectInfo.trash,
        ownerUserId: projectInfo.trash.ownerUserId ?? ownerUserId,
      };
    }

    projectDb.upsertProject(
      projectName,
      ownerUserId,
      existing?.display_name || projectInfo?.displayName || null,
      projectPath,
      existing?.is_starred || 0,
      existing?.last_accessed || null,
      Object.keys(metadata).length > 0 ? metadata : null,
    );
    seededCount += 1;
  }

  return seededCount;
}

function buildTrashEntry(projectName, projectInfo = null, dbEntry = null) {
  const trashMeta = dbEntry?.metadata?.trash || projectInfo?.trash;
  if (!trashMeta?.trashedAt) {
    return null;
  }

  const filesExist = trashMeta.filesExist !== false;

  return {
    name: projectName,
    displayName: dbEntry?.display_name || projectInfo?.displayName || trashMeta.displayName || projectName,
    fullPath: trashMeta.originalPath || dbEntry?.path || projectInfo?.originalPath || '',
    path: trashMeta.originalPath || dbEntry?.path || projectInfo?.originalPath || '',
    originalPath: trashMeta.originalPath || projectInfo?.originalPath || '',
    trashPath: trashMeta.trashPath || dbEntry?.path || '',
    claudeTrashPath: trashMeta.claudeTrashPath || '',
    trashedAt: trashMeta.trashedAt,
    sessionCount:
      typeof trashMeta.sessionCount === 'number'
        ? trashMeta.sessionCount
        : Array.isArray(dbEntry?.metadata?.sessions)
          ? dbEntry.metadata.sessions.length
          : 0,
    canRestore: Boolean(trashMeta.originalPath && filesExist),
    filesExist,
  };
}

function normalizeTaskStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw) return 'pending';
    if (raw === 'completed' || raw === 'complete') return 'done';
    if (raw === 'in_progress' || raw === 'inprogress') return 'in-progress';
    if (raw === 'todo' || raw === 'open') return 'pending';
    return raw;
}

// Import TaskMaster detection functions
async function detectTaskMasterFolder(projectPath) {
    try {
        const pipelinePath = path.join(projectPath, '.pipeline');
        const legacyPath = path.join(projectPath, '.taskmaster');
        let taskMasterPath = pipelinePath;

        const hasPipeline = await fs.access(pipelinePath).then(() => true).catch(() => false);
        if (!hasPipeline) {
            const hasLegacy = await fs.access(legacyPath).then(() => true).catch(() => false);
            if (hasLegacy) {
                await fs.cp(legacyPath, pipelinePath, { recursive: true, force: false });
                taskMasterPath = pipelinePath;
            } else {
                taskMasterPath = pipelinePath;
            }
        }

        // Check if .pipeline directory exists
        try {
            const stats = await fs.stat(taskMasterPath);
            if (!stats.isDirectory()) {
                return {
                    hasTaskmaster: false,
                    reason: '.pipeline exists but is not a directory'
                };
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    hasTaskmaster: false,
                    reason: '.pipeline directory not found'
                };
            }
            throw error;
        }

        // Check for key TaskMaster files
        const keyFiles = [
            'tasks/tasks.json',
            'config.json'
        ];

        const fileStatus = {};
        let hasEssentialFiles = true;

        for (const file of keyFiles) {
            const filePath = path.join(taskMasterPath, file);
            try {
                await fs.access(filePath);
                fileStatus[file] = true;
            } catch (error) {
                fileStatus[file] = false;
                if (file === 'tasks/tasks.json') {
                    hasEssentialFiles = false;
                }
            }
        }

        // Parse tasks.json if it exists for metadata
        let taskMetadata = null;
        if (fileStatus['tasks/tasks.json']) {
            try {
                const tasksPath = path.join(taskMasterPath, 'tasks/tasks.json');
                const tasksContent = await fs.readFile(tasksPath, 'utf8');
                const tasksData = JSON.parse(tasksContent);

                // Handle both tagged and legacy formats
                let tasks = [];
                if (tasksData.tasks) {
                    // Legacy format
                    tasks = tasksData.tasks;
                } else {
                    // Tagged format - get tasks from all tags
                    Object.values(tasksData).forEach(tagData => {
                        if (tagData.tasks) {
                            tasks = tasks.concat(tagData.tasks);
                        }
                    });
                }

                // Calculate task statistics
                const stats = tasks.reduce((acc, task) => {
                    const taskStatus = normalizeTaskStatus(task.status);
                    acc.total++;
                    acc[taskStatus] = (acc[taskStatus] || 0) + 1;

                    // Count subtasks
                    if (task.subtasks) {
                        task.subtasks.forEach(subtask => {
                            const subtaskStatus = normalizeTaskStatus(subtask.status);
                            acc.subtotalTasks++;
                            acc.subtasks = acc.subtasks || {};
                            acc.subtasks[subtaskStatus] = (acc.subtasks[subtaskStatus] || 0) + 1;
                        });
                    }

                    return acc;
                }, {
                    total: 0,
                    subtotalTasks: 0,
                    pending: 0,
                    'in-progress': 0,
                    done: 0,
                    review: 0,
                    deferred: 0,
                    cancelled: 0,
                    subtasks: {}
                });

                taskMetadata = {
                    taskCount: stats.total,
                    subtaskCount: stats.subtotalTasks,
                    completed: stats.done || 0,
                    pending: stats.pending || 0,
                    inProgress: stats['in-progress'] || 0,
                    review: stats.review || 0,
                    completionPercentage: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
                    lastModified: (await fs.stat(tasksPath)).mtime.toISOString()
                };
            } catch (parseError) {
                console.warn('Failed to parse tasks.json:', parseError.message);
                taskMetadata = { error: 'Failed to parse tasks.json' };
            }
        }

        return {
            hasTaskmaster: true,
            hasEssentialFiles,
            files: fileStatus,
            metadata: taskMetadata,
            path: taskMasterPath
        };

    } catch (error) {
        console.error('Error detecting TaskMaster folder:', error);
        return {
            hasTaskmaster: false,
            reason: `Error checking directory: ${error.message}`
        };
    }
}

// Cache for extracted project directories
const projectDirectoryCache = new Map();

// Clear cache when needed (called when project files change)
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
}

// Load project configuration file
async function writeProjectConfigFile(configPath, config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

async function loadProjectConfig() {
  const configPath = resolveProjectConfigPath();
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return {};
    }
  }

  for (const legacyPath of resolveLegacyProjectConfigPaths(os.homedir())) {
    try {
      const configData = await fs.readFile(legacyPath, 'utf8');
      const parsed = JSON.parse(configData);
      try {
        await writeProjectConfigFile(configPath, parsed);
      } catch (migrationError) {
        console.warn('[projects] Failed to migrate legacy project config:', migrationError.message);
      }
      return parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return {};
      }
    }
  }

  // Return empty config if no config exists anywhere.
  return {};
}

async function migrateLegacyDefaultWorkspacesRoot(targetRoot = CURRENT_DEFAULT_WORKSPACES_ROOT) {
  if (targetRoot !== CURRENT_DEFAULT_WORKSPACES_ROOT) {
    return targetRoot;
  }

  const currentExists = fsSync.existsSync(CURRENT_DEFAULT_WORKSPACES_ROOT);
  const existingLegacyRoot = LEGACY_DEFAULT_WORKSPACES_ROOTS.find((legacyRoot) => fsSync.existsSync(legacyRoot)) || null;

  if (!existingLegacyRoot || currentExists) {
    return targetRoot;
  }

  try {
    await fs.rename(existingLegacyRoot, CURRENT_DEFAULT_WORKSPACES_ROOT);
    return CURRENT_DEFAULT_WORKSPACES_ROOT;
  } catch (error) {
    console.warn('[projects] Failed to migrate legacy default workspace root, using legacy path:', error.message);
    return existingLegacyRoot;
  }
}

async function resolveConfiguredWorkspacesRoot(configRoot = null) {
  if (!configRoot) {
    return migrateLegacyDefaultWorkspacesRoot();
  }

  if (LEGACY_DEFAULT_WORKSPACES_ROOTS.includes(configRoot)) {
    return migrateLegacyDefaultWorkspacesRoot();
  }

  return configRoot;
}

async function normalizeComparablePath(targetPath) {
  const resolved = path.resolve(targetPath);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function normalizeWorkspaceRoots(roots) {
  const normalizedRoots = [];

  for (const root of roots) {
    if (!root) continue;

    try {
      const normalizedRoot = await normalizeComparablePath(root);
      if (!normalizedRoots.includes(normalizedRoot)) {
        normalizedRoots.push(normalizedRoot);
      }
    } catch (error) {
      console.warn('[projects] Failed to normalize workspace root:', root, error.message);
    }
  }

  return normalizedRoots;
}

async function getVisibleWorkspaceRoots(configRoot = null) {
  const resolvedRoot = process.env.WORKSPACES_ROOT || await resolveConfiguredWorkspacesRoot(configRoot);
  const candidateRoots = [resolvedRoot];

  const usesDefaultWorkspaceRoot =
    !process.env.WORKSPACES_ROOT &&
    (!configRoot ||
      configRoot === CURRENT_DEFAULT_WORKSPACES_ROOT ||
      LEGACY_DEFAULT_WORKSPACES_ROOTS.includes(configRoot) ||
      resolvedRoot === CURRENT_DEFAULT_WORKSPACES_ROOT ||
      LEGACY_DEFAULT_WORKSPACES_ROOTS.includes(resolvedRoot));

  if (usesDefaultWorkspaceRoot) {
    candidateRoots.push(...LEGACY_DEFAULT_WORKSPACES_ROOTS);
    candidateRoots.push(CURRENT_DEFAULT_WORKSPACES_ROOT);
  }

  return normalizeWorkspaceRoots(candidateRoots);
}

async function isPathWithinWorkspaceRoots(candidatePath, normalizedRoots) {
  const normalizedPath = await normalizeComparablePath(candidatePath);
  return normalizedRoots.some((root) => normalizedPath === root || normalizedPath.startsWith(root + path.sep));
}

function remapProjectPathToCurrentHome(projectPath) {
  if (!projectPath) {
    return null;
  }

  const normalizedPath = path.resolve(projectPath);
  const currentHome = path.resolve(os.homedir());
  const homeParent = path.dirname(currentHome);

  if (
    normalizedPath === currentHome
    || normalizedPath.startsWith(currentHome + path.sep)
    || !normalizedPath.startsWith(homeParent + path.sep)
  ) {
    return null;
  }

  const relativeFromHomeParent = path.relative(homeParent, normalizedPath);
  const [candidateHomeName, ...restSegments] = relativeFromHomeParent.split(path.sep).filter(Boolean);

  if (!candidateHomeName || candidateHomeName === path.basename(currentHome) || restSegments.length === 0) {
    return null;
  }

  return path.join(currentHome, ...restSegments);
}

function rewriteProjectMetadataPaths(metadata, oldPath, newPath) {
  if (!metadata || typeof metadata !== 'object') {
    return metadata;
  }

  let changed = false;
  const nextMetadata = { ...metadata };

  if (nextMetadata.originalPath === oldPath) {
    nextMetadata.originalPath = newPath;
    changed = true;
  }

  if (nextMetadata.path === oldPath) {
    nextMetadata.path = newPath;
    changed = true;
  }

  if (nextMetadata.trash?.originalPath === oldPath) {
    nextMetadata.trash = {
      ...nextMetadata.trash,
      originalPath: newPath,
    };
    changed = true;
  }

  return changed ? nextMetadata : metadata;
}

function rewriteProjectConfigPaths(config, projectName, oldPath, newPath) {
  let changed = false;
  const projectInfo = config?.[projectName];

  if (projectInfo?.originalPath === oldPath) {
    projectInfo.originalPath = newPath;
    changed = true;
  }

  if (projectInfo?.path === oldPath) {
    projectInfo.path = newPath;
    changed = true;
  }

  if (projectInfo?.trash?.originalPath === oldPath) {
    projectInfo.trash = {
      ...projectInfo.trash,
      originalPath: newPath,
    };
    changed = true;
  }

  const deletedProject = config?.[DELETED_PROJECTS_CONFIG_KEY]?.[projectName];
  if (deletedProject?.originalPath === oldPath) {
    deletedProject.originalPath = newPath;
    changed = true;
  }

  return changed;
}

async function maybeMigrateProjectPathToCurrentHome(projectName, projectPath, projectDb, config = null, existingEntry = null) {
  const migratedPath = remapProjectPathToCurrentHome(projectPath);
  if (!migratedPath || migratedPath === projectPath) {
    return null;
  }

  if (await pathExists(projectPath) || !await pathExists(migratedPath)) {
    return null;
  }

  let configDirty = false;
  if (config) {
    configDirty = rewriteProjectConfigPaths(config, projectName, projectPath, migratedPath);
  }

  if (projectDb) {
    const dbEntry = existingEntry || projectDb.getProjectById(projectName);
    if (dbEntry) {
      const nextMetadata = rewriteProjectMetadataPaths(dbEntry.metadata, projectPath, migratedPath);
      projectDb.upsertProject(
        projectName,
        dbEntry.user_id ?? null,
        dbEntry.display_name ?? null,
        migratedPath,
        dbEntry.is_starred ?? 0,
        dbEntry.last_accessed ?? null,
        nextMetadata || null,
      );
    }
  }

  console.log(`[projects] Remapped project path from previous home: ${projectName} -> ${migratedPath}`);

  return {
    oldPath: projectPath,
    newPath: migratedPath,
    configDirty,
  };
}

function remapLegacyProjectPath(projectPath) {
  if (!projectPath) return null;

  const normalizedPath = path.resolve(projectPath);
  for (const legacyRoot of LEGACY_DEFAULT_WORKSPACES_ROOTS) {
    if (
      normalizedPath === legacyRoot ||
      normalizedPath.startsWith(legacyRoot + path.sep)
    ) {
      return path.join(
        CURRENT_DEFAULT_WORKSPACES_ROOT,
        path.relative(legacyRoot, normalizedPath)
      );
    }
  }

  return null;
}

function remapCurrentProjectPathsToLegacy(projectPath) {
  if (!projectPath) return [];

  const normalizedPath = path.resolve(projectPath);
  if (
    normalizedPath !== CURRENT_DEFAULT_WORKSPACES_ROOT &&
    !normalizedPath.startsWith(CURRENT_DEFAULT_WORKSPACES_ROOT + path.sep)
  ) {
    return [];
  }

  return LEGACY_DEFAULT_WORKSPACES_ROOTS.map((legacyRoot) => (
    path.join(
      legacyRoot,
      path.relative(CURRENT_DEFAULT_WORKSPACES_ROOT, normalizedPath)
    )
  ));
}

function remapCurrentProjectPathToLegacy(projectPath) {
  return remapCurrentProjectPathsToLegacy(projectPath)[0] || null;
}

async function maybeMigrateLegacyProject(projectName, projectInfo, projectDb) {
  const legacyPath = projectInfo?.originalPath || projectInfo?.path;
  const migratedPath = remapLegacyProjectPath(legacyPath);

  if (!legacyPath || !migratedPath || migratedPath === legacyPath) {
    return null;
  }

  const legacyProjectId = projectName || encodeProjectPath(legacyPath);
  const migratedProjectId = encodeProjectPath(migratedPath);
  const legacyClaudeDir = path.join(os.homedir(), '.claude', 'projects', legacyProjectId);
  const migratedClaudeDir = path.join(os.homedir(), '.claude', 'projects', migratedProjectId);

  let legacyExists = false;
  let migratedExists = false;

  try {
    await fs.access(legacyPath);
    legacyExists = true;
  } catch (_) {}

  try {
    await fs.access(migratedPath);
    migratedExists = true;
  } catch (_) {}

  if (legacyExists && !migratedExists) {
    try {
      await fs.mkdir(path.dirname(migratedPath), { recursive: true });
      await fs.rename(legacyPath, migratedPath);
      migratedExists = true;
      legacyExists = false;
    } catch (error) {
      console.warn('[projects] Failed to move legacy project directory:', legacyPath, '->', migratedPath, error.message);
      return null;
    }
  }

  if (!migratedExists) {
    return null;
  }

  try {
    await fs.access(legacyClaudeDir);
    try {
      await fs.access(migratedClaudeDir);
    } catch (_) {
      await fs.rename(legacyClaudeDir, migratedClaudeDir);
    }
  } catch (_) {}

  if (projectDb && legacyProjectId !== migratedProjectId) {
    const existingMigratedProject = projectDb.getProjectById(migratedProjectId);
    if (!existingMigratedProject) {
      const existingLegacyProject = projectDb.getProjectById(legacyProjectId);
      if (existingLegacyProject) {
        projectDb.migrateProjectIdentity(legacyProjectId, migratedProjectId, migratedPath);
      }
    }
  } else if (projectDb) {
    projectDb.updateProjectPath(migratedProjectId, migratedPath);
  }

  return {
    oldId: legacyProjectId,
    newId: migratedProjectId,
    oldPath: legacyPath,
    newPath: migratedPath
  };
}

async function migrateLegacyProjects(config, projectDb) {
  let configDirty = false;

  for (const [projectName, projectInfo] of Object.entries(config)) {
    if (projectName.startsWith('_') || !projectInfo?.originalPath) {
      continue;
    }

    const migration = await maybeMigrateLegacyProject(projectName, projectInfo, projectDb);
    if (!migration) {
      continue;
    }

    const nextProjectInfo = {
      ...projectInfo,
      originalPath: migration.newPath
    };

    if (migration.oldId !== migration.newId) {
      if (!config[migration.newId]) {
        config[migration.newId] = nextProjectInfo;
      }
      delete config[projectName];
    } else {
      config[projectName] = nextProjectInfo;
    }
    configDirty = true;
  }

  if (configDirty) {
    await saveProjectConfig(config);
    clearProjectDirectoryCache();
  }

  return configDirty;
}

async function migrateProjectsToCurrentHome(config, projectDb) {
  let configDirty = false;
  const seenProjectIds = new Set();

  for (const dbEntry of projectDb.getAllProjects()) {
    seenProjectIds.add(dbEntry.id);
    const migration = await maybeMigrateProjectPathToCurrentHome(
      dbEntry.id,
      dbEntry.path,
      projectDb,
      config,
      dbEntry,
    );
    if (migration?.configDirty) {
      configDirty = true;
    }
  }

  for (const [projectName, projectInfo] of Object.entries(config)) {
    if (projectName.startsWith('_') || seenProjectIds.has(projectName)) {
      continue;
    }

    const projectPath = projectInfo?.originalPath || projectInfo?.path || null;
    if (!projectPath) {
      continue;
    }

    const migration = await maybeMigrateProjectPathToCurrentHome(
      projectName,
      projectPath,
      null,
      config,
    );
    if (migration?.configDirty) {
      configDirty = true;
    }
  }

  if (configDirty) {
    await saveProjectConfig(config);
    clearProjectDirectoryCache();
  }

  return configDirty;
}

// Save project configuration file
async function saveProjectConfig(config) {
  await writeProjectConfigFile(resolveProjectConfigPath(), config);
}

export function encodeProjectPath(projectPath) {
  return path.resolve(projectPath).replace(/[\\/:\s~_.]/g, '-');
}

// Generate better display name from path
async function generateDisplayName(projectName, actualProjectDir = null) {
  // Use actual project directory if provided, otherwise decode from project name
  let projectPath = actualProjectDir || projectName.replace(/-/g, '/');

  // Try to read package.json from the project path
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);

    // Return the name from package.json if it exists
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch (error) {
    // Fall back to path-based naming if package.json doesn't exist or can't be read
  }

  // If it starts with /, it's an absolute path
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    // Return only the last folder name
    return parts[parts.length - 1] || projectPath;
  }

  return projectPath;
}

// Extract the actual project directory from JSONL sessions (with caching)
async function extractProjectDirectory(projectName) {
  // Check cache first
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName);
  }

  // Check project config for originalPath (manually added projects via UI or platform)
  // This handles projects with dashes in their directory names correctly
  const config = await loadProjectConfig();
  if (config[projectName]?.originalPath) {
    const originalPath = config[projectName].originalPath;
    projectDirectoryCache.set(projectName, originalPath);
    return originalPath;
  }

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
  const cwdCounts = new Map();
  let latestTimestamp = 0;
  let latestCwd = null;
  let extractedPath;

  try {
    // Check if the project directory exists
    await fs.access(projectDir);

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      // Fall back to decoded project name if no sessions, but never to '/'
      const decoded = projectName.replace(/-/g, '/');
      extractedPath = decoded === '/' ? os.homedir() : decoded;
    } else {
      // Process all JSONL files to collect cwd values
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);

              if (entry.cwd) {
                // Count occurrences of each cwd
                cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);

                // Track the most recent cwd
                const timestamp = new Date(entry.timestamp || 0).getTime();
                if (timestamp > latestTimestamp) {
                  latestTimestamp = timestamp;
                  latestCwd = entry.cwd;
                }
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        }
      }

      // Determine the best cwd to use
      if (cwdCounts.size === 0) {
        // No cwd found, fall back to decoded project name, but never to '/'
        const decoded = projectName.replace(/-/g, '/');
        extractedPath = decoded === '/' ? os.homedir() : decoded;
      } else if (cwdCounts.size === 1) {
        // Only one cwd, use it
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // Multiple cwd values - prefer the most recent one if it has reasonable usage
        const mostRecentCount = cwdCounts.get(latestCwd) || 0;
        const maxCount = Math.max(...cwdCounts.values());

        // Use most recent if it has at least 25% of the max count
        if (mostRecentCount >= maxCount * 0.25) {
          extractedPath = latestCwd;
        } else {
          // Otherwise use the most frequently used cwd
          for (const [cwd, count] of cwdCounts.entries()) {
            if (count === maxCount) {
              extractedPath = cwd;
              break;
            }
          }
        }

        // Fallback (shouldn't reach here)
        if (!extractedPath) {
          const decoded = projectName.replace(/-/g, '/');
          extractedPath = latestCwd || (decoded === '/' ? os.homedir() : decoded);
        }
      }
    }

    // Cache the result
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;

  } catch (error) {
    // If the directory doesn't exist, just use the decoded project name
    if (error.code === 'ENOENT') {
      const decoded = projectName.replace(/-/g, '/');
      extractedPath = decoded === '/' ? os.homedir() : decoded;
    } else {
      console.error(`Error extracting project directory for ${projectName}:`, error);
      // Fall back to decoded project name for other errors, but never to '/'
      const decoded = projectName.replace(/-/g, '/');
      extractedPath = decoded === '/' ? os.homedir() : decoded;
    }

    // Cache the fallback result too
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function mapIndexedSessionToProjectSession(session, provider) {
  const metadata = session?.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const mode = extractSessionModeFromMetadata(metadata);
  const lastActivity = session?.last_activity || session?.lastActivity || session?.created_at || session?.createdAt || null;
  const createdAt = session?.created_at || session?.createdAt || lastActivity;
  const messageCount = Number(session?.message_count ?? session?.messageCount ?? 0);
  const baseName = session?.display_name || session?.name || session?.summary || null;
  const tags = Array.isArray(session?.tags) ? session.tags : [];

  return {
    id: session.id,
    summary: baseName || 'New Session',
    createdAt,
    lastActivity,
    messageCount,
    mode,
    tags,
    __provider: 'claude',
  };
}

function isPlaceholderSessionName(provider, displayName) {
  return String(displayName || '').trim() === 'New Session';
}

async function shouldRefreshIndexedSession(provider, indexedSession, parsedSession) {
  if (!parsedSession) {
    return false;
  }

  if (!indexedSession) {
    return true;
  }

  const indexedName = String(indexedSession.display_name || indexedSession.name || indexedSession.summary || '').trim();
  const parsedName = String(parsedSession.summary || parsedSession.name || '').trim();
  if (parsedName && indexedName !== parsedName) {
    return true;
  }

  const indexedCount = Number(indexedSession.message_count ?? indexedSession.messageCount ?? 0);
  const parsedCount = Number(parsedSession.messageCount ?? 0);
  if (parsedCount > indexedCount) {
    return true;
  }

  const { normalizeSessionTimestamp } = await import('./database/db.js');
  const indexedLastActivity = normalizeSessionTimestamp(indexedSession.last_activity || indexedSession.lastActivity);
  const parsedLastActivity = normalizeSessionTimestamp(parsedSession.lastActivity);
  if (parsedLastActivity && parsedLastActivity !== indexedLastActivity) {
    return true;
  }

  const indexedMode = extractSessionModeFromMetadata(indexedSession.metadata);
  const parsedMode = normalizeSessionMode(parsedSession.mode);
  if (indexedMode !== parsedMode) {
    return true;
  }

  return isPlaceholderSessionName(provider, indexedName) && Boolean(parsedName);
}

async function reconcileIndexedSessionFromSource(projectName, provider, parsedSession, indexedSession = null, projectPath = null) {
  const { sessionDb, normalizeSessionTimestamp } = await import('./database/db.js');

  const resolvedProjectPath =
    projectPath ||
    parsedSession.projectPath ||
    parsedSession.cwd ||
    indexedSession?.metadata?.projectPath ||
    await extractProjectDirectory(projectName).catch(() => null);
  const metadata = {
    ...(indexedSession?.metadata && typeof indexedSession.metadata === 'object' ? indexedSession.metadata : {}),
    sessionMode: normalizeSessionMode(parsedSession.mode),
    indexState: 'synced',
  };
  if (resolvedProjectPath) {
    metadata.projectPath = resolvedProjectPath;
  }

  sessionDb.upsertSessionFromSource(parsedSession.id, projectName, provider, {
    displayName: parsedSession.summary || parsedSession.name || null,
    lastActivity: normalizeSessionTimestamp(parsedSession.lastActivity),
    messageCount: Number(parsedSession.messageCount || 0),
    metadata,
    createdAt: parsedSession.createdAt || indexedSession?.created_at || null,
    isStarred: indexedSession?.is_starred ?? 0,
  });
}

async function reconcileClaudeSessionIndex(projectName, targetSessionId = null) {
  if (targetSessionId) {
    const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
    const sessionFile = path.join(projectDir, `${targetSessionId}.jsonl`);
    const { sessionDb } = await import('./database/db.js');

    try {
      await fs.access(sessionFile);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { sessions: [], hasMore: false, total: 0, session: null };
      }
      throw error;
    }

    const dbSessions = sessionDb.getSessionsByProject(projectName);
    const dbSessionMap = new Map(dbSessions.filter((session) => session.provider === 'claude').map((session) => [session.id, session]));
    const projectPath = await extractProjectDirectory(projectName).catch(() => null);
    const result = await parseJsonlSessions(sessionFile, projectName, dbSessionMap);
    const session = (result.sessions || []).find((item) => item.id === targetSessionId) || null;

    if (session) {
      const indexedSession = dbSessionMap.get(session.id) || null;
      if (await shouldRefreshIndexedSession('claude', indexedSession, session)) {
        await reconcileIndexedSessionFromSource(projectName, 'claude', session, indexedSession, projectPath);
      }
    }

    return {
      sessions: session ? [session] : [],
      hasMore: false,
      total: session ? 1 : 0,
      session,
    };
  }

  return getSessions(projectName, 0, 0);
}

async function reindexProjectSessions(projectName, options = {}) {
  const {
    userId = null,
  } = options;
  const normalizedProviders = ['claude'];

  const { projectDb, sessionDb } = await import('./database/db.js');
  const existingProject = projectDb.getProjectById(projectName);
  if (userId && existingProject?.user_id && existingProject.user_id !== userId) {
    throw new Error('You do not have permission to reindex this project');
  }

  await reconcileClaudeSessionIndex(projectName);

  const indexedSessions = sessionDb.getSessionsByProject(projectName).filter((session) => !isSessionTrashed(session));
  return {
    providers: normalizedProviders,
    sessions: indexedSessions.filter((session) => session.provider === 'claude').map((session) => mapIndexedSessionToProjectSession(session, 'claude')),
  };
}

async function getProjects(userId, progressCallback = null) {
  const { projectDb, sessionDb, metaAnalysisDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const projects = [];

  await migrateLegacyProjects(config, projectDb);
  await migrateProjectsToCurrentHome(config, projectDb);

  const visibleWorkspaceRoots = await getVisibleWorkspaceRoots(config._workspacesRoot || null);
  let totalProjects = 0;
  let processedProjects = 0;

  let dbProjects = projectDb.getAllProjects(userId || null);
  if (dbProjects.length === 0) {
    const seededCount = await bootstrapProjectsIndexFromLegacySources(
      config,
      projectDb,
      userId || null,
      visibleWorkspaceRoots,
    );
    if (seededCount > 0) {
      dbProjects = projectDb.getAllProjects(userId || null);
    }
  }

  try {
    const visibleProjects = [];
    for (const dbEntry of dbProjects) {
      const projectInfo = config[dbEntry.id];
      if (
        isProjectTrashed(projectInfo, dbEntry)
        || isProjectSuppressed(dbEntry.id, config, projectInfo)
      ) {
        continue;
      }

      const projectPath = dbEntry.path || projectInfo?.originalPath || null;
      if (!projectPath) {
        continue;
      }

      const isManuallyAdded = Boolean(dbEntry.metadata?.manuallyAdded || projectInfo?.manuallyAdded);
      if (!isManuallyAdded && !await isPathWithinWorkspaceRoots(projectPath, visibleWorkspaceRoots)) {
        console.log(`[projects] Skipping external DB project: ${dbEntry.id} at ${projectPath}`);
        continue;
      }

      visibleProjects.push({
        entry: { name: dbEntry.id },
        actualProjectDir: projectPath,
        dbEntry,
      });
    }

    const projectNames = visibleProjects.map(({ entry }) => entry.name);
    let indexedSessions = sessionDb.getSessionsByProjects(projectNames).filter((session) => !isSessionTrashed(session));
    const sessionsByProject = new Map();

    for (const session of indexedSessions) {
      if (!sessionsByProject.has(session.project_name)) {
        sessionsByProject.set(session.project_name, []);
      }
      sessionsByProject.get(session.project_name).push(session);
    }

    totalProjects = visibleProjects.length;

    const hydratedProjects = await mapWithConcurrency(visibleProjects, 6, async ({ entry, actualProjectDir, dbEntry }) => {
      processedProjects++;

      if (progressCallback) {
        progressCallback({ phase: 'loading', current: processedProjects, total: totalProjects, currentProject: entry.name });
      }

      // If the underlying directory no longer exists (common after manual deletes or failed workspace creation),
      // auto-trash the project so it doesn't keep reappearing as an "empty project".
      try {
        await fs.access(actualProjectDir);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          console.warn(`[projects] Auto-trashing missing project directory: ${entry.name} at ${actualProjectDir}`);
          try {
            await deleteProject(entry.name, false, userId || null);
          } catch (trashError) {
            console.warn('[projects] Failed to auto-trash missing project:', entry.name, trashError?.message);
          }
          return null;
        }
      }

      const projectInfo = config[entry.name];
      const displayName = dbEntry?.display_name || projectInfo?.displayName || await generateDisplayName(entry.name, actualProjectDir);
      const existingMetaProject = userId
        ? metaAnalysisDb.getMetaProjectByProjectId(userId, entry.name)
        : null;
      const baseMetadata = dbEntry?.metadata && typeof dbEntry.metadata === 'object'
        ? { ...dbEntry.metadata }
        : null;
      const baseMetaAnalysis = baseMetadata?.metaAnalysis && typeof baseMetadata.metaAnalysis === 'object' && !Array.isArray(baseMetadata.metaAnalysis)
        ? { ...baseMetadata.metaAnalysis }
        : {};
      delete baseMetaAnalysis.workflowRoot;
      // This is a Meta-only app, but many projects were indexed before
      // projectKind metadata was introduced. Keep those existing projects in
      // the sidebar and hydrate them with Meta-compatible metadata instead of
      // silently dropping them from the project list.
      const folderSchemaVersion = normalizeMetaFolderSchemaVersion(baseMetaAnalysis.folderSchemaVersion)
        || META_FOLDER_SCHEMA_VERSION;
      const hydratedReviewType = existingMetaProject?.review_type
        ? String(existingMetaProject.review_type).trim().toLowerCase()
        : '';
      const metadata = {
        ...(baseMetadata || {}),
        projectKind: 'meta',
        metaAnalysis: {
          ...baseMetaAnalysis,
          workflow: META_PROJECT_WORKFLOW,
          templateId: META_PROJECT_TEMPLATE_ID,
          artifactRoots: getMetaStageDirs(actualProjectDir, { folderSchemaVersion }),
          folderSchemaVersion,
          ...(hydratedReviewType ? { reviewType: hydratedReviewType } : {}),
          ...(existingMetaProject?.id ? { metaProjectId: existingMetaProject.id } : {}),
        },
      };

      let dirCreatedAt = dbEntry?.created_at;
      if (!dirCreatedAt) {
        try {
          const dirStat = await fs.stat(actualProjectDir);
          dirCreatedAt = dirStat.birthtime.toISOString();
        } catch (_) {}
      }

      const project = {
        name: entry.name,
        path: actualProjectDir,
        displayName,
        fullPath: actualProjectDir,
        isCustomName: !!(dbEntry?.display_name || projectInfo?.displayName),
        createdAt: dirCreatedAt,
        metadata,
        isStarred: !!dbEntry?.is_starred,
        sessions: [],
        sessionMeta: { hasMore: false, total: 0 }
      };

      const projectSessions = sessionsByProject.get(entry.name) || [];
      const claudeSessions = projectSessions.filter((session) => session.provider === 'claude');

      project.sessions = claudeSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'claude'));
      project.sessionMeta = {
        total: claudeSessions.length,
        hasMore: claudeSessions.length > 5,
      };

      const taskmasterResult = await detectTaskMasterFolder(actualProjectDir).catch(() => null);

      if (taskmasterResult) {
        const tm = taskmasterResult;
        project.taskmaster = {
          hasTaskmaster: tm.hasTaskmaster,
          hasEssentialFiles: tm.hasEssentialFiles,
          metadata: tm.metadata,
          status: tm.hasTaskmaster && tm.hasEssentialFiles ? 'configured' : 'not-configured'
        };
        project.pipeline = project.taskmaster;
      }

      return project;
    });

    projects.push(...hydratedProjects.filter(Boolean));
  } catch (error) {
    console.error('Error reading projects from database:', error);
  }

  return projects;
}

async function getTrashedProjects(userId = null) {
  const { projectDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const allDbProjects = projectDb.getAllProjects();
  const dbProjectMap = new Map(allDbProjects.map((entry) => [entry.id, entry]));
  const allProjectNames = new Set([
    ...Object.keys(config).filter((key) => !key.startsWith('_')),
    ...allDbProjects.map((entry) => entry.id),
  ]);

  const trashEntries = [];

  for (const projectName of allProjectNames) {
    const projectInfo = config[projectName];
    const dbEntry = dbProjectMap.get(projectName);

    if (!isProjectTrashed(projectInfo, dbEntry)) {
      continue;
    }

    const ownerUserId = getProjectOwnerUserId(projectInfo, dbEntry);
    if (userId && ownerUserId !== userId) {
      continue;
    }

    const trashEntry = buildTrashEntry(projectName, projectInfo, dbEntry);
    if (trashEntry) {
      trashEntries.push(trashEntry);
    }
  }

  return trashEntries.sort(
    (left, right) => new Date(right.trashedAt).getTime() - new Date(left.trashedAt).getTime(),
  );
}

async function getSessions(projectName, limit = 5, offset = 0, userId = null) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
  const { sessionDb } = await import('./database/db.js');

  try {
    // Check if the project directory exists before trying to read it
    try {
      await fs.access(projectDir);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // No Claude sessions for this project yet, which is fine for manual projects
        return { sessions: [], hasMore: false, total: 0 };
      }
      throw err;
    }

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return { sessions: [], hasMore: false, total: 0 };
    }

    // Fetch indexed sessions from database - filter by userId?
    // Usually sessions inherit project ownership, but we store it anyway.
    const dbSessions = sessionDb.getSessionsByProject(projectName);
    const dbSessionMap = new Map(dbSessions.filter(s => s.provider === 'claude').map(s => [s.id, s]));
    const projectPath = await extractProjectDirectory(projectName).catch(() => null);

    // ... (rest of getSessions remains mostly same, but ensures it uses the DB map correctly)


    // Sort files by modification time (newest first)
    const filesWithStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );
    filesWithStats.sort((a, b) => b.mtime - a.mtime);

    const allSessions = new Map();
    const allEntries = [];
    const uuidToSessionMap = new Map();

    // Collect all sessions and entries from all files
    for (const { file } of filesWithStats) {
      const jsonlFile = path.join(projectDir, file);
      const result = await parseJsonlSessions(jsonlFile, projectName, dbSessionMap);

      result.sessions.forEach(session => {
        if (!allSessions.has(session.id)) {
          allSessions.set(session.id, session);
        }
      });

      allEntries.push(...result.entries);

      // Early exit optimization for large projects
      if (allSessions.size >= (limit + offset) * 2 && allEntries.length >= Math.min(3, filesWithStats.length)) {
        break;
      }
    }

    // Build UUID-to-session mapping for timeline detection
    allEntries.forEach(entry => {
      if (entry.uuid && entry.sessionId) {
        uuidToSessionMap.set(entry.uuid, entry.sessionId);
      }
    });

    // Group sessions by first user message ID
    const sessionGroups = new Map(); // firstUserMsgId -> { latestSession, allSessions[] }
    const sessionToFirstUserMsgId = new Map(); // sessionId -> firstUserMsgId

    // Find the first user message for each session
    allEntries.forEach(entry => {
      if (entry.sessionId && entry.type === 'user' && entry.parentUuid === null && entry.uuid) {
        // This is a first user message in a session (parentUuid is null)
        const firstUserMsgId = entry.uuid;

        if (!sessionToFirstUserMsgId.has(entry.sessionId)) {
          sessionToFirstUserMsgId.set(entry.sessionId, firstUserMsgId);

          const session = allSessions.get(entry.sessionId);
          if (session) {
            if (!sessionGroups.has(firstUserMsgId)) {
              sessionGroups.set(firstUserMsgId, {
                latestSession: session,
                allSessions: [session]
              });
            } else {
              const group = sessionGroups.get(firstUserMsgId);
              group.allSessions.push(session);

              // Update latest session if this one is more recent
              if (new Date(session.lastActivity) > new Date(group.latestSession.lastActivity)) {
                group.latestSession = session;
              }
            }
          }
        }
      }
    });

    // Collect all sessions that don't belong to any group (standalone sessions)
    const groupedSessionIds = new Set();
    sessionGroups.forEach(group => {
      group.allSessions.forEach(session => groupedSessionIds.add(session.id));
    });

    const standaloneSessionsArray = Array.from(allSessions.values())
      .filter(session => !groupedSessionIds.has(session.id));

    // Combine grouped sessions (only show latest from each group) + standalone sessions
    const latestFromGroups = Array.from(sessionGroups.values()).map(group => {
      const session = { ...group.latestSession };
      // Add metadata about grouping
      if (group.allSessions.length > 1) {
        session.isGrouped = true;
        session.groupSize = group.allSessions.length;
        session.groupSessions = group.allSessions.map(s => s.id);
      }
      return session;
    });
    const visibleSessions = [...latestFromGroups, ...standaloneSessionsArray]
      .filter(session => !session.summary.startsWith('{ "'))
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    // Hide trashed sessions by default.
    const isTrashed = (session) => {
      const indexed = dbSessionMap.get(session?.id) || null;
      return Boolean(indexed?.metadata?.trash?.trashedAt);
    };
    const untrashedSessions = visibleSessions.filter((session) => !isTrashed(session));

    await Promise.all(
      untrashedSessions.map(async (session) => {
        const indexedSession = dbSessionMap.get(session.id) || null;
        if (!await shouldRefreshIndexedSession('claude', indexedSession, session)) {
          return;
        }

        await reconcileIndexedSessionFromSource(projectName, 'claude', session, indexedSession, projectPath);
      })
    );

    const total = untrashedSessions.length;
    const paginatedSessions = limit > 0 ? untrashedSessions.slice(offset, offset + limit) : untrashedSessions.slice(offset);
    const hasMore = limit > 0 ? offset + limit < total : false;

    return {
      sessions: paginatedSessions,
      hasMore,
      total,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading sessions for project ${projectName}:`, error);
    return { sessions: [], hasMore: false, total: 0 };
  }
}

async function parseJsonlSessions(filePath, projectName = null, dbSessionMap = null) {
  const sessions = new Map();
  const entries = [];
  const pendingSummaries = new Map(); // leafUuid -> summary for entries without sessionId

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);

          // Handle summary entries that don't have sessionId yet
          if (entry.type === 'summary' && entry.summary && !entry.sessionId && entry.leafUuid) {
            pendingSummaries.set(entry.leafUuid, entry.summary);
          }

          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              // Priority: 1. DB name, 2. Default
              let initialSummary = 'New Session';
              if (dbSessionMap && dbSessionMap.has(entry.sessionId)) {
                initialSummary = dbSessionMap.get(entry.sessionId).display_name;
              }

              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: initialSummary,
                messageCount: 0,
                lastActivity: new Date(),
                cwd: entry.cwd || '',
                lastUserMessage: null,
                lastAssistantMessage: null,
                mode: dbSessionMap && dbSessionMap.has(entry.sessionId)
                  ? (readExplicitSessionModeFromMetadata(dbSessionMap.get(entry.sessionId).metadata) || 'research')
                  : 'research',
                tags: dbSessionMap && dbSessionMap.has(entry.sessionId)
                  ? (Array.isArray(dbSessionMap.get(entry.sessionId).tags) ? dbSessionMap.get(entry.sessionId).tags : [])
                  : []
              });
            }

            const session = sessions.get(entry.sessionId);

            // If we have a DB name, we might skip the logic to overwrite it with "New Session" file logs,
            // but we still want to update it if the file has a LATEST summary entry that might be newer.
            // For now, manual DB renames should take precedence if they are different from 'New Session'

            // Apply pending summary if this entry has a parentUuid that matches a pending summary
            if (session.summary === 'New Session' && entry.parentUuid && pendingSummaries.has(entry.parentUuid)) {
              session.summary = pendingSummaries.get(entry.parentUuid);
            }

            // Update summary from summary entries with sessionId - always take the LATEST in the file
            if (entry.type === 'summary' && entry.summary) {
              session.summary = stripInternalContextPrefix(entry.summary);
            }

            // Track last user and assistant messages (skip system messages)
            if (entry.message?.role === 'user' && entry.message?.content) {
              const content = entry.message.content;

              // Extract text from all text parts if it's an array
              let textContent = '';
              if (Array.isArray(content)) {
                textContent = content
                  .filter(part => part.type === 'text')
                  .map(part => part.text)
                  .join(' ');
              } else if (typeof content === 'string') {
                textContent = content;
              }

              const isSystemMessage = typeof textContent === 'string' && (
                textContent.startsWith('<command-name>') ||
                textContent.startsWith('<command-message>') ||
                textContent.startsWith('<command-args>') ||
                textContent.startsWith('<local-command-stdout>') ||
                textContent.startsWith('<system-reminder>') ||
                textContent.startsWith('Caveat:') ||
                textContent.startsWith('This session is being continued from a previous') ||
                textContent.startsWith('Invalid API key') ||
                textContent.includes('{"subtasks":') || // Filter Task Master prompts
                textContent.includes('CRITICAL: You MUST respond with ONLY a JSON') || // Filter Task Master system prompts
                textContent === 'Warmup' // Explicitly filter out "Warmup"
              );

              const modeFromMessage = typeof textContent === 'string'
                ? extractSessionModeFromText(textContent)
                : null;
              if (modeFromMessage) {
                session.mode = modeFromMessage;
              }

              if (textContent && textContent.length > 0) {
                const cleaned = stripInternalContextPrefix(textContent, false);

                const isSystemMessage = typeof cleaned === 'string' && (
                  cleaned.startsWith('<command-name>') ||
                  cleaned.startsWith('<command-message>') ||
                  cleaned.startsWith('<command-args>') ||
                  cleaned.startsWith('<local-command-stdout>') ||
                  cleaned.startsWith('<system-reminder>') ||
                  cleaned.startsWith('Caveat:') ||
                  cleaned.startsWith('This session is being continued from a previous') ||
                  cleaned.startsWith('Invalid API key') ||
                  cleaned.includes('{"subtasks":') || // Filter Task Master prompts
                  cleaned.includes('CRITICAL: You MUST respond with ONLY a JSON') || // Filter Task Master system prompts
                  cleaned === 'Warmup' // Explicitly filter out "Warmup"
                );

                if (cleaned && !isSystemMessage) {
                  // If this is the very first message (no parent), use it as initial summary
                  if (entry.parentUuid === null && session.summary === 'New Session') {
                    session.summary = cleaned.length > 50 ? cleaned.substring(0, 50) + '...' : cleaned;
                  }
                  session.lastUserMessage = cleaned;
                }
              }
            } else if (entry.message?.role === 'assistant' && entry.message?.content) {
              // Skip API error messages using the isApiErrorMessage flag
              if (entry.isApiErrorMessage === true) {
                // Skip this message entirely
              } else {
                // Track last assistant text message
                let assistantText = null;

                if (Array.isArray(entry.message.content)) {
                  for (const part of entry.message.content) {
                    if (part.type === 'text' && part.text) {
                      assistantText = part.text;
                    }
                  }
                } else if (typeof entry.message.content === 'string') {
                  assistantText = entry.message.content;
                }

                if (assistantText) {
                  const cleaned = stripInternalContextPrefix(assistantText, false);

                  // Additional filter for assistant messages with system content
                  const isSystemAssistantMessage = typeof cleaned === 'string' && (
                    cleaned.startsWith('Invalid API key') ||
                    cleaned.includes('{"subtasks":') ||
                    cleaned.includes('CRITICAL: You MUST respond with ONLY a JSON')
                  );

                  if (cleaned && !isSystemAssistantMessage) {
                    session.lastAssistantMessage = cleaned;
                  }
                }
              }
            }

            session.messageCount++;

            if (entry.timestamp) {
              session.lastActivity = new Date(entry.timestamp);
            }
          }
        } catch (parseError) {
          // Skip malformed lines silently
        }
      }
    }

    // After processing all entries, set final summary based on last message if no summary exists
    for (const session of sessions.values()) {
      if (session.summary === 'New Session') {
        // Prefer last user message, fall back to last assistant message
        const lastMessage = session.lastUserMessage || session.lastAssistantMessage;
        if (lastMessage) {
          session.summary = lastMessage.length > 50 ? lastMessage.substring(0, 50) + '...' : lastMessage;
        }
      }
    }

    // Filter out sessions that contain JSON responses (Task Master errors)
    const allSessions = Array.from(sessions.values());
    const filteredSessions = allSessions.filter(session => {
      const shouldFilter = session.summary.startsWith('{ "');
      if (shouldFilter) {
      }
      // Log a sample of summaries to debug
      if (Math.random() < 0.01) { // Log 1% of sessions
      }
      return !shouldFilter;
    });


    return {
      sessions: filteredSessions,
      entries: entries
    };

  } catch (error) {
    console.error('Error reading JSONL file:', error);
    return { sessions: [], entries: [] };
  }
}

// Parse an agent JSONL file and extract tool uses/results for grouped rendering
async function parseAgentTools(filePath) {
  const tools = [];

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        if (entry.message?.role === 'assistant' && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content) {
            if (part.type === 'tool_use') {
              tools.push({
                toolId: part.id,
                toolName: part.name,
                toolInput: part.input,
                timestamp: entry.timestamp
              });
            }
          }
        }

        if (entry.message?.role === 'user' && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content) {
            if (part.type === 'tool_result') {
              const tool = tools.find(t => t.toolId === part.tool_use_id);
              if (tool) {
                tool.toolResult = {
                  content: typeof part.content === 'string'
                    ? part.content
                    : Array.isArray(part.content)
                      ? part.content.map(c => c.text || '').join('\n')
                      : JSON.stringify(part.content),
                  isError: Boolean(part.is_error)
                };
              }
            }
          }
        }
      } catch (parseError) {
        // Skip malformed lines
      }
    }
  } catch (error) {
    console.warn(`Error parsing agent file ${filePath}:`, error.message);
  }

  return tools;
}

// Get messages for a specific session with pagination support
async function getSessionMessages(projectName, sessionId, limit = null, offset = 0, provider = 'claude', userId = null) {
  console.log(`[DEBUG] getSessionMessages - project: ${projectName}, session: ${sessionId}, provider: ${provider}`);
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    // agent-*.jsonl files contain subagent tool history, handled separately below
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));
    const agentFiles = files.filter(file => file.endsWith('.jsonl') && file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return { messages: [], total: 0, hasMore: false };
    }

    const messages = [];
    const agentToolsCache = new Map();

    // Process all JSONL files to find messages for this session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const fileStream = fsSync.createReadStream(jsonlFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            if (entry.sessionId === sessionId) {
              messages.push(entry);
            }
          } catch (parseError) {
            console.warn('Error parsing line:', parseError.message);
          }
        }
      }
    }

    // Collect Task agent IDs and hydrate grouped subagent tool history
    const agentIds = new Set();
    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        agentIds.add(message.toolUseResult.agentId);
      }
    }

    for (const agentId of agentIds) {
      const agentFileName = `agent-${agentId}.jsonl`;
      if (agentFiles.includes(agentFileName)) {
        const agentFilePath = path.join(projectDir, agentFileName);
        const tools = await parseAgentTools(agentFilePath);
        agentToolsCache.set(agentId, tools);
      }
    }

    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        const tools = agentToolsCache.get(message.toolUseResult.agentId);
        if (tools && tools.length > 0) {
          message.subagentTools = tools;
        }
      }
    }

    // Sort messages by timestamp
    const sortedMessages = messages.sort((a, b) =>
      new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
    );

    const total = sortedMessages.length;

    // If no limit is specified, return all messages (backward compatibility)
    if (limit === null) {
      return sortedMessages;
    }

    // Apply pagination - for recent messages, we need to slice from the end
    // offset 0 should give us the most recent messages
    const startIndex = Math.max(0, total - offset - limit);
    const endIndex = total - offset;
    const paginatedMessages = sortedMessages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;

    return {
      messages: paginatedMessages,
      total,
      hasMore,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading messages for session ${sessionId}:`, error);
    return limit === null ? [] : { messages: [], total: 0, hasMore: false };
  }
}

// Rename a project's display name
async function renameProject(projectName, newDisplayName, userId = null) {
  const { projectDb } = await import('./database/db.js');
  const trimmedName = (newDisplayName || '').trim();

  const existing = projectDb.getProjectById(projectName);
  if (existing) {
    if (userId && existing.user_id && existing.user_id !== userId) {
      throw new Error('You do not have permission to rename this project');
    }
    projectDb.updateProjectName(projectName, trimmedName);
  } else {
    const actualPath = await extractProjectDirectory(projectName);
    projectDb.upsertProject(projectName, userId, trimmedName, actualPath);
  }

  await mutateProjectConfig(async (config) => {
    if (!trimmedName) {
      if (config[projectName]) {
        delete config[projectName].displayName;
        if (Object.keys(config[projectName]).length === 0) {
          delete config[projectName];
        }
      }
      return;
    }

    if (!config[projectName]) {
      const actualPath = await extractProjectDirectory(projectName);
      config[projectName] = {
        originalPath: actualPath
      };
    }

    config[projectName].displayName = trimmedName;
  });

  return true;
}

// Delete a session from a project
async function deleteSession(projectName, sessionId, provider = 'claude') {
  const { sessionDb } = await import('./database/db.js');
  const indexedSession = sessionDb.getSessionById(sessionId);

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    let matchedFiles = 0;
    let removedEntries = 0;

    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      let fileRemovedEntries = 0;

      const filteredLines = lines.filter(line => {
        try {
          const data = JSON.parse(line);
          if (data.sessionId === sessionId) {
            fileRemovedEntries += 1;
            return false;
          }
          return true;
        } catch {
          return true; // Keep malformed lines
        }
      });

      if (fileRemovedEntries > 0) {
        matchedFiles += 1;
        removedEntries += fileRemovedEntries;

        if (filteredLines.length > 0) {
          await fs.writeFile(jsonlFile, filteredLines.join('\n') + '\n');
        } else {
          await fs.unlink(jsonlFile);
        }
      }
    }

    const deletedIndex = indexedSession?.provider === 'claude' || matchedFiles > 0;
    if (deletedIndex) {
      sessionDb.deleteSession(sessionId);
    }

    if (matchedFiles > 0 || deletedIndex) {
      console.log(
        `[Claude] Deleted session ${sessionId} from ${matchedFiles} file(s), removed ${removedEntries} entr${removedEntries === 1 ? 'y' : 'ies'}`,
      );
      return true;
    }

    throw new Error(`Session ${sessionId} not found in any files or index`);
  } catch (error) {
    if (error?.code === 'ENOENT' && indexedSession?.provider === 'claude') {
      sessionDb.deleteSession(sessionId);
      console.log(`[Claude] Deleted session ${sessionId} from index only; project directory missing: ${projectDir}`);
      return true;
    }
    console.error(`Error deleting session ${sessionId} from project ${projectName}:`, error);
    throw error;
  }
}

// Soft-delete: move a session to trash (do not delete underlying provider files).
async function trashSession(projectName, sessionId, provider = 'claude', userId = null) {
  const { sessionDb, projectDb } = await import('./database/db.js');

  const normalizedProvider = provider || 'claude';
  const projectRow = projectDb.getProjectById(projectName);
  if (userId && projectRow?.user_id && projectRow.user_id !== userId) {
    throw new Error('You do not have permission to delete this session');
  }

  // Ensure there's an index row to attach trash metadata to.
  let existing = sessionDb.getSessionById(sessionId);
  if (!existing) {
    sessionDb.upsertSessionPlaceholder(sessionId, projectName, normalizedProvider);
    existing = sessionDb.getSessionById(sessionId);
  } else if (existing.project_name && existing.project_name !== projectName) {
    throw new Error('Session does not belong to this project');
  }

  const trashedAt = new Date().toISOString();
  const updated = sessionDb.setSessionTrash(sessionId, {
    trashedAt,
    projectName,
    provider: normalizedProvider,
  });

  return Boolean(updated?.metadata?.trash?.trashedAt);
}

async function restoreSession(projectName, sessionId, userId = null) {
  const { sessionDb, projectDb } = await import('./database/db.js');

  const projectRow = projectDb.getProjectById(projectName);
  if (userId && projectRow?.user_id && projectRow.user_id !== userId) {
    throw new Error('You do not have permission to restore this session');
  }

  const session = sessionDb.getSessionById(sessionId);
  if (!session || session.project_name !== projectName) {
    throw new Error('Session not found');
  }

  const trashMeta = session?.metadata?.trash;
  if (!trashMeta?.trashedAt) {
    throw new Error('Session is not in trash');
  }

  const updated = sessionDb.clearSessionTrash(sessionId);
  return Boolean(updated && !updated?.metadata?.trash?.trashedAt);
}

async function getTrashedSessions(userId = null) {
  const { sessionDb, projectDb } = await import('./database/db.js');
  const trashed = sessionDb.listTrashedSessions(userId);
  return trashed
    .map((row) => {
      const project = projectDb.getProjectById(row.project_name);
      return {
        id: row.id,
        projectName: row.project_name,
        provider: row.provider,
        displayName: row.display_name || 'Deleted Session',
        lastActivity: row.last_activity || null,
        messageCount: row.message_count || 0,
        trashedAt: row.metadata?.trash?.trashedAt || null,
        projectDisplayName: project?.display_name || row.project_name,
      };
    })
    .filter((s) => typeof s.trashedAt === 'string' && s.trashedAt);
}

// Check if a project is empty (has no sessions)
async function isProjectEmpty(projectName) {
  try {
    const sessionsResult = await getSessions(projectName, 1, 0);
    return sessionsResult.total === 0;
  } catch (error) {
    console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}

// Delete a project (force=true to delete with sessions). This hides the project and records it in trash metadata.
async function deleteProject(projectName, force = false, userId = null) {
  const { projectDb, sessionDb } = await import('./database/db.js');

  try {
    const existing = projectDb.getProjectById(projectName);
    const initialConfig = await loadProjectConfig();
    const initialProjectInfo = initialConfig[projectName];
    const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(initialProjectInfo, existing) ?? userId ?? null;

    if (userId && ownerUserId && ownerUserId !== userId) {
      throw new Error('You do not have permission to delete this project');
    }

    const isEmpty = await isProjectEmpty(projectName);
    if (!isEmpty && !force) {
      throw new Error('Cannot delete project with existing sessions');
    }

    if (isProjectTrashed(initialProjectInfo, existing)) {
      return true;
    }

    const sessionCount = sessionDb.getSessionsByProject(projectName).length;
    let projectPath = initialProjectInfo?.path || initialProjectInfo?.originalPath || existing?.path || null;
    if (!projectPath) {
      projectPath = await extractProjectDirectory(projectName);
    }

    const trashedAt = new Date().toISOString();
    const filesExist = await pathExists(projectPath);
    const instanceId = await readProjectInstanceId(projectPath);
    const displayName = existing?.display_name || initialProjectInfo?.displayName || path.basename(projectPath || projectName);

    const mutationResult = await mutateProjectConfig((config) => {
      const currentConfig = config[projectName] || {};
      if (isProjectTrashed(currentConfig, existing)) {
        return {
          alreadyTrashed: true,
          currentConfig,
          trashMetadata: currentConfig.trash || existing?.metadata?.trash || null,
        };
      }

      clearDeletedProjectMetadata(config, projectName);
      const trashMetadata = {
        ...(currentConfig.trash || {}),
        trashedAt,
        originalPath: projectPath,
        trashPath: '',
        claudeTrashPath: '',
        sessionCount,
        displayName,
        filesExist,
        ownerUserId,
        instanceId,
      };

      config[projectName] = {
        ...currentConfig,
        originalPath: currentConfig.originalPath || projectPath,
        ownerUserId,
        trash: trashMetadata,
      };
      delete config[projectName].deleted;

      // Also mark project as "suppressed" so it won't be re-seeded back into
      // the visible list by legacy/bootstrap indexing even if other flows
      // re-upsert the project metadata.
      const deletedProjects = getDeletedProjectsStore(config);
      deletedProjects[projectName] = {
        deletedAt: trashedAt,
        ownerUserId,
        originalPath: trashMetadata.originalPath,
        displayName: trashMetadata.displayName,
      };

      return {
        alreadyTrashed: false,
        currentConfig: config[projectName],
        trashMetadata,
      };
    });

    if (mutationResult.alreadyTrashed) {
      return true;
    }

    const metadata = {
      ...(existing?.metadata || {}),
      trash: mutationResult.trashMetadata,
    };

    if (mutationResult.currentConfig?.manuallyAdded || existing?.metadata?.manuallyAdded) {
      metadata.manuallyAdded = true;
    } else {
      delete metadata.manuallyAdded;
    }

    projectDb.upsertProject(
      projectName,
      ownerUserId,
      existing?.display_name || initialProjectInfo?.displayName || null,
      projectPath,
      existing?.is_starred || 0,
      existing?.last_accessed || null,
      Object.keys(metadata).length > 0 ? metadata : null,
    );
    projectDirectoryCache.delete(projectName);

    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}

async function restoreProject(projectName, userId = null) {
  const { projectDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const existing = projectDb.getProjectById(projectName);
  const projectInfo = config[projectName];
  const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(projectInfo, existing) ?? userId ?? null;

  if (userId && ownerUserId && ownerUserId !== userId) {
    throw new Error('You do not have permission to restore this project');
  }

  const trashMeta = existing?.metadata?.trash || projectInfo?.trash;
  if (!trashMeta?.trashedAt) {
    throw new Error('Project is not in trash');
  }

  const originalPath = trashMeta.originalPath;
  if (!originalPath) {
    throw new Error('Original project path is missing');
  }

  if (!await pathExists(originalPath)) {
    throw new Error('Project files are missing from the original path and cannot be restored');
  }

  const nextMetadata = { ...(existing?.metadata || {}) };
  delete nextMetadata.trash;

  projectDb.upsertProject(
    projectName,
    ownerUserId,
    existing?.display_name || projectInfo?.displayName || trashMeta.displayName || null,
    originalPath,
    existing?.is_starred || 0,
    existing?.last_accessed || null,
    Object.keys(nextMetadata).length > 0 ? nextMetadata : null,
  );
  projectDb.setProjectMetadata(
    projectName,
    Object.keys(nextMetadata).length > 0 ? nextMetadata : null,
  );

  await mutateProjectConfig((nextConfig) => {
    const nextProjectInfo = {
      ...(nextConfig[projectName] || {}),
      originalPath,
      ownerUserId,
    };
    delete nextProjectInfo.trash;
    delete nextProjectInfo.deleted;
    clearDeletedProjectMetadata(nextConfig, projectName);
    nextConfig[projectName] = nextProjectInfo;
  });

  await ensureProjectSkillLinks(originalPath, { metadata: nextMetadata });
  projectDirectoryCache.delete(projectName);
  return true;
}

async function deleteTrashedProject(projectName, mode = 'logical', userId = null) {
  const { projectDb, sessionDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const existing = projectDb.getProjectById(projectName);
  const projectInfo = config[projectName];
  const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(projectInfo, existing) ?? userId ?? null;

  if (userId && ownerUserId && ownerUserId !== userId) {
    throw new Error('You do not have permission to delete this trashed project');
  }

  const trashMeta = existing?.metadata?.trash || projectInfo?.trash;
  if (!trashMeta?.trashedAt) {
    throw new Error('Project is not in trash');
  }

  if (mode === 'physical') {
    if (trashMeta.originalPath && await pathExists(trashMeta.originalPath)) {
      const storedInstanceId = trashMeta.instanceId || projectInfo?.trash?.instanceId || null;
      if (!storedInstanceId) {
        throw new Error('Cannot safely delete project files because this trash entry has no recorded instance identity. Use logical delete instead.');
      }

      const currentInstanceId = await readProjectInstanceId(trashMeta.originalPath);
      if (!currentInstanceId || currentInstanceId !== storedInstanceId) {
        throw new Error('Project files at the original path no longer match this trash entry. Refusing physical delete.');
      }

      await fs.rm(trashMeta.originalPath, { recursive: true, force: true });
    }

    try {
      const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
      await fs.rm(projectDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to delete Claude project dir for ${projectName}:`, err.message);
    }

    await mutateProjectConfig((nextConfig) => {
      delete nextConfig[projectName];
      clearDeletedProjectMetadata(nextConfig, projectName);
    });
    projectDb.deleteProject(projectName);
    sessionDb.deleteSessionsByProject(projectName);
    projectDirectoryCache.delete(projectName);
    return true;
  }

  const deletedAt = new Date().toISOString();
  await mutateProjectConfig((nextConfig) => {
    const deletedProjects = getDeletedProjectsStore(nextConfig);
    deletedProjects[projectName] = {
      deletedAt,
      ownerUserId,
      originalPath: trashMeta.originalPath || projectInfo?.originalPath || existing?.path || '',
      displayName: existing?.display_name || projectInfo?.displayName || trashMeta.displayName || projectName,
    };
    delete nextConfig[projectName];
  });

  projectDb.deleteProject(projectName);
  sessionDb.deleteSessionsByProject(projectName);
  projectDirectoryCache.delete(projectName);
  return true;
}

/**
 * Create provider instruction folders and their skills subdirs in the project,
 * and symlink each medhelp skill directory into those skills subdirs.
 * Also creates pipeline folders: Literature, Ideation, Experiment, Publication, Promotion.
 * Failures are logged but do not throw (project add still succeeds).
 */
async function collectSkillDirs(baseDir) {
  const results = []; // { name, absolutePath }

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const hasSkillMd = entries.some(e => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd) {
      results.push({ name: path.basename(dir), absolutePath: dir });
      return; // Don't recurse deeper into a skill directory
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(path.join(dir, entry.name));
      }
    }
  }

  await walk(baseDir);
  return results;
}

function getRelativeSymlinkTarget(sourcePath, linkPath) {
  return path.relative(path.dirname(linkPath), sourcePath) || '.';
}

/**
 * Load the set of core (platform-native) skill names from skill-tag-mapping.json.
 * Returns a Set of skill directory names that are considered "core pipeline" skills.
 */
function getCoreSkillNames() {
  try {
    const mappingPath = path.join(DRCLAW_SKILLS_DIR, 'skill-tag-mapping.json');
    const raw = fsSync.readFileSync(mappingPath, 'utf8');
    const mapping = JSON.parse(raw);
    const names = new Set(mapping.platformNativeSkills || []);
    // Meta workflow skills are always core in the Meta-only app.
    names.add('meta-pipeline-planner');
    names.add('meta-analysis-workflow');
    // bioinformatics-init-analysis resolves to dir name 'init-analysis' via collectSkillDirs
    names.add('init-analysis');
    return names;
  } catch {
    return new Set();
  }
}

/**
 * Generate a compact skills-index.md for the .agents/skills/ directory.
 * Reads YAML frontmatter (name, description) from each SKILL.md and produces
 * a markdown table grouped by Core Pipeline Skills vs Library Skills.
 *
 * @param {Array<{name: string, absolutePath: string}>} skillDirs
 * @returns {string} Markdown content for skills-index.md
 */
async function generateSkillsIndex(skillDirs) {
  const matter = (await import('gray-matter')).default;
  const coreNames = getCoreSkillNames();

  const coreSkills = [];
  const librarySkills = [];

  for (const { name, absolutePath } of skillDirs) {
    const skillMdPath = path.join(absolutePath, 'SKILL.md');
    let skillName = name;
    let description = '';
    try {
      const content = await fs.readFile(skillMdPath, 'utf8');
      const { data } = matter(content);
      if (data.name) skillName = data.name;
      if (data.description) {
        // Collapse newlines (YAML block scalars) and escape pipe chars for markdown tables
        const cleaned = data.description.replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();
        description = cleaned.length > 120
          ? cleaned.slice(0, 117) + '...'
          : cleaned;
      }
    } catch {
      // Skip skills with unreadable SKILL.md
      continue;
    }

    const entry = { dirName: name, skillName, description };
    if (coreNames.has(name)) {
      coreSkills.push(entry);
    } else {
      librarySkills.push(entry);
    }
  }

  coreSkills.sort((a, b) => a.dirName.localeCompare(b.dirName));
  librarySkills.sort((a, b) => a.dirName.localeCompare(b.dirName));

  const lines = [
    '# Skills Index',
    '',
    '> **Do NOT read all SKILL.md files at once.** Use this index to find the right skill, then read only that one.',
    '',
    '## Core Pipeline Skills',
    '',
    '| Skill | Path | Description |',
    '|-------|------|-------------|',
  ];
  for (const s of coreSkills) {
    lines.push(`| ${s.skillName} | \`.agents/skills/${s.dirName}/SKILL.md\` | ${s.description} |`);
  }

  lines.push('', '## Library Skills', '');
  lines.push('| Skill | Path | Description |');
  lines.push('|-------|------|-------------|');
  for (const s of librarySkills) {
    lines.push(`| ${s.skillName} | \`.agents/skills/library/${s.dirName}/SKILL.md\` | ${s.description} |`);
  }

  lines.push('');
  return lines.join('\n');
}

async function ensureProjectSkillLinks(projectPath, options = {}) {
  const projectKind = await inferProjectKindForPath(projectPath, options);
  const hasLegacyPipelineFolders = await Promise.any(
    PROJECT_PIPELINE_FOLDERS.map((folder) => fs.access(path.join(projectPath, folder)).then(() => true)),
  ).catch(() => false);
  const usesMetaNumberedFolders = projectKind === 'meta'
    && (isNumberedMetaFolderSchema(projectPath, options) || !hasLegacyPipelineFolders);
  try {
    const presetSubdirs = usesMetaNumberedFolders
      ? [
          ...META_NUMBERED_WORKFLOW_DIRS,
          META_NUMBERED_STAGE_DIRS.literatureReports,
          META_NUMBERED_STAGE_DIRS.literatureReferences,
          META_NUMBERED_STAGE_DIRS.ideationIdeas,
          META_NUMBERED_STAGE_DIRS.scopingReview,
          ...META_NUMBERED_CODE_SUBDIRS,
        ]
      : [
          ...PROJECT_PIPELINE_FOLDERS,
          'Literature/references',
          'Literature/reports',
          'Ideation/ideas',
          'Ideation/references',
          'Experiment/code_references',
          'Experiment/datasets',
          'Experiment/core_code',
          'Experiment/analysis',
          ...PROJECT_PUBLICATION_SUBDIRS.map((dir) => `Publication/${dir}`),
          'Promotion/homepage',
          'Promotion/slides',
          'Promotion/audio',
          'Promotion/video'
        ];
    for (const rel of presetSubdirs) {
      await fs.mkdir(path.join(projectPath, rel), { recursive: true });
    }
  } catch (err) {
    console.error('[projects] Failed to create pipeline folders or preset subdirs:', err.message);
  }

  // Keep creating instance.json for new projects.
  const instancePath = path.join(projectPath, 'instance.json');
  try {
    const projectBasename = path.basename(projectPath);
    const createdAt = new Date().toISOString();
    const instanceId = `${projectBasename}_${createdAt.replace(/[:.]/g, '-')}`;
    const instanceTemplate = usesMetaNumberedFolders ? {
      instance_id: instanceId,
      idea_maturity: '',
      created_at: createdAt,
      instance: instancePath,
      category: 'meta',
      MetaAnalysis: {
        folderSchemaVersion: META_FOLDER_SCHEMA_VERSION,
        literature: path.join(projectPath, META_NUMBERED_STAGE_DIRS.literature),
        literatureReports: path.join(projectPath, META_NUMBERED_STAGE_DIRS.literatureReports),
        literatureReferences: path.join(projectPath, META_NUMBERED_STAGE_DIRS.literatureReferences),
        topicSelection: path.join(projectPath, META_NUMBERED_STAGE_DIRS.ideationIdeas),
        scopingReview: path.join(projectPath, META_NUMBERED_STAGE_DIRS.scopingReview),
        protocol: path.join(projectPath, META_NUMBERED_STAGE_DIRS.protocol),
        searchDedupe: path.join(projectPath, META_NUMBERED_STAGE_DIRS.searchDedupe),
        titleAbstractScreening: path.join(projectPath, META_NUMBERED_STAGE_DIRS.titleAbstractScreening),
        fullTextReview: path.join(projectPath, META_NUMBERED_STAGE_DIRS.fullTextReview),
        dataExtraction: path.join(projectPath, META_NUMBERED_STAGE_DIRS.dataExtraction),
        qualityAssessment: path.join(projectPath, META_NUMBERED_STAGE_DIRS.qualityAssessment),
        dataAnalysis: path.join(projectPath, META_NUMBERED_STAGE_DIRS.dataAnalysis),
        resultsFigures: path.join(projectPath, META_NUMBERED_STAGE_DIRS.resultsFigures),
        manuscriptSubmission: path.join(projectPath, META_NUMBERED_STAGE_DIRS.manuscriptSubmission),
        presentation: path.join(projectPath, META_NUMBERED_STAGE_DIRS.presentation),
      }
    } : {
      instance_id: instanceId,
      idea_maturity: '',
      created_at: createdAt,
      instance: instancePath,
      category: '',
      Literature: {
        references: path.join(projectPath, 'Literature', 'references'),
        reports: path.join(projectPath, 'Literature', 'reports')
      },
      Ideation: {
        ideas: path.join(projectPath, 'Ideation', 'ideas'),
        references: path.join(projectPath, 'Ideation', 'references')
      },
      Experiment: {
        code_references: path.join(projectPath, 'Experiment', 'code_references'),
        datasets: path.join(projectPath, 'Experiment', 'datasets'),
        core_code: path.join(projectPath, 'Experiment', 'core_code'),
        analysis: path.join(projectPath, 'Experiment', 'analysis')
      },
      Publication: Object.fromEntries(
        PROJECT_PUBLICATION_SUBDIRS.map((dir) => [dir, path.join(projectPath, 'Publication', dir)])
      ),
      Promotion: {
        homepage: path.join(projectPath, 'Promotion', 'homepage'),
        slides: path.join(projectPath, 'Promotion', 'slides'),
        audio: path.join(projectPath, 'Promotion', 'audio'),
        video: path.join(projectPath, 'Promotion', 'video')
      }
    };
    const hasInstance = await fs.access(instancePath).then(() => true).catch(() => false);
    if (!hasInstance) {
      await fs.writeFile(instancePath, JSON.stringify(instanceTemplate, null, 2), 'utf8');
    } else {
      const rawInstance = await fs.readFile(instancePath, 'utf8');
      const currentInstance = JSON.parse(rawInstance);
      let changed = false;
      if (usesMetaNumberedFolders) {
        if (!currentInstance.MetaAnalysis || typeof currentInstance.MetaAnalysis !== 'object' || Array.isArray(currentInstance.MetaAnalysis)) {
          currentInstance.MetaAnalysis = {};
          changed = true;
        }
        const metaDefaults = instanceTemplate.MetaAnalysis;
        for (const [key, value] of Object.entries(metaDefaults)) {
          if (typeof currentInstance.MetaAnalysis[key] !== 'string' || currentInstance.MetaAnalysis[key].trim() === '') {
            currentInstance.MetaAnalysis[key] = value;
            changed = true;
          }
        }
        if (currentInstance.category !== 'meta') {
          currentInstance.category = 'meta';
          changed = true;
        }
        if (changed) {
          await fs.writeFile(instancePath, JSON.stringify(currentInstance, null, 2), 'utf8');
        }
      } else {
        if (!currentInstance.Literature || typeof currentInstance.Literature !== 'object' || Array.isArray(currentInstance.Literature)) {
        currentInstance.Literature = {};
        changed = true;
      }
      const legacySurveyDefaults = {
        references: path.join(projectPath, 'Survey', 'references'),
        reports: path.join(projectPath, 'Survey', 'reports')
      };
      const legacyLowercaseDefaults = {
        references: path.join(projectPath, 'literature', 'references'),
        reports: path.join(projectPath, 'literature', 'reports')
      };
      const literatureDefaults = {
        references: path.join(projectPath, 'Literature', 'references'),
        reports: path.join(projectPath, 'Literature', 'reports')
      };
      for (const key of ['references', 'reports']) {
        const currentValue = typeof currentInstance.Literature[key] === 'string' ? currentInstance.Literature[key].trim() : '';
        const legacyValue = typeof currentInstance.Survey?.[key] === 'string' ? currentInstance.Survey[key].trim() : '';
        if (!currentValue) {
          currentInstance.Literature[key] = legacyValue
            && legacyValue !== legacySurveyDefaults[key]
            && legacyValue !== legacyLowercaseDefaults[key]
            ? legacyValue
            : literatureDefaults[key];
          changed = true;
        } else if (currentValue === legacySurveyDefaults[key] || currentValue === legacyLowercaseDefaults[key]) {
          currentInstance.Literature[key] = literatureDefaults[key];
          changed = true;
        }
      }
      if (
        currentInstance.Survey
        && typeof currentInstance.Survey === 'object'
        && !Array.isArray(currentInstance.Survey)
        && ['references', 'reports'].every((key) => {
          const value = typeof currentInstance.Survey[key] === 'string' ? currentInstance.Survey[key].trim() : '';
          return !value || value === legacySurveyDefaults[key] || value === legacyLowercaseDefaults[key] || value === literatureDefaults[key];
        })
      ) {
        delete currentInstance.Survey;
        changed = true;
      }
      if (!currentInstance.Publication || typeof currentInstance.Publication !== 'object' || Array.isArray(currentInstance.Publication)) {
        currentInstance.Publication = {};
        changed = true;
      }
      for (const dir of PROJECT_PUBLICATION_SUBDIRS) {
        if (typeof currentInstance.Publication[dir] !== 'string' || currentInstance.Publication[dir].trim() === '') {
          currentInstance.Publication[dir] = path.join(projectPath, 'Publication', dir);
          changed = true;
        }
      }
      for (const dir of DEPRECATED_PROJECT_PUBLICATION_SUBDIRS) {
        if (currentInstance.Publication[dir] === path.join(projectPath, 'Publication', dir)) {
          delete currentInstance.Publication[dir];
          changed = true;
        }
      }
      }
      if (changed) {
        await fs.writeFile(instancePath, JSON.stringify(currentInstance, null, 2), 'utf8');
      }
    }
  } catch (err) {
    console.error('[projects] Failed to create instance.json:', err.message);
  }

  // Generate agent instruction templates (CLAUDE.md with .claude/rules/project.md compatibility, AGENTS.md)
  try {
    const { writeProjectTemplates } = await import('./templates/index.js');
    await writeProjectTemplates(projectPath, { includeRootAgentTemplates: true, projectKind });
  } catch (err) {
    console.error('[projects] Failed to write agent templates:', err.message);
  }

  try {
    await fs.access(DRCLAW_SKILLS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('[projects] medhelp skills dir not found, skipping skill symlinks:', DRCLAW_SKILLS_DIR);
      return;
    }
    console.error('[projects] Cannot access medhelp skills dir:', err.message);
    return;
  }

  try {
    const skillDirs = (await collectSkillDirs(DRCLAW_SKILLS_DIR))
      .filter((skill) => META_ONLY_PROJECT_SKILLS.has(skill.name));
    if (skillDirs.length === 0) return;

    // Warn about name collisions
    const seen = new Map();
    for (const skill of skillDirs) {
      if (seen.has(skill.name)) {
        console.warn(`[projects] Skill name collision: "${skill.name}" found at both ${seen.get(skill.name)} and ${skill.absolutePath}`);
      } else {
        seen.set(skill.name, skill.absolutePath);
      }
    }

    const coreNames = getCoreSkillNames();

    for (const dir of PROJECT_SKILL_FOLDERS) {
      const skillsSubdir = path.join(projectPath, dir, 'skills');
      const isAgents = dir === '.agents';
      try {
        await fs.mkdir(skillsSubdir, { recursive: true });
        if (isAgents) {
          await fs.mkdir(path.join(skillsSubdir, 'library'), { recursive: true });
        }
      } catch (err) {
        console.error(`[projects] Failed to create ${dir}/skills:`, err.message);
        continue;
      }

      for (const { name, absolutePath } of skillDirs) {
        // For .agents/: core skills at top level, library skills under library/
        const linkPath = isAgents && !coreNames.has(name)
          ? path.join(skillsSubdir, 'library', name)
          : path.join(skillsSubdir, name);
        const linkTarget = getRelativeSymlinkTarget(absolutePath, linkPath);
        try {
          try {
            await fs.unlink(linkPath);
          } catch (_) {
            // ignore if not exists or not a symlink
          }
          // Clean up stale top-level symlink when migrating library skills into library/
          if (isAgents && !coreNames.has(name)) {
            try { await fs.unlink(path.join(skillsSubdir, name)); } catch (_) {}
          }
          await fs.symlink(linkTarget, linkPath, 'dir');
        } catch (err) {
          console.error(`[projects] Failed to symlink ${name} in ${dir}/skills:`, err.message);
        }
      }

      // Write the skills index for .agents/ so project assistants can discover skills lazily.
      if (isAgents) {
        try {
          const indexContent = await generateSkillsIndex(skillDirs);
          await fs.writeFile(path.join(skillsSubdir, 'skills-index.md'), indexContent, 'utf8');
        } catch (err) {
          console.error('[projects] Failed to write skills-index.md:', err.message);
        }
      }

      // Symlink JSON config files from medhelp root into each project skills folder
      for (const jsonFile of ['skill-tag-mapping.json', 'stage-skill-map.json']) {
        const srcJson = path.join(DRCLAW_SKILLS_DIR, jsonFile);
        const destJson = path.join(skillsSubdir, jsonFile);
        const linkTarget = getRelativeSymlinkTarget(srcJson, destJson);
        try {
          await fs.access(srcJson);
          try { await fs.unlink(destJson); } catch (_) {}
          await fs.symlink(linkTarget, destJson, 'file');
        } catch (err) {
          if (err.code !== 'ENOENT') {
            console.error(`[projects] Failed to symlink ${jsonFile} in ${dir}/skills:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[projects] ensureProjectSkillLinks failed:', err.message);
  }
}

// Add a project manually to the config (without creating folders)
async function addProjectManually(projectPath, displayName = null, userId = null, metadataPatch = null) {
  const { projectDb } = await import('./database/db.js');
  const absolutePath = path.resolve(projectPath);

  try {
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  const projectName = encodeProjectPath(absolutePath);

  // Check for existing project with the same path (may have legacy encoded ID)
  const existingByPath = projectDb.getProjectByPath(absolutePath, userId);
  if (existingByPath) {
    if (existingByPath.id !== projectName) {
      // Legacy ID detected — migrate to new encoding
      projectDb.migrateProjectIdentity(existingByPath.id, projectName, absolutePath);
    }
    const nextMetadata = metadataPatch && typeof metadataPatch === 'object'
      ? projectDb.updateProjectMetadata(projectName, metadataPatch)
      : existingByPath.metadata;
    return {
      name: projectName,
      path: absolutePath,
      fullPath: absolutePath,
      displayName: displayName || existingByPath.display_name || await generateDisplayName(projectName, absolutePath),
      metadata: nextMetadata || null,
      isManuallyAdded: Boolean(nextMetadata?.manuallyAdded || existingByPath.metadata?.manuallyAdded),
      createdAt: existingByPath.created_at,
      sessions: [],
      alreadyExists: true,
    };
  }

  const metadata = {
    ...(metadataPatch && typeof metadataPatch === 'object' ? metadataPatch : {}),
    manuallyAdded: true,
  };
  projectDb.upsertProject(projectName, userId, displayName, absolutePath, 0, new Date().toISOString(), metadata);

  await mutateProjectConfig((config) => {
    config[projectName] = {
      ...(config[projectName] || {}),
      manuallyAdded: true,
      originalPath: absolutePath,
      ownerUserId: config[projectName]?.ownerUserId ?? userId ?? null,
    };

    if (displayName) {
      config[projectName].displayName = displayName;
    }
  });

  await ensureProjectSkillLinks(absolutePath, { metadata });

  let dirCreatedAt = null;
  try {
    const dirStat = await fs.stat(absolutePath);
    dirCreatedAt = dirStat.birthtime.toISOString();
  } catch (_) {}

  return {
    name: projectName,
    path: absolutePath,
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(projectName, absolutePath),
    metadata,
    isManuallyAdded: true,
    createdAt: dirCreatedAt,
    sessions: [],
  };
}

// Get workspace root from project config
async function getWorkspaceRootFromConfig() {
  const config = await loadProjectConfig();
  if (!config._workspacesRoot) {
    return null;
  }

  const resolvedRoot = await resolveConfiguredWorkspacesRoot(config._workspacesRoot || null);

  if (resolvedRoot && config._workspacesRoot !== resolvedRoot) {
    await mutateProjectConfig((nextConfig) => {
      nextConfig._workspacesRoot = resolvedRoot;
    });
  }

  return resolvedRoot || null;
}

// Save workspace root to project config
async function setWorkspaceRootInConfig(workspacesRoot) {
  await mutateProjectConfig((config) => {
    if (workspacesRoot) {
      config._workspacesRoot = workspacesRoot;
    } else {
      delete config._workspacesRoot;
    }
  });
}

// Rename a Claude session.
async function renameSession(projectName, sessionId, newSummary, provider = 'claude', userId = null) {
  if (!newSummary || newSummary.trim() === '') {
    throw new Error('New session name cannot be empty');
  }

  const trimmedSummary = newSummary.trim();
  const { sessionDb, projectDb } = await import('./database/db.js');

  // Basic security: if project is in DB, check if it belongs to this user
  const project = projectDb.getProjectById(projectName);
  if (project && userId && project.user_id && project.user_id !== userId) {
    throw new Error('You do not have permission to modify sessions in this project');
  }

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    // Check if project directory exists first
    try {
      await fs.access(projectDir);
    } catch (e) {
      console.error(`[Claude] Project directory not found: ${projectDir}`);
      throw new Error(`Claude project directory not found: ${projectName}`);
    }

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      throw new Error('No session files found for this project');
    }

    // Check all JSONL files to find which one contains the session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      const hasSession = lines.some(line => {
        try {
          const data = JSON.parse(line);
          return data.sessionId === sessionId;
        } catch {
          return false;
        }
      });

      if (hasSession) {
        const summaryEntry = {
          type: 'summary',
          sessionId: sessionId,
          summary: trimmedSummary,
          timestamp: new Date().toISOString()
        };
        await fs.appendFile(jsonlFile, JSON.stringify(summaryEntry) + '\n');

        sessionDb.updateSessionName(sessionId, trimmedSummary);

        console.log(`[Claude] Renamed session ${sessionId} to "${trimmedSummary}"`);
        return true;
      }
    }

    throw new Error(`Session ${sessionId} not found in any files`);
  } catch (error) {
    console.error(`Error renaming session ${sessionId} in project ${projectName}:`, error);
    throw error;
  }
}

export {
  getProjects,
  getTrashedProjects,
  getTrashedSessions,
  getSessions,
  getSessionMessages,
  parseJsonlSessions,
  renameProject,
  renameSession,
  deleteSession,
  trashSession,
  restoreSession,
  isProjectEmpty,
  deleteProject,
  restoreProject,
  deleteTrashedProject,
  addProjectManually,
  loadProjectConfig,
  saveProjectConfig,
  extractProjectDirectory,
  clearProjectDirectoryCache,
  reconcileClaudeSessionIndex,
  reindexProjectSessions,
  ensureProjectSkillLinks,
  getWorkspaceRootFromConfig,
  setWorkspaceRootInConfig
};
