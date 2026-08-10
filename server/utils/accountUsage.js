import fs from 'fs';
import path from 'path';
import { appSettingsDb, projectDb } from '../database/db.js';
import { normalizeMembershipPlan } from '../../shared/modelConstants.js';

export const USAGE_QUOTA_EXCEEDED_ERROR = 'Account usage quota has been exhausted';
export const USAGE_QUOTA_SETTINGS_KEY = 'account_usage_quota_settings';
export const BYTES_PER_MB = 1024 * 1024;

export const DEFAULT_USAGE_QUOTA_SETTINGS = {
  enabled: true,
  planQuotasMb: {
    free: 50,
    plus: 100,
    pro: 500,
  },
};

const PLAN_KEYS = ['free', 'plus', 'pro'];
const CACHE_TTL_MS = 5_000;
const MAX_QUOTA_MB = 1024 * 1024;
const SKIPPED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'coverage',
  '.cache',
]);

const usageCache = new Map();

function normalizeQuotaMb(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(MAX_QUOTA_MB, Math.round(parsed * 100) / 100);
}

function quotaMbToBytes(value) {
  return Math.round(normalizeQuotaMb(value, 0) * BYTES_PER_MB);
}

function normalizeSettingsPayload(payload = {}) {
  const current = payload && typeof payload === 'object' ? payload : {};
  const planQuotas = current.planQuotasMb && typeof current.planQuotasMb === 'object'
    ? current.planQuotasMb
    : {};

  return {
    enabled: current.enabled !== false,
    planQuotasMb: PLAN_KEYS.reduce((result, plan) => {
      result[plan] = normalizeQuotaMb(
        planQuotas[plan],
        DEFAULT_USAGE_QUOTA_SETTINGS.planQuotasMb[plan],
      );
      return result;
    }, {}),
  };
}

export function normalizeUsageQuotaSettings(rawValue = null) {
  if (!rawValue) {
    return normalizeSettingsPayload(DEFAULT_USAGE_QUOTA_SETTINGS);
  }

  if (typeof rawValue === 'string') {
    try {
      return normalizeSettingsPayload(JSON.parse(rawValue));
    } catch {
      return normalizeSettingsPayload(DEFAULT_USAGE_QUOTA_SETTINGS);
    }
  }

  return normalizeSettingsPayload(rawValue);
}

export function getUsageQuotaSettings() {
  return normalizeUsageQuotaSettings(appSettingsDb.get(USAGE_QUOTA_SETTINGS_KEY));
}

export function updateUsageQuotaSettings(payload = {}) {
  const current = getUsageQuotaSettings();
  const next = normalizeSettingsPayload({
    enabled: Object.prototype.hasOwnProperty.call(payload, 'enabled')
      ? Boolean(payload.enabled)
      : current.enabled,
    planQuotasMb: {
      ...current.planQuotasMb,
      ...(payload.planQuotasMb && typeof payload.planQuotasMb === 'object' ? payload.planQuotasMb : {}),
    },
  });

  appSettingsDb.set(USAGE_QUOTA_SETTINGS_KEY, JSON.stringify(next));
  usageCache.clear();
  return next;
}

function normalizeDbBytes(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed);
}

export function normalizeUsageQuotaOverrideBytes(value) {
  if (value === null || value === undefined || value === '') {
    return { bytes: null };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_QUOTA_MB) {
    return { error: `Usage quota must be between 0 and ${MAX_QUOTA_MB} MB` };
  }

  return { bytes: quotaMbToBytes(parsed) };
}

export function bytesToMb(value) {
  const bytes = normalizeDbBytes(value);
  if (bytes === null) {
    return null;
  }
  return Math.round((bytes / BYTES_PER_MB) * 100) / 100;
}

function shouldSkipDirectory(entryName) {
  return SKIPPED_DIRECTORY_NAMES.has(String(entryName || '').trim());
}

function getPathSizeBytes(rootPath) {
  const stack = [rootPath];
  let totalBytes = 0;

  while (stack.length > 0) {
    const currentPath = stack.pop();
    let stats;
    try {
      stats = fs.lstatSync(currentPath);
    } catch {
      continue;
    }

    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isFile()) {
      totalBytes += Number(stats.size || 0);
      continue;
    }

    if (!stats.isDirectory()) {
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && shouldSkipDirectory(entry.name)) {
        continue;
      }
      stack.push(path.join(currentPath, entry.name));
    }
  }

  return totalBytes;
}

export function clearAccountUsageCache(userId = null) {
  if (userId === null || userId === undefined) {
    usageCache.clear();
    return;
  }
  usageCache.delete(String(userId));
}

export function getUserStorageUsageBytes(userId, options = {}) {
  if (!userId) {
    return 0;
  }

  const cacheKey = String(userId);
  const now = Date.now();
  const cached = usageCache.get(cacheKey);
  if (!options.forceRefresh && cached && now - cached.createdAt < CACHE_TTL_MS) {
    return cached.usedBytes;
  }

  const projects = projectDb.getAllProjects(userId);
  const seenPaths = new Set();
  let usedBytes = 0;

  for (const project of projects) {
    const rawPath = typeof project?.path === 'string' ? project.path.trim() : '';
    if (!rawPath) {
      continue;
    }

    const resolvedPath = path.resolve(rawPath);
    if (seenPaths.has(resolvedPath)) {
      continue;
    }
    seenPaths.add(resolvedPath);

    try {
      const stats = fs.lstatSync(resolvedPath);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        continue;
      }
    } catch {
      continue;
    }

    usedBytes += getPathSizeBytes(resolvedPath);
  }

  usageCache.set(cacheKey, { createdAt: now, usedBytes });
  return usedBytes;
}

export function getUserUsageBaselineBytes(user) {
  return normalizeDbBytes(user?.usage_baseline_bytes ?? user?.usageBaselineBytes) || 0;
}

export function getAccountUsageStatus(user, options = {}) {
  const settings = getUsageQuotaSettings();
  const membershipPlan = normalizeMembershipPlan(user?.membership_plan || user?.membershipPlan, 'free');
  const planQuotaMb = settings.planQuotasMb[membershipPlan] ?? settings.planQuotasMb.free;
  const planQuotaBytes = quotaMbToBytes(planQuotaMb);
  const quotaOverrideBytes = normalizeDbBytes(user?.usage_quota_bytes ?? user?.usageQuotaBytes);
  const quotaBytes = quotaOverrideBytes !== null ? quotaOverrideBytes : planQuotaBytes;
  const totalStorageBytes = getUserStorageUsageBytes(user?.id || user?.userId, options);
  const baselineBytes = Math.min(getUserUsageBaselineBytes(user), totalStorageBytes);
  const usedBytes = Math.max(0, totalStorageBytes - baselineBytes);
  const remainingBytes = Math.max(0, quotaBytes - usedBytes);
  const usagePercent = quotaBytes > 0
    ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10)
    : (usedBytes > 0 || settings.enabled ? 100 : 0);

  return {
    enabled: settings.enabled,
    unit: 'MB',
    usedBytes,
    usedMb: bytesToMb(usedBytes) ?? 0,
    totalStorageBytes,
    totalStorageMb: bytesToMb(totalStorageBytes) ?? 0,
    baselineBytes,
    baselineMb: bytesToMb(baselineBytes) ?? 0,
    baselineUpdatedAt: user?.usage_baseline_updated_at || user?.usageBaselineUpdatedAt || null,
    quotaBytes,
    quotaMb: bytesToMb(quotaBytes) ?? 0,
    planQuotaBytes,
    planQuotaMb: bytesToMb(planQuotaBytes) ?? 0,
    quotaOverrideBytes,
    quotaOverrideMb: bytesToMb(quotaOverrideBytes),
    remainingBytes,
    remainingMb: bytesToMb(remainingBytes) ?? 0,
    usagePercent,
    isUsageExceeded: Boolean(settings.enabled && usedBytes >= quotaBytes),
  };
}

export function assertAccountUsageAvailable(user, additionalBytes = 0) {
  const normalizedAdditionalBytes = Math.max(0, Number(additionalBytes) || 0);
  const usage = getAccountUsageStatus(user, { forceRefresh: true });
  if (!usage.enabled) {
    return usage;
  }

  if (usage.usedBytes + normalizedAdditionalBytes > usage.quotaBytes) {
    const error = new Error(USAGE_QUOTA_EXCEEDED_ERROR);
    error.statusCode = 403;
    error.usage = {
      ...usage,
      attemptedBytes: normalizedAdditionalBytes,
      projectedUsedBytes: usage.usedBytes + normalizedAdditionalBytes,
    };
    throw error;
  }

  if (normalizedAdditionalBytes === 0 && usage.isUsageExceeded) {
    const error = new Error(USAGE_QUOTA_EXCEEDED_ERROR);
    error.statusCode = 403;
    error.usage = usage;
    throw error;
  }

  return usage;
}
