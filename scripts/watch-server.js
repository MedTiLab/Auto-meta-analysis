#!/usr/bin/env node

import chokidar from 'chokidar';
import { spawn } from 'child_process';
import path from 'path';

const ENTRYPOINT = path.join('server', 'index.js');
const WATCH_PATHS = [
  path.join('server', 'projects.js'),
  path.join('server', 'claude-sdk.js'),
  path.join('server', 'routes'),
  path.join('server', 'middleware'),
  path.join('server', 'database'),
  path.join('server', 'services'),
  path.join('server', 'utils'),
  path.join('server', 'pipeline'),
  path.join('server', 'execution-memory'),
  path.join('server', 'constants'),
  ENTRYPOINT,
];
const IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.DS_Store',
  '**/*.swp',
  '**/*.tmp',
];
const RESTART_DEBOUNCE_MS = 150;
const FORCE_KILL_AFTER_MS = 5000;

let child = null;
let restartTimer = null;
let pendingRestart = false;
let shuttingDown = false;
let forceKillTimer = null;

function clearForceKillTimer() {
  if (forceKillTimer) {
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }
}

function logRestart() {
  console.log(`Restarting '${ENTRYPOINT}'`);
}

function startChild() {
  child = spawn(process.execPath, [ENTRYPOINT], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    clearForceKillTimer();
    child = null;

    if (shuttingDown) {
      process.exit(code ?? (signal ? 1 : 0));
    }

    if (pendingRestart) {
      pendingRestart = false;
      startChild();
      return;
    }

    if (code !== 0) {
      console.error(`Failed running '${ENTRYPOINT}'. Waiting for file changes before restarting...`);
    }
  });
}

function requestRestart() {
  if (shuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;

    if (!child) {
      logRestart();
      startChild();
      return;
    }

    pendingRestart = true;
    logRestart();

    clearForceKillTimer();
    forceKillTimer = setTimeout(() => {
      if (child && !child.killed) {
        child.kill('SIGKILL');
      }
    }, FORCE_KILL_AFTER_MS);

    child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
  }, RESTART_DEBOUNCE_MS);
}

function shutdown(signal) {
  shuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  clearForceKillTimer();

  if (!child) {
    process.exit(0);
    return;
  }

  child.once('exit', () => {
    process.exit(0);
  });

  child.kill(signal);
}

const watcher = chokidar.watch(WATCH_PATHS, {
  ignored: IGNORED,
  ignoreInitial: true,
  persistent: true,
  followSymlinks: false,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 50,
  },
});

watcher.on('all', () => {
  requestRestart();
});

watcher.on('error', (error) => {
  console.error('[watch-server] Watcher error:', error.message);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startChild();
