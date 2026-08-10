/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  getConfiguredContextWindow,
  resolveClaudeModelSelection,
} from '../shared/modelConstants.js';
import { classifyError, classifySDKError } from '../shared/errorClassifier.js';
import { encodeProjectPath, ensureProjectSkillLinks, reconcileClaudeSessionIndex } from './projects.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { buildTempAttachmentFilename } from './utils/imageAttachmentFiles.js';
import { buildSessionDisplayName } from './utils/sessionFormatting.js';
import { prependUserPreferenceMemoryToPrompt } from './utils/userPreferenceMemory.js';
import { buildAgentSessionEnv } from './utils/agentSessionEnv.js';
import { getManagedEnvKeys } from './services/providerRuntimeEnv.js';
import { MEDHELP_ASSISTANT_IDENTITY_SYSTEM_PROMPT } from './utils/assistantIdentity.js';
import { resolveClaudeCodeExecutableInfo } from './utils/claudeCodeExecutable.js';
import {
  nextWithInactivityTimeout,
  resolveInactivityTimeoutMs,
} from './utils/streamInactivity.js';

import { createRequestId, waitForToolApproval, resolveToolApproval as resolvePermApproval, matchesToolPermission } from './utils/permissions.js';

const activeSessions = new Map();
const pendingClaudeSessionIndexReconciles = new Map();
const DEFAULT_CLAUDE_FIRST_MESSAGE_TIMEOUT_MS = 90_000;
const DEFAULT_CLAUDE_STREAM_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_CLAUDE_INTERACTION_TIMEOUT_MS = 10 * 60_000;
const CLAUDE_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion']);

function normalizeClaudeEffort(effort) {
  const normalized = typeof effort === 'string' ? effort.trim().toLowerCase() : '';
  return CLAUDE_EFFORT_LEVELS.has(normalized) ? normalized : null;
}

function normalizeClaudeThinkingConfig(thinking) {
  if (!thinking || typeof thinking !== 'object') return null;
  if (thinking.type === 'adaptive') return { type: 'adaptive' };
  if (thinking.type === 'disabled') return { type: 'disabled' };
  if (thinking.type === 'enabled') {
    const normalized = { type: 'enabled' };
    if (Number.isFinite(thinking.budgetTokens) && thinking.budgetTokens > 0) {
      normalized.budgetTokens = Math.floor(thinking.budgetTokens);
    }
    if (thinking.display === 'summarized' || thinking.display === 'omitted') {
      normalized.display = thinking.display;
    }
    return normalized;
  }
  return null;
}

function isEnvEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function isBypassPermissionsEnabled() {
  return isEnvEnabled(process.env.MEDAUTODATA_ENABLE_BYPASS_PERMISSIONS);
}

function resolveToolApproval(requestId, decision) {
  resolvePermApproval(requestId, decision);
}

function scheduleClaudeSessionIndexReconcile(projectPath, sessionId, delayMs = 1000) {
  if (!projectPath || !sessionId) {
    return;
  }

  const existingTimer = pendingClaudeSessionIndexReconciles.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timeoutId = setTimeout(async () => {
    pendingClaudeSessionIndexReconciles.delete(sessionId);
    try {
      await reconcileClaudeSessionIndex(encodeProjectPath(projectPath), sessionId);
    } catch (error) {
      console.warn(`[Claude] Failed to reconcile indexed session ${sessionId}:`, error.message);
    }
  }, delayMs);

  pendingClaudeSessionIndexReconciles.set(sessionId, timeoutId);
}

async function flushClaudeSessionIndexReconcile(projectPath, sessionId) {
  if (!projectPath || !sessionId) {
    return;
  }

  const existingTimer = pendingClaudeSessionIndexReconciles.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    pendingClaudeSessionIndexReconciles.delete(sessionId);
  }

  try {
    await reconcileClaudeSessionIndex(encodeProjectPath(projectPath), sessionId);
  } catch (error) {
    console.warn(`[Claude] Failed to flush indexed session ${sessionId}:`, error.message);
  }
}

/**
 * Maps CLI options to SDK-compatible options format
 * @param {Object} options - CLI options
 * @returns {Object} SDK-compatible options
 */
export function mapCliOptionsToSDK(options = {}) {
  const { sessionId, cwd, toolsSettings, permissionMode, images, env, thinking, effort } = options;
  const bypassPermissionsEnabled = isBypassPermissionsEnabled();
  const requestedPermissionMode = permissionMode === 'bypassPermissions' && !bypassPermissionsEnabled
    ? 'default'
    : permissionMode;

  const sdkOptions = {};

  // Map working directory
  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  if (env) {
    sdkOptions.env = env;
  }

  // Map permission mode
  if (requestedPermissionMode && requestedPermissionMode !== 'default') {
    sdkOptions.permissionMode = requestedPermissionMode;
  }

  // Skip the interactive trust/bypass-permissions dialogs that the CLI shows on
  // first launch in a new directory.  These Ink prompts require a TTY and will
  // hang when the SDK is used headlessly from a server process.
  //
  // In the web backend we MUST skip these dialogs, otherwise Claude SDK can stall
  // forever waiting for user input that will never arrive.
  sdkOptions.allowDangerouslySkipPermissions = true;

  // Map tool settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  // Handle tool permissions
  if (settings.skipPermissions && requestedPermissionMode !== 'plan' && bypassPermissionsEnabled) {
    // When skipping permissions, use bypassPermissions mode
    sdkOptions.permissionMode = 'bypassPermissions';
  }

  let allowedTools = [...(settings.allowedTools || [])];

  // Add plan mode default tools
  if (requestedPermissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  sdkOptions.model = resolveClaudeModelSelection(options.model, env || process.env);

  const normalizedThinking = normalizeClaudeThinkingConfig(thinking);
  if (normalizedThinking) {
    sdkOptions.thinking = normalizedThinking;
  }

  const normalizedEffort = normalizeClaudeEffort(effort);
  if (normalizedEffort) {
    sdkOptions.effort = normalizedEffort;
  }

  // Map system prompt configuration
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code',  // Required to use CLAUDE.md
    append: MEDHELP_ASSISTANT_IDENTITY_SYSTEM_PROMPT
  };

  // Map setting sources for CLAUDE.md loading
  // This loads CLAUDE.md from project, user (~/.config/claude/CLAUDE.md), and local directories
  sdkOptions.settingSources = ['project', 'user', 'local'];

  // The modern SDK wraps incremental Anthropic events in `stream_event`.
  // Request them so the chat can render text and thinking while a turn runs.
  sdkOptions.includePartialMessages = true;

  // Map resume session
  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  return sdkOptions;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Array<string>} tempImagePaths - Temp image file paths for cleanup
 * @param {string} tempDir - Temp directory for cleanup
 */
function addSession(sessionId, queryInstance, tempImagePaths = [], tempDir = null, abortController = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    abortController,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  if (sdkMessage?.type === 'stream_event' && sdkMessage.event) {
    return {
      ...sdkMessage.event,
      parentToolUseId: sdkMessage.parent_tool_use_id || undefined,
      sdkMessageUuid: sdkMessage.uuid,
    };
  }

  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

/**
 * Extracts token budget from the last assistant message's usage data.
 * This gives us per-API-call input tokens, which represents the actual
 * context window fill level (not cumulative across the agentic turn).
 * @param {Object|null} usage - usage object from assistant message (message.usage)
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudgetFromUsage(usage) {
  if (!usage) {
    return null;
  }

  // In Claude API: input_tokens is the non-cached portion.
  // Total context = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
  const inputTokens = usage.input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
  const totalUsed = inputTokens + cacheReadTokens + cacheCreationTokens;

  // Context window is the model's input limit
  const contextWindow = getConfiguredContextWindow(process.env.CONTEXT_WINDOW);

  console.log(`Token calculation: input=${inputTokens}, cacheRead=${cacheReadTokens}, cacheCreation=${cacheCreationTokens}, total=${totalUsed}/${contextWindow}`);

  return {
    used: totalUsed,
    total: contextWindow
  };
}

/**
 * Handles image processing for SDK queries
 * Saves base64 images to temporary files and returns modified prompt with file paths
 * @param {string} command - Original user prompt
 * @param {Array} images - Array of image objects with base64 data
 * @param {string} cwd - Working directory for temp file creation
 * @returns {Promise<Object>} {modifiedCommand, tempImagePaths, tempDir}
 */
async function handleImages(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }

  try {
    // Create temp directory in the project directory
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Save each image to a temp file
    for (const [index, image] of images.entries()) {
      // Extract base64 data and mime type
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, , base64Data] = matches;
      const filename = buildTempAttachmentFilename(index, image?.name, matches[1]);
      const filepath = path.join(tempDir, filename);

      // Write base64 data to file
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
    }

    // Include the full image paths in the prompt
    let modifiedCommand = command;
    if (tempImagePaths.length > 0 && command && command.trim()) {
      const imageNote = `\n\n[Files provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + imageNote;
    }

    console.log(`Processed ${tempImagePaths.length} images to temp directory: ${tempDir}`);
    return { modifiedCommand, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for SDK:', error);
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }
}

/**
 * Cleans up temporary image files
 * @param {Array<string>} tempImagePaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    console.log(`Cleaned up ${tempImagePaths.length} temp image files`);
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      console.log('No ~/.claude.json found, proceeding without MCP servers');
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      console.log(`Loaded ${Object.keys(mcpServers).length} global MCP servers`);
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        console.log(`Loaded ${Object.keys(projectConfig.mcpServers).length} project-specific MCP servers`);
      }
    }

    // MedAutoData no longer relies on TaskMaster MCP tooling in chat sessions.
    // Filter out any TaskMaster-related MCP entries to prevent legacy "not installed" errors.
    const filteredMcpServers = Object.fromEntries(
      Object.entries(mcpServers).filter(([name, config]) => {
        const normalizedName = String(name || '').toLowerCase();
        const command = String(config?.command || '').toLowerCase();
        const argsJoined = Array.isArray(config?.args)
          ? config.args.map((arg) => String(arg || '').toLowerCase()).join(' ')
          : '';

        const isTaskMasterServer =
          normalizedName.includes('task-master') ||
          normalizedName.includes('taskmaster') ||
          command.includes('task-master') ||
          command.includes('taskmaster') ||
          argsJoined.includes('task-master') ||
          argsJoined.includes('taskmaster');

        return !isTaskMasterServer;
      })
    );

    // Return null if no servers found
    if (Object.keys(filteredMcpServers).length === 0) {
      console.log('No MCP servers configured');
      return null;
    }

    if (Object.keys(filteredMcpServers).length !== Object.keys(mcpServers).length) {
      console.log(
        `Filtered legacy TaskMaster MCP servers: ${Object.keys(mcpServers).length - Object.keys(filteredMcpServers).length}`
      );
    }

    console.log(`Total MCP servers loaded: ${Object.keys(filteredMcpServers).length}`);
    return filteredMcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Executes a Claude query using the SDK
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws) {
  const { sessionId, clientSessionId, sessionMode, stageTagKeys, stageTagSource = 'task_context' } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;
  let externalAbortHandler = null;
  let queryIterator = null;
  const lifecycleAbortController = new AbortController();
  const trackedSessionIds = new Set();
  const trackSession = (trackedSessionId, queryInstance) => {
    const normalizedSessionId = typeof trackedSessionId === 'string' ? trackedSessionId.trim() : '';
    if (!normalizedSessionId) return;
    addSession(normalizedSessionId, queryInstance, tempImagePaths, tempDir, lifecycleAbortController);
    trackedSessionIds.add(normalizedSessionId);
  };
  const untrackSessionsExcept = (retainedSessionId = null) => {
    for (const trackedSessionId of trackedSessionIds) {
      if (trackedSessionId === retainedSessionId) continue;
      removeSession(trackedSessionId);
      trackedSessionIds.delete(trackedSessionId);
    }
  };
  const untrackAllSessions = () => untrackSessionsExcept(null);
  const workingDirectory = options.cwd || options.projectPath || null;
  const shouldIndexSession = options.indexSession !== false && Boolean(workingDirectory);
  const shouldInitializeProject = options.initializeProject !== false && Boolean(workingDirectory);
  const sessionProjectPath = shouldIndexSession ? workingDirectory : null;
  const sessionDisplayName = buildSessionDisplayName(command);
  const cleanupExternalAbortHandler = () => {
    if (externalAbortHandler && options.signal?.removeEventListener) {
      options.signal.removeEventListener('abort', externalAbortHandler);
      externalAbortHandler = null;
    }
  };
  const createAbortError = () => {
    const error = new Error('Claude query was cancelled.');
    error.name = 'AbortError';
    return error;
  };

  try {
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    // Synchronous (better-sqlite3) — no await needed.
    if (sessionId && sessionProjectPath) {
      applyStageTagsToSession({
        sessionId,
        projectPath: sessionProjectPath,
        stageTagKeys,
        source: stageTagSource,
      });
    }

    // Ensure skills symlinks and CLAUDE.md template exist in the project directory
    const projectDir = shouldInitializeProject ? workingDirectory : null;
    if (projectDir) {
      try {
        await ensureProjectSkillLinks(projectDir);
      } catch (err) {
        console.warn('[claude-sdk] Failed to initialize project skills/templates:', err.message);
      }
    }

    const effectiveOptions = options.userId
      ? { ...options, env: buildAgentSessionEnv(options.userId, options.env || process.env) }
      : options;

    // Map CLI options to SDK format
    const sdkOptions = mapCliOptionsToSDK(effectiveOptions);

    const sdkEnv = sdkOptions.env && typeof sdkOptions.env === 'object'
      ? { ...process.env, ...sdkOptions.env }
      : process.env;
    const claudeExecutableInfo = resolveClaudeCodeExecutableInfo({
      env: sdkEnv,
      preferBundledNative: true,
    });
    if (!claudeExecutableInfo.executable) {
      throw new Error('Claude Code executable was not found. Install Claude Code or set CLAUDE_CLI_PATH, then restart the app.');
    }
    sdkOptions.pathToClaudeCodeExecutable = claudeExecutableInfo.executable;
    console.log(`[Claude] Using Claude Code executable (${claudeExecutableInfo.source}): ${claudeExecutableInfo.executable}`);

    // Load MCP configuration
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }

    // Handle images - save to temp files and modify prompt
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = prependUserPreferenceMemoryToPrompt(
      imageResult.modifiedCommand,
      options.userId,
      {
        fallbackCommand: 'Continue with the current task.',
        analysisLanguage: options.analysisLanguage,
        projectKind: options.projectKind,
        projectPath: options.cwd || options.projectPath || null,
      },
    );
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    sdkOptions.canUseTool = async (toolName, input, context) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions' && isBypassPermissionsEnabled()) {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      ws.send({
        type: 'claude-permission-request',
        requestId,
        toolName,
        input,
        sessionId: capturedSessionId || sessionId || null
      });

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction
          ? resolveInactivityTimeoutMs(
            process.env.CLAUDE_INTERACTION_TIMEOUT_MS,
            DEFAULT_CLAUDE_INTERACTION_TIMEOUT_MS,
          )
          : undefined,
        signal: context?.signal,
        onCancel: (reason) => {
          ws.send({
            type: 'claude-permission-cancelled',
            requestId,
            reason,
            sessionId: capturedSessionId || sessionId || clientSessionId || null
          });
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    // IMPORTANT: The Claude Agent SDK reads credentials and custom endpoints from process.env.
    // Apply per-session overrides only for the synchronous Query constructor call so
    // concurrent users do not share a longer global env mutation window.
    const envOverrides = sdkOptions.env && typeof sdkOptions.env === 'object' ? sdkOptions.env : null;
    const envKeysToApply = [...new Set([
      ...getManagedEnvKeys(),
      ...Object.keys(envOverrides || {}).filter((key) => key.toUpperCase().startsWith('VERTEX_REGION_CLAUDE_')),
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_API_URL',
      'ANTHROPIC_MODEL',
      'MEDAUTODATA_CLAUDE_FREE_MODEL',
      'MEDAUTODATA_CLAUDE_PLUS_MODEL',
      'MEDAUTODATA_CLAUDE_PRO_MODEL',
      'ZOTERO_API_KEY',
      'ZOTERO_USER_ID',
      'ZOTERO_API_BASE_URL',
      'MINERU_API_TOKEN',
      'MINERU_API_KEY',
      'MINERU_API_BASE_URL',
      'MINERU_TIMEOUT_MS',
      'MINERU_POLL_INTERVAL_MS',
      'MINERU_MODEL_VERSION',
      'MINERU_DOWNLOAD_TIMEOUT_MS',
      'MEDHELP_API_BASE_URL',
      'MEDHELP_API_TOKEN',
      'MEDHELP_AUTHORIZATION',
      'MEDHELP_USER_ID',
      'MEDHELP_USERNAME',
      'MEDHELP_AGENT_API_PROFILE_ID',
      'MEDHELP_AGENT_API_PROFILE_NAME',
      'MEDHELP_AGENT_API_PROFILE_SCOPE',
      'MEDHELP_MODEL_PLAN',
    ])];
    const prevEnv = {};

    const applyEnvOverrides = () => {
      if (!envOverrides) return;
      for (const key of envKeysToApply) {
        if (Object.prototype.hasOwnProperty.call(envOverrides, key)) {
          prevEnv[key] = process.env[key];
          const nextVal = envOverrides[key];
          if (nextVal === null || nextVal === undefined || String(nextVal).length === 0) {
            delete process.env[key];
          } else {
            process.env[key] = String(nextVal);
          }
        }
      }
    };

    const restoreEnvOverrides = () => {
      for (const key of Object.keys(prevEnv)) {
        if (prevEnv[key] === undefined) delete process.env[key];
        else process.env[key] = prevEnv[key];
      }
    };

    let queryInstance;
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    try {
      applyEnvOverrides();
      // Set stream-close timeout for interactive tools (Query constructor reads it synchronously). Claude Agent SDK has a default of 5s and this overrides it
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';
      queryInstance = query({
        prompt: finalCommand,
        options: sdkOptions
      });
    } finally {
      if (prevStreamTimeout !== undefined) {
        process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
      } else {
        delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
      }
      restoreEnvOverrides();
    }

    if (options.signal) {
      externalAbortHandler = () => {
        lifecycleAbortController.abort();
        try {
          if (queryInstance?.interrupt) queryInstance.interrupt().catch(() => {});
        } catch {}
      };
      if (options.signal.aborted) {
        externalAbortHandler();
      } else {
        options.signal.addEventListener('abort', externalAbortHandler, { once: true });
      }
    }

    // Track the temporary id immediately. This makes Stop work before Claude
    // emits the durable SDK session id.
    trackSession(capturedSessionId || clientSessionId, queryInstance);

    // Process streaming messages
    // Track the latest assistant message's usage to get per-API-call context window usage
    let lastAssistantUsage = null;
    let sawAnyTextOutput = false;
    console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
    const firstMessageTimeoutMs = resolveInactivityTimeoutMs(
      process.env.CLAUDE_FIRST_TOKEN_TIMEOUT_MS,
      DEFAULT_CLAUDE_FIRST_MESSAGE_TIMEOUT_MS,
    );
    const streamIdleTimeoutMs = resolveInactivityTimeoutMs(
      process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS,
      DEFAULT_CLAUDE_STREAM_IDLE_TIMEOUT_MS,
    );
    queryIterator = queryInstance[Symbol.asyncIterator]();
    let receivedAnyMessage = false;
    while (true) {
      const timeoutMs = receivedAnyMessage ? streamIdleTimeoutMs : firstMessageTimeoutMs;
      const iteratorResult = await nextWithInactivityTimeout(queryIterator, {
        timeoutMs,
        errorCode: receivedAnyMessage ? 'STREAM_IDLE_TIMEOUT' : 'FIRST_MESSAGE_TIMEOUT',
        message: receivedAnyMessage
          ? `Claude stopped producing events for ${timeoutMs}ms; the session was interrupted.`
          : 'Timed out waiting for Claude response (no streaming messages received). Check your Claude API gateway/key settings.',
        onTimeout: () => queryInstance?.interrupt?.(),
        signal: lifecycleAbortController.signal,
      });
      if (iteratorResult.done) break;
      receivedAnyMessage = true;
      const message = iteratorResult.value;
      const visibleMessage = message?.type === 'stream_event' && message.event
        ? message.event
        : message;

      // Detect whether this turn produced any visible text for the UI.
      // (If the model only emits thinking/tool_use without text, the UI can look "stuck".)
      if (visibleMessage?.type === 'content_block_delta' && typeof visibleMessage?.delta?.text === 'string' && visibleMessage.delta.text.trim()) {
        sawAnyTextOutput = true;
      }
      if (message?.type === 'assistant' && message?.message?.content && Array.isArray(message.message.content)) {
        if (message.message.content.some((part) => part?.type === 'text' && typeof part?.text === 'string' && part.text.trim())) {
          sawAnyTextOutput = true;
        }
      }
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        untrackSessionsExcept(capturedSessionId);
        trackSession(capturedSessionId, queryInstance);

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for new sessions
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          if (options.cwd || options.projectPath) {
            recordIndexedSession({
              sessionId: capturedSessionId,
              provider: 'claude',
              projectPath: options.cwd || options.projectPath,
              sessionMode: sessionMode || 'research',
              displayName: sessionDisplayName,
              stageTagKeys,
              tagSource: stageTagSource,
            });
          }
          ws.send({
            type: 'session-created',
            sessionId: capturedSessionId,
            previousSessionId: clientSessionId || undefined,
            provider: 'claude',
            mode: sessionMode || 'research',
            displayName: sessionDisplayName || 'New Session',
            projectName: sessionProjectPath ? encodeProjectPath(sessionProjectPath) : undefined,
          });
        }
      }

      // Track usage from assistant messages (per-API-call, not cumulative)
      if (message.type === 'assistant' && message.message?.usage) {
        lastAssistantUsage = message.message.usage;
      }

      // Detect SDK-level errors on assistant messages (e.g. rate_limit, authentication_failed)
      // These come as structured enum values, not in the catch block.
      if (message.type === 'assistant' && message.error) {
        const { errorType, isRetryable } = classifySDKError(message.error, 'claude');
        ws.send({
          type: 'claude-error',
          error: message.error,
          errorType,
          isRetryable,
        sessionId: capturedSessionId || sessionId || clientSessionId || null,
        });
      }

      // Transform and send message to WebSocket
      const transformedMessage = transformMessage(message);
      const sessionData = capturedSessionId ? getSession(capturedSessionId) : null;
      ws.send({
        type: 'claude-response',
        data: {
          ...transformedMessage,
          startTime: sessionData?.startTime
        },
        sessionId: capturedSessionId || sessionId || clientSessionId || null
      });

      if (
        capturedSessionId &&
        sessionProjectPath &&
        (message.type === 'assistant' || message.type === 'result')
      ) {
        scheduleClaudeSessionIndexReconcile(sessionProjectPath, capturedSessionId);
      }

      // Send token budget update when the turn completes
      if (message.type === 'result') {
        const tokenBudget = extractTokenBudgetFromUsage(lastAssistantUsage);
        if (tokenBudget) {
          console.log('Token budget from last assistant usage:', tokenBudget);
          ws.send({
            type: 'token-budget',
            data: tokenBudget,
            sessionId: capturedSessionId || sessionId || null
          });
        }
      }
    }
    cleanupExternalAbortHandler();
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    // Send completion event before removing session to avoid race with abort requests
    console.log('Streaming complete, sending claude-complete event');
    if (!sawAnyTextOutput) {
      ws.send({
        type: 'claude-error',
        error: 'Claude completed without producing any text output (only non-text blocks or empty output). This often indicates a stuck trust dialog, a tool-only turn, or a gateway issue.',
        errorType: 'NO_OUTPUT',
        isRetryable: true,
        sessionId: capturedSessionId || sessionId || clientSessionId || null,
      });
    }
    ws.send({
      type: 'claude-complete',
      sessionId: capturedSessionId || sessionId || clientSessionId || null,
      exitCode: 0,
      isNewSession: !sessionId && !!command
    });
    console.log('claude-complete event sent');

    // Keep post-run housekeeping out of the completion critical path so the UI
    // can settle immediately after the model finishes streaming.
    const completionTasks = [];
    if (trackedSessionIds.size > 0) {
      untrackAllSessions();
    }
    if (capturedSessionId) {
      completionTasks.push(flushClaudeSessionIndexReconcile(sessionProjectPath, capturedSessionId));
    }
    completionTasks.push(cleanupTempFiles(tempImagePaths, tempDir));
    await Promise.allSettled(completionTasks);

  } catch (error) {
    cleanupExternalAbortHandler();
    const wasAborted = error?.name === 'AbortError';
    if (queryIterator?.return) {
      await Promise.race([
        queryIterator.return().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
    if (wasAborted) {
      console.log('Claude SDK query interrupted:', capturedSessionId || sessionId || clientSessionId || 'unknown');
    } else {
      console.error('SDK query error:', error);
    }

    // Record session before cleanup so it appears in sidebar even on early errors
    if (capturedSessionId && !sessionId && !sessionCreatedSent && (options.cwd || options.projectPath)) {
      sessionCreatedSent = true;
      recordIndexedSession({
        sessionId: capturedSessionId,
        provider: 'claude',
        projectPath: options.cwd || options.projectPath,
        sessionMode: sessionMode || 'research',
        displayName: sessionDisplayName,
      });
      ws.send({
        type: 'session-created',
        sessionId: capturedSessionId,
        provider: 'claude',
        mode: sessionMode || 'research',
        displayName: sessionDisplayName || 'New Session',
        projectName: sessionProjectPath ? encodeProjectPath(sessionProjectPath) : undefined,
      });
    }

    // Clean up session on error
    untrackAllSessions();

    if (!wasAborted) {
      const { errorType, isRetryable } = classifyError(error.message);
      ws.send({
        type: 'claude-error',
        error: error.message,
        errorType,
        isRetryable,
        sessionId: capturedSessionId || sessionId || clientSessionId || null
      });
    }

    const errorTasks = [];
    if (capturedSessionId) {
      errorTasks.push(flushClaudeSessionIndexReconcile(sessionProjectPath, capturedSessionId));
    }
    errorTasks.push(cleanupTempFiles(tempImagePaths, tempDir));
    await Promise.allSettled(errorTasks);

    if (!wasAborted) throw error;
  }
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  session.status = 'aborted';
  removeSession(sessionId);
  session.abortController?.abort();

  try {
    console.log(`Aborting SDK session: ${sessionId}`);
    await Promise.race([
      session.instance?.interrupt?.() || Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (session.instance?.return) {
      await Promise.race([
        session.instance.return().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
    // Clean up temporary image files
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);
    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    try {
      await cleanupTempFiles(session.tempImagePaths, session.tempDir);
    } catch {}
    return true;
  }
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets the start time of an SDK session
 * @param {string} sessionId - Session identifier
 * @returns {number|null} Start time in ms or null
 */
function getClaudeSDKSessionStartTime(sessionId) {
  const session = getSession(sessionId);
  return session ? session.startTime : null;
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  getClaudeSDKSessionStartTime,
  getActiveClaudeSDKSessions,
  resolveToolApproval
};
