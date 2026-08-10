import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveAvailableCliCommand } from '../utils/cliResolution.js';

const router = express.Router();

function buildCliInstallHint(agent) {
  if (agent === 'claude') {
    return 'Claude Code CLI is not installed. Install it first, then retry login.';
  }

  return 'Required CLI is not installed. Install it first, then retry login.';
}

function buildStatusPayload(result, agent) {
  const {
    authenticated,
    email,
    error,
    cliAvailable,
    cliCommand,
    installHint,
    ...extra
  } = result || {};

  return {
    authenticated: Boolean(authenticated),
    email: email || null,
    error: error || null,
    cliAvailable: cliAvailable !== false,
    cliCommand: cliCommand || null,
    installHint: installHint || (cliAvailable === false ? buildCliInstallHint(agent) : null),
    ...extra,
  };
}

router.get('/claude/status', async (_req, res) => {
  try {
    const credentialsResult = await checkClaudeCredentials();

    if (credentialsResult.authenticated) {
      return res.json(buildStatusPayload({
        ...credentialsResult,
        email: credentialsResult.email || 'Authenticated',
        method: 'cli',
      }, 'claude'));
    }

    if (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY) {
      return res.json(buildStatusPayload({
        authenticated: true,
        email: 'Custom API Connected',
        method: 'custom_api',
        cliAvailable: credentialsResult.cliAvailable,
        cliCommand: credentialsResult.cliCommand,
      }, 'claude'));
    }

    return res.json(buildStatusPayload({
      authenticated: false,
      email: null,
      error: credentialsResult.error || 'Not authenticated',
      cliAvailable: credentialsResult.cliAvailable,
      cliCommand: credentialsResult.cliCommand,
      installHint: credentialsResult.installHint,
    }, 'claude'));
  } catch (error) {
    console.error('Error checking Claude auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message,
    });
  }
});

async function checkClaudeCredentials() {
  const resolvedCliCommand = await resolveAvailableCliCommand({
    envVarName: 'CLAUDE_CLI_PATH',
    defaultCommands: ['claude'],
    appendWindowsSuffixes: true,
  });

  if (!resolvedCliCommand) {
    return checkClaudeCredentialsFile({ cliAvailable: false });
  }

  return new Promise((resolve) => {
    let processCompleted = false;

    const timeout = setTimeout(() => {
      if (!processCompleted) {
        processCompleted = true;
        if (childProcess) {
          childProcess.kill();
        }
        checkClaudeCredentialsFile({ cliAvailable: true, cliCommand: resolvedCliCommand }).then(resolve);
      }
    }, 5000);

    let childProcess;
    try {
      childProcess = spawn(resolvedCliCommand, ['auth', 'status', '--json'], {
        env: { ...process.env, CLAUDECODE: '' },
        shell: process.platform === 'win32',
      });
    } catch {
      clearTimeout(timeout);
      checkClaudeCredentialsFile({ cliAvailable: false }).then(resolve);
      return;
    }

    let stdout = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.on('close', (code) => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      if (code === 0 && stdout.trim()) {
        try {
          const status = JSON.parse(stdout.trim());
          if (status.loggedIn) {
            resolve({
              authenticated: true,
              email: status.email || null,
              cliAvailable: true,
              cliCommand: resolvedCliCommand,
            });
            return;
          }
        } catch {
          // Fall through to credentials file check.
        }
      }

      checkClaudeCredentialsFile({ cliAvailable: true, cliCommand: resolvedCliCommand }).then(resolve);
    });

    childProcess.on('error', () => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);
      checkClaudeCredentialsFile({ cliAvailable: true, cliCommand: resolvedCliCommand }).then(resolve);
    });
  });
}

async function checkClaudeCredentialsFile({ cliAvailable = true, cliCommand = 'claude' } = {}) {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(content);

    const oauth = creds.claudeAiOauth;
    if (oauth && oauth.accessToken) {
      const isExpired = oauth.expiresAt && Date.now() >= oauth.expiresAt;

      if (!isExpired) {
        return {
          authenticated: true,
          email: creds.email || creds.user || null,
          cliAvailable,
          cliCommand,
        };
      }
    }
  } catch {
    // Missing or invalid credentials file means "not authenticated".
  }

  return {
    authenticated: false,
    email: null,
    cliAvailable,
    cliCommand,
    error: cliAvailable ? null : 'Claude Code CLI not installed',
    installHint: cliAvailable ? null : buildCliInstallHint('claude'),
  };
}

export default router;
