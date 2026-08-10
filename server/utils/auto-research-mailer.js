import fetch from 'node-fetch';
import { appSettingsDb } from '../database/db.js';

const AUTO_RESEARCH_SENDER_EMAIL_KEY = 'auto_research_sender_email';
const AUTO_RESEARCH_RESEND_API_KEY = 'auto_research_resend_api_key';

function hasMailConfig() {
  return Boolean(
    appSettingsDb.get(AUTO_RESEARCH_RESEND_API_KEY)
    && appSettingsDb.get(AUTO_RESEARCH_SENDER_EMAIL_KEY),
  );
}

export async function sendAutoResearchCompletionEmail({ toEmail, run, projectName }) {
  if (!hasMailConfig()) {
    console.warn('[AutoResearch] Email skipped: RESEND_API_KEY or Auto Research sender email not configured');
    return { sent: false, skipped: true, reason: 'missing_config' };
  }

  const senderEmail = appSettingsDb.get(AUTO_RESEARCH_SENDER_EMAIL_KEY);
  const resendApiKey = appSettingsDb.get(AUTO_RESEARCH_RESEND_API_KEY);

  const status = String(run?.status || 'completed');
  const subject = status === 'completed'
    ? `Auto Research completed for ${projectName}`
    : `Auto Research ${status} for ${projectName}`;

  const summary = [
    `Project: ${projectName}`,
    `Provider: ${run?.provider || 'claude'}`,
    `Status: ${status}`,
    `Completed tasks: ${run?.completed_tasks ?? 0}/${run?.total_tasks ?? 0}`,
    run?.finished_at ? `Finished at: ${run.finished_at}` : null,
    run?.error ? `Error: ${run.error}` : null,
  ].filter(Boolean).join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: senderEmail,
      to: [toEmail],
      subject,
      text: summary,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend email failed: ${response.status} ${errorBody}`);
  }

  return { sent: true };
}
