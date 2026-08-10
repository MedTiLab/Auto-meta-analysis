import express from 'express';
import bcrypt from 'bcrypt';
import { projectActivityDb, projectDb, userDb } from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { getSystemGitConfig } from '../utils/gitConfig.js';
import { getDefaultAvatarId, isValidAvatarId } from '../../shared/avatarCatalog.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getTrialStatus } from '../utils/trialStatus.js';
import { getAccountUsageStatus } from '../utils/accountUsage.js';

const execAsync = promisify(exec);
const router = express.Router();

function normalizeProjectActivityText(value) {
  return String(value || '').trim();
}

function toPublicProfile(profile) {
  if (!profile) return null;
  const trialStatus = getTrialStatus(profile);
  const usage = getAccountUsageStatus(profile);

  return {
    id: profile.id,
    username: profile.username,
    notificationEmail: profile.notification_email || null,
    avatarId: profile.avatar_id || getDefaultAvatarId(`${profile.id}:${profile.username}`),
    membershipPlan: profile.membership_plan || 'free',
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

router.get('/git-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    let gitConfig = userDb.getGitConfig(userId);

    // If database is empty, try to get from system git config
    if (!gitConfig || (!gitConfig.git_name && !gitConfig.git_email)) {
      const systemConfig = await getSystemGitConfig();

      // If system has values, save them to database for this user
      if (systemConfig.git_name || systemConfig.git_email) {
        userDb.updateGitConfig(userId, systemConfig.git_name, systemConfig.git_email);
        gitConfig = systemConfig;
        console.log(`Auto-populated git config from system for user ${userId}: ${systemConfig.git_name} <${systemConfig.git_email}>`);
      }
    }

    res.json({
      success: true,
      gitName: gitConfig?.git_name || null,
      gitEmail: gitConfig?.git_email || null
    });
  } catch (error) {
    console.error('Error getting git config:', error);
    res.status(500).json({ error: 'Failed to get git configuration' });
  }
});

// Apply git config globally via git config --global
router.post('/git-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { gitName, gitEmail } = req.body;

    if (!gitName || !gitEmail) {
      return res.status(400).json({ error: 'Git name and email are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(gitEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    userDb.updateGitConfig(userId, gitName, gitEmail);

    try {
      await execAsync(`git config --global user.name "${gitName.replace(/"/g, '\\"')}"`);
      await execAsync(`git config --global user.email "${gitEmail.replace(/"/g, '\\"')}"`);
      console.log(`Applied git config globally: ${gitName} <${gitEmail}>`);
    } catch (gitError) {
      console.error('Error applying git config:', gitError);
    }

    res.json({
      success: true,
      gitName,
      gitEmail
    });
  } catch (error) {
    console.error('Error updating git config:', error);
    res.status(500).json({ error: 'Failed to update git configuration' });
  }
});

router.post('/complete-onboarding', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    userDb.completeOnboarding(userId);

    res.json({
      success: true,
      message: 'Onboarding completed successfully'
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const profile = userDb.getProfile(userId);

    res.json({
      success: true,
      profile: toPublicProfile(profile)
    });
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};
    const hasNotificationEmail = Object.prototype.hasOwnProperty.call(body, 'notificationEmail');
    const hasAvatarId = Object.prototype.hasOwnProperty.call(body, 'avatarId');

    if (!hasNotificationEmail && !hasAvatarId) {
      return res.status(400).json({ error: 'No profile updates provided' });
    }

    const updates = {};

    if (hasNotificationEmail) {
      const rawEmail = typeof body.notificationEmail === 'string' ? body.notificationEmail.trim().toLowerCase() : '';

      if (!rawEmail) {
        return res.status(400).json({ error: 'Notification email is required' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(rawEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      updates.notificationEmail = rawEmail;
    }

    if (hasAvatarId) {
      const avatarId = typeof body.avatarId === 'string' ? body.avatarId.trim() : '';
      if (!isValidAvatarId(avatarId)) {
        return res.status(400).json({ error: 'Invalid avatar selection' });
      }

      updates.avatarId = avatarId;
    }

    const profile = userDb.updateProfile(userId, updates);

    res.json({
      success: true,
      profile: toPublicProfile(profile)
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

router.get('/project-activity', authenticateToken, async (req, res) => {
  try {
    const days = Number.parseInt(req.query.days, 10) || 365;
    const timezoneOffsetMinutes = Number.parseInt(req.query.timezoneOffsetMinutes, 10) || 0;
    const activity = projectActivityDb.getActivity(req.user.id, {
      days,
      timezoneOffsetMinutes,
    });

    res.json({ activity });
  } catch (error) {
    console.error('Error reading project activity:', error);
    res.status(500).json({ error: 'Failed to read project activity' });
  }
});

router.post('/project-activity/open', authenticateToken, async (req, res) => {
  try {
    const projectId = normalizeProjectActivityText(
      req.body?.projectId || req.body?.projectName || req.body?.name,
    );
    if (!projectId) {
      return res.status(400).json({ error: 'Project id is required' });
    }

    const existingProject = projectDb.getProjectById(projectId);
    if (existingProject?.user_id != null && Number(existingProject.user_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const source = normalizeProjectActivityText(req.body?.source || 'project_select') || 'project_select';
    const event = projectActivityDb.recordProjectOpen(req.user.id, {
      projectId,
      projectPath: normalizeProjectActivityText(req.body?.projectPath || req.body?.path || req.body?.fullPath) || null,
      metadata: {
        source,
        displayName: normalizeProjectActivityText(req.body?.displayName) || null,
      },
    });

    res.json({ success: true, event });
  } catch (error) {
    console.error('Error recording project activity:', error);
    res.status(500).json({ error: 'Failed to record project activity' });
  }
});

router.post('/password', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = userDb.getUserAuthById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = userDb.updatePassword(userId, passwordHash);
    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

router.get('/onboarding-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const hasCompleted = userDb.hasCompletedOnboarding(userId);

    res.json({
      success: true,
      hasCompletedOnboarding: hasCompleted
    });
  } catch (error) {
    console.error('Error checking onboarding status:', error);
    res.status(500).json({ error: 'Failed to check onboarding status' });
  }
});

export default router;
