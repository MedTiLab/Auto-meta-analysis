#!/usr/bin/env node
// Load environment variables before other imports execute
import './load-env.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installMode = fs.existsSync(path.join(__dirname, '..', '.git')) ? 'git' : 'npm';
const npmPackageName = process.env.NPM_PACKAGE_NAME || 'medautodata';

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text) => `${colors.green}${text}${colors.reset}`,
    warn: (text) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text) => `${colors.blue}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

console.log('Requested PORT from env:', process.env.PORT);

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import http from 'http';
import cors from 'cors';
import { promises as fsPromises } from 'fs';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import mime from 'mime-types';

import {
    getProjects,
    getTrashedProjects,
    getTrashedSessions,
    getSessions,
    getSessionMessages,
    renameProject,
    renameSession,
    deleteSession,
    trashSession,
    restoreSession,
    deleteProject,
    restoreProject,
    deleteTrashedProject,
    addProjectManually,
    extractProjectDirectory,
    encodeProjectPath,
    loadProjectConfig,
    clearProjectDirectoryCache,
    reindexProjectSessions,
} from './projects.js';
import { getProjectTokenUsageSummary } from './project-token-usage.js';
import { queryClaudeSDK, abortClaudeSDKSession, isClaudeSDKSessionActive, getClaudeSDKSessionStartTime, getActiveClaudeSDKSessions, resolveToolApproval } from './claude-sdk.js';
import gitRoutes from './routes/git.js';
import mcpRoutes from './routes/mcp.js';
import taskmasterRoutes, { syncTasksWithResearchBrief } from './routes/taskmaster.js';
import mcpUtilsRoutes from './routes/mcp-utils.js';
import commandsRoutes from './routes/commands.js';
import settingsRoutes from './routes/settings.js';
import agentRoutes from './routes/agent.js';
import projectsRoutes, {
    WORKSPACES_ROOT,
    getWorkspaceRootForUser,
    getWorkspacesRoot,
    isProjectPathLockEnabled,
    validateWorkspacePath,
} from './routes/projects.js';
import cliAuthRoutes from './routes/cli-auth.js';
import userRoutes from './routes/user.js';
import skillsRoutes from './routes/skills.js';
import telemetryRoutes from './routes/telemetry.js';
import newsRoutes from './routes/news.js';
import referencesRoutes from './routes/references.js';
import metaAnalysisRoutes from './routes/meta-analysis.js';
import providersRoutes from './routes/providers.js';
import providerOAuthRoutes, { createProviderOAuthAliasRouter } from './routes/providerOAuth.js';
import providerProxyRoutes from './routes/providerProxy.js';
import { llmOAuthService } from './services/providerOAuthService.js';
import { startSurveillanceScheduler } from './services/meta-analysis/surveillance/scheduler-service.js';
import { agentToolPermissionsDb, initializeDatabase, sessionDb, tagDb, userDb } from './database/db.js';
import { validateApiKey, authenticateToken, authenticateWebSocket, isUsingDefaultJwtSecret } from './middleware/auth.js';
import { IS_PLATFORM } from './constants/config.js';
import { enqueueTelemetryEvent } from './telemetry.js';
import {
    DEFAULT_BACKEND_PORT,
    DEFAULT_FRONTEND_PORT,
    getFrontendPortSync,
    listenOnAvailablePort,
    parsePortNumber,
    setRuntimePortSync,
} from './utils/runtimePorts.js';
import { readExecutionMemorySnapshot } from './execution-memory/summary.js';
import { createExecutionMemoryTracker, wrapWriterWithExecutionMemory } from './execution-memory/tracker.js';
import { syncExecutionMemoryToTasks } from './execution-memory/task-sync.js';
import { buildResearchAwarePromptPrefix, captureResearchLessonsFromText, readResearchLessons } from './execution-memory/lessons.js';
import { getConnectedClientUserId, groupOpenClientsByUserId } from './utils/projectRealtime.js';
import { broadcastTaskMasterProjectUpdate, broadcastTaskMasterTasksUpdate } from './utils/taskmaster-websocket.js';
import {
    createTaskMasterTasksFileWatcher,
    resolveProjectNameFromConfig,
} from './utils/taskmaster-file-watcher.js';
import { resolveProjectChatAttachmentsDir } from './utils/storagePaths.js';
import { isInternalProjectPath, normalizeProjectRelativePath } from '../shared/internalProjectFiles.js';
import { getConfiguredContextWindow, getContextWindowForModel } from '../shared/modelConstants.js';

// File system watchers for provider project/session folders
const PROVIDER_WATCH_PATHS = [
    { provider: 'claude', rootPath: path.join(os.homedir(), '.claude', 'projects') },
];
const WATCHER_IGNORED_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/*.tmp',
    '**/*.swp',
    '**/.DS_Store'
];
const WATCHER_DEBOUNCE_MS = 1000;
let projectsWatchers = [];
let projectsWatcherDebounceTimer = null;
let taskmasterTasksWatcher = null;
const registeredTaskMasterProjectPaths = new Map();
const recentTaskMasterTaskFileBroadcasts = new Map();
const connectedClients = new Set();
let isGetProjectsRunning = false; // Flag to prevent reentrant calls
let hasPendingProjectsUpdate = false;
let lastWatcherEvent = null;
const lastProjectsUpdateSignatures = new Map();

async function abortActiveInteractiveSessions() {
    const abortTasks = [];

    try {
        abortTasks.push(...getActiveClaudeSDKSessions().map((sessionId) => abortClaudeSDKSession(sessionId)));
    } catch (error) {
        console.error('[WARN] Failed to enumerate active Claude sessions during restart:', error);
    }

    if (abortTasks.length > 0) {
        await Promise.allSettled(abortTasks);
    }
}

async function closeAllWebSocketClients(code = 1012, reason = 'Server restarting') {
    const clients = Array.from(wss.clients || []);

    if (clients.length === 0) {
        connectedClients.clear();
        lastProjectsUpdateSignatures.clear();
        return;
    }

    await Promise.allSettled(
        clients.map((client) => new Promise((resolve) => {
            if (!client || client.readyState === WebSocket.CLOSED) {
                resolve();
                return;
            }

            let settled = false;
            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve();
            };

            const forceTimer = setTimeout(() => {
                try {
                    client.terminate();
                } catch {
                    // Ignore termination failures during shutdown.
                }
                finish();
            }, 500);

            client.once('close', () => {
                clearTimeout(forceTimer);
                finish();
            });

            try {
                client.close(code, reason);
            } catch {
                clearTimeout(forceTimer);
                try {
                    client.terminate();
                } catch {
                    // Ignore termination failures during shutdown.
                }
                finish();
            }
        }))
    );

    connectedClients.clear();
    lastProjectsUpdateSignatures.clear();
}

function shouldProcessProjectsWatcherEvent(eventType, filePath, provider) {
    if (eventType === 'addDir' || eventType === 'unlinkDir') {
        return true;
    }

    const normalized = String(filePath || '').toLowerCase();
    if (provider === 'claude') {
        return normalized.endsWith('.jsonl');
    }

    return true;
}

// Broadcast project-loading progress only to the active user's sockets.
function broadcastProgress(progress, userId = null) {
    const message = JSON.stringify({
        type: 'loading_progress',
        ...progress
    });
    connectedClients.forEach(client => {
        if (
            client.readyState === WebSocket.OPEN
            && (userId == null || getConnectedClientUserId(client) === userId)
        ) {
            client.send(message);
        }
    });
}

// Setup file system watchers for Claude project/session folders
async function setupProjectsWatcher() {
    const chokidar = (await import('chokidar')).default;

    if (projectsWatcherDebounceTimer) {
        clearTimeout(projectsWatcherDebounceTimer);
        projectsWatcherDebounceTimer = null;
    }

    await Promise.all(
        projectsWatchers.map(async (watcher) => {
            try {
                await watcher.close();
            } catch (error) {
                console.error('[WARN] Failed to close watcher:', error);
            }
        })
    );
    projectsWatchers = [];

    const debouncedUpdate = (eventType, filePath, provider, rootPath) => {
        if (!shouldProcessProjectsWatcherEvent(eventType, filePath, provider)) {
            return;
        }

        lastWatcherEvent = { eventType, filePath, provider, rootPath };

        if (projectsWatcherDebounceTimer) {
            clearTimeout(projectsWatcherDebounceTimer);
        }

        projectsWatcherDebounceTimer = setTimeout(async () => {
            // Prevent reentrant calls
            if (isGetProjectsRunning) {
                hasPendingProjectsUpdate = true;
                return;
            }

            try {
                isGetProjectsRunning = true;
                hasPendingProjectsUpdate = false;

                // Clear project directory cache when files change
                clearProjectDirectoryCache();

                const clientsByUserId = groupOpenClientsByUserId(connectedClients);
                const activeSignatureKeys = new Set();

                for (const [userId, userClients] of clientsByUserId.entries()) {
                    const signatureKey = userId == null ? '__anonymous__' : String(userId);
                    activeSignatureKeys.add(signatureKey);

                    const updatedProjects = await getProjects(userId || null);
                    const updateSignature = JSON.stringify(updatedProjects);

                    // Skip broadcasting identical snapshots for the same authenticated user.
                    if (updateSignature === lastProjectsUpdateSignatures.get(signatureKey)) {
                        continue;
                    }
                    lastProjectsUpdateSignatures.set(signatureKey, updateSignature);

                    const updateMessage = JSON.stringify({
                        type: 'projects_updated',
                        projects: updatedProjects,
                        timestamp: new Date().toISOString(),
                        changeType: eventType,
                        changedFile: path.relative(rootPath, filePath),
                        watchProvider: provider
                    });

                    userClients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(updateMessage);
                        }
                    });
                }

                for (const signatureKey of Array.from(lastProjectsUpdateSignatures.keys())) {
                    if (!activeSignatureKeys.has(signatureKey)) {
                        lastProjectsUpdateSignatures.delete(signatureKey);
                    }
                }

            } catch (error) {
                console.error('[ERROR] Error handling project changes:', error);
            } finally {
                isGetProjectsRunning = false;
                if (hasPendingProjectsUpdate && lastWatcherEvent) {
                    hasPendingProjectsUpdate = false;
                    const { eventType, filePath, provider, rootPath } = lastWatcherEvent;
                    debouncedUpdate(eventType, filePath, provider, rootPath);
                }
            }
        }, WATCHER_DEBOUNCE_MS);
    };

    for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
        try {
            // chokidar v4 emits ENOENT via the "error" event for missing roots and will not auto-recover.
            // Ensure provider folders exist before creating the watcher so watching stays active.
            await fsPromises.mkdir(rootPath, { recursive: true });

            // Initialize chokidar watcher with optimized settings
            const watcher = chokidar.watch(rootPath, {
                ignored: WATCHER_IGNORED_PATTERNS,
                persistent: true,
                ignoreInitial: true, // Don't fire events for existing files on startup
                followSymlinks: false,
                depth: 10, // Reasonable depth limit
                awaitWriteFinish: {
                    stabilityThreshold: 100, // Wait 100ms for file to stabilize
                    pollInterval: 50
                }
            });

            // Set up event listeners
            watcher
                .on('add', (filePath) => debouncedUpdate('add', filePath, provider, rootPath))
                .on('change', (filePath) => debouncedUpdate('change', filePath, provider, rootPath))
                .on('unlink', (filePath) => debouncedUpdate('unlink', filePath, provider, rootPath))
                .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath, provider, rootPath))
                .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath, provider, rootPath))
                .on('error', (error) => {
                    console.error(`[ERROR] ${provider} watcher error:`, error);
                })
                .on('ready', () => {
                });

            projectsWatchers.push(watcher);
        } catch (error) {
            console.error(`[ERROR] Failed to setup ${provider} watcher for ${rootPath}:`, error);
        }
    }

    if (projectsWatchers.length === 0) {
        console.error('[ERROR] Failed to setup any provider watchers');
    }
}

function normalizeWatchRoot(rootPath) {
    if (!rootPath) {
        return null;
    }

    return path.resolve(String(rootPath)).replace(/[\\/]+$/, '');
}

async function addExistingTasksFileTarget(targets, projectPath) {
    const normalizedProjectPath = normalizeWatchRoot(projectPath);
    if (!normalizedProjectPath) {
        return;
    }

    const tasksFile = path.join(normalizedProjectPath, '.pipeline', 'tasks', 'tasks.json');
    try {
        const stats = await fsPromises.stat(tasksFile);
        if (stats.isFile()) {
            targets.set(tasksFile, tasksFile);
        }
    } catch {
        // Projects can be registered before TaskMaster creates tasks.json.
    }
}

async function getTaskMasterTasksWatchTargets() {
    const targets = new Map();
    await addExistingTasksFileTarget(targets, process.cwd());

    try {
        const config = await loadProjectConfig();
        for (const projectInfo of Object.values(config || {})) {
            if (!projectInfo || typeof projectInfo !== 'object') {
                continue;
            }

            await addExistingTasksFileTarget(targets, projectInfo.originalPath || projectInfo.path || projectInfo.projectPath);
        }
    } catch (error) {
        console.warn('[TaskMaster watcher] Failed to read project config:', error?.message || error);
    }

    for (const projectPath of registeredTaskMasterProjectPaths.values()) {
        await addExistingTasksFileTarget(targets, projectPath);
    }

    return Array.from(targets.values());
}

async function resolveProjectNameForTasksFile(_filePath, projectPath) {
    const config = await loadProjectConfig().catch(() => ({}));
    return resolveProjectNameFromConfig(projectPath, config, encodeProjectPath);
}

function shouldBroadcastTaskMasterTaskFileChange(projectName, filePath) {
    const key = `${projectName}:${path.resolve(filePath)}`;
    const now = Date.now();
    const lastBroadcastAt = recentTaskMasterTaskFileBroadcasts.get(key) || 0;
    recentTaskMasterTaskFileBroadcasts.set(key, now);

    for (const [broadcastKey, broadcastAt] of recentTaskMasterTaskFileBroadcasts.entries()) {
        if (now - broadcastAt > 10_000) {
            recentTaskMasterTaskFileBroadcasts.delete(broadcastKey);
        }
    }

    return now - lastBroadcastAt > 800;
}

async function handleTaskMasterTasksFileChanged({ eventType, filePath, projectName, projectPath }) {
    if (!projectName || !filePath) {
        return;
    }
    if (!shouldBroadcastTaskMasterTaskFileChange(projectName, filePath)) {
        return;
    }

    clearProjectDirectoryCache();

    const changedFile = projectPath
        ? path.relative(projectPath, filePath)
        : path.basename(filePath);

    broadcastTaskMasterProjectUpdate(wss, projectName, {
        status: 'tasks-file-changed',
        source: 'tasks-file-watcher',
        eventType,
        changedFile,
    });
    broadcastTaskMasterTasksUpdate(wss, projectName);
}

async function setupTaskMasterTasksWatcher() {
    const chokidar = (await import('chokidar')).default;

    if (taskmasterTasksWatcher) {
        try {
            await taskmasterTasksWatcher.close();
        } catch (error) {
            console.error('[WARN] Failed to close TaskMaster tasks watcher:', error);
        }
        taskmasterTasksWatcher = null;
    }

    const watchTargets = await getTaskMasterTasksWatchTargets();
    if (watchTargets.length === 0) {
        return;
    }

    taskmasterTasksWatcher = await createTaskMasterTasksFileWatcher({
        chokidar,
        watchTargets,
        resolveProjectName: resolveProjectNameForTasksFile,
        onTasksFileChanged: handleTaskMasterTasksFileChanged,
        logger: console,
        debounceMs: 500,
        watchOptions: {
            ignored: WATCHER_IGNORED_PATTERNS,
            depth: 8,
        },
    });
}

async function registerTaskMasterProjectPath(projectName, projectPath) {
    if (!projectName || !projectPath) {
        return;
    }

    const normalizedProjectPath = normalizeWatchRoot(projectPath);
    if (!normalizedProjectPath) {
        return;
    }

    registeredTaskMasterProjectPaths.set(projectName, normalizedProjectPath);
    const tasksFile = path.join(normalizedProjectPath, '.pipeline', 'tasks', 'tasks.json');
    if (taskmasterTasksWatcher) {
        taskmasterTasksWatcher.add(tasksFile);
        return;
    }

    const chokidar = (await import('chokidar')).default;
    taskmasterTasksWatcher = await createTaskMasterTasksFileWatcher({
        chokidar,
        watchTargets: [tasksFile],
        resolveProjectName: resolveProjectNameForTasksFile,
        onTasksFileChanged: handleTaskMasterTasksFileChanged,
        logger: console,
        debounceMs: 500,
        watchOptions: {
            ignored: WATCHER_IGNORED_PATTERNS,
            depth: 1,
        },
    });
}


const app = express();
const server = http.createServer(app);

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function parseOriginList(value = '') {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeOrigin(value) {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

function getConfiguredCorsOrigins() {
    const configuredValues = [
        ...parseOriginList(process.env.CORS_ORIGINS),
        ...parseOriginList(process.env.CORS_ORIGIN),
        process.env.PUBLIC_APP_URL,
        process.env.APP_URL,
        process.env.MEDHELP_PUBLIC_URL,
    ];

    return new Set(
        configuredValues
            .map((value) => normalizeOrigin(value))
            .filter(Boolean)
    );
}

function isLoopbackOrigin(origin) {
    try {
        const parsed = new URL(origin);
        return LOOPBACK_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
}

function isAllowedCorsOrigin(origin) {
    if (!origin) {
        return true;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) {
        return false;
    }

    const configuredOrigins = getConfiguredCorsOrigins();
    if (configuredOrigins.size > 0) {
        return configuredOrigins.has(normalizedOrigin);
    }

    return isLoopbackOrigin(normalizedOrigin);
}

function isSystemUpdateEnabled() {
    return String(process.env.MEDAUTODATA_ENABLE_SYSTEM_UPDATE || '').trim().toLowerCase() === 'true';
}

// Single WebSocket server that handles supported real-time paths.
const wss = new WebSocketServer({
    server,
    verifyClient: (info) => {
        const authHeader = info.req.headers.authorization || '';
        const tokenFromHeader = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const requestUrl = new URL(info.req.url || '/', 'http://localhost');
        const token = tokenFromHeader || requestUrl.searchParams.get('token');
        const user = authenticateWebSocket(token);
        if (!user) {
            console.log('[WARN] WebSocket authentication failed');
            return false;
        }
        info.req.user = user;
        return true;
    }
});

// Make WebSocket server available to routes
app.locals.wss = wss;
app.locals.registerTaskMasterProjectPath = registerTaskMasterProjectPath;

app.use(cors({
    origin(origin, callback) {
        callback(null, isAllowedCorsOrigin(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: false,
}));
app.use(express.json({
  limit: '50mb',
  type: (req) => {
    // Skip multipart/form-data requests (for file uploads like images)
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      return false;
    }
    return contentType.includes('json');
  }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Public health check endpoint (no authentication required)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    installMode
  });
});

// Local protocol bridge used by Claude Agent SDK sessions for OpenAI-compatible
// providers. It is loopback-only by default and credentials never leave the
// backend; built-in OAuth providers resolve tokens server-side.
app.use('/proxy', providerProxyRoutes);

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectsRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// MCP API Routes (protected)
app.use('/api/mcp', authenticateToken, mcpRoutes);

// TaskMaster API Routes (protected)
app.use('/api/taskmaster', authenticateToken, taskmasterRoutes);

// MCP utilities
app.use('/api/mcp-utils', authenticateToken, mcpUtilsRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);

// LLM provider management and official-provider OAuth.
app.use('/api/providers', authenticateToken, providersRoutes);
app.use('/api/provider-oauth', authenticateToken, providerOAuthRoutes);
app.use('/api/haha-openai-oauth', authenticateToken, createProviderOAuthAliasRouter('openai'));
app.use('/api/haha-grok-oauth', authenticateToken, createProviderOAuthAliasRouter('grok'));

// CLI Authentication API Routes (protected)
app.use('/api/cli', authenticateToken, cliAuthRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Skills API Routes (protected)
app.use('/api/skills', authenticateToken, skillsRoutes);

// Telemetry API Routes (protected)
app.use('/api/telemetry', authenticateToken, telemetryRoutes);

// Literature news API Routes (protected)
app.use('/api/news', authenticateToken, newsRoutes);

// References (literature library) API Routes (protected)
app.use('/api/references', authenticateToken, referencesRoutes);

// Meta Analysis Workspace API Routes (protected)
app.use('/api/meta-analysis', authenticateToken, metaAnalysisRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

const expandWorkspacePath = async (inputPath) => {
    if (!inputPath) return inputPath;
    if (inputPath === '~') {
        return os.homedir();
    }
    if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
        return path.join(os.homedir(), inputPath.slice(2));
    }
    return inputPath;
};

// Browse filesystem endpoint for project suggestions - uses existing getFileTree
app.get('/api/browse-filesystem', authenticateToken, async (req, res) => {
    try {
        const { path: dirPath, showHidden: showHiddenQuery } = req.query;
        const showHidden = showHiddenQuery === 'true';
        const selectingDefaultLocation = req.query.selectDefaultLocation === 'true';

        console.log('[API] Browse filesystem request for path:', dirPath, 'showHidden:', showHidden);
        const homeDir = os.homedir();
        const defaultBrowseRoot = selectingDefaultLocation
            ? homeDir
            : isProjectPathLockEnabled()
            ? await getWorkspaceRootForUser(req.user)
            : homeDir;
        // Default to home directory if no path provided
        let targetPath = dirPath ? await expandWorkspacePath(dirPath) : defaultBrowseRoot;

        // Resolve and normalize the path
        targetPath = path.resolve(targetPath);

        // Security check - ensure path is valid
        let resolvedPath = targetPath;
        if (!selectingDefaultLocation) {
            const validation = await validateWorkspacePath(targetPath, { user: req.user });
            if (!validation.valid) {
                return res.status(403).json({ error: validation.error });
            }
            resolvedPath = validation.resolvedPath || targetPath;
        }

        let resolvedHomeDir = homeDir;
        try {
            resolvedHomeDir = await fs.promises.realpath(homeDir);
        } catch (error) {
            // Use home dir as-is if realpath fails
        }

        if (selectingDefaultLocation) {
            try {
                const selectedRealPath = await fs.promises.realpath(resolvedPath);
                if (selectedRealPath !== resolvedHomeDir && !selectedRealPath.startsWith(`${resolvedHomeDir}${path.sep}`)) {
                    return res.status(403).json({ error: 'Default project location must be inside your home directory' });
                }
                resolvedPath = selectedRealPath;
            } catch (error) {
                return res.status(404).json({ error: 'Directory not accessible' });
            }
        }

        // Security check - ensure path is accessible
        try {
            await fs.promises.access(resolvedPath);
            const stats = await fs.promises.stat(resolvedPath);

            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is not a directory' });
            }
        } catch (err) {
            return res.status(404).json({ error: 'Directory not accessible' });
        }

        // Use existing getFileTree function with shallow depth (only direct children)
        // For browsing, we use a more permissive version that doesn't skip node_modules etc.
        const fileTree = await getFileTree(resolvedPath, 1, 0, showHidden, true); // maxDepth=1, showHidden, isBrowsing=true

        // Filter only directories and format for suggestions
        const directories = fileTree
            .filter(item => item.type === 'directory')
            .map(item => ({
                path: item.path,
                name: item.name,
                type: 'directory'
            }))
            .sort((a, b) => {
                const aHidden = a.name.startsWith('.');
                const bHidden = b.name.startsWith('.');
                if (aHidden && !bHidden) return 1;
                if (!aHidden && bHidden) return -1;
                return a.name.localeCompare(b.name);
            });

        // Add common directories if browsing home directory
        const suggestions = [];
        if (resolvedPath === resolvedHomeDir) {
            const commonDirs = ['Desktop', 'Documents', 'Downloads', 'Projects', 'Development', 'Dev', 'Code', 'workspace', 'vibelab'];
            const existingCommon = directories.filter(dir => commonDirs.includes(dir.name));
            const otherDirs = directories.filter(dir => !commonDirs.includes(dir.name));

            suggestions.push(...existingCommon, ...otherDirs);
        } else {
            suggestions.push(...directories);
        }

        res.json({
            path: resolvedPath,
            suggestions: suggestions,
            parentPath: selectingDefaultLocation && resolvedPath !== resolvedHomeDir
                ? path.dirname(resolvedPath)
                : null,
            browseRoot: selectingDefaultLocation ? resolvedHomeDir : undefined
        });

    } catch (error) {
        console.error('Error browsing filesystem:', error);
        res.status(500).json({ error: 'Failed to browse filesystem' });
    }
});

app.post('/api/create-folder', authenticateToken, async (req, res) => {
    try {
        if (isProjectPathLockEnabled()) {
            return res.status(403).json({
                error: 'Folder creation is disabled because new projects use the configured default location',
                lockedToDefault: true,
                lockedToUser: false
            });
        }

        const { path: folderPath } = req.body;
        if (!folderPath) {
            return res.status(400).json({ error: 'Path is required' });
        }
        const expandedPath = await expandWorkspacePath(folderPath);
        const resolvedInput = path.resolve(expandedPath);
        const validation = await validateWorkspacePath(resolvedInput, { user: req.user });
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }
        const targetPath = validation.resolvedPath || resolvedInput;
        const parentDir = path.dirname(targetPath);
        try {
            await fs.promises.access(parentDir);
        } catch (err) {
            return res.status(404).json({ error: 'Parent directory does not exist' });
        }
        try {
            await fs.promises.access(targetPath);
            return res.status(409).json({ error: 'Folder already exists' });
        } catch (err) {
            // Folder doesn't exist, which is what we want
        }
        try {
            await fs.promises.mkdir(targetPath, { recursive: false });
            res.json({ success: true, path: targetPath });
        } catch (mkdirError) {
            if (mkdirError.code === 'EEXIST') {
                return res.status(409).json({ error: 'Folder already exists' });
            }
            throw mkdirError;
        }
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

function setServiceWorkerHeaders(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Service-Worker-Allowed', '/');
}

// Serve public files (like api-docs.html)
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (path.basename(filePath) === 'sw.js') {
      setServiceWorkerHeaders(res);
    }
  }
}));

// Static files served after API routes
// Add cache control: HTML files should not be cached, but assets can be cached
app.use(express.static(path.join(__dirname, '../dist'), {
  setHeaders: (res, filePath) => {
    if (path.basename(filePath) === 'sw.js') {
      // The service worker controls app-shell caching, so the script itself must
      // be revalidated on every load to let stale-cache fixes reach browsers.
      setServiceWorkerHeaders(res);
    } else if (filePath.endsWith('.html')) {
      // Prevent HTML caching to avoid service worker issues after builds
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
      // Cache static assets for 1 year (they have hashed names)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs

// System update endpoint
app.post('/api/system/update', authenticateToken, async (req, res) => {
    try {
        if (!isSystemUpdateEnabled()) {
            return res.status(403).json({
                success: false,
                error: 'Server-side self-update is disabled. Set MEDAUTODATA_ENABLE_SYSTEM_UPDATE=true only for trusted single-user deployments.',
            });
        }

        // Get the project root directory (parent of server directory)
        const projectRoot = path.join(__dirname, '..');

        console.log('Starting system update from directory:', projectRoot);

        // Run the update command based on installation mode
        const updateCommand = installMode === 'git'
            ? 'git checkout main && git pull && npm install'
            : `npm install -g ${npmPackageName}@latest`;

        const child = spawn('sh', ['-c', updateCommand], {
            cwd: installMode === 'git' ? projectRoot : os.homedir(),
            env: process.env
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log('Update output:', text);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            console.error('Update error:', text);
        });

        child.on('close', (code) => {
            if (code === 0) {
                res.json({
                    success: true,
                    output: output || 'Update completed successfully',
                    message: 'Update completed. Please restart the server to apply changes.'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Update command failed',
                    output: output,
                    errorOutput: errorOutput
                });
            }
        });

        child.on('error', (error) => {
            console.error('Update process error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        });

    } catch (error) {
        console.error('System update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const projects = await getProjects(userId, (progress) => broadcastProgress(progress, userId));
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/trash', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const projects = await getTrashedProjects(userId);
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/token-usage-summary', authenticateToken, async (req, res) => {
    try {
        const projectRefs = req.body?.projects;
        if (!Array.isArray(projectRefs)) {
            return res.status(400).json({ error: 'projects array is required' });
        }

        const summary = await getProjectTokenUsageSummary(projectRefs);
        res.json(summary);
    } catch (error) {
        console.error('Error building project token usage summary:', error);
        res.status(500).json({ error: 'Failed to build project token usage summary' });
    }
});

app.get('/api/projects/:projectName/sessions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { limit = 5, offset = 0 } = req.query;
        const result = await getSessions(req.params.projectName, parseInt(limit), parseInt(offset), userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/sessions/reindex', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const requestedProviders = Array.isArray(req.body?.providers) ? req.body.providers : ['claude'];
        const result = await reindexProjectSessions(req.params.projectName, {
            providers: requestedProviders,
            userId,
        });
        res.json({ success: true, ...result });
    } catch (error) {
        console.error(`Error reindexing sessions for project ${req.params.projectName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Get messages for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/messages', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectName, sessionId } = req.params;
        const { limit, offset, provider } = req.query;

        // Parse limit and offset if provided
        const parsedLimit = limit ? parseInt(limit, 10) : null;
        const parsedOffset = offset ? parseInt(offset, 10) : 0;

        const result = await getSessionMessages(projectName, sessionId, parsedLimit, parsedOffset, provider, userId);

        // Handle both old and new response formats
        if (Array.isArray(result)) {
            // Backward compatibility: no pagination parameters were provided
            res.json({ messages: result });
        } else {
            // New format with pagination info
            res.json(result);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/tags', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        // Lazy initialization: idempotent, uses INSERT OR IGNORE internally.
        tagDb.ensureDefaultStageTags(projectName);
        const { tagType } = req.query;
        const tags = tagDb.listProjectTags(projectName, tagType || null);
        res.json({ tags });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions/:sessionId/tags', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        // Lazy initialization: idempotent, uses INSERT OR IGNORE internally.
        tagDb.ensureDefaultStageTags(projectName);
        const session = sessionDb.getSessionById(sessionId);
        if (!session || session.project_name !== projectName) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const tags = tagDb.listTagsForSession(sessionId);
        res.json({ tags });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/sessions/:sessionId/tags', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { tagIds } = req.body || {};

        if (!Array.isArray(tagIds)) {
            return res.status(400).json({ error: 'tagIds array is required' });
        }

        // Lazy initialization: idempotent, uses INSERT OR IGNORE internally.
        tagDb.ensureDefaultStageTags(projectName);
        const session = sessionDb.getSessionById(sessionId);
        if (!session || session.project_name !== projectName) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const tags = tagDb.replaceSessionTags(sessionId, projectName, tagIds, {
            linkedBy: req.user?.username || 'user',
            source: 'manual',
        });
        res.json({ success: true, tags });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions/:sessionId/context-review', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const session = sessionDb.getSessionById(sessionId);

        if (!session || session.project_name !== projectName) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({
            sessionId,
            projectName,
            reviews: sessionDb.getSessionContextReview(sessionId),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/sessions/:sessionId/context-review', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { reviews } = req.body || {};
        const session = sessionDb.getSessionById(sessionId);

        if (!session || session.project_name !== projectName) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({
            sessionId,
            projectName,
            reviews: sessionDb.updateSessionContextReview(sessionId, reviews),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions/:sessionId/execution-memory', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const session = sessionDb.getSessionById(sessionId);

        if (!session || session.project_name !== projectName) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const projectPath = await extractProjectDirectory(projectName);
        const snapshot = await readExecutionMemorySnapshot({
            scope: 'session',
            projectPath,
            sessionId,
            provider: session.provider || null,
        }, { ledgerLimit: 80 });

        res.json({
            sessionId,
            projectName,
            microtasks: snapshot.microtasks,
            derived: snapshot.derived,
            recentEvents: snapshot.ledgerEvents,
            sessionSummary: snapshot.sessionSummary,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/research-lessons', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const projectPath = await extractProjectDirectory(projectName);
        const state = await readResearchLessons(projectPath);

        res.json({
            projectName,
            updatedAt: state.updatedAt,
            lessons: state.items,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename project endpoint
app.put('/api/projects/:projectName/rename', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { displayName } = req.body;
        await renameProject(req.params.projectName, displayName, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename session endpoint
app.put('/api/projects/:projectName/sessions/:sessionId/rename', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectName, sessionId } = req.params;
        const { summary, provider } = req.body;
        await renameSession(projectName, sessionId, summary, provider, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete session endpoint
app.delete('/api/projects/:projectName/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectName, sessionId } = req.params;
        const { provider, mode } = req.query;
        if (provider && provider !== 'claude') {
            return res.status(400).json({ error: 'provider must be "claude"' });
        }
        const normalizedProvider = 'claude';
        const deleteMode = mode || 'trash';
        console.log(`[API] Deleting session: ${sessionId} from project: ${projectName}, provider: ${normalizedProvider}, mode: ${deleteMode}`);

        // Safety: never delete a session while it is actively processing in-memory.
        // This can happen during reconnect/status polling and leads to "stuck" UI.
        const isActive = normalizedProvider === 'claude'
            ? isClaudeSDKSessionActive(sessionId)
            : false;
        if (isActive) {
            return res.status(409).json({
                error: `Session ${sessionId} is currently processing and cannot be deleted yet.`,
            });
        }

        if (deleteMode === 'physical') {
            await deleteSession(projectName, sessionId, normalizedProvider);
            console.log(`[API] Session ${sessionId} physically deleted successfully`);
        } else {
            await trashSession(projectName, sessionId, normalizedProvider, userId);
            console.log(`[API] Session ${sessionId} moved to trash successfully`);
        }
        res.json({ success: true });
    } catch (error) {
        console.error(`[API] Error deleting session ${req.params.sessionId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// List trashed sessions
app.get('/api/projects/trash/sessions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const sessions = await getTrashedSessions(userId);
        res.json(sessions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Restore session from trash
app.post('/api/projects/:projectName/sessions/:sessionId/restore', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectName, sessionId } = req.params;
        await restoreSession(projectName, sessionId, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete project endpoint (force=true to delete with sessions)
app.delete('/api/projects/:projectName', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectName } = req.params;
        const force = req.query.force === 'true';
        await deleteProject(projectName, force, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/trash/:projectName/restore', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        await restoreProject(req.params.projectName, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/projects/trash/:projectName', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const mode = req.query.mode === 'physical' ? 'physical' : 'logical';
        await deleteTrashedProject(req.params.projectName, mode, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create project endpoint
async function handleCreateProject(req, res) {
    try {
        if (isProjectPathLockEnabled()) {
            return res.status(403).json({
                error: 'Custom project paths are disabled. Create a new project through the server-managed workspace endpoint.',
                lockedToUser: true
            });
        }

        const { path: projectPath, displayName = null } = req.body;

        if (!projectPath || !projectPath.trim()) {
            return res.status(400).json({ error: 'Project path is required' });
        }

        let resolvedProjectPath = projectPath.trim();
        if (isProjectPathLockEnabled()) {
            const validation = await validateWorkspacePath(resolvedProjectPath, { user: req.user });
            if (!validation.valid) {
                return res.status(400).json({
                    error: 'Invalid project path',
                    details: validation.error
                });
            }
            resolvedProjectPath = validation.resolvedPath || resolvedProjectPath;
        }

        const project = await addProjectManually(resolvedProjectPath, displayName, req.user?.id);
        res.json({ success: true, project });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: error.message });
    }
}

app.post('/api/projects/create', authenticateToken, handleCreateProject);
app.post('/api/projects', authenticateToken, handleCreateProject);

// Read file content endpoint
app.get('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const filePath = normalizeProjectFileRequestPath(req.query.filePath);


        // Security: ensure the requested path is inside the project root
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Handle both absolute and relative paths with pipeline file fallback + bare name search
        const result = await resolveProjectFilePath(projectRoot, filePath, {
            includeInternal: includeInternalProjectFiles(req),
        });
        if (result.candidates) {
            return res.json({ ambiguous: true, candidates: result.candidates });
        }
        const resolved = result.resolved;
        await assertReadableProjectPath(projectRoot, resolved, {
            includeInternal: includeInternalProjectFiles(req),
        });

        const rawMaxPreview = req.query.maxPreviewBytes;
        let maxPreviewBytes = null;
        if (rawMaxPreview !== undefined && rawMaxPreview !== null && String(rawMaxPreview).trim() !== '') {
            const parsed = Number.parseInt(String(rawMaxPreview), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                maxPreviewBytes = Math.min(parsed, 2 * 1024 * 1024);
            }
        }

        const stats = await fsPromises.stat(resolved);
        let content;
        let truncated = false;
        if (maxPreviewBytes && stats.size > maxPreviewBytes) {
            const handle = await fsPromises.open(resolved, 'r');
            try {
                const buf = Buffer.allocUnsafe(maxPreviewBytes);
                const { bytesRead } = await handle.read(buf, 0, maxPreviewBytes, 0);
                content = buf.subarray(0, bytesRead).toString('utf8');
                truncated = true;
            } finally {
                await handle.close();
            }
        } else {
            content = await fsPromises.readFile(resolved, 'utf8');
        }

        res.json({
            content,
            path: resolved,
            truncated,
            totalBytes: stats.size,
            previewBytes: truncated ? maxPreviewBytes : stats.size,
        });
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File not found is a normal condition (e.g. optional config files) — no noisy log
            res.status(404).json({ error: 'File not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES') {
            console.error('Permission denied reading project file');
            res.status(403).json({ error: 'Permission denied' });
        } else {
            console.error('Error reading file:', error);
            res.status(500).json({ error: error.message });
        }
    }
});

// Serve binary file content endpoint (for images, etc.)
app.get('/api/projects/:projectName/files/content', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const filePath = normalizeProjectFileRequestPath(req.query.path);


        // Security: ensure the requested path is inside the project root
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const result = await resolveProjectFilePath(projectRoot, filePath, {
            includeInternal: includeInternalProjectFiles(req),
        });
        if (result.candidates) {
            return res.status(400).json({ error: 'Ambiguous filename', candidates: result.candidates });
        }
        const resolved = result.resolved;
        await assertReadableProjectPath(projectRoot, resolved, {
            includeInternal: includeInternalProjectFiles(req),
        });

        // Check if file exists
        try {
            await fsPromises.access(resolved);
        } catch (error) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Get file extension and set appropriate content type
        const mimeType = mime.lookup(resolved) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);

        // Stream the file
        const fileStream = fs.createReadStream(resolved);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file' });
            }
        });

    } catch (error) {
        console.error('Error serving binary file:', error);
        if (!res.headersSent) {
            res.status(error.statusCode || 500).json({ error: error.message });
        }
    }
});

// Save file content endpoint
app.put('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { filePath, content } = req.body;


        // Security: ensure the requested path is inside the project root
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        if (content === undefined) {
            return res.status(400).json({ error: 'Content is required' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Handle both absolute and relative paths with pipeline file fallback + bare name search
        const result = await resolveProjectFilePath(projectRoot, filePath);
        if (result.candidates) {
            return res.status(400).json({ error: 'Ambiguous filename', candidates: result.candidates });
        }
        const resolved = result.resolved;
        await assertWritableProjectPath(projectRoot, resolved);

        // Write the new content
        await fsPromises.writeFile(resolved, content, 'utf8');

        res.json({
            success: true,
            path: resolved,
            message: 'File saved successfully'
        });
    } catch (error) {
        console.error('Error saving file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Move a file or directory to another directory within the same project
app.post('/api/projects/:projectName/file/move', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { sourcePath, destinationDir } = req.body || {};

        if (!sourcePath || typeof sourcePath !== 'string') {
            return res.status(400).json({ error: 'Invalid source path' });
        }

        if (typeof destinationDir !== 'string') {
            return res.status(400).json({ error: 'Invalid destination directory' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolvedProjectRoot = path.resolve(projectRoot);
        const normalizedRoot = `${resolvedProjectRoot}${path.sep}`;
        const sourceResult = await resolveProjectFilePath(projectRoot, sourcePath);

        if (sourceResult.candidates) {
            return res.status(400).json({ error: 'Ambiguous source path', candidates: sourceResult.candidates });
        }

        const resolvedSourcePath = sourceResult.resolved;
        await assertReadableProjectPath(projectRoot, resolvedSourcePath);

        const sourceStats = await fsPromises.stat(resolvedSourcePath);
        const isDirectoryMove = sourceStats.isDirectory();
        const isFileMove = sourceStats.isFile();
        if (!isFileMove && !isDirectoryMove) {
            return res.status(400).json({ error: 'Only files and folders can be moved from this panel' });
        }
        if (resolvedSourcePath === resolvedProjectRoot) {
            return res.status(400).json({ error: 'Project root cannot be moved' });
        }

        const trimmedDestinationDir = destinationDir.trim();
        const resolvedDestinationDir = path.isAbsolute(trimmedDestinationDir)
            ? path.resolve(trimmedDestinationDir)
            : path.resolve(projectRoot, trimmedDestinationDir);

        if (
            resolvedDestinationDir !== resolvedProjectRoot &&
            !resolvedDestinationDir.startsWith(normalizedRoot)
        ) {
            return res.status(403).json({ error: 'Destination must be under project root' });
        }
        await assertReadableProjectPath(projectRoot, resolvedDestinationDir);

        const destinationStats = await fsPromises.stat(resolvedDestinationDir);
        if (!destinationStats.isDirectory()) {
            return res.status(400).json({ error: 'Destination must be a directory' });
        }

        if (
            isDirectoryMove &&
            (resolvedDestinationDir === resolvedSourcePath ||
                resolvedDestinationDir.startsWith(`${resolvedSourcePath}${path.sep}`))
        ) {
            return res.status(400).json({ error: 'Folder cannot be moved into itself or one of its subfolders' });
        }

        const targetPath = path.join(resolvedDestinationDir, path.basename(resolvedSourcePath));
        if (targetPath === resolvedSourcePath) {
            return res.status(400).json({ error: 'Item is already in that folder' });
        }
        await assertWritableProjectPath(projectRoot, targetPath);

        try {
            await fsPromises.access(targetPath);
            return res.status(409).json({ error: 'An item with the same name already exists in that folder' });
        } catch {
            // Target does not exist, so the move can continue.
        }

        await fsPromises.rename(resolvedSourcePath, targetPath);

        const relativePath = path.relative(resolvedProjectRoot, targetPath).split(path.sep).join('/');
        const relativeDestinationDir = path.relative(resolvedProjectRoot, resolvedDestinationDir).split(path.sep).join('/') || '.';

        res.json({
            success: true,
            name: path.basename(targetPath),
            absolutePath: targetPath,
            relativePath,
            destinationDir: relativeDestinationDir,
        });
    } catch (error) {
        console.error('Error moving file or folder:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'Source file or destination folder not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Create a directory within the project filesystem
app.post('/api/projects/:projectName/folder', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { parentDir = '', name } = req.body || {};

        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Folder name is required' });
        }

        if (typeof parentDir !== 'string') {
            return res.status(400).json({ error: 'Invalid parent directory' });
        }

        const folderName = name.trim();
        if (
            folderName === '.' ||
            folderName === '..' ||
            folderName.startsWith('.') ||
            folderName.includes('/') ||
            folderName.includes('\\') ||
            folderName.includes('\0')
        ) {
            return res.status(400).json({ error: 'Invalid folder name' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolvedProjectRoot = path.resolve(projectRoot);
        const normalizedRoot = `${resolvedProjectRoot}${path.sep}`;
        const trimmedParentDir = parentDir.trim();
        const resolvedParentDir = trimmedParentDir
            ? (path.isAbsolute(trimmedParentDir)
                ? path.resolve(trimmedParentDir)
                : path.resolve(projectRoot, trimmedParentDir))
            : resolvedProjectRoot;

        if (
            resolvedParentDir !== resolvedProjectRoot &&
            !resolvedParentDir.startsWith(normalizedRoot)
        ) {
            return res.status(403).json({ error: 'Parent directory must be under project root' });
        }
        assertPublicProjectPath(projectRoot, resolvedParentDir);

        const parentStats = await fsPromises.stat(resolvedParentDir);
        if (!parentStats.isDirectory()) {
            return res.status(400).json({ error: 'Parent path must be a directory' });
        }

        const targetPath = path.join(resolvedParentDir, folderName);
        if (!targetPath.startsWith(normalizedRoot)) {
            return res.status(403).json({ error: 'Target directory must be under project root' });
        }
        assertPublicProjectPath(projectRoot, targetPath);

        try {
            await fsPromises.access(targetPath);
            return res.status(409).json({ error: 'Folder already exists' });
        } catch {
            // Target does not exist, so creation can continue.
        }

        await fsPromises.mkdir(targetPath, { recursive: false });

        const relativePath = path.relative(resolvedProjectRoot, targetPath).split(path.sep).join('/');
        const relativeParentDir = path.relative(resolvedProjectRoot, resolvedParentDir).split(path.sep).join('/') || '.';

        res.json({
            success: true,
            name: folderName,
            absolutePath: targetPath,
            relativePath,
            parentDir: relativeParentDir,
        });
    } catch (error) {
        console.error('Error creating project folder:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'Parent directory not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message || 'Failed to create folder' });
        }
    }
});

// Delete a file or directory from the project filesystem
app.delete('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const projectName = req.params.projectName;
        const { filePath } = req.body || {};

        if (!filePath || typeof filePath !== 'string') {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolved = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(projectRoot, filePath);
        const normalizedRoot = path.resolve(projectRoot) + path.sep;
        if (!resolved.startsWith(normalizedRoot)) {
            return res.status(403).json({ error: 'Path must be under project root' });
        }
        assertPublicProjectPath(projectRoot, resolved);

        await fsPromises.rm(resolved, { recursive: true });

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Upload files to project filesystem
app.post('/api/projects/:projectName/upload-files', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const CHAT_ATTACHMENT_STORAGE_SCOPE = 'project-chat-attachments';
        const MAX_UPLOAD_FILE_COUNT = 200;
        const projectName = req.params.projectName;
        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const createUploadError = (message, statusCode = 400) => {
            const error = new Error(message);
            error.statusCode = statusCode;
            return error;
        };

        const getUploadDestination = (request) => {
            const storageScope = typeof request.body?.storageScope === 'string' ? request.body.storageScope : '';
            const targetDir = (request.body && request.body.targetDir) || '';
            const baseDir = storageScope === CHAT_ATTACHMENT_STORAGE_SCOPE
                ? resolveProjectChatAttachmentsDir(projectRoot)
                : projectRoot;
            const resolved = path.resolve(baseDir, targetDir);
            const normalizedBase = path.resolve(baseDir) + path.sep;

            if (!resolved.startsWith(normalizedBase) && resolved !== path.resolve(baseDir)) {
                const message = storageScope === CHAT_ATTACHMENT_STORAGE_SCOPE
                    ? 'Path must be under project attachment storage'
                    : 'Path must be under project root';
                throw createUploadError(message, 403);
            }
            if (storageScope !== CHAT_ATTACHMENT_STORAGE_SCOPE) {
                assertPublicProjectPath(projectRoot, resolved);
            }

            return resolved;
        };

        const getSafeUploadRelativePath = (originalName) => {
            const rawPath = String(originalName || '').replace(/\\/g, '/');
            const segments = rawPath.split('/').filter(Boolean);

            if (segments.length === 0) {
                throw createUploadError('Invalid upload path');
            }

            const safeSegments = segments.map((segment) => {
                const cleanSegment = segment.replace(/\0/g, '').trim();

                if (!cleanSegment || cleanSegment === '.' || cleanSegment === '..') {
                    throw createUploadError('Invalid upload path');
                }

                return cleanSegment.replace(/\.\./g, '_').replace(/[/\\]/g, '_');
            });

            const relativePath = path.join(...safeSegments);
            const normalizedPath = path.normalize(relativePath);

            if (path.isAbsolute(normalizedPath) || normalizedPath.startsWith(`..${path.sep}`) || normalizedPath === '..') {
                throw createUploadError('Invalid upload path');
            }

            return normalizedPath;
        };

        const normalizeUploadFieldArray = (value) => {
            if (Array.isArray(value)) return value;
            if (typeof value === 'string') return [value];
            return [];
        };

        const getUploadDirectoryFields = (request) => Array.from(new Set(
            normalizeUploadFieldArray(request.body?.directories)
                .map((directoryPath) => String(directoryPath || '').trim())
                .filter(Boolean)
        ));

        const getUploadRelativePathFields = (request) => normalizeUploadFieldArray(
            request.body?.relativePaths ?? request.body?.relativePath
        );

        const isVisibleProjectUploadPath = (targetPath) => {
            const relativePath = getProjectRelativePath(projectRoot, targetPath);
            return !isInternalProjectPath(relativePath);
        };

        const moveUploadedTempFile = async (sourcePath, targetPath) => {
            try {
                await fsPromises.rename(sourcePath, targetPath);
            } catch (error) {
                if (error.code !== 'EXDEV') {
                    throw error;
                }

                await fsPromises.copyFile(sourcePath, targetPath);
                await fsPromises.unlink(sourcePath);
            }
        };

        const storage = multer.diskStorage({
            destination: async (req, file, cb) => {
                try {
                    if (!req.uploadTempDir) {
                        const userId = req.user?.id ? String(req.user.id) : 'anonymous';
                        const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                        req.uploadTempDir = path.join(os.tmpdir(), 'medautodata-project-uploads', userId, uploadId);
                    }
                    await fsPromises.mkdir(req.uploadTempDir, { recursive: true });
                    cb(null, req.uploadTempDir);
                } catch (error) {
                    cb(error);
                }
            },
            filename: async (req, file, cb) => {
                try {
                    req.uploadTempFileIndex = (req.uploadTempFileIndex || 0) + 1;
                    const extension = path.extname(String(file.originalname || '')).replace(/[^a-zA-Z0-9.]/g, '');
                    cb(null, `${req.uploadTempFileIndex}-${Date.now()}${extension}`);
                } catch (error) {
                    cb(error);
                }
            }
        });

        const upload = multer({
            preservePath: true,
            storage,
            limits: {
                fileSize: 50 * 1024 * 1024, // 50MB
                files: MAX_UPLOAD_FILE_COUNT
            }
        });

        upload.array('files', MAX_UPLOAD_FILE_COUNT)(req, res, async (err) => {
            if (err) {
                const status = Number.isInteger(err.statusCode) ? err.statusCode : 400;
                return res.status(status).json({ error: err.message });
            }

            try {
                const storageScope = String(req.body?.storageScope || '');
                const isChatAttachmentUpload = storageScope === CHAT_ATTACHMENT_STORAGE_SCOPE;
                const destinationDir = getUploadDestination(req);
                const normalizedDestination = `${path.resolve(destinationDir)}${path.sep}`;
                const createdDirectories = [];
                const uploadedFiles = [];
                const skippedInternalUploadPaths = [];
                const relativePathFields = getUploadRelativePathFields(req);
                await fsPromises.mkdir(destinationDir, { recursive: true });

                for (const directoryPath of getUploadDirectoryFields(req)) {
                    const safeRelativePath = getSafeUploadRelativePath(directoryPath);
                    const finalDir = path.resolve(destinationDir, safeRelativePath);

                    if (!finalDir.startsWith(normalizedDestination)) {
                        throw createUploadError('Invalid upload path');
                    }
                    if (!isChatAttachmentUpload) {
                        if (!isVisibleProjectUploadPath(finalDir)) {
                            skippedInternalUploadPaths.push(directoryPath);
                            continue;
                        }
                        assertPublicProjectPath(projectRoot, finalDir);
                    }

                    await fsPromises.mkdir(finalDir, { recursive: true });
                    createdDirectories.push({
                        name: path.basename(finalDir),
                        path: finalDir,
                        relativePath: path.relative(projectRoot, finalDir).split(path.sep).join('/')
                    });
                }

                for (const [index, file] of (req.files || []).entries()) {
                    const requestedRelativePath = relativePathFields[index] || file.originalname || file.filename;
                    const safeRelativePath = getSafeUploadRelativePath(requestedRelativePath);
                    const finalPath = path.resolve(destinationDir, safeRelativePath);

                    if (!finalPath.startsWith(normalizedDestination)) {
                        throw createUploadError('Invalid upload path');
                    }
                    if (!isChatAttachmentUpload) {
                        if (!isVisibleProjectUploadPath(finalPath)) {
                            skippedInternalUploadPaths.push(requestedRelativePath);
                            await fsPromises.rm(file.path, { force: true });
                            continue;
                        }
                        assertPublicProjectPath(projectRoot, finalPath);
                    }

                    await fsPromises.mkdir(path.dirname(finalPath), { recursive: true });
                    await moveUploadedTempFile(file.path, finalPath);

                    uploadedFiles.push({
                        name: path.basename(finalPath),
                        size: file.size,
                        path: finalPath,
                        relativePath: path.relative(projectRoot, finalPath).split(path.sep).join('/')
                    });
                }

                if (uploadedFiles.length === 0 && createdDirectories.length === 0) {
                    return res.status(400).json({
                        error: skippedInternalUploadPaths.length > 0
                            ? 'No visible files or folders provided'
                            : 'No files or folders provided'
                    });
                }

                res.json({
                    files: uploadedFiles,
                    directories: createdDirectories,
                    skippedInternalPaths: skippedInternalUploadPaths
                });
            } catch (uploadError) {
                const status = Number.isInteger(uploadError.statusCode) ? uploadError.statusCode : 400;
                return res.status(status).json({ error: uploadError.message });
            } finally {
                if (req.uploadTempDir) {
                    await fsPromises.rm(req.uploadTempDir, { recursive: true, force: true }).catch(() => {});
                }
            }
        });
    } catch (error) {
        console.error('Error in file upload endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Global skills endpoints (GET /api/skills, GET /api/skills/file) are handled
// by the skillsRoutes router mounted above at /api/skills.

app.get('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
    try {

        // Using fsPromises from import

        // Use extractProjectDirectory to get the actual project path
        let actualPath;
        try {
            actualPath = await extractProjectDirectory(req.params.projectName);
        } catch (error) {
            console.error('Error extracting project directory:', error);
            // Fallback to simple dash replacement
            actualPath = req.params.projectName.replace(/-/g, '/');
        }

        const projectRoot = path.resolve(actualPath);
        const { path: requestedPath, maxDepth: maxDepthQuery, showHidden: showHiddenQuery } = req.query;
        const includeInternal = includeInternalProjectFiles(req);

        let targetPath = projectRoot;
        if (typeof requestedPath === 'string' && requestedPath.trim()) {
            targetPath = path.isAbsolute(requestedPath)
                ? path.resolve(requestedPath)
                : path.resolve(projectRoot, requestedPath);

            const normalizedRoot = projectRoot + path.sep;
            if (targetPath !== projectRoot && !targetPath.startsWith(normalizedRoot)) {
                return res.status(403).json({ error: 'Path must be under project root' });
            }
        }
        assertPublicProjectPath(projectRoot, targetPath, { includeInternal });

        // Check if path exists
        try {
            await fsPromises.access(targetPath);
        } catch (e) {
            return res.status(404).json({ error: `Project path not found: ${targetPath}` });
        }

        let maxDepth = 10;
        if (maxDepthQuery !== undefined) {
            const parsedDepth = Number.parseInt(String(maxDepthQuery), 10);
            if (!Number.isNaN(parsedDepth)) {
                maxDepth = Math.min(10, Math.max(0, parsedDepth));
            }
        }

        const showHidden = showHiddenQuery === undefined
            ? true
            : ['1', 'true', 'yes', 'on'].includes(String(showHiddenQuery).toLowerCase());

        const stats = await fsPromises.stat(targetPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Path must be a directory' });
        }

        const files = await getFileTree(targetPath, maxDepth, 0, showHidden, false, {
            projectRoot,
            includeInternal,
        });
        res.json(files);
    } catch (error) {
        console.error('[ERROR] File tree error:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
    const url = request.url;

    // Parse URL to get pathname without query parameters
    const urlObj = new URL(url, 'http://localhost');
    const pathname = urlObj.pathname;
    console.log('[INFO] Client connected to WebSocket path:', pathname);

    if (pathname === '/shell') {
        ws.close(1008, 'Shell access is disabled');
    } else if (pathname === '/ws') {
        handleChatConnection(ws, request);
    } else {
        console.log('[WARN] Unknown WebSocket path:', pathname);
        ws.close();
    }
});

/**
 * WebSocket Writer - Wrapper for WebSocket to match SSEStreamWriter interface
 */
class WebSocketWriter {
  constructor(ws, telemetryContext = null) {
    this.ws = ws;
    this.sessionId = null;
    this.isWebSocketWriter = true;  // Marker for transport detection
    this.telemetryContext = telemetryContext;
    this.projectPath = null;
  }

  send(data) {
    if (this.ws.readyState === 1) { // WebSocket.OPEN
      // Providers send raw objects, we stringify for WebSocket
      this.ws.send(JSON.stringify(data));
      trackAgentResponseTelemetry(data, this.telemetryContext);
    }
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  setProjectPath(projectPath) {
    this.projectPath = projectPath;
  }

  getSessionId() {
    return this.sessionId;
  }

  getProjectPath() {
    return this.projectPath;
  }
}

function createSessionExecutionMemoryBridge({ provider, projectPath, sessionId, currentObjective, taskContext, onPipelineStateChanged }) {
    const tracker = createExecutionMemoryTracker({
        scope: 'session',
        projectPath,
        provider,
        sessionId,
        currentObjective,
        currentTaskId: taskContext?.id != null ? String(taskContext.id) : undefined,
        currentTaskTitle: taskContext?.title || undefined,
        stage: taskContext?.stage || undefined,
        onPipelineStateChanged,
    });

    return {
        tracker,
        wrap(baseWriter) {
            return wrapWriterWithExecutionMemory(baseWriter, tracker);
        },
    };
}

function isResearchBriefControlPath(filePath) {
    const normalized = String(filePath || '').trim().replace(/\\/g, '/').toLowerCase();
    return normalized === '.pipeline/docs/research_brief.json';
}

function createExecutionMemorySyncBroadcaster(wss, projectName, projectPath) {
    if (!wss || !projectName) {
        return null;
    }

    return async (syncResult) => {
        let taskPlanSync = null;
        if (projectPath && syncResult?.type === 'pipeline_control_file_touched' && isResearchBriefControlPath(syncResult?.path)) {
            try {
                taskPlanSync = await syncTasksWithResearchBrief(projectPath, { mode: 'merge' });
            } catch (error) {
                console.warn('[ExecutionMemory] Failed to reconcile tasks after research brief update:', error?.message || error);
            }
        }
        broadcastTaskMasterProjectUpdate(wss, projectName, {
            status: 'execution-memory-synced',
            stage: syncResult?.stage || null,
            taskPlanSync: taskPlanSync?.synced ? taskPlanSync.reason || 'merge' : null,
        });
        broadcastTaskMasterTasksUpdate(wss, projectName);
    };
}

async function finalizeInteractiveTaskRun({
    executionMemoryBridge,
    projectPath,
    projectName,
    provider,
    sessionId,
    taskContext,
    wss,
}) {
    if (!executionMemoryBridge?.tracker || !projectPath || !taskContext?.id) {
        return;
    }

    try {
        const tracker = executionMemoryBridge.tracker;
        await tracker.refreshSummaries();
        const scopeRef = tracker.getScopeRef ? tracker.getScopeRef() : {
            scope: 'session',
            projectPath,
            provider,
            sessionId: sessionId || null,
            currentTaskId: String(taskContext.id),
            currentTaskTitle: taskContext.title || null,
            stage: taskContext.stage || null,
        };
        const snapshot = await readExecutionMemorySnapshot(scopeRef, { ledgerLimit: 400 });
        await syncExecutionMemoryToTasks(scopeRef, { snapshot });
    } catch (error) {
        console.warn('[ExecutionMemory] Final interactive task reconciliation failed:', error?.message || error);
    } finally {
        if (wss && projectName) {
            broadcastTaskMasterTasksUpdate(wss, projectName);
        }
    }
}

async function captureProjectResearchLessons({ wss, projectName, projectPath, provider, sessionId, command, taskContext }) {
    if (!projectPath || typeof command !== 'string' || !command.trim()) {
        return null;
    }

    const result = await captureResearchLessonsFromText(projectPath, command, {
        provider,
        sessionId,
        stage: taskContext?.stage || null,
        taskId: taskContext?.id != null ? String(taskContext.id) : null,
        taskTitle: taskContext?.title || null,
        source: 'user_command',
    });

    if (result?.synced && wss && projectName) {
        broadcastTaskMasterProjectUpdate(wss, projectName, {
            status: 'research-lessons-updated',
            lessonCount: result.items.length,
        });
    }

    return result;
}

function enqueueConversationTelemetry(event, context = {}) {
    if (context.telemetryEnabled === false) {
        return;
    }
    enqueueTelemetryEvent({
        source: 'chat-websocket',
        ...context,
        ...event,
        receivedAt: new Date().toISOString(),
    });
}

function hasAgentResponseContent(payload) {
    if (!payload || typeof payload !== 'object') {
        return false;
    }

    if (payload.type === 'claude-response') {
        const data = payload.data;
        if (!data || typeof data !== 'object') {
            return false;
        }

        if (typeof data.content === 'string' && data.content.trim()) {
            return true;
        }

        if (Array.isArray(data.content)) {
            return data.content.some((part) => part?.type === 'text' && typeof part?.text === 'string' && part.text.trim());
        }

        return false;
    }

    return false;
}

function trackAgentResponseTelemetry(payload, context = {}) {
    if (context.telemetryEnabled === false) {
        return;
    }
    if (context.provider === 'claude' && payload?.type === 'claude-response') {
        const streamData = payload.data;
        const sessionKey = `${context.provider}:${payload.sessionId || 'pending'}`;

        if (streamData?.type === 'content_block_delta' && typeof streamData?.delta?.text === 'string') {
            trackAgentResponseTelemetry.streamBuffers.set(sessionKey, true);
            return;
        }

        if (streamData?.type === 'content_block_stop') {
            const hasContent = trackAgentResponseTelemetry.streamBuffers.get(sessionKey);
            if (hasContent) {
                enqueueConversationTelemetry(
                    {
                        name: 'agent_dialogue_meta',
                        direction: 'agent_to_user',
                        provider: context.provider || 'unknown',
                        sessionId: payload.sessionId || context.sessionId || null,
                        transportType: payload.type || 'unknown',
                    },
                    context,
                );
            }
            trackAgentResponseTelemetry.streamBuffers.delete(sessionKey);
            return;
        }
    }

    if (!hasAgentResponseContent(payload)) {
        return;
    }

    enqueueConversationTelemetry(
        {
            name: 'agent_dialogue_meta',
            direction: 'agent_to_user',
            provider: context.provider || 'unknown',
            sessionId: payload.sessionId || context.sessionId || null,
            transportType: payload.type || 'unknown',
        },
        context,
    );
}
trackAgentResponseTelemetry.streamBuffers = new Map();

// Handle chat WebSocket connections
function handleChatConnection(ws, request) {
    console.log('[INFO] Chat WebSocket connected');

    const user = request?.user || {};
    const userId = user.userId || user.id || null;
    ws.authUserId = userId;

    // Add to connected clients for project updates
    connectedClients.add(ws);

    const telemetryContext = {
        userId: userId,
        username: user.username || null,
        clientType: 'websocket',
        telemetryEnabled: true,
    };

    // Wrap WebSocket with writer for consistent interface with SSEStreamWriter
    const writer = new WebSocketWriter(ws, telemetryContext);
    // Track sessions started over this websocket so we can abort them if the client disconnects.
    const wsSessionIds = new Set();
    const originalSetSessionId = writer.setSessionId.bind(writer);
    writer.setSessionId = (sessionId) => {
        // Track only real provider session IDs for abort-on-disconnect.
        // UI uses temporary ids like `new-session-*` before the provider returns a real session id.
        if (sessionId && !String(sessionId).startsWith('new-session-')) wsSessionIds.add(sessionId);
        originalSetSessionId(sessionId);
    };

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`[DEBUG] Received WebSocket message: ${data.type}`);
            
            if (data.type === 'telemetry-settings') {
                const enabled = data.enabled !== false;
                writer.telemetryContext = {
                    ...(writer.telemetryContext || telemetryContext),
                    telemetryEnabled: enabled,
                };
            } else if (data.type === 'claude-command') {
                console.log('[DEBUG] User message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.projectPath || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
                const commandTelemetryEnabled = data.options?.telemetryEnabled !== false;
                const userScopedToolSettings = userId
                    ? agentToolPermissionsDb.getForUser(userId, 'claude')
                    : (data.options?.toolsSettings || {
                        allowedTools: [],
                        disallowedTools: [],
                        skipPermissions: false,
                    });
                enqueueConversationTelemetry(
                    {
                        name: 'agent_dialogue_meta',
                        direction: 'user_to_agent',
                        provider: 'claude',
                        sessionId: data.options?.sessionId || data.sessionId || null,
                        projectPath: data.options?.projectPath || data.options?.cwd || null,
                        transportType: data.type,
                    },
                    { ...telemetryContext, telemetryEnabled: commandTelemetryEnabled },
                );
                writer.telemetryContext = { ...telemetryContext, provider: 'claude', telemetryEnabled: commandTelemetryEnabled };

                // Use Claude Agents SDK
                const sessionId = data.options?.sessionId || data.sessionId;
                const clientSessionId = data.options?.clientSessionId || data.clientSessionId || null;
                const projectPath = data.options?.projectPath || data.options?.cwd || null;
                const projectName = data.options?.projectName || null;
                const executionMemorySessionId = sessionId || (
                    clientSessionId && String(clientSessionId).startsWith('new-session-')
                        ? clientSessionId
                        : null
                );
                const executionMemoryBridge = createSessionExecutionMemoryBridge({
                    provider: 'claude',
                    projectPath,
                    sessionId: executionMemorySessionId,
                    currentObjective: data.command || null,
                    taskContext: data.options?.taskContext || null,
                    onPipelineStateChanged: createExecutionMemorySyncBroadcaster(wss, projectName, projectPath),
                });
                const runtimeWriter = executionMemoryBridge.wrap(writer);
                runtimeWriter.setProjectPath(projectPath);
                if (!sessionId && clientSessionId && String(clientSessionId).startsWith('new-session-')) {
                    // Allow frontend to receive/route early streaming output before Claude provides a real session_id.
                    // This does NOT represent a resumable provider session.
                    runtimeWriter.setSessionId(clientSessionId);
                }
                if (sessionId && isClaudeSDKSessionActive(sessionId)) {
                    console.log(`[WARN] Session ${sessionId} is already active. Ignoring concurrent request.`);
                    runtimeWriter.send({
                        type: 'claude-error',
                        error: `Session ${sessionId} is already processing on another connection. Stop it first, then retry.`,
                        errorType: 'CONCURRENT_SESSION',
                        isRetryable: true,
                        sessionId
                    });
                    return;
                }

                const researchAwareCommand = await buildResearchAwarePromptPrefix(
                    {
                        scope: 'session',
                        projectPath,
                        provider: 'claude',
                        sessionId: executionMemorySessionId,
                        stage: data.options?.taskContext?.stage || null,
                    },
                    data.command,
                    {
                        fallbackCommand: 'Continue from the latest confirmed execution state.',
                        taskContext: data.options?.taskContext || null,
                    },
                );
                await captureProjectResearchLessons({
                    wss,
                    projectName,
                    projectPath,
                    provider: 'claude',
                    sessionId: executionMemorySessionId,
                    command: data.command,
                    taskContext: data.options?.taskContext || null,
                });

                queryClaudeSDK(researchAwareCommand, {
                    ...data.options,
                    toolsSettings: userScopedToolSettings,
                    clientSessionId,
                    env: process.env,
                    userId,
                }, runtimeWriter)
                    .catch(error => {
                        console.error('[ERROR] Claude query error:', error);
                    })
                    .finally(() => {
                        void finalizeInteractiveTaskRun({
                            executionMemoryBridge,
                            projectPath,
                            projectName,
                            provider: 'claude',
                            sessionId: executionMemorySessionId,
                            taskContext: data.options?.taskContext || null,
                            wss,
                        });
                    });
            } else if (data.type === 'abort-session') {
                console.log('[DEBUG] Abort session request:', data.sessionId);
                const provider = 'claude';
                const success = await abortClaudeSDKSession(data.sessionId);

                writer.send({
                    type: 'session-aborted',
                    sessionId: data.sessionId,
                    provider,
                    success
                });
            } else if (data.type === 'claude-permission-response') {
                if (data.rememberEntry && data.allow && userId) {
                    try {
                        agentToolPermissionsDb.grantAllowedTool(userId, 'claude', data.rememberEntry);
                    } catch (error) {
                        console.warn('[WARN] Failed to persist remembered Claude permission:', error.message);
                    }
                }

                // Relay UI approval decisions back into the SDK control flow.
                if (data.requestId) {
                    resolveToolApproval(data.requestId, {
                        allow: Boolean(data.allow),
                        updatedInput: data.updatedInput,
                        message: data.message,
                        rememberEntry: data.rememberEntry
                    });
                }
            } else if (data.type === 'check-session-status') {
                // Check if a specific Claude session is currently processing
                const provider = 'claude';
                const sessionId = data.sessionId;
                const isActive = isClaudeSDKSessionActive(sessionId);
                const startTime = getClaudeSDKSessionStartTime(sessionId);

                writer.send({
                    type: 'session-status',
                    sessionId,
                    provider,
                    isProcessing: isActive,
                    startTime
                });
            } else if (data.type === 'get-active-sessions') {
                const activeSessions = {
                    claude: getActiveClaudeSDKSessions(),
                };

                writer.send({
                    type: 'active-sessions',
                    sessions: activeSessions
                });
            }
        } catch (error) {
            console.error('[ERROR] Chat WebSocket error:', error.message);
            writer.send({
                type: 'error',
                error: error.message
            });
        }
    });

    ws.on('close', () => {
        console.log('🔌 Chat client disconnected');
        // Remove from connected clients
        connectedClients.delete(ws);
        if (connectedClients.size === 0) {
            lastProjectsUpdateSignatures.clear();
        }
        // Best-effort: abort any Claude sessions started over this websocket so we don't
        // leave orphaned streams that can never deliver output back to the user.
        for (const sessionId of wsSessionIds) {
            try {
                if (sessionId && isClaudeSDKSessionActive(sessionId)) {
                    abortClaudeSDKSession(sessionId).catch(() => {});
                }
            } catch {
                // ignore
            }
        }
    });
}

// Audio transcription endpoint
app.post('/api/transcribe', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const upload = multer({ storage: multer.memoryStorage() });

        // Handle multipart form data
        upload.single('audio')(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: 'Failed to process audio file' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No audio file provided' });
            }

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in server environment.' });
            }

            try {
                // Create form data for OpenAI
                const FormData = (await import('form-data')).default;
                const formData = new FormData();
                formData.append('file', req.file.buffer, {
                    filename: req.file.originalname,
                    contentType: req.file.mimetype
                });
                formData.append('model', 'whisper-1');
                formData.append('response_format', 'json');
                formData.append('language', 'en');

                // Make request to OpenAI
                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        ...formData.getHeaders()
                    },
                    body: formData
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
                }

                const data = await response.json();
                let transcribedText = data.text || '';

                // Check if enhancement mode is enabled
                const mode = req.body.mode || 'default';

                // If no transcribed text, return empty
                if (!transcribedText) {
                    return res.json({ text: '' });
                }

                // If default mode, return transcribed text without enhancement
                if (mode === 'default') {
                    return res.json({ text: transcribedText });
                }

                // Handle different enhancement modes
                try {
                    const OpenAI = (await import('openai')).default;
                    const openai = new OpenAI({ apiKey });

                    let prompt, systemMessage, temperature = 0.7, maxTokens = 800;

                    switch (mode) {
                        case 'prompt':
                            systemMessage = 'You are an expert prompt engineer who creates clear, detailed, and effective prompts.';
                            prompt = `You are an expert prompt engineer. Transform the following rough instruction into a clear, detailed, and context-aware AI prompt.

Your enhanced prompt should:
1. Be specific and unambiguous
2. Include relevant context and constraints
3. Specify the desired output format
4. Use clear, actionable language
5. Include examples where helpful
6. Consider edge cases and potential ambiguities

Transform this rough instruction into a well-crafted prompt:
"${transcribedText}"

Enhanced prompt:`;
                            break;

                        case 'vibe':
                        case 'instructions':
                        case 'architect':
                            systemMessage = 'You are a helpful assistant that formats ideas into clear, actionable instructions for AI agents.';
                            temperature = 0.5; // Lower temperature for more controlled output
                            prompt = `Transform the following idea into clear, well-structured instructions that an AI agent can easily understand and execute.

IMPORTANT RULES:
- Format as clear, step-by-step instructions
- Add reasonable implementation details based on common patterns
- Only include details directly related to what was asked
- Do NOT add features or functionality not mentioned
- Keep the original intent and scope intact
- Use clear, actionable language an agent can follow

Transform this idea into agent-friendly instructions:
"${transcribedText}"

Agent instructions:`;
                            break;

                        default:
                            // No enhancement needed
                            break;
                    }

                    // Only make GPT call if we have a prompt
                    if (prompt) {
                        const completion = await openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                { role: 'system', content: systemMessage },
                                { role: 'user', content: prompt }
                            ],
                            temperature: temperature,
                            max_tokens: maxTokens
                        });

                        transcribedText = completion.choices[0].message.content || transcribedText;
                    }

                } catch (gptError) {
                    console.error('GPT processing error:', gptError);
                    // Fall back to original transcription if GPT fails
                }

                res.json({ text: transcribedText });

            } catch (error) {
                console.error('Transcription error:', error);
                res.status(500).json({ error: error.message });
            }
        });
    } catch (error) {
        console.error('Endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Image upload endpoint
app.post('/api/projects/:projectName/upload-images', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const path = (await import('path')).default;
        const fs = (await import('fs')).promises;
        const os = (await import('os')).default;

        // Configure multer for image uploads
        const storage = multer.diskStorage({
            destination: async (req, file, cb) => {
                const uploadDir = path.join(os.tmpdir(), 'claude-ui-uploads', String(req.user.id));
                await fs.mkdir(uploadDir, { recursive: true });
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                cb(null, uniqueSuffix + '-' + sanitizedName);
            }
        });

        const upload = multer({
            storage,
            limits: {
                fileSize: 10 * 1024 * 1024, // 10MB
                files: 5
            }
        });

        // Handle multipart form data
        upload.array('images', 5)(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No files provided' });
            }

            try {
                // Process uploaded images
                const processedImages = await Promise.all(
                    req.files.map(async (file) => {
                        // Read file and convert to base64
                        const buffer = await fs.readFile(file.path);
                        const base64 = buffer.toString('base64');
                        const mimeType = file.mimetype;

                        // Clean up temp file immediately
                        await fs.unlink(file.path);

                        return {
                            name: file.originalname,
                            data: `data:${mimeType};base64,${base64}`,
                            size: file.size,
                            mimeType: mimeType
                        };
                    })
                );

                res.json({ images: processedImages });
            } catch (error) {
                console.error('Error processing images:', error);
                // Clean up any remaining files
                await Promise.all(req.files.map(f => fs.unlink(f.path).catch(() => { })));
                res.status(500).json({ error: 'Failed to process images' });
            }
        });
    } catch (error) {
        console.error('Error in image upload endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get token usage for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/token-usage', authenticateToken, async (req, res) => {
  try {
    const { projectName, sessionId } = req.params;
    const { provider = 'claude' } = req.query;
    const homeDir = os.homedir();

    if (provider !== 'claude') {
      return res.status(400).json({ error: 'provider must be "claude"' });
    }

    // Allow only safe characters in sessionId
    const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safeSessionId) {
      return res.status(400).json({ error: 'Invalid sessionId' });
    }

    // Handle Claude sessions.
    // Extract actual project path
    let projectPath;
    try {
      projectPath = await extractProjectDirectory(projectName);
    } catch (error) {
      console.error('Error extracting project directory:', error);
      return res.status(500).json({ error: 'Failed to determine project path' });
    }

    // Construct the JSONL file path
    // Claude stores session files in ~/.claude/projects/[encoded-project-path]/[session-id].jsonl
    // The encoding replaces /, spaces, ~, and _ with -
    const encodedPath = projectPath.replace(/[\\/:\s~_]/g, '-');
    const projectDir = path.join(homeDir, '.claude', 'projects', encodedPath);

    const jsonlPath = path.join(projectDir, `${safeSessionId}.jsonl`);

    // Constrain to projectDir
    const rel = path.relative(path.resolve(projectDir), path.resolve(jsonlPath));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Read and parse the JSONL file
    let fileContent;
    try {
      fileContent = await fsPromises.readFile(jsonlPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Session file not found', path: jsonlPath });
      }
      throw error; // Re-throw other errors to be caught by outer try-catch
    }
    const lines = fileContent.trim().split('\n');

    let inputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let modelName = null;

    // Find the latest assistant message with usage data (scan from end)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);

        // Only count assistant messages which have usage data
        if (entry.type === 'assistant' && entry.message?.usage) {
          const usage = entry.message.usage;

          // Use token counts from latest assistant message only
          inputTokens = usage.input_tokens || 0;
          cacheCreationTokens = usage.cache_creation_input_tokens || 0;
          cacheReadTokens = usage.cache_read_input_tokens || 0;
          modelName = entry.message.model || null;

          break; // Stop after finding the latest assistant message
        }
      } catch (parseError) {
        // Skip lines that can't be parsed
        continue;
      }
    }

    // Priority: env var override > model-based lookup > default
    const parsedContextWindow = parseInt(process.env.CONTEXT_WINDOW, 10);
    let contextWindow;
    if (Number.isFinite(parsedContextWindow)) {
      contextWindow = parsedContextWindow;
    } else if (modelName) {
      contextWindow = getContextWindowForModel(modelName);
    } else {
      contextWindow = getConfiguredContextWindow(process.env.CONTEXT_WINDOW);
    }

    // Calculate total context usage (excluding output_tokens, as per ccusage)
    const totalUsed = inputTokens + cacheCreationTokens + cacheReadTokens;

    res.json({
      used: totalUsed,
      total: contextWindow,
      model: modelName,
      breakdown: {
        input: inputTokens,
        cacheCreation: cacheCreationTokens,
        cacheRead: cacheReadTokens
      }
    });
  } catch (error) {
    console.error('Error reading session token usage:', error);
    res.status(500).json({ error: 'Failed to read session token usage' });
  }
});

// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
  // Skip requests for static assets (files with extensions)
  if (path.extname(req.path)) {
    return res.status(404).send('Not found');
  }

  // Only serve index.html for HTML routes, not for static assets
  // Static assets should already be handled by express.static middleware above
  const indexPath = path.join(__dirname, '../dist/index.html');

  // Check if dist/index.html exists (production build available)
  if (fs.existsSync(indexPath)) {
    // Set no-cache headers for HTML to prevent service worker issues
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(indexPath);
  } else {
    // In development, redirect to Vite dev server only if dist doesn't exist
    res.redirect(`http://${DISPLAY_HOST}:${getFrontendPortSync(REQUESTED_VITE_PORT)}`);
  }
});

// Helper function to convert permissions to rwx format
function permToRwx(perm) {
    const r = perm & 4 ? 'r' : '-';
    const w = perm & 2 ? 'w' : '-';
    const x = perm & 1 ? 'x' : '-';
    return r + w + x;
}

function isPathInsideOrEqual(parentPath, childPath) {
    const parent = path.resolve(parentPath);
    const child = path.resolve(childPath);
    return child === parent || child.startsWith(parent + path.sep);
}

function getProjectRelativePath(projectRoot, targetPath) {
    const relativePath = path.relative(path.resolve(projectRoot), path.resolve(targetPath));
    return normalizeProjectRelativePath(relativePath);
}

function includeInternalProjectFiles(req) {
    return ['1', 'true', 'yes', 'on'].includes(String(req.query.includeInternal || '').toLowerCase());
}

function assertPublicProjectPath(projectRoot, targetPath, { includeInternal = false } = {}) {
    if (!isPathInsideOrEqual(projectRoot, targetPath)) {
        const error = new Error('Path must be under project root');
        error.statusCode = 403;
        throw error;
    }

    const relativePath = getProjectRelativePath(projectRoot, targetPath);
    if (!includeInternal && isInternalProjectPath(relativePath)) {
        const error = new Error('Internal project files are not available from the file browser');
        error.statusCode = 404;
        throw error;
    }
}

async function assertReadableProjectPath(projectRoot, targetPath, { includeInternal = false } = {}) {
    assertPublicProjectPath(projectRoot, targetPath, { includeInternal });

    const realProjectRoot = await fsPromises.realpath(projectRoot);
    const realTargetPath = await fsPromises.realpath(targetPath);
    if (!isPathInsideOrEqual(realProjectRoot, realTargetPath)) {
        const error = new Error('Resolved path must stay under project root');
        error.statusCode = 403;
        throw error;
    }
}

async function assertWritableProjectPath(projectRoot, targetPath, { includeInternal = false } = {}) {
    assertPublicProjectPath(projectRoot, targetPath, { includeInternal });

    const realProjectRoot = await fsPromises.realpath(projectRoot);
    try {
        const realTargetPath = await fsPromises.realpath(targetPath);
        if (!isPathInsideOrEqual(realProjectRoot, realTargetPath)) {
            const error = new Error('Resolved path must stay under project root');
            error.statusCode = 403;
            throw error;
        }
        return;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    const realParentPath = await fsPromises.realpath(path.dirname(targetPath));
    if (!isPathInsideOrEqual(realProjectRoot, realParentPath)) {
        const error = new Error('Parent directory must stay under project root');
        error.statusCode = 403;
        throw error;
    }
}

async function findAllFilesInProject(projectRoot, fileName, maxDepth = 10) {
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);
    const results = [];
    const queue = [[projectRoot, 0]];

    while (queue.length > 0) {
        const [dirPath, depth] = queue.shift();
        let entries;
        try {
            entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
        } catch { continue; }

        for (const entry of entries) {
            const entryPath = path.join(dirPath, entry.name);
            if (entry.isSymbolicLink()) {
                continue;
            }

            let isDir = entry.isDirectory();

            if (entry.name === fileName && !isDir) {
                results.push(entryPath);
                if (results.length >= 20) return results;
            }
            if (isDir && !SKIP_DIRS.has(entry.name)
                && depth < maxDepth) {
                queue.push([entryPath, depth + 1]);
            }
        }
    }
    return results;
}

async function resolveProjectFilePath(projectRoot, inputPath, { includeInternal = false } = {}) {
    inputPath = normalizeProjectFileRequestPath(inputPath);
    if (!inputPath || typeof inputPath !== 'string') return { resolved: path.resolve(projectRoot, '') };
    const resolvedProjectRoot = path.resolve(projectRoot);
    if (path.isAbsolute(inputPath)) {
        const absoluteInput = path.resolve(inputPath);
        if (absoluteInput === resolvedProjectRoot || absoluteInput.startsWith(resolvedProjectRoot + path.sep)) {
            try {
                await fsPromises.access(absoluteInput);
                return { resolved: absoluteInput };
            } catch { /* project-scoped absolute path not found; try relative fallback below */ }

            const projectRelativeInput = path.relative(resolvedProjectRoot, absoluteInput);
            if (projectRelativeInput && !projectRelativeInput.startsWith('..') && !path.isAbsolute(projectRelativeInput)) {
                return resolveProjectFilePath(resolvedProjectRoot, projectRelativeInput, { includeInternal });
            }
        }
        return { resolved: absoluteInput };
    }

    const direct = path.resolve(resolvedProjectRoot, inputPath);
    const isSimpleName = !inputPath.includes('/') && !inputPath.includes('\\');

    // For paths with separators (e.g. "src/main.tsx"), check direct first, then search
    if (!isSimpleName) {
        try {
            await fsPromises.access(direct);
            return { resolved: direct };
        } catch { /* not found at direct path */ }

        // Search for the filename, then filter matches ending with the partial path
        const fileName = path.basename(inputPath);
        const normalizedInput = inputPath.split(path.sep).join('/');
        const matches = await findAllFilesInProject(projectRoot, fileName);
        const filtered = matches.filter(m => {
            const rel = path.relative(projectRoot, m).split(path.sep).join('/');
            if (!includeInternal && isInternalProjectPath(rel)) return false;
            return rel === normalizedInput || rel.endsWith('/' + normalizedInput);
        });

        if (filtered.length === 1) {
            return { resolved: filtered[0] };
        }
        if (filtered.length > 1) {
            return {
                resolved: null,
                candidates: filtered.map(m => path.relative(projectRoot, m))
            };
        }

        return { resolved: direct };
    }

    // 1. Hardcoded pipeline fallbacks
    const fallbackMap = {
        'research_brief.json': '.pipeline/docs/research_brief.json',
        'tasks.json': '.pipeline/tasks/tasks.json',
        'pipeline_config.json': '.pipeline/config.json'
    };
    const mapped = fallbackMap[inputPath];
    if (mapped && includeInternal) return { resolved: path.resolve(projectRoot, mapped) };

    // 2. If the file exists at project root, use it
    try {
        await fsPromises.access(direct);
        return { resolved: direct };
    } catch { /* not at root */ }

    // 3. Search project tree
    const matches = (await findAllFilesInProject(projectRoot, inputPath))
        .filter((matchPath) => includeInternal || !isInternalProjectPath(path.relative(projectRoot, matchPath)));
    if (matches.length === 1) {
        return { resolved: matches[0] };
    }
    if (matches.length > 1) {
        return {
            resolved: null,
            candidates: matches.map(m => path.relative(projectRoot, m))
        };
    }

    // 4. No match — fall back to direct path (will 404)
    return { resolved: direct };
}

function normalizeProjectFileRequestPath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') return '';
    let value = String(inputPath).trim().replace(/^<(.+)>$/, '$1').trim();
    if (!value) return '';

    if (/^file:\/\//i.test(value)) {
        try {
            const fileUrl = new URL(value);
            value = decodeURIComponent(fileUrl.pathname);
            if (/^\/[A-Za-z]:[\\/]/.test(value)) {
                value = value.slice(1);
            }
        } catch {
            value = value.replace(/^file:\/\//i, '');
        }
    } else {
        try {
            value = decodeURI(value);
        } catch {
            // Keep the original value if it is not valid URI-encoded text.
        }
    }

    value = value.replace(/[?#].*$/, '').trim();
    const lineMatch = value.match(/^(.*\.[A-Za-z0-9][A-Za-z0-9_-]{0,15})(?::\d+(?::\d+)?)$/);
    return (lineMatch?.[1] || value).trim();
}

async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true, isBrowsing = false, options = {}) {
    // Using fsPromises from import
    const items = [];
    const projectRoot = path.resolve(options.projectRoot || dirPath);
    const includeInternal = Boolean(options.includeInternal);

    try {
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            // Debug: log all entries including hidden files
            if (!showHidden && entry.name.startsWith('.')) continue;

            const itemPath = path.join(dirPath, entry.name);
            const relativePath = getProjectRelativePath(projectRoot, itemPath);
            if (!includeInternal && isInternalProjectPath(relativePath)) continue;

            if (entry.isSymbolicLink()) continue;

            // Skip heavy build directories and VCS directories unless we are browsing
            if (!isBrowsing && (
                entry.name === 'node_modules' ||
                entry.name === 'dist' ||
                entry.name === 'build' ||
                entry.name === '.git' ||
                entry.name === '.svn' ||
                entry.name === '.hg'
            )) continue;

            let isDirectory = entry.isDirectory();

            const item = {
                name: entry.name,
                path: itemPath,
                type: isDirectory ? 'directory' : 'file'
            };

            // Get file stats for additional metadata
            try {
                const stats = await fsPromises.stat(itemPath);
                item.size = stats.size;
                item.modified = stats.mtime.toISOString();

                // Convert permissions to rwx format
                const mode = stats.mode;
                const ownerPerm = (mode >> 6) & 7;
                const groupPerm = (mode >> 3) & 7;
                const otherPerm = mode & 7;
                item.permissions = ((mode >> 6) & 7).toString() + ((mode >> 3) & 7).toString() + (mode & 7).toString();
                item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
            } catch (statError) {
                // If stat fails, provide default values
                item.size = 0;
                item.modified = null;
                item.permissions = '000';
                item.permissionsRwx = '---------';
            }

            if (isDirectory && currentDepth < maxDepth) {
                // Recursively get subdirectories but limit depth
                try {
                    // Check if we can access the directory before trying to read it
                    await fsPromises.access(item.path, fs.constants.R_OK);
                    item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden, isBrowsing, {
                        projectRoot,
                        includeInternal,
                    });
                } catch (e) {
                    // Silently skip directories we can't access (permission denied, etc.)
                    item.children = [];
                }
            }

            items.push(item);
        }
    } catch (error) {
        // Only log non-permission errors to avoid spam
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
            console.error('Error reading directory:', error);
        }
    }

    return items.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}

const REQUESTED_PORT = parsePortNumber(process.env.PORT, DEFAULT_BACKEND_PORT);
const REQUESTED_VITE_PORT = parsePortNumber(process.env.VITE_PORT, DEFAULT_FRONTEND_PORT);
const HOST = process.env.HOST || '127.0.0.1';
// Show localhost when binding to all interfaces; 0.0.0.0 is not directly connectable.
const DISPLAY_HOST = HOST === '0.0.0.0' ? 'localhost' : HOST;
const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;
let serverStartPromise = null;
let serverStopPromise = null;

function isExposedHost(host) {
    const normalized = String(host || '').trim().toLowerCase();
    return normalized === '0.0.0.0' || normalized === '::' || normalized === '[::]';
}

function hasPublicUrlConfigured() {
    return Boolean(process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.MEDHELP_PUBLIC_URL);
}

function assertSecureDeploymentConfig() {
    if (IS_PLATFORM) {
        return;
    }

    if ((isExposedHost(HOST) || hasPublicUrlConfigured()) && isUsingDefaultJwtSecret()) {
        throw new Error(
            'JWT_SECRET must be set before exposing MedHelp on a network. Generate a strong value and set JWT_SECRET in the server environment.'
        );
    }
}

// Initialize database and start server
export async function startServer() {
    if (serverStartPromise) {
        return serverStartPromise;
    }

    serverStartPromise = (async () => {
        try {
            // Initialize authentication database
            await initializeDatabase();

            // Check if running in production mode (dist folder exists)
            const distIndexPath = path.join(__dirname, '../dist/index.html');
            const isProduction = fs.existsSync(distIndexPath);
            assertSecureDeploymentConfig();

            // Log Claude implementation mode
            console.log(`${c.info('[INFO]')} Using Claude Agents SDK for Claude integration`);
            console.log(`${c.info('[INFO]')} Running in ${c.bright(isProduction ? 'PRODUCTION' : 'DEVELOPMENT')} mode`);

            if (!isProduction) {
                console.log(`${c.warn('[WARN]')} Note: Requests will be proxied to Vite dev server at ${c.dim('http://' + DISPLAY_HOST + ':' + getFrontendPortSync(REQUESTED_VITE_PORT))}`);
            }

            const activePort = await listenOnAvailablePort(server, {
                startPort: REQUESTED_PORT,
                host: HOST,
            });
            setRuntimePortSync('backend', activePort);

            const appInstallPath = path.join(__dirname, '..');
            const vitePort = getFrontendPortSync(REQUESTED_VITE_PORT);

            if (activePort !== REQUESTED_PORT) {
                console.log(`${c.warn('[WARN]')} Port ${REQUESTED_PORT} is busy, switched backend to ${activePort}`);
            }

            console.log('');
            console.log(c.dim('═'.repeat(63)));
            console.log(`  ${c.bright('medautodata Server - Ready')}`);
            console.log(c.dim('═'.repeat(63)));
            console.log('');

            if (isProduction) {
                console.log(`${c.info('[INFO]')} Server URL:  ${c.bright('http://' + DISPLAY_HOST + ':' + activePort)}`);
            } else {
                console.log(`${c.info('[INFO]')} Backend URL: ${c.dim('http://' + DISPLAY_HOST + ':' + activePort)}`);
                console.log(`${c.ok('[OK]')}   Frontend URL: ${c.bright('http://' + DISPLAY_HOST + ':' + vitePort)} (Use this for development)`);
            }

            console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
            console.log(`${c.tip('[TIP]')}  Run "medautodata status" for full configuration details`);
            console.log('');

            // Ensure the workspaces root directory exists
            const startupWorkspaceRoot = await getWorkspacesRoot();
            await fsPromises.mkdir(startupWorkspaceRoot, { recursive: true });

            // Start watching the projects folder for changes
            await setupProjectsWatcher();
            await setupTaskMasterTasksWatcher();
            startSurveillanceScheduler();
            console.log('[surveillance] living-update scheduler started (hourly tick)');

            return {
                server,
                activePort,
                host: DISPLAY_HOST,
                isProduction,
            };
        } catch (error) {
            serverStartPromise = null;
            console.error('[ERROR] Failed to start server:', error);
            if (isDirectExecution) {
                process.exit(1);
            }
            throw error;
        }
    })();

    return serverStartPromise;
}

export async function stopServer() {
    if (!serverStartPromise) {
        return;
    }

    if (serverStopPromise) {
        return serverStopPromise;
    }

    serverStopPromise = (async () => {
        if (projectsWatcherDebounceTimer) {
            clearTimeout(projectsWatcherDebounceTimer);
            projectsWatcherDebounceTimer = null;
        }

        await Promise.all(
            projectsWatchers.map(async (watcher) => {
                try {
                    await watcher.close();
                } catch (error) {
                    console.error('[WARN] Failed to close watcher during shutdown:', error);
                }
            })
        );
        projectsWatchers = [];

        if (taskmasterTasksWatcher) {
            try {
                await taskmasterTasksWatcher.close();
            } catch (error) {
                console.error('[WARN] Failed to close TaskMaster tasks watcher during shutdown:', error);
            }
            taskmasterTasksWatcher = null;
        }
        registeredTaskMasterProjectPaths.clear();
        recentTaskMasterTaskFileBroadcasts.clear();
        llmOAuthService.dispose();

        await abortActiveInteractiveSessions();
        await closeAllWebSocketClients();

        if (server.listening) {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
        }

        if (typeof server.closeIdleConnections === 'function') {
            server.closeIdleConnections();
        }
        if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
        }

        serverStartPromise = null;
        serverStopPromise = null;
    })();

    return serverStopPromise;
}

if (isDirectExecution) {
    startServer();
}
