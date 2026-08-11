import { IS_PLATFORM } from "../constants/config";

// Utility function for authenticated API calls
export const authenticatedFetch = (url, options = {}) => {
  const token = localStorage.getItem('auth-token');

  const defaultHeaders = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (!IS_PLATFORM && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
};

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (username, password) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username, password, notificationEmail) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, notificationEmail }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    requestMembershipUpgrade: (membershipPlan) => authenticatedFetch('/api/auth/membership-upgrade-requests', {
      method: 'POST',
      body: JSON.stringify({ membershipPlan }),
    }),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
    adminStatus: () => fetch('/api/auth/admin/status'),
    adminLogin: (username, password) => fetch('/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    adminRegistrationRequests: (token, status = 'pending') => fetch(`/api/auth/admin/registration-requests?status=${encodeURIComponent(status)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    adminMembershipUpgradeRequests: (token, status = 'pending') => fetch(`/api/auth/admin/membership-upgrade-requests?status=${encodeURIComponent(status)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    adminUsers: (token) => fetch('/api/auth/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    }),
    adminUsageSettings: (token) => fetch('/api/auth/admin/usage-settings', {
      headers: { Authorization: `Bearer ${token}` },
    }),
    updateAdminUsageSettings: (token, payload) => fetch('/api/auth/admin/usage-settings', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
    updateAdminUserMembership: (token, id, membershipPlan) => fetch(`/api/auth/admin/users/${encodeURIComponent(id)}/membership`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ membershipPlan }),
    }),
    updateAdminUserUsageQuota: (token, id, usageQuotaMb) => fetch(`/api/auth/admin/users/${encodeURIComponent(id)}/usage-quota`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ usageQuotaMb }),
    }),
    resetAdminUserUsage: (token, id) => fetch(`/api/auth/admin/users/${encodeURIComponent(id)}/usage-reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
    updateAdminUserTrial: (token, id, payload) => fetch(`/api/auth/admin/users/${encodeURIComponent(id)}/trial`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
    deleteAdminUser: (token, id, payload) => fetch(`/api/auth/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    }),
    updateAdminMailSettings: (token, payload) => fetch('/api/auth/admin/mail-settings', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
    adminAgentApiProfiles: (token) => fetch('/api/auth/admin/agent-api-profiles', {
      headers: { Authorization: `Bearer ${token}` },
    }),
    createAdminAgentApiProfile: (token, payload) => fetch('/api/auth/admin/agent-api-profiles', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
    updateAdminAgentApiProfile: (token, id, payload) => fetch(`/api/auth/admin/agent-api-profiles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
    deleteAdminAgentApiProfile: (token, id) => fetch(`/api/auth/admin/agent-api-profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),
    updateAdminAgentApiStrategy: (token, strategy) => fetch('/api/auth/admin/agent-api-profiles/strategy', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ strategy }),
    }),
    approveRegistrationRequest: (token, id) => fetch(`/api/auth/admin/registration-requests/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
    rejectRegistrationRequest: (token, id, note = '') => fetch(`/api/auth/admin/registration-requests/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ note }),
    }),
    approveMembershipUpgradeRequest: (token, id) => fetch(`/api/auth/admin/membership-upgrade-requests/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
    rejectMembershipUpgradeRequest: (token, id, note = '') => fetch(`/api/auth/admin/membership-upgrade-requests/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ note }),
    }),
    updateAdminUserAgentApiAccess: (token, id, enabled) => fetch(`/api/auth/admin/users/${encodeURIComponent(id)}/agent-api-access`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled }),
    }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  projects: () => authenticatedFetch('/api/projects'),
  trashedProjects: () => authenticatedFetch('/api/projects/trash'),
  trashedSessions: () => authenticatedFetch('/api/projects/trash/sessions'),
  settings: {
    agentPermissions: (provider = 'claude') =>
      authenticatedFetch(`/api/settings/agent-permissions/${encodeURIComponent(provider)}`),
    updateAgentPermissions: (provider = 'claude', payload = {}) =>
      authenticatedFetch(`/api/settings/agent-permissions/${encodeURIComponent(provider)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    grantAgentToolPermission: (provider = 'claude', entry) =>
      authenticatedFetch(`/api/settings/agent-permissions/${encodeURIComponent(provider)}/allowed-tools`, {
        method: 'POST',
        body: JSON.stringify({ entry }),
      }),
    submitFeedback: (payload) =>
      authenticatedFetch('/api/settings/feedback', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    agentApiProfiles: () => authenticatedFetch('/api/settings/agent-api-profiles'),
    createAgentApiProfile: (payload) =>
      authenticatedFetch('/api/settings/agent-api-profiles', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateAgentApiProfile: (profileId, payload) =>
      authenticatedFetch(`/api/settings/agent-api-profiles/${encodeURIComponent(profileId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    deleteAgentApiProfile: (profileId) =>
      authenticatedFetch(`/api/settings/agent-api-profiles/${encodeURIComponent(profileId)}`, {
        method: 'DELETE',
      }),
    selectAgentApiProfile: (profileId) =>
      authenticatedFetch('/api/settings/agent-api-profiles/selection', {
        method: 'PATCH',
        body: JSON.stringify(profileId ? { mode: 'profile', profileId } : { mode: 'system_auto' }),
      }),
    mineruStatus: () => authenticatedFetch('/api/settings/mineru/status'),
    saveMineruCredentials: (apiToken) =>
      authenticatedFetch('/api/settings/mineru/credentials', {
        method: 'PUT',
        body: JSON.stringify({ apiToken }),
      }),
    memory: () => authenticatedFetch('/api/settings/memory'),
    createMemory: (payload) =>
      authenticatedFetch('/api/settings/memory', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateMemory: (memoryId, payload) =>
      authenticatedFetch(`/api/settings/memory/${memoryId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    toggleMemory: (memoryId, isEnabled) =>
      authenticatedFetch(`/api/settings/memory/${memoryId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify(
          typeof isEnabled === 'boolean'
            ? { isEnabled }
            : {},
        ),
      }),
    deleteMemory: (memoryId) =>
      authenticatedFetch(`/api/settings/memory/${memoryId}`, {
        method: 'DELETE',
      }),
    memorySettings: () => authenticatedFetch('/api/settings/memory/settings'),
    updateMemorySettings: (enabled) =>
      authenticatedFetch('/api/settings/memory/settings', {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
  },
  providers: {
    list: () => authenticatedFetch('/api/providers'),
    presets: () => authenticatedFetch('/api/providers/presets'),
    authStatus: () => authenticatedFetch('/api/providers/auth-status'),
    settings: () => authenticatedFetch('/api/providers/settings'),
    updateSettings: (payload) => authenticatedFetch('/api/providers/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
    create: (payload) => authenticatedFetch('/api/providers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    update: (providerId, payload) => authenticatedFetch(`/api/providers/${encodeURIComponent(providerId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
    delete: (providerId) => authenticatedFetch(`/api/providers/${encodeURIComponent(providerId)}`, {
      method: 'DELETE',
    }),
    activate: (providerId) => authenticatedFetch(`/api/providers/${encodeURIComponent(providerId)}/activate`, {
      method: 'POST',
    }),
    activateOfficial: () => authenticatedFetch('/api/providers/official', { method: 'POST' }),
    reorder: (orderedIds) => authenticatedFetch('/api/providers/reorder', {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    }),
    testSaved: (providerId, payload = {}) => authenticatedFetch(`/api/providers/${encodeURIComponent(providerId)}/test`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    testConfig: (payload) => authenticatedFetch('/api/providers/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    oauthStatus: (provider) => authenticatedFetch(`/api/provider-oauth/${encodeURIComponent(provider)}`),
    startOAuth: (provider) => authenticatedFetch(`/api/provider-oauth/${encodeURIComponent(provider)}/start`, {
      method: 'POST',
    }),
    logoutOAuth: (provider) => authenticatedFetch(`/api/provider-oauth/${encodeURIComponent(provider)}`, {
      method: 'DELETE',
    }),
  },
  projectTokenUsageSummary: (projects) =>
    authenticatedFetch('/api/projects/token-usage-summary', {
      method: 'POST',
      body: JSON.stringify({
        projects: (projects || []).map((project) => ({
          name: project.name,
          fullPath: project.fullPath,
        })),
      }),
    }),
  sessions: (projectName, limit = 5, offset = 0) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions?limit=${limit}&offset=${offset}`),
  reindexProjectSessions: (projectName, providers = ['claude']) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/reindex`, {
      method: 'POST',
      body: JSON.stringify({ providers }),
    }),
  projectTags: (projectName, tagType = null) => {
    const params = new URLSearchParams();
    if (tagType) {
      params.append('tagType', tagType);
    }
    const query = params.toString();
    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/tags${query ? `?${query}` : ''}`);
  },
  sessionTags: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/tags`),
  updateSessionTags: (projectName, sessionId, tagIds) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tagIds }),
    }),
  sessionMessages: (projectName, sessionId, limit = null, offset = 0, provider = 'claude') => {
    const params = new URLSearchParams();
    if (limit !== null) {
      params.append('limit', limit);
      params.append('offset', offset);
    }
    params.append('provider', provider);
    const queryString = params.toString();

    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/messages${queryString ? `?${queryString}` : ''}`);
  },
  sessionContextReview: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/context-review`),
  updateSessionContextReview: (projectName, sessionId, reviews) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/context-review`, {
      method: 'PUT',
      body: JSON.stringify({ reviews }),
    }),
  renameProject: (projectName, displayName) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  renameSession: (projectName, sessionId, summary, provider = 'claude') =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ summary, provider }),
    }),
  deleteSession: (projectName, sessionId, provider = 'claude') =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}?provider=${encodeURIComponent(provider)}`, {
      method: 'DELETE',
    }),
  restoreSession: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/restore`, {
      method: 'POST',
    }),
  deleteSessionPermanently: (projectName, sessionId, provider = 'claude') =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}?provider=${encodeURIComponent(provider)}&mode=physical`, {
      method: 'DELETE',
    }),
  deleteProject: (projectName, force = false) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),
  restoreProject: (projectName) =>
    authenticatedFetch(`/api/projects/trash/${encodeURIComponent(projectName)}/restore`, {
      method: 'POST',
    }),
  deleteTrashedProject: (projectName, mode = 'logical') =>
    authenticatedFetch(`/api/projects/trash/${encodeURIComponent(projectName)}?mode=${encodeURIComponent(mode)}`, {
      method: 'DELETE',
    }),
  createProject: (path) =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  createWorkspace: (workspaceData, options = {}) =>
    authenticatedFetch('/api/projects/create-workspace', {
      ...options,
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
  updateProjectMetadata: (projectName, metadata) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(metadata),
    }),
  downloadProjectArchive: (projectName, options = {}) => {
    const params = new URLSearchParams();
    if (options?.scope) {
      params.set('scope', options.scope);
    }
    const query = params.toString();
    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/download${query ? `?${query}` : ''}`);
  },
  readFile: (projectName, filePath, options = {}) => {
    const params = new URLSearchParams({ filePath });
    const maxPreviewBytes = options?.maxPreviewBytes;
    if (maxPreviewBytes != null && Number.isFinite(Number(maxPreviewBytes)) && Number(maxPreviewBytes) > 0) {
      params.set('maxPreviewBytes', String(Math.floor(Number(maxPreviewBytes))));
    }
    if (options?.includeInternal) {
      params.set('includeInternal', 'true');
    }
    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file?${params.toString()}`);
  },
  /** Fetch binary file content (e.g. PDF/docx/zip) as Blob. Accepts project-relative or absolute paths. */
  getFileContentBlob: (projectName, filePath) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/files/content?path=${encodeURIComponent(filePath)}`).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? 'Not found' : `HTTP ${r.status}`);
      return r.blob();
    }),
  saveFile: (projectName, filePath, content) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  moveFile: (projectName, sourcePath, destinationDir) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file/move`, {
      method: 'POST',
      body: JSON.stringify({ sourcePath, destinationDir }),
    }),
  createProjectFolder: (projectName, parentDir, name) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/folder`, {
      method: 'POST',
      body: JSON.stringify({ parentDir, name }),
    }),
  deleteFile: (projectName, filePath) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file`, {
      method: 'DELETE',
      body: JSON.stringify({ filePath }),
    }),
  getFiles: (projectName, options = {}) => {
    const { path, maxDepth, showHidden, includeInternal, ...fetchOptions } = options || {};
    const params = new URLSearchParams();

    if (typeof path === 'string' && path) {
      params.append('path', path);
    }
    if (maxDepth !== undefined && maxDepth !== null) {
      params.append('maxDepth', String(maxDepth));
    }
    if (showHidden !== undefined && showHidden !== null) {
      params.append('showHidden', String(showHidden));
    }
    if (includeInternal !== undefined && includeInternal !== null) {
      params.append('includeInternal', String(includeInternal));
    }

    const query = params.toString();
    return authenticatedFetch(
      `/api/projects/${encodeURIComponent(projectName)}/files${query ? `?${query}` : ''}`,
      fetchOptions
    );
  },
  transcribe: (formData) =>
    authenticatedFetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  // TaskMaster endpoints
  taskmaster: {
    detect: (projectName) =>
      authenticatedFetch(`/api/taskmaster/detect/${encodeURIComponent(projectName)}`),

    // Initialize TaskMaster in a project
    init: (projectName) =>
      authenticatedFetch(`/api/taskmaster/init/${projectName}`, {
        method: 'POST',
      }),

    // Add a new task
    addTask: (projectName, { prompt, title, description, priority, dependencies, stage, insertAfterId }) =>
      authenticatedFetch(`/api/taskmaster/add-task/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ prompt, title, description, priority, dependencies, stage, insertAfterId }),
      }),

    // Parse PRD to generate tasks
    parsePRD: (projectName, { fileName, numTasks, append }) =>
      authenticatedFetch(`/api/taskmaster/parse-prd/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ fileName, numTasks, append }),
      }),

    // Get available PRD templates
    getTemplates: () =>
      authenticatedFetch('/api/taskmaster/prd-templates'),

    // Apply a PRD template
    applyTemplate: (projectName, { templateId, fileName, customizations }) =>
      authenticatedFetch(`/api/taskmaster/apply-template/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ templateId, fileName, customizations }),
      }),

    updateResearchBrief: (projectName, { fileName, updates }) =>
      authenticatedFetch(`/api/taskmaster/research-brief/${projectName}`, {
        method: 'PUT',
        body: JSON.stringify({ fileName, updates }),
      }),

    getKnowledgeBaseManifest: (projectName) =>
      authenticatedFetch(`/api/taskmaster/kb/${encodeURIComponent(projectName)}`),

    bootstrapKnowledgeBase: (projectName) =>
      authenticatedFetch(`/api/taskmaster/kb/${encodeURIComponent(projectName)}/bootstrap`, {
        method: 'POST',
      }),

    ingestNewsItem: (projectName, { item, sourceKey }) =>
      authenticatedFetch(`/api/taskmaster/kb/${encodeURIComponent(projectName)}/news-item`, {
        method: 'POST',
        body: JSON.stringify({ item, sourceKey }),
      }),

    createKnowledgeBaseNote: (projectName, payload) =>
      authenticatedFetch(`/api/taskmaster/kb/${encodeURIComponent(projectName)}/note`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    uploadKnowledgeBaseFile: (projectName, file) => {
      const formData = new FormData();
      formData.append('file', file, file.name);
      return authenticatedFetch(`/api/taskmaster/kb/${encodeURIComponent(projectName)}/upload`, {
        method: 'POST',
        body: formData,
        headers: {},
      });
    },

    searchKnowledgeBase: (projectName, { query = '', limit = 12 } = {}) =>
      authenticatedFetch(
        `/api/taskmaster/kb/${encodeURIComponent(projectName)}/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
      ),

    // Update a task
    updateTask: (projectName, taskId, updates) =>
      authenticatedFetch(`/api/taskmaster/update-task/${projectName}/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),

    // Delete a task
    deleteTask: (projectName, taskId) =>
      authenticatedFetch(`/api/taskmaster/delete-task/${projectName}/${taskId}`, {
        method: 'DELETE',
      }),
  },

  // Workspace root
  getWorkspaceRoot: () => authenticatedFetch('/api/projects/workspace-root'),
  setWorkspaceRoot: (path) =>
    authenticatedFetch('/api/projects/workspace-root', {
      method: 'PUT',
      body: JSON.stringify({ path }),
    }),

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath = /** @type {string | null} */ (null), { selectDefaultLocation = false, showHidden = false } = {}) => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);
    if (selectDefaultLocation) params.append('selectDefaultLocation', 'true');
    if (showHidden) params.append('showHidden', 'true');

    return authenticatedFetch(`/api/browse-filesystem?${params}`);
  },

  createFolder: (folderPath) =>
    authenticatedFetch('/api/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    }),

  // User endpoints
  user: {
    profile: () => authenticatedFetch('/api/user/profile'),
    updateProfile: (profile) =>
      authenticatedFetch('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify(
          typeof profile === 'string'
            ? { notificationEmail: profile }
            : (profile || {}),
        ),
      }),
    updateAvatar: (avatarId) =>
      authenticatedFetch('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ avatarId }),
      }),
    projectActivity: (params) => {
      const query = new URLSearchParams(params || {}).toString();
      return authenticatedFetch(`/api/user/project-activity${query ? `?${query}` : ''}`);
    },
    recordProjectOpen: (project, source = 'project_select') =>
      authenticatedFetch('/api/user/project-activity/open', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project?.name,
          projectPath: project?.fullPath || project?.path,
          displayName: project?.displayName,
          source,
        }),
      }),
    changePassword: (currentPassword, newPassword) =>
      authenticatedFetch('/api/user/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    gitConfig: () => authenticatedFetch('/api/user/git-config'),
    updateGitConfig: (gitName, gitEmail) =>
      authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        body: JSON.stringify({ gitName, gitEmail }),
      }),
    onboardingStatus: () => authenticatedFetch('/api/user/onboarding-status'),
    completeOnboarding: () =>
      authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      }),
  },

  // Global skills endpoints
  getGlobalSkills: () => authenticatedFetch('/api/skills'),
  readGlobalSkillFile: (filePath) =>
    authenticatedFetch(`/api/skills/file?filePath=${encodeURIComponent(filePath)}`),
  validateGlobalSkillZip: (formData) =>
    authenticatedFetch('/api/skills/validate-skill-zip', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  uploadGlobalSkill: (formData) =>
    authenticatedFetch('/api/skills/upload-skill', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  uploadFiles: (projectName, formData) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/upload-files`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  validateSkillZip: (projectName, formData) =>
    authenticatedFetch(`/api/skills/${projectName}/validate-skill-zip`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  uploadSkill: (projectName, formData) =>
    authenticatedFetch(`/api/skills/${projectName}/upload-skill`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  scanLocalSkills: (dirPath) =>
    authenticatedFetch(`/api/skills/scan-local?path=${encodeURIComponent(dirPath)}`),
  importLocalSkills: (sourcePath, skillNames) =>
    authenticatedFetch('/api/skills/import-from-local', {
      method: 'POST',
      body: JSON.stringify({ sourcePath, skillNames }),
    }),
  deleteProjectSkill: (projectName, skillDirName) =>
    authenticatedFetch(`/api/skills/${encodeURIComponent(projectName)}/${encodeURIComponent(skillDirName)}`, {
      method: 'DELETE',
    }),
  deleteGlobalSkill: (dirPath) =>
    authenticatedFetch('/api/skills/global-skill', {
      method: 'DELETE',
      body: JSON.stringify({ dirPath }),
    }),

  // News dashboard endpoints
  news: {
    getSources: () => authenticatedFetch('/api/news/sources'),
    getConfig: (source = 'arxiv') => authenticatedFetch(`/api/news/config/${source}`),
    updateConfig: (source, config) =>
      authenticatedFetch(`/api/news/config/${source}`, {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    resetConfig: (source) =>
      authenticatedFetch(`/api/news/config/${source}`, {
        method: 'DELETE',
      }),
    search: (source = 'arxiv', configOverride, fetchOptions = {}) =>
      authenticatedFetch(`/api/news/search/${source}`, {
        ...fetchOptions,
        method: 'POST',
        body: configOverride ? JSON.stringify({ configOverride }) : undefined,
      }),
    getResults: (source = 'arxiv') => authenticatedFetch(`/api/news/results/${source}`),
    translate: ({ title, abstract, targetLanguage = 'zh-CN' }) =>
      authenticatedFetch('/api/news/translate', {
        method: 'POST',
        body: JSON.stringify({ title, abstract, targetLanguage }),
      }),
    /** Poll search progress logs for a source. */
    getLogs: (source) => authenticatedFetch(`/api/news/logs/${source}`),
    /** Trigger xhs login (returns JSON with success, nickname, logs). */
    xhsLogin: (options = {}) => authenticatedFetch('/api/news/xhs-login', {
      method: 'POST',
      body: JSON.stringify(options),
    }),
  },
  // References (literature library) endpoints
  references: {
    list: (params) => authenticatedFetch(`/api/references?${new URLSearchParams(params || {})}`, { cache: 'no-store' }),
    get: (id) => authenticatedFetch(`/api/references/${encodeURIComponent(id)}`),
    delete: (id) => authenticatedFetch(`/api/references/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getPdf: (id) => authenticatedFetch(`/api/references/${encodeURIComponent(id)}/pdf`),
    syncZotero: ({ projectName, collectionKey, sourceIds } = {}) => authenticatedFetch('/api/references/sync/zotero', { method: 'POST', body: JSON.stringify({ projectName, collectionKey, sourceIds }) }),
    zoteroItems: (params) => {
      const qs = new URLSearchParams();
      if (params?.collectionKey) qs.set('collectionKey', params.collectionKey);
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.start) qs.set('start', String(params.start));
      return authenticatedFetch(`/api/references/zotero/items?${qs}`);
    },
    importBibtex: (formData) => authenticatedFetch('/api/references/import/bibtex', { method: 'POST', body: formData, headers: {} }),
    importPubmed: (item, folderId = /** @type {string | null} */ (null)) => authenticatedFetch('/api/references/import/pubmed', { method: 'POST', body: JSON.stringify({ item, folderId }) }),
    zoteroStatus: () => authenticatedFetch('/api/references/zotero/status'),
    zoteroCollections: () => authenticatedFetch('/api/references/zotero/collections'),
    projectRefs: (projectName) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}`),
    aggregatedProjectRefs: (projectName) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}/aggregate`),
    linkToProject: (projectName, refId) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}/${encodeURIComponent(refId)}`, { method: 'POST' }),
    unlinkFromProject: (projectName, refId) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}/${encodeURIComponent(refId)}`, { method: 'DELETE' }),
    bulkDelete: (ids) => authenticatedFetch('/api/references/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    folders: () => authenticatedFetch('/api/references/folders', { cache: 'no-store' }),
    createFolder: (name, parentId = null) => authenticatedFetch('/api/references/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) }),
    renameFolder: (folderId, name) => authenticatedFetch(`/api/references/folders/${encodeURIComponent(folderId)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    deleteFolder: (folderId) => authenticatedFetch(`/api/references/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' }),
    addToFolder: (folderId, referenceIds) => authenticatedFetch(`/api/references/folders/${encodeURIComponent(folderId)}/references`, { method: 'POST', body: JSON.stringify({ referenceIds }) }),
    removeFromFolder: (folderId, referenceId) => authenticatedFetch(`/api/references/folders/${encodeURIComponent(folderId)}/references/${encodeURIComponent(referenceId)}`, { method: 'DELETE' }),
    removeFromAllFolders: (referenceId) => authenticatedFetch(`/api/references/folders/references/${encodeURIComponent(referenceId)}`, { method: 'DELETE' }),
    tags: () => authenticatedFetch('/api/references/tags'),
  },

  // Generic GET method for any endpoint
  get: (endpoint) => authenticatedFetch(`/api${endpoint}`),
};
