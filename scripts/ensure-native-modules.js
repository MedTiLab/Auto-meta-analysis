#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const repoRoot = path.join(__dirname, '..');
const cacheDir = path.join(repoRoot, 'node_modules', '.cache', 'medautodata');
const stampPath = path.join(cacheDir, 'native-modules.json');
const nativePackages = ['better-sqlite3', 'bcrypt', 'sharp', 'sqlite3'];
const nativeMismatchPatterns = [
  /NODE_MODULE_VERSION/i,
  /compiled against a different Node\.js version/i,
  /module version mismatch/i,
  /invalid ELF header/i,
  /dlopen\(.+not a mach-o file/i,
];

const runtimeStamp = {
  node: process.versions.node,
  abi: process.versions.modules,
  napi: process.versions.napi ?? null,
  platform: process.platform,
  arch: process.arch,
};

function log(message) {
  console.log(`[native] ${message}`);
}

function warn(message) {
  console.warn(`[native] ${message}`);
}

function ensureCacheDir() {
  fs.mkdirSync(cacheDir, { recursive: true });
}

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(stampPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      warn(`Could not read native module stamp: ${error.message}`);
    }
    return null;
  }
}

function writeStamp() {
  ensureCacheDir();
  fs.writeFileSync(
    stampPath,
    JSON.stringify(
      {
        ...runtimeStamp,
        packages: nativePackages,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function needsRebuild(previousStamp) {
  if (!previousStamp) return true;
  return (
    previousStamp.abi !== runtimeStamp.abi ||
    previousStamp.platform !== runtimeStamp.platform ||
    previousStamp.arch !== runtimeStamp.arch
  );
}

function shouldRebuildFromLoadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return nativeMismatchPatterns.some((pattern) => pattern.test(message));
}

function validateNativePackages() {
  for (const packageName of nativePackages) {
    try {
      const loaded = require(packageName);
      if (packageName === 'better-sqlite3') {
        const tempDb = new loaded(':memory:');
        tempDb.close();
      }
    } catch (error) {
      if (!shouldRebuildFromLoadError(error)) {
        throw error;
      }

      warn(
        `Detected incompatible native package "${packageName}" for Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  return true;
}

function run(command, args) {
  const nodeBinDir = path.dirname(process.execPath);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${nodeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
    },
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

function resolveNpmInvocation() {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath) {
    if (npmExecPath.endsWith('.js')) {
      return {
        command: process.execPath,
        args: [npmExecPath],
      };
    }

    return {
      command: npmExecPath,
      args: [],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: [],
  };
}

function rebuildNativePackages() {
  log(
    `Detected native module/runtime mismatch. Rebuilding ${nativePackages.join(', ')} for Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}).`,
  );

  const npmInvocation = resolveNpmInvocation();
  const rebuildStatus = run(
    npmInvocation.command,
    [...npmInvocation.args, 'rebuild', ...nativePackages],
  );
  if (rebuildStatus !== 0) {
    process.exit(rebuildStatus);
  }

  writeStamp();
  log(`Native modules are now aligned with Node ${runtimeStamp.node}.`);
}

if (process.argv.includes('--record-only')) {
  writeStamp();
  log(`Recorded native module runtime for Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}).`);
  process.exit(0);
}

const previousStamp = readStamp();
if (needsRebuild(previousStamp) || !validateNativePackages()) {
  rebuildNativePackages();
} else {
  log(`Native modules already match Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}).`);
}
