import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { agentApiProfilesDb, userDb, registrationRequestDb, membershipUpgradeRequestDb, db, projectDb, sessionDb, hasAgentApiAccess } from '../database/db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { getDefaultAvatarId } from '../../shared/avatarCatalog.js';
import {
  getRegistrationReviewMailSettings,
  hasRegistrationReviewMailConfig,
  sendRegistrationReviewEmail,
  updateRegistrationReviewMailSettings,
} from '../utils/registration-review-mailer.js';
import {
  buildTrialPatch,
  getTrialStatus,
} from '../utils/trialStatus.js';
import {
  bytesToMb,
  getAccountUsageStatus,
  getUserStorageUsageBytes,
  getUsageQuotaSettings,
  normalizeUsageQuotaOverrideBytes,
  updateUsageQuotaSettings,
} from '../utils/accountUsage.js';
import { normalizeMembershipPlan } from '../../shared/modelConstants.js';

const router = express.Router();
const REGISTRATION_REVIEW_PENDING_MESSAGE = 'Registration request submitted and waiting for administrator approval';
const REGISTRATION_REVIEW_ALREADY_PENDING_ERROR = 'A registration request for this username or email is already pending review';
const MEMBERSHIP_PLANS = new Set(['free', 'plus', 'pro']);
const UPGRADE_MEMBERSHIP_PLANS = new Set(['plus', 'pro']);
const MEMBERSHIP_PLAN_RANK = { free: 0, plus: 1, pro: 2 };

function isRegistrationReviewEnabled() {
  return String(process.env.REGISTRATION_REVIEW_ENABLED || '').trim().toLowerCase() === 'true';
}

function getMaxUsers() {
  const parsed = Number.parseInt(String(process.env.MAX_USERS || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isUserCapacityFull() {
  const maxUsers = getMaxUsers();
  if (!maxUsers) {
    return false;
  }
  return userDb.countActiveUsers() >= maxUsers;
}

function getAdminUsername() {
  return process.env.ADMIN_USERNAME || null;
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || null;
}

function normalizeSubmittedMembershipPlan(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return MEMBERSHIP_PLANS.has(normalized) ? normalized : null;
}

function buildAgentApiProfilePayload(body = {}) {
  const payload = {};
  for (const key of ['name', 'provider', 'authType', 'apiKey', 'authToken', 'baseUrl', 'runtimeModel', 'modelPlan', 'isActive', 'isDefault', 'priority']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      payload[key] = body[key];
    }
  }
  return payload;
}

function normalizeUpgradeMembershipPlan(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return UPGRADE_MEMBERSHIP_PLANS.has(normalized) ? normalized : null;
}

function generateAdminToken() {
  const payload = {
    admin: true,
  };
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production')
    .update(JSON.stringify(payload))
    .update(':')
    .update(String(Date.now()))
    .digest('hex');
}

const activeAdminTokens = new Set();

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token || !activeAdminTokens.has(token)) {
    return res.status(401).json({ error: 'Administrator authentication required' });
  }

  req.admin = { authenticated: true };
  return next();
}

function getPublicBaseUrl(req) {
  const configured = process.env.PUBLIC_APP_URL || process.env.MEDHELP_PUBLIC_URL || process.env.MEDHELP_API_BASE_URL;
  if (configured) {
    return String(configured).replace(/\/+$/, '');
  }
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

function secureStringEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createReviewToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashReviewToken(token) {
  const secret = process.env.REGISTRATION_REVIEW_TOKEN_SECRET
    || process.env.JWT_SECRET
    || 'medautodata-registration-review';
  return crypto
    .createHmac('sha256', secret)
    .update(String(token).trim())
    .digest('hex');
}

function resolveAvatarId(user) {
  return user?.avatar_id || getDefaultAvatarId(`${user?.id || ''}:${user?.username || ''}`);
}

function toPublicAuthUser(user) {
  const trialStatus = getTrialStatus(user);
  const agentApiEnabled = hasAgentApiAccess(user);
  const usage = getAccountUsageStatus(user);
  return {
    id: user.id,
    username: user.username,
    notificationEmail: user.notification_email || null,
    avatarId: resolveAvatarId(user),
    membershipPlan: normalizeMembershipPlan(user.membership_plan, 'free'),
    agentApiEnabled,
    canUseCustomAgentApi: agentApiEnabled,
    agentApiOverrideEnabled: Boolean(user.agent_api_enabled),
    trialStartedAt: trialStatus.trialStartedAt,
    trialExpiresAt: trialStatus.trialExpiresAt,
    trialRemainingMs: trialStatus.trialRemainingMs,
    trialRemainingSeconds: trialStatus.trialRemainingSeconds,
    trialRemainingDays: trialStatus.trialRemainingDays,
    isTrialExpired: trialStatus.isTrialExpired,
    usage,
    usageUsedBytes: usage.usedBytes,
    usageQuotaBytes: usage.quotaBytes,
    usageRemainingBytes: usage.remainingBytes,
    usageBaselineBytes: usage.baselineBytes,
    usageBaselineUpdatedAt: usage.baselineUpdatedAt,
    usagePercent: usage.usagePercent,
    isUsageExceeded: usage.isUsageExceeded,
  };
}

function toAdminUser(user) {
  if (!user) {
    return null;
  }

  const trialStatus = getTrialStatus(user);
  const agentApiEnabled = hasAgentApiAccess(user);
  const usage = getAccountUsageStatus(user);
  return {
    id: Number(user.id),
    username: user.username,
    notificationEmail: user.notification_email || null,
    avatarId: resolveAvatarId(user),
    createdAt: user.created_at || null,
    lastLogin: user.last_login || null,
    isActive: user.is_active !== 0,
    membershipPlan: normalizeMembershipPlan(user.membership_plan, 'free'),
    usage,
    usageQuotaOverrideBytes: usage.quotaOverrideBytes,
    usageQuotaOverrideMb: usage.quotaOverrideMb,
    usageUsedBytes: usage.usedBytes,
    usageQuotaBytes: usage.quotaBytes,
    usageQuotaMb: usage.quotaMb,
    usageRemainingBytes: usage.remainingBytes,
    usageRemainingMb: usage.remainingMb,
    usageTotalStorageBytes: usage.totalStorageBytes,
    usageTotalStorageMb: usage.totalStorageMb,
    usageBaselineBytes: usage.baselineBytes,
    usageBaselineMb: usage.baselineMb,
    usageBaselineUpdatedAt: usage.baselineUpdatedAt,
    usagePercent: usage.usagePercent,
    isUsageExceeded: usage.isUsageExceeded,
    agentApiEnabled,
    canUseCustomAgentApi: agentApiEnabled,
    agentApiOverrideEnabled: Boolean(user.agent_api_enabled),
    trialStartedAt: trialStatus.trialStartedAt,
    trialExpiresAt: trialStatus.trialExpiresAt,
    trialRemainingMs: trialStatus.trialRemainingMs,
    trialRemainingSeconds: trialStatus.trialRemainingSeconds,
    trialRemainingDays: trialStatus.trialRemainingDays,
    isTrialExpired: trialStatus.isTrialExpired,
    projectCount: Number(user.project_count || 0),
  };
}

function isPathInside(candidatePath, parentPath) {
  if (!candidatePath || !parentPath) {
    return false;
  }

  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function hasWorkspaceDeletionMarker(projectPath) {
  const markerNames = ['.medhelp', '.med-help', '.claude', '.agents'];
  for (const markerName of markerNames) {
    if (await pathExists(path.join(projectPath, markerName))) {
      return true;
    }
  }

  const stageFolders = ['Literature', 'Ideation', 'Experiment', 'Publication', 'Promotion'];
  let stageFolderCount = 0;
  for (const folderName of stageFolders) {
    if (await pathExists(path.join(projectPath, folderName))) {
      stageFolderCount += 1;
    }
  }
  return stageFolderCount >= 2;
}

async function resolveSafeProjectDeletionPath(project) {
  const rawProjectPath = typeof project?.path === 'string' ? project.path.trim() : '';
  if (!rawProjectPath) {
    return { ok: false, reason: 'Project path is empty' };
  }

  const resolvedPath = path.resolve(rawProjectPath);
  const rootPath = path.parse(resolvedPath).root;
  const homePath = path.resolve(os.homedir());
  const appPath = path.resolve(process.cwd());

  if (
    resolvedPath === rootPath
    || resolvedPath === homePath
    || resolvedPath === path.dirname(homePath)
    || resolvedPath === appPath
    || isPathInside(resolvedPath, appPath)
    || isPathInside(appPath, resolvedPath)
  ) {
    return { ok: false, reason: 'Project path is too broad to delete safely' };
  }

  let stats;
  try {
    stats = await fs.stat(resolvedPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: false, reason: 'Project path does not exist' };
    }
    return { ok: false, reason: error.message };
  }

  if (!stats.isDirectory()) {
    return { ok: false, reason: 'Project path is not a directory' };
  }

  const workspaceRoot = process.env.WORKSPACES_ROOT
    ? path.resolve(process.env.WORKSPACES_ROOT)
    : null;
  const insideConfiguredWorkspace = workspaceRoot
    ? isPathInside(resolvedPath, workspaceRoot)
    : false;
  const hasMarker = await hasWorkspaceDeletionMarker(resolvedPath);

  if (!insideConfiguredWorkspace && !hasMarker) {
    return { ok: false, reason: 'Project path does not contain MedHelp workspace markers' };
  }

  return { ok: true, path: resolvedPath };
}

async function deleteOwnedProjectFiles(projects) {
  const deleted = [];
  const skipped = [];

  for (const project of projects) {
    const safeTarget = await resolveSafeProjectDeletionPath(project);
    if (!safeTarget.ok) {
      skipped.push({
        id: project.id,
        path: project.path,
        reason: safeTarget.reason,
      });
      continue;
    }

    try {
      await fs.rm(safeTarget.path, { recursive: true, force: true });
      deleted.push({ id: project.id, path: safeTarget.path });
    } catch (error) {
      skipped.push({
        id: project.id,
        path: safeTarget.path,
        reason: error.message,
      });
    }
  }

  return { deleted, skipped };
}

// Check auth status
router.get('/status', async (req, res) => {
  res.json({
    needsSetup: !isRegistrationReviewEnabled() && !userDb.hasUsers(),
    isAuthenticated: false,
    registrationReviewEnabled: isRegistrationReviewEnabled()
  });
});

router.get('/admin/status', (req, res) => {
  res.json({
    adminConfigured: Boolean(getAdminUsername() && getAdminPassword()),
    registrationReviewEnabled: isRegistrationReviewEnabled(),
    mailConfigured: hasRegistrationReviewMailConfig(),
    mailSettings: getRegistrationReviewMailSettings(),
    usageQuotaSettings: getUsageQuotaSettings(),
    activeUsers: userDb.countActiveUsers(),
    maxUsers: getMaxUsers(),
  });
});

router.post('/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const adminUsername = getAdminUsername();
  const adminPassword = getAdminPassword();
  if (!adminUsername || !adminPassword) {
    return res.status(503).json({ error: 'Administrator account is not configured' });
  }

  const submittedUsername = String(username || '');
  const submittedPassword = String(password || '');
  if (
    !secureStringEquals(submittedUsername, adminUsername)
    || !secureStringEquals(submittedPassword, adminPassword)
  ) {
    return res.status(401).json({ error: 'Invalid administrator username or password' });
  }

  const token = generateAdminToken();
  activeAdminTokens.add(token);
  return res.json({ success: true, token });
});

router.get('/admin/users', requireAdmin, (req, res) => {
  const users = userDb.listAdminUsers().map(toAdminUser);
  res.json({ users });
});

router.get('/admin/usage-settings', requireAdmin, (_req, res) => {
  res.json({ settings: getUsageQuotaSettings() });
});

router.put('/admin/usage-settings', requireAdmin, (req, res) => {
  const settings = updateUsageQuotaSettings({
    enabled: req.body?.enabled,
    planQuotasMb: req.body?.planQuotasMb,
  });
  res.json({ success: true, settings });
});

router.patch('/admin/users/:id/membership', requireAdmin, (req, res) => {
  const membershipPlan = normalizeSubmittedMembershipPlan(req.body?.membershipPlan);
  if (!membershipPlan) {
    return res.status(400).json({ error: 'Invalid membership plan' });
  }

  const user = userDb.updateMembershipPlan(req.params.id, membershipPlan);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  membershipUpgradeRequestDb.resolvePendingForUser(
    req.params.id,
    'approved',
    `Membership set to ${membershipPlan} by administrator`,
    membershipPlan,
  );

  return res.json({ success: true, user: toAdminUser(user) });
});

router.patch('/admin/users/:id/usage-quota', requireAdmin, (req, res) => {
  const quotaInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'usageQuotaMb')
    ? req.body.usageQuotaMb
    : req.body?.quotaMb;
  const quota = normalizeUsageQuotaOverrideBytes(quotaInput);
  if (quota.error) {
    return res.status(400).json({ error: quota.error });
  }

  const user = userDb.updateUsageQuota(req.params.id, quota.bytes);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({
    success: true,
    user: toAdminUser(user),
    usageQuotaMb: bytesToMb(quota.bytes),
  });
});

router.post('/admin/users/:id/usage-reset', requireAdmin, (req, res) => {
  const user = userDb.getAdminUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const baselineBytes = getUserStorageUsageBytes(user.id, { forceRefresh: true });
  const updatedUser = userDb.updateUsageBaseline(user.id, baselineBytes);
  return res.json({
    success: true,
    user: toAdminUser(updatedUser),
    baselineBytes,
    baselineMb: bytesToMb(baselineBytes),
  });
});

router.patch('/admin/users/:id/agent-api-access', requireAdmin, (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  const user = userDb.updateAgentApiAccess(req.params.id, enabled);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({ success: true, user: toAdminUser(user) });
});

router.patch('/admin/users/:id/trial', requireAdmin, (req, res) => {
  const trialPatch = buildTrialPatch(req.body || {});
  if (trialPatch && typeof trialPatch === 'object' && trialPatch.error) {
    return res.status(400).json({ error: trialPatch.error });
  }

  const user = userDb.updateTrialExpiration(req.params.id, trialPatch);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({ success: true, user: toAdminUser(user) });
});

router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = userDb.getAdminUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const confirmUsername = String(req.body?.confirmUsername || '').trim();
    if (confirmUsername !== user.username) {
      return res.status(400).json({ error: 'Username confirmation does not match' });
    }

    const deleteFiles = Boolean(req.body?.deleteFiles);
    const projects = projectDb.getAllProjects(user.id);
    const fileDeletion = deleteFiles
      ? await deleteOwnedProjectFiles(projects)
      : { deleted: [], skipped: projects.map((project) => ({ id: project.id, path: project.path, reason: 'File deletion was not requested' })) };

    const deleted = db.transaction(() => {
      for (const project of projects) {
        sessionDb.deleteSessionsByProject(project.id);
      }
      return userDb.deleteUser(user.id);
    })();

    if (!deleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      success: true,
      deletedUser: {
        id: Number(user.id),
        username: user.username,
      },
      deletedProjectRecords: projects.length,
      fileDeletion,
    });
  } catch (error) {
    console.error('Admin delete user error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin/registration-requests', requireAdmin, (req, res) => {
  const status = String(req.query.status || '').trim();
  const requests = registrationRequestDb.list(status || null);
  res.json({ requests });
});

router.get('/admin/membership-upgrade-requests', requireAdmin, (req, res) => {
  const status = String(req.query.status || '').trim();
  const requests = membershipUpgradeRequestDb.list(status || null);
  res.json({ requests });
});

router.put('/admin/mail-settings', requireAdmin, (req, res) => {
  const settings = updateRegistrationReviewMailSettings({
    adminEmail: req.body?.adminEmail,
    senderEmail: req.body?.senderEmail,
    resendApiKey: req.body?.resendApiKey,
  });
  res.json({ success: true, settings });
});

router.get('/admin/agent-api-profiles', requireAdmin, (_req, res) => {
  res.json({
    profiles: agentApiProfilesDb.listSystemProfiles(),
    strategy: agentApiProfilesDb.getSystemStrategy(),
  });
});

router.put('/admin/agent-api-profiles/strategy', requireAdmin, (req, res) => {
  const strategy = agentApiProfilesDb.setSystemStrategy(req.body?.strategy);
  res.json({ success: true, strategy });
});

router.post('/admin/agent-api-profiles', requireAdmin, (req, res) => {
  try {
    const profile = agentApiProfilesDb.createSystemProfile(buildAgentApiProfilePayload(req.body || {}));
    res.status(201).json({ profile });
  } catch (error) {
    console.error('Admin create agent API profile error:', error);
    res.status(400).json({ error: error.message || 'Failed to create agent API profile' });
  }
});

router.patch('/admin/agent-api-profiles/:id', requireAdmin, (req, res) => {
  try {
    const profile = agentApiProfilesDb.updateSystemProfile(req.params.id, buildAgentApiProfilePayload(req.body || {}));
    if (!profile) {
      return res.status(404).json({ error: 'Agent API profile not found' });
    }
    res.json({ success: true, profile });
  } catch (error) {
    console.error('Admin update agent API profile error:', error);
    res.status(400).json({ error: error.message || 'Failed to update agent API profile' });
  }
});

router.delete('/admin/agent-api-profiles/:id', requireAdmin, (req, res) => {
  const deleted = agentApiProfilesDb.deleteSystemProfile(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Agent API profile not found' });
  }
  res.json({ success: true });
});

router.post('/admin/registration-requests/:id/approve', requireAdmin, (req, res) => {
  try {
    const request = registrationRequestDb.getById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Registration request not found' });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Registration request has already been ${request.status}` });
    }
    if (isUserCapacityFull()) {
      return res.status(403).json({ error: 'User capacity has been reached' });
    }
    if (userDb.getUserByUsername(request.username)) {
      registrationRequestDb.reject(request.id, 'Username already exists at approval time');
      return res.status(409).json({ error: 'Username already exists' });
    }

    const user = db.transaction(() => {
      const createdUser = userDb.createUser(request.username, request.password_hash, request.notification_email);
      registrationRequestDb.approve(request.id, createdUser.id);
      return createdUser;
    })();

    res.json({ success: true, user: toPublicAuthUser(user) });
  } catch (error) {
    console.error('Admin approve registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/registration-requests/:id/reject', requireAdmin, (req, res) => {
  const request = registrationRequestDb.getById(req.params.id);
  if (!request) {
    return res.status(404).json({ error: 'Registration request not found' });
  }
  if (request.status !== 'pending') {
    return res.status(409).json({ error: `Registration request has already been ${request.status}` });
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  const updated = registrationRequestDb.reject(request.id, note || 'Rejected by administrator');
  res.json({ success: true, request: updated });
});

router.post('/admin/membership-upgrade-requests/:id/approve', requireAdmin, (req, res) => {
  try {
    const request = membershipUpgradeRequestDb.getById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Membership upgrade request not found' });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Membership upgrade request has already been ${request.status}` });
    }

    const result = db.transaction(() => {
      const user = userDb.updateMembershipPlan(request.user_id, request.requested_plan);
      const updatedRequest = membershipUpgradeRequestDb.approve(request.id, 'Approved by administrator');
      return { user, request: updatedRequest };
    })();

    return res.json({ success: true, user: toAdminUser(result.user), request: result.request });
  } catch (error) {
    console.error('Admin approve membership upgrade error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/membership-upgrade-requests/:id/reject', requireAdmin, (req, res) => {
  const request = membershipUpgradeRequestDb.getById(req.params.id);
  if (!request) {
    return res.status(404).json({ error: 'Membership upgrade request not found' });
  }
  if (request.status !== 'pending') {
    return res.status(409).json({ error: `Membership upgrade request has already been ${request.status}` });
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  const updated = membershipUpgradeRequestDb.reject(request.id, note || 'Rejected by administrator');
  return res.json({ success: true, request: updated });
});

// User registration (setup)
router.post('/register', async (req, res) => {
  try {
    const { username, password, notificationEmail } = req.body;
    const normalizedUsername = String(username || '').trim();

    // Validate input
    if (!normalizedUsername || !password || !notificationEmail) {
      return res.status(400).json({ error: 'Username, password, and email are required' });
    }

    if (normalizedUsername.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
    }

    const email = String(notificationEmail).trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (isUserCapacityFull()) {
      return res.status(403).json({ error: 'User capacity has been reached' });
    }

    // Check if user already exists
    const existingUser = userDb.getUserByUsername(normalizedUsername);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    if (!isRegistrationReviewEnabled()) {
      return res.status(503).json({ error: 'Registration review is not enabled' });
    }

    const existingPendingRequest = registrationRequestDb.getPendingByUsernameOrEmail(normalizedUsername, email);
    if (existingPendingRequest) {
      return res.status(409).json({ error: REGISTRATION_REVIEW_ALREADY_PENDING_ERROR });
    }

    const reviewToken = createReviewToken();
    const request = registrationRequestDb.create({
      username: normalizedUsername,
      notificationEmail: email,
      passwordHash,
      reviewTokenHash: hashReviewToken(reviewToken),
      requestIp: req.ip || null,
      userAgent: req.get('user-agent') || null,
    });

    const baseUrl = getPublicBaseUrl(req);
    const tokenParam = encodeURIComponent(reviewToken);
    let reviewEmailSent = false;
    if (hasRegistrationReviewMailConfig()) {
      await sendRegistrationReviewEmail({
        request,
        approveUrl: `${baseUrl}/api/auth/registration-requests/review?token=${tokenParam}&action=approve`,
        rejectUrl: `${baseUrl}/api/auth/registration-requests/review?token=${tokenParam}&action=reject`,
      });
      reviewEmailSent = true;
    } else {
      console.warn('[RegistrationReview] Request saved but review email is not configured');
    }

    return res.status(202).json({
      success: true,
      pendingReview: true,
      reviewEmailSent,
      message: REGISTRATION_REVIEW_PENDING_MESSAGE,
    });

  } catch (error) {
    console.error('Registration error:', error);
    if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.get('/registration-requests/review', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    const action = String(req.query.action || '').trim().toLowerCase();

    if (!token || !['approve', 'reject'].includes(action)) {
      return res.status(400).send('Invalid registration review link.');
    }

    const request = registrationRequestDb.getByTokenHash(hashReviewToken(token));
    if (!request) {
      return res.status(404).send('Registration request not found.');
    }

    if (request.status !== 'pending') {
      return res.status(409).send(`Registration request has already been ${request.status}.`);
    }

    if (action === 'reject') {
      registrationRequestDb.reject(request.id, 'Rejected from email review link');
      return res.send('Registration request rejected. No account was created.');
    }

    if (isUserCapacityFull()) {
      return res.status(403).send('Cannot approve: user capacity has been reached.');
    }

    const existingUser = userDb.getUserByUsername(request.username);
    if (existingUser) {
      registrationRequestDb.reject(request.id, 'Username already exists at approval time');
      return res.status(409).send('Cannot approve: username already exists.');
    }

    const user = db.transaction(() => {
      const createdUser = userDb.createUser(
        request.username,
        request.password_hash,
        request.notification_email,
      );
      registrationRequestDb.approve(request.id, createdUser.id);
      return createdUser;
    })();

    return res.send(`Registration approved for ${user.username}. The user can now sign in.`);
  } catch (error) {
    console.error('Registration review error:', error);
    if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).send('Cannot approve: username already exists.');
    }
    return res.status(500).send('Internal server error');
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Get user from database
    const user = userDb.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Generate token
    const token = generateToken(user);

    // Update last login
    userDb.updateLastLogin(user.id);

    res.json({
      success: true,
      user: toPublicAuthUser(user),
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: toPublicAuthUser(req.user),
  });
});

router.post('/membership-upgrade-requests', authenticateToken, (req, res) => {
  const requestedPlan = normalizeUpgradeMembershipPlan(req.body?.membershipPlan);
  if (!requestedPlan) {
    return res.status(400).json({ error: 'Invalid membership upgrade target' });
  }

  const currentPlan = normalizeMembershipPlan(req.user?.membership_plan, 'free');
  if ((MEMBERSHIP_PLAN_RANK[requestedPlan] ?? 0) <= (MEMBERSHIP_PLAN_RANK[currentPlan] ?? 0)) {
    return res.status(400).json({ error: 'Requested plan must be higher than current plan' });
  }

  const request = membershipUpgradeRequestDb.createOrUpdatePending({
    userId: req.user.id,
    username: req.user.username,
    currentPlan,
    requestedPlan,
    requestIp: req.ip || null,
    userAgent: req.headers['user-agent'] || null,
  });

  return res.json({ success: true, request });
});

// Logout (client-side token removal, but this endpoint can be used for logging)
router.post('/logout', authenticateToken, (req, res) => {
  // In a simple JWT system, logout is mainly client-side
  // This endpoint exists for consistency and potential future logging
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
