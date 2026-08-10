import fetch from 'node-fetch';
import { appSettingsDb } from '../database/db.js';

const AUTO_RESEARCH_SENDER_EMAIL_KEY = 'auto_research_sender_email';
const AUTO_RESEARCH_RESEND_API_KEY = 'auto_research_resend_api_key';
const REGISTRATION_REVIEW_ADMIN_EMAIL_KEY = 'registration_review_admin_email';
const REGISTRATION_REVIEW_SENDER_EMAIL_KEY = 'registration_review_sender_email';
const REGISTRATION_REVIEW_RESEND_API_KEY = 'registration_review_resend_api_key';

function getMailConfig() {
  return {
    resendApiKey: process.env.REGISTRATION_REVIEW_RESEND_API_KEY
      || appSettingsDb.get(REGISTRATION_REVIEW_RESEND_API_KEY)
      || appSettingsDb.get(AUTO_RESEARCH_RESEND_API_KEY),
    senderEmail: process.env.REGISTRATION_REVIEW_SENDER_EMAIL
      || appSettingsDb.get(REGISTRATION_REVIEW_SENDER_EMAIL_KEY)
      || appSettingsDb.get(AUTO_RESEARCH_SENDER_EMAIL_KEY),
    adminEmail: process.env.REGISTRATION_REVIEW_ADMIN_EMAIL
      || appSettingsDb.get(REGISTRATION_REVIEW_ADMIN_EMAIL_KEY),
  };
}

export function hasRegistrationReviewMailConfig() {
  const config = getMailConfig();
  return Boolean(config.resendApiKey && config.senderEmail && config.adminEmail);
}

export function getRegistrationReviewMailSettings() {
  const config = getMailConfig();
  return {
    adminEmail: config.adminEmail || '',
    senderEmail: config.senderEmail || '',
    hasResendApiKey: Boolean(config.resendApiKey),
    configured: Boolean(config.resendApiKey && config.senderEmail && config.adminEmail),
    adminEmailLockedByEnv: Boolean(process.env.REGISTRATION_REVIEW_ADMIN_EMAIL),
    senderEmailLockedByEnv: Boolean(process.env.REGISTRATION_REVIEW_SENDER_EMAIL),
    resendApiKeyLockedByEnv: Boolean(process.env.REGISTRATION_REVIEW_RESEND_API_KEY),
  };
}

export function updateRegistrationReviewMailSettings({ adminEmail, senderEmail, resendApiKey }) {
  if (!process.env.REGISTRATION_REVIEW_ADMIN_EMAIL && typeof adminEmail === 'string') {
    appSettingsDb.set(REGISTRATION_REVIEW_ADMIN_EMAIL_KEY, adminEmail.trim());
  }
  if (!process.env.REGISTRATION_REVIEW_SENDER_EMAIL && typeof senderEmail === 'string') {
    appSettingsDb.set(REGISTRATION_REVIEW_SENDER_EMAIL_KEY, senderEmail.trim());
  }
  if (!process.env.REGISTRATION_REVIEW_RESEND_API_KEY && typeof resendApiKey === 'string' && resendApiKey.trim()) {
    appSettingsDb.set(REGISTRATION_REVIEW_RESEND_API_KEY, resendApiKey.trim());
  }

  return getRegistrationReviewMailSettings();
}

export async function sendRegistrationReviewEmail({ request, approveUrl, rejectUrl }) {
  const config = getMailConfig();
  if (!config.resendApiKey || !config.senderEmail || !config.adminEmail) {
    console.warn('[RegistrationReview] Email skipped: review email config is incomplete');
    return { sent: false, skipped: true, reason: 'missing_config' };
  }

  const subject = `MedHelp registration request: ${request.username}`;
  const text = [
    'A new MedHelp account registration request is waiting for review.',
    '',
    `Username: ${request.username}`,
    `Email: ${request.notification_email}`,
    `Requested at: ${request.requested_at}`,
    request.request_ip ? `IP: ${request.request_ip}` : null,
    request.user_agent ? `User-Agent: ${request.user_agent}` : null,
    '',
    `Approve: ${approveUrl}`,
    `Reject: ${rejectUrl}`,
  ].filter(Boolean).join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.senderEmail,
      to: [config.adminEmail],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Registration review email failed: ${response.status} ${errorBody}`);
  }

  return { sent: true };
}
