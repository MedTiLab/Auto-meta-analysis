import express from 'express';
import {
  agentApiProfilesDb,
  agentToolPermissionsDb,
  credentialsDb,
  userFeedbackDb,
  userPreferenceMemoryDb,
} from '../database/db.js';
import { abortClaudeSDKSession, getActiveClaudeSDKSessions } from '../claude-sdk.js';
import {
  getMinerUCredentialStatus,
  saveMinerUApiToken,
} from '../utils/mineruCredentials.js';
import { getZoteroWebCredentialStatus, inspectZoteroWebApiKey } from '../utils/zotero-web-client.js';
import {
  USER_PREFERENCE_MEMORY_MAX_CONTENT_LENGTH,
  normalizeUserPreferenceMemoryCategory,
  normalizeUserPreferenceMemoryScope,
  sanitizeUserPreferenceMemoryContent,
} from '../utils/userPreferenceMemory.js';

const router = express.Router();

function parsePositiveInteger(rawValue) {
  const value = Number.parseInt(rawValue, 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function getMemoryContentOrError(rawContent) {
  const content = sanitizeUserPreferenceMemoryContent(rawContent);
  if (!content) {
    return { error: 'Memory content is required' };
  }
  if (content.length > USER_PREFERENCE_MEMORY_MAX_CONTENT_LENGTH) {
    return {
      error: `Memory content must be ${USER_PREFERENCE_MEMORY_MAX_CONTENT_LENGTH} characters or less`,
    };
  }
  return { content };
}

function getMemoryScopePayload(rawScope, rawProjectPath) {
  const projectPath = typeof rawProjectPath === 'string' ? rawProjectPath.trim() : '';
  const scope = rawScope === undefined && projectPath
    ? 'project'
    : normalizeUserPreferenceMemoryScope(rawScope);

  if (scope === 'project' && !projectPath) {
    return { error: 'projectPath is required for project-scoped memory' };
  }

  return {
    scope,
    projectPath: scope === 'project' ? projectPath : null,
  };
}

function parseProfileId(rawValue) {
  const value = Number.parseInt(rawValue, 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function buildAgentApiProfilePayload(body = {}) {
  const payload = {};
  for (const key of ['name', 'provider', 'authType', 'apiKey', 'authToken', 'baseUrl', 'runtimeModel', 'modelPlan', 'isActive', 'priority']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      payload[key] = body[key];
    }
  }
  return payload;
}

function buildUserAgentApiProfilePayload(body = {}) {
  const payload = buildAgentApiProfilePayload(body);
  payload.modelPlan = 'all';
  return payload;
}

function buildAgentToolPermissionsPayload(body = {}) {
  const payload = {};
  for (const key of ['allowedTools', 'disallowedTools', 'skipPermissions', 'projectSortOrder']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      payload[key] = body[key];
    }
  }
  return payload;
}

function buildUserFeedbackPayload(req) {
  const body = req.body || {};
  return {
    category: body.category,
    title: body.title,
    content: body.content,
    contact: body.contact,
    pageUrl: body.pageUrl,
    userAgent: req.headers['user-agent'] || body.userAgent,
    metadata: {
      language: body.language || null,
      submittedAt: new Date().toISOString(),
    },
  };
}

// ===============================
// Help & suggestions feedback
// ===============================

router.post('/feedback', async (req, res) => {
  try {
    const feedback = userFeedbackDb.create(req.user.id, buildUserFeedbackPayload(req));
    res.status(201).json({ success: true, feedback });
  } catch (error) {
    console.error('Error saving user feedback:', error);
    res.status(400).json({ error: error.message || 'Failed to submit feedback' });
  }
});

// ===============================
// Agent tool permissions (per user/provider)
// ===============================

router.get('/agent-permissions/:provider?', async (req, res) => {
  try {
    const provider = req.params.provider || 'claude';
    res.json({ settings: agentToolPermissionsDb.getForUser(req.user.id, provider) });
  } catch (error) {
    console.error('Error loading agent permissions:', error);
    res.status(500).json({ error: 'Failed to load agent permissions' });
  }
});

router.put('/agent-permissions/:provider?', async (req, res) => {
  try {
    const provider = req.params.provider || 'claude';
    const settings = agentToolPermissionsDb.upsertForUser(
      req.user.id,
      provider,
      buildAgentToolPermissionsPayload(req.body || {}),
    );
    res.json({ settings });
  } catch (error) {
    console.error('Error saving agent permissions:', error);
    res.status(400).json({ error: error.message || 'Failed to save agent permissions' });
  }
});

router.post('/agent-permissions/:provider/allowed-tools', async (req, res) => {
  try {
    const provider = req.params.provider || 'claude';
    const settings = agentToolPermissionsDb.grantAllowedTool(req.user.id, provider, req.body?.entry);
    res.json({ settings });
  } catch (error) {
    console.error('Error granting agent tool permission:', error);
    res.status(400).json({ error: error.message || 'Failed to grant agent tool permission' });
  }
});

// ===============================
// Agent API profiles (user BYOK / switcher)
// ===============================

router.get('/agent-api-profiles', async (req, res) => {
  try {
    res.json(agentApiProfilesDb.listForUser(req.user.id));
  } catch (error) {
    console.error('Error listing agent API profiles:', error);
    res.status(500).json({ error: 'Failed to list agent API profiles' });
  }
});

router.post('/agent-api-profiles', async (req, res) => {
  try {
    const profile = agentApiProfilesDb.createUserProfile(req.user.id, buildUserAgentApiProfilePayload(req.body || {}));
    res.status(201).json({ profile });
  } catch (error) {
    console.error('Error creating agent API profile:', error);
    res.status(400).json({ error: error.message || 'Failed to create agent API profile' });
  }
});

router.patch('/agent-api-profiles/selection', async (req, res) => {
  try {
    const selection = agentApiProfilesDb.setUserSelection(req.user.id, {
      mode: req.body?.mode,
      profileId: req.body?.profileId,
      selectedProfileId: req.body?.selectedProfileId,
    });
    res.json({ selection });
  } catch (error) {
    console.error('Error selecting agent API profile:', error);
    res.status(400).json({ error: error.message || 'Failed to select agent API profile' });
  }
});

router.patch('/agent-api-profiles/:profileId', async (req, res) => {
  try {
    const profileId = parseProfileId(req.params.profileId);
    if (!profileId) {
      return res.status(400).json({ error: 'Invalid profile ID' });
    }

    const profile = agentApiProfilesDb.updateUserProfile(req.user.id, profileId, buildUserAgentApiProfilePayload(req.body || {}));
    if (!profile) {
      return res.status(404).json({ error: 'Agent API profile not found' });
    }

    res.json({ profile });
  } catch (error) {
    console.error('Error updating agent API profile:', error);
    res.status(400).json({ error: error.message || 'Failed to update agent API profile' });
  }
});

router.delete('/agent-api-profiles/:profileId', async (req, res) => {
  try {
    const profileId = parseProfileId(req.params.profileId);
    if (!profileId) {
      return res.status(400).json({ error: 'Invalid profile ID' });
    }

    const deleted = agentApiProfilesDb.deleteUserProfile(req.user.id, profileId);
    if (!deleted) {
      return res.status(404).json({ error: 'Agent API profile not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting agent API profile:', error);
    res.status(500).json({ error: 'Failed to delete agent API profile' });
  }
});

router.get('/zotero-web/status', async (req, res) => {
  try {
    res.json(getZoteroWebCredentialStatus(req.user.id));
  } catch (error) {
    console.error('Error checking Zotero Web credentials:', error);
    res.status(500).json({ error: 'Failed to check Zotero Web credentials' });
  }
});

router.post('/zotero-web/credentials', async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || req.body?.zoteroApiKey || '').trim();
    const requestedUserId = String(req.body?.userId || req.body?.zoteroUserId || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'Zotero API key is required' });
    }

    const inspection = await inspectZoteroWebApiKey(apiKey);
    if (requestedUserId && requestedUserId !== inspection.userId) {
      return res.status(400).json({
        error: `Zotero user ID mismatch. The API key belongs to user ${inspection.userId}.`,
      });
    }
    if (!inspection.access.library || !inspection.access.write) {
      return res.status(400).json({
        error: 'This Zotero API key does not have library write access. Create a key with library access and write permission.',
      });
    }

    credentialsDb.createCredential(
      req.user.id,
      'Zotero API Key',
      'zotero_api_key',
      apiKey,
      'Validated and saved from Meta Zotero communication',
    );
    credentialsDb.createCredential(
      req.user.id,
      'Zotero User ID',
      'zotero_user_id',
      inspection.userId,
      'Resolved from Zotero API key',
    );

    res.json({
      success: true,
      configured: true,
      userId: inspection.userId,
      source: 'user_credential',
      apiKeySource: 'user_credential',
      userIdSource: 'user_credential',
      username: inspection.username || null,
      displayName: inspection.displayName || null,
      access: inspection.access,
    });
  } catch (error) {
    console.error('Error saving Zotero Web credentials:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to save Zotero Web credentials' });
  }
});

// ===============================
// MinerU API token (per user, environment fallback)
// ===============================

router.get('/mineru/status', async (req, res) => {
  try {
    res.json(getMinerUCredentialStatus(req.user.id));
  } catch (error) {
    console.error('Error checking MinerU credentials:', error);
    res.status(500).json({ error: 'Failed to check MinerU credentials' });
  }
});

router.put('/mineru/credentials', async (req, res) => {
  try {
    const apiToken = String(req.body?.apiToken || req.body?.token || '').trim();
    if (!apiToken) {
      return res.status(400).json({ error: 'MinerU API token is required' });
    }

    res.json({
      success: true,
      ...saveMinerUApiToken(req.user.id, apiToken),
    });
  } catch (error) {
    console.error('Error saving MinerU credentials:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to save MinerU credentials' });
  }
});

// ===============================
// Lightweight User Preference Memory
// ===============================

router.get('/memory/settings', async (req, res) => {
  try {
    res.json({
      enabled: userPreferenceMemoryDb.getMemoryEnabled(req.user.id),
    });
  } catch (error) {
    console.error('Error fetching memory settings:', error);
    res.status(500).json({ error: 'Failed to fetch memory settings' });
  }
});

router.patch('/memory/settings', async (req, res) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    res.json({
      enabled: userPreferenceMemoryDb.setMemoryEnabled(req.user.id, enabled),
    });
  } catch (error) {
    console.error('Error updating memory settings:', error);
    res.status(500).json({ error: 'Failed to update memory settings' });
  }
});

router.get('/memory', async (req, res) => {
  try {
    res.json({
      memories: userPreferenceMemoryDb.getAll(req.user.id),
    });
  } catch (error) {
    console.error('Error fetching memories:', error);
    res.status(500).json({ error: 'Failed to fetch memories' });
  }
});

router.post('/memory', async (req, res) => {
  try {
    const { content, category, scope, projectPath } = req.body || {};
    const validated = getMemoryContentOrError(content);
    if (validated.error) {
      return res.status(400).json({ error: validated.error });
    }
    const scoped = getMemoryScopePayload(scope, projectPath);
    if (scoped.error) {
      return res.status(400).json({ error: scoped.error });
    }

    const memory = userPreferenceMemoryDb.create(
      req.user.id,
      validated.content,
      normalizeUserPreferenceMemoryCategory(category),
      scoped.scope,
      scoped.projectPath,
    );

    res.status(201).json({ memory });
  } catch (error) {
    console.error('Error creating memory:', error);
    const statusCode = error.message?.includes('Maximum of') ? 400 : 500;
    res.status(statusCode).json({ error: error.message || 'Failed to create memory' });
  }
});

router.put('/memory/:memoryId', async (req, res) => {
  try {
    const memoryId = parsePositiveInteger(req.params.memoryId);
    if (!memoryId) {
      return res.status(400).json({ error: 'Invalid memory ID' });
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'content')) {
      const validated = getMemoryContentOrError(req.body.content);
      if (validated.error) {
        return res.status(400).json({ error: validated.error });
      }
      updates.content = validated.content;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'category')) {
      updates.category = normalizeUserPreferenceMemoryCategory(req.body.category);
    }

    const hasScope = Object.prototype.hasOwnProperty.call(req.body || {}, 'scope');
    const hasProjectPath = Object.prototype.hasOwnProperty.call(req.body || {}, 'projectPath');
    if (hasScope || hasProjectPath) {
      const scoped = getMemoryScopePayload(
        hasScope ? req.body.scope : undefined,
        hasProjectPath ? req.body.projectPath : undefined,
      );
      if (scoped.error) {
        return res.status(400).json({ error: scoped.error });
      }
      if (hasScope) {
        updates.scope = scoped.scope;
      }
      if (hasProjectPath || scoped.scope === 'project') {
        updates.projectPath = scoped.projectPath;
      }
      if (hasScope && scoped.scope === 'user') {
        updates.projectPath = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const memory = userPreferenceMemoryDb.update(req.user.id, memoryId, updates);
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({ memory });
  } catch (error) {
    console.error('Error updating memory:', error);
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

router.patch('/memory/:memoryId/toggle', async (req, res) => {
  try {
    const memoryId = parsePositiveInteger(req.params.memoryId);
    if (!memoryId) {
      return res.status(400).json({ error: 'Invalid memory ID' });
    }

    const requestedEnabled = typeof req.body?.isEnabled === 'boolean'
      ? req.body.isEnabled
      : undefined;
    const memory = userPreferenceMemoryDb.toggle(req.user.id, memoryId, requestedEnabled);
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({ memory });
  } catch (error) {
    console.error('Error toggling memory:', error);
    res.status(500).json({ error: 'Failed to toggle memory' });
  }
});

router.delete('/memory/:memoryId', async (req, res) => {
  try {
    const memoryId = parsePositiveInteger(req.params.memoryId);
    if (!memoryId) {
      return res.status(400).json({ error: 'Invalid memory ID' });
    }

    const deleted = userPreferenceMemoryDb.delete(req.user.id, memoryId);
    if (!deleted) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting memory:', error);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

router.post('/runtime-reset', async (_req, res) => {
  try {
    const active = {
      claude: getActiveClaudeSDKSessions(),
    };

    const results = {
      aborted: {
        claude: [],
      },
      counts: {
        claude: active.claude.length,
      },
    };

    // Claude abort is async (SDK interrupt)
    for (const sessionId of active.claude) {
      const ok = await abortClaudeSDKSession(sessionId);
      results.aborted.claude.push({ sessionId, ok });
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Error during runtime reset:', error);
    res.status(500).json({ error: 'Failed to reset runtime', details: error.message });
  }
});

export default router;
