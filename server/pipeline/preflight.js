import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { constants as fsConstants, promises as fs } from 'fs';

import { CLAUDE_MODELS, isClaudeModelSelectionSupported } from '../../shared/modelConstants.js';
import { validateAutoResearchStageContract } from './contracts.js';
import { resolveAvailableCliCommand } from '../utils/cliResolution.js';

function createCheck(name, status, detail, fix = null) {
  return {
    name,
    status,
    detail,
    ...(fix ? { fix } : {}),
  };
}

function getSupportedModels(provider) {
  return CLAUDE_MODELS.OPTIONS.map((entry) => entry.value);
}

function isModelValidForProvider(provider, model) {
  if (!model || typeof model !== 'string' || !model.trim()) {
    return false;
  }
  return provider === 'claude' && isClaudeModelSelectionSupported(model);
}

async function checkPathWritable(targetPath) {
  try {
    await fs.access(targetPath, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function canPrepareRunsDirectory(projectPath) {
  const runsDir = path.join(projectPath, '.pipeline', 'runs');
  try {
    await fs.mkdir(runsDir, { recursive: true });
    return {
      ok: true,
      runsDir,
    };
  } catch (error) {
    return {
      ok: false,
      runsDir,
      error: error.message,
    };
  }
}

async function loadClaudeCredentialState(env = process.env, homeDir = os.homedir()) {
  if (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY) {
    return { authenticated: true, detail: 'Anthropic credentials found in environment' };
  }

  try {
    const credPath = path.join(homeDir, '.claude', '.credentials.json');
    const content = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(content);
    const oauth = creds?.claudeAiOauth;
    const hasToken = Boolean(oauth?.accessToken);
    const isExpired = Boolean(oauth?.expiresAt && Date.now() >= oauth.expiresAt);
    if (hasToken && !isExpired) {
      return { authenticated: true, detail: 'Claude credentials file is present' };
    }
  } catch {}

  const cliAuthState = await loadClaudeCliAuthState(env);
  if (cliAuthState?.authenticated) {
    return cliAuthState;
  }

  return {
    authenticated: false,
    detail: 'Claude credentials were not found',
    fix: 'Run Claude login or set ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY before starting Auto Research.',
  };
}

async function loadClaudeCliAuthState(env = process.env) {
  const cliCommand = await resolveAvailableCliCommand({
    envVarName: 'CLAUDE_CLI_PATH',
    defaultCommands: ['claude'],
    appendWindowsSuffixes: true,
  });

  if (!cliCommand) {
    return null;
  }

  return new Promise((resolve) => {
    let completed = false;
    let childProcess = null;

    const finish = (result) => {
      if (completed) {
        return;
      }
      completed = true;
      if (childProcess) {
        childProcess.kill();
      }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish(null);
    }, 5000);

    try {
      childProcess = spawn(cliCommand, ['auth', 'status', '--json'], {
        env: { ...process.env, ...env, CLAUDECODE: '' },
        shell: process.platform === 'win32',
      });
    } catch {
      clearTimeout(timeout);
      finish(null);
      return;
    }

    let stdout = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !stdout.trim()) {
        finish(null);
        return;
      }

      try {
        const status = JSON.parse(stdout.trim());
        if (status.loggedIn) {
          finish({ authenticated: true, detail: `Claude CLI authentication is active via ${cliCommand}` });
          return;
        }
      } catch {}

      finish(null);
    });

    childProcess.on('error', () => {
      clearTimeout(timeout);
      finish(null);
    });
  });
}

async function checkProviderCredentials(provider, userId, env = process.env, homeDir = os.homedir()) {
  return loadClaudeCredentialState(env, homeDir);
}

function summarizePreflightFailure(report) {
  const firstFailure = report.checks.find((check) => check.status === 'fail');
  if (firstFailure) {
    return `Auto Research preflight failed: ${firstFailure.detail}`;
  }
  return 'Auto Research preflight failed.';
}

async function runAutoResearchPreflight({
  userId,
  profile,
  projectPath,
  provider,
  model,
  pipelineState,
  mailConfig = {},
  env = process.env,
  homeDir = os.homedir(),
}) {
  const checks = [];
  const checkedAt = new Date().toISOString();

  const projectExists = Boolean(projectPath);
  checks.push(
    projectExists
      ? createCheck('project_path', 'pass', `Project path resolved: ${projectPath}`)
      : createCheck('project_path', 'fail', 'Project path could not be resolved', 'Open the project again and retry.'),
  );

  const modelCheck = isModelValidForProvider(provider, model)
    ? createCheck('model_selection', 'pass', `Model ${model} is valid for provider ${provider}`)
    : createCheck(
      'model_selection',
      'fail',
      `Model ${model || '(empty)'} is not valid for provider ${provider}`,
      'Pick a supported model for the selected provider before starting Auto Research.',
    );
  checks.push(modelCheck);

  if (projectExists) {
    const writable = await checkPathWritable(projectPath);
    checks.push(
      writable
        ? createCheck('project_writable', 'pass', 'Project directory is writable')
        : createCheck('project_writable', 'fail', 'Project directory is not writable', 'Grant write access to the project directory.'),
    );

    const runsDirectoryState = await canPrepareRunsDirectory(projectPath);
    checks.push(
      runsDirectoryState.ok
        ? createCheck('runs_directory', 'pass', `Runs directory is ready at ${runsDirectoryState.runsDir}`)
        : createCheck(
          'runs_directory',
          'fail',
          `Failed to prepare runs directory: ${runsDirectoryState.error}`,
          'Ensure .pipeline/runs can be created under the project directory.',
        ),
    );
  }

  checks.push(
    profile?.notification_email
      ? createCheck('notification_email', 'pass', `Notification email set to ${profile.notification_email}`)
      : createCheck('notification_email', 'fail', 'Notification email is missing', 'Set a notification email in Settings before starting Auto Research.'),
  );

  if (pipelineState?.hasResearchBrief) {
    checks.push(
      pipelineState.researchBriefValid
        ? createCheck('research_brief', 'pass', 'Research brief exists and is valid JSON')
        : createCheck(
          'research_brief',
          'fail',
          `Research brief JSON is invalid: ${pipelineState.researchBriefError}`,
          'Regenerate the research brief or fix its JSON before starting Auto Research.',
        ),
    );
  } else {
    checks.push(
      createCheck(
        'research_brief',
        'fail',
        'Research brief is missing',
        'Generate .pipeline/docs/research_brief.json before starting Auto Research.',
      ),
    );
  }

  if (pipelineState?.hasTasksFile) {
    checks.push(
      pipelineState.tasksValid
        ? createCheck('tasks_file', 'pass', 'Task list exists and is valid JSON')
        : createCheck(
          'tasks_file',
          'fail',
          `Task list JSON is invalid: ${pipelineState.tasksError}`,
          'Regenerate .pipeline/tasks/tasks.json or fix its JSON before starting Auto Research.',
        ),
    );
  } else {
    checks.push(
      createCheck(
        'tasks_file',
        'fail',
        'Task list is missing',
        'Generate .pipeline/tasks/tasks.json before starting Auto Research.',
      ),
    );
  }

  checks.push(
    pipelineState?.actionableTaskCount > 0
      ? createCheck('actionable_tasks', 'pass', `${pipelineState.actionableTaskCount} actionable task(s) are ready`)
      : createCheck(
        'actionable_tasks',
        'fail',
        'No actionable tasks were found',
        'Add at least one pending or in-progress task before starting Auto Research.',
      ),
  );

  if (pipelineState?.researchBriefValid && pipelineState?.tasksValid && pipelineState?.nextTask?.stage) {
    const nextStageContract = await validateAutoResearchStageContract({
      stage: pipelineState.nextTask.stage,
      projectPath,
      pipelineState,
      currentTask: pipelineState.nextTask,
      runStatus: 'queued',
    });

    checks.push(
      nextStageContract.readiness.canStart
        ? createCheck(
          'next_stage_contract',
          nextStageContract.readiness.overall === 'warn' ? 'warn' : 'pass',
          nextStageContract.readiness.summary,
          nextStageContract.readiness.warnings[0]?.fix || null,
        )
        : createCheck(
          'next_stage_contract',
          'fail',
          nextStageContract.readiness.summary,
          nextStageContract.readiness.blockingErrors[0]?.fix || null,
        ),
    );
  }

  const providerCredentialState = await checkProviderCredentials(provider, userId, env, homeDir);
  checks.push(
    providerCredentialState.authenticated
      ? createCheck('provider_credentials', 'pass', providerCredentialState.detail)
      : createCheck('provider_credentials', 'fail', providerCredentialState.detail, providerCredentialState.fix),
  );

  if (mailConfig.senderEmail) {
    checks.push(createCheck('mail_sender', 'pass', `Sender email configured as ${mailConfig.senderEmail}`));
  } else {
    checks.push(createCheck('mail_sender', 'warn', 'Auto Research sender email is not configured', 'Set a sender email in Settings if you want completion emails.'));
  }

  if (mailConfig.resendConfigured) {
    checks.push(createCheck('mail_delivery', 'pass', 'Resend API key is configured'));
  } else {
    checks.push(createCheck('mail_delivery', 'warn', 'Resend API key is not configured', 'Set the Auto Research Resend key in Settings if you want completion emails.'));
  }

  const hasFailures = checks.some((check) => check.status === 'fail');
  const hasWarnings = checks.some((check) => check.status === 'warn');

  return {
    checkedAt,
    overall: hasFailures ? 'fail' : hasWarnings ? 'warn' : 'pass',
    checks,
    blockingChecks: checks.filter((check) => check.status === 'fail'),
    warningChecks: checks.filter((check) => check.status === 'warn'),
  };
}

export {
  isModelValidForProvider,
  runAutoResearchPreflight,
  summarizePreflightFailure,
};
