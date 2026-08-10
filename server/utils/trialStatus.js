export const TRIAL_EXPIRED_ERROR = 'Account trial has expired';

export function parseTrialDate(value) {
  if (!value) {
    return null;
  }

  const rawValue = String(value).trim();
  if (!rawValue) {
    return null;
  }

  const sqliteTimestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  if (sqliteTimestampPattern.test(rawValue)) {
    const date = new Date(`${rawValue.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const isoWithoutTimezonePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  if (isoWithoutTimezonePattern.test(rawValue)) {
    const date = new Date(`${rawValue}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(rawValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getTrialStatus(user, now = new Date()) {
  const trialStartedAt = user?.trial_started_at || null;
  const trialExpiresAt = user?.trial_expires_at || null;
  const expiresAtDate = parseTrialDate(trialExpiresAt);
  const remainingMs = expiresAtDate ? Math.max(0, expiresAtDate.getTime() - now.getTime()) : null;
  const isExpired = Boolean(expiresAtDate && remainingMs === 0);
  const trialRemainingDays = remainingMs === null ? null : Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

  return {
    trialStartedAt,
    trialExpiresAt,
    trialRemainingMs: remainingMs,
    trialRemainingSeconds: remainingMs === null ? null : Math.ceil(remainingMs / 1000),
    trialRemainingDays,
    isTrialExpired: isExpired,
  };
}

export function isTrialExpired(user, now = new Date()) {
  return getTrialStatus(user, now).isTrialExpired;
}

export function normalizeTrialExpiresAt(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const rawValue = String(value).trim();
  if (!rawValue) {
    return null;
  }

  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return { error: 'Invalid trial expiration time' };
  }

  return parsedDate.toISOString();
}

export function buildTrialPatch(body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, 'trialExpiresAt')) {
    return normalizeTrialExpiresAt(body.trialExpiresAt);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'trialDays')) {
    const trialDays = Number(body.trialDays);
    if (!Number.isFinite(trialDays) || trialDays < 0 || trialDays > 3650) {
      return { error: 'Trial days must be between 0 and 3650' };
    }

    return new Date(Date.now() + Math.round(trialDays * 24 * 60 * 60 * 1000)).toISOString();
  }

  return { error: 'Trial expiration time is required' };
}
