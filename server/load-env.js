// Load environment variables from .env before other imports execute.
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  resolveAppDataRoot,
  resolveAppDatabasePath,
  resolveLegacyDatabasePaths,
} from './utils/storagePaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOGIN_SHELL_ENV_IMPORT_TIMEOUT_MS = 4000;

function shouldImportLoginShellEnvKey(key = '') {
  if (!key) return false;

  if ([
    'PATH',
    'HOME',
    'SHELL',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_STATE_HOME',
    'XDG_CACHE_HOME',
  ].includes(key)) {
    return true;
  }

  return [
    'PYENV_',
    'CONDA_',
    'VIRTUAL_ENV',
    'MAMBA_',
    'UV_',
    'HOMEBREW_',
    'NVM_',
    'ASDF_',
    'PNPM_',
    'POETRY_',
    'PIP_',
    'PIPX_',
    'CARGO_',
    'RUSTUP_',
    'ANTHROPIC_',
    'CLAUDE_',
  ].some((prefix) => key === prefix || key.startsWith(prefix));
}

function resolveLoginShellPath() {
  const explicitShell = String(process.env.MEDAUTODATA_LOGIN_SHELL || '').trim();
  if (explicitShell) {
    return explicitShell;
  }

  try {
    const userInfo = os.userInfo();
    if (userInfo?.shell) {
      return userInfo.shell;
    }
  } catch {
    // Ignore user shell lookup failures and fall back below.
  }

  if (process.env.SHELL) {
    return process.env.SHELL;
  }

  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

function importLoginShellEnvironment() {
  if (process.platform === 'win32') {
    return;
  }

  if (process.env.MEDAUTODATA_DISABLE_LOGIN_SHELL_ENV_IMPORT === '1') {
    return;
  }

  const shellPath = resolveLoginShellPath();
  if (!shellPath || !fs.existsSync(shellPath)) {
    return;
  }

  const shellName = path.basename(shellPath).toLowerCase();
  const command = 'command env -0';
  let args = ['-lc', command];

  if (shellName.includes('zsh') || shellName.includes('bash')) {
    args = ['-ilc', command];
  } else if (shellName.includes('fish')) {
    args = ['-lic', command];
  }

  const result = spawnSync(shellPath, args, {
    encoding: 'utf8',
    timeout: LOGIN_SHELL_ENV_IMPORT_TIMEOUT_MS,
    maxBuffer: 5 * 1024 * 1024,
    env: {
      ...process.env,
      TERM: 'dumb',
      CLICOLOR: '0',
      FORCE_COLOR: '0',
      MEDAUTODATA_LOGIN_SHELL_ENV_IMPORT: '1',
    },
  });

  if (result.error) {
    console.warn('[load-env] Failed to import login shell environment:', result.error.message);
    return;
  }

  if (result.status !== 0 || !result.stdout) {
    if (result.stderr?.trim()) {
      console.warn('[load-env] Login shell env import skipped:', result.stderr.trim());
    }
    return;
  }

  let importedCount = 0;

  for (const entry of result.stdout.split('\0')) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    if (!shouldImportLoginShellEnvKey(key)) {
      continue;
    }

    if (process.env[key] !== value) {
      process.env[key] = value;
      importedCount += 1;
    }
  }

  if (importedCount > 0) {
    console.log(`[load-env] Imported ${importedCount} login-shell environment values from ${shellPath}`);
  }
}

function resolveDefaultDatabasePath() {
  const currentDbPath = resolveAppDatabasePath();
  const currentSidecars = [`${currentDbPath}-shm`, `${currentDbPath}-wal`];
  const legacyDbPaths = resolveLegacyDatabasePaths();

  if (fs.existsSync(currentDbPath)) {
    return currentDbPath;
  }

  const legacyDbPath = legacyDbPaths.find((candidatePath) => fs.existsSync(candidatePath));
  if (!legacyDbPath) {
    return currentDbPath;
  }

  const legacySidecars = [`${legacyDbPath}-shm`, `${legacyDbPath}-wal`];

  try {
    fs.mkdirSync(path.dirname(currentDbPath), { recursive: true });
    fs.copyFileSync(legacyDbPath, currentDbPath);

    legacySidecars.forEach((legacySidecar, index) => {
      if (fs.existsSync(legacySidecar) && !fs.existsSync(currentSidecars[index])) {
        fs.copyFileSync(legacySidecar, currentSidecars[index]);
      }
    });

    return currentDbPath;
  } catch (error) {
    console.warn('[load-env] Failed to migrate legacy auth DB, using legacy path:', error.message);
    return legacyDbPath;
  }
}

try {
  importLoginShellEnvironment();

  const envPath = path.join(__dirname, '../.env');
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0 && !process.env[key]) {
        process.env[key] = valueParts.join('=').trim();
      }
    }
  });
} catch (e) {
  console.log('No .env file found or error reading it:', e.message);
}

if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = resolveDefaultDatabasePath();
}

if (!process.env.MEDAUTODATA_DATA_DIR && !process.env.DR_CLAW_DATA_DIR) {
  process.env.MEDAUTODATA_DATA_DIR = resolveAppDataRoot();
}
