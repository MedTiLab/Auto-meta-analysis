import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function stripMatchingQuotes(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function expandHome(value, env) {
  const candidate = stripMatchingQuotes(value);
  if (!candidate) return null;
  const homeDir = env.HOME || os.homedir();
  if (candidate === '~') return homeDir;
  if (candidate.startsWith('~/') || candidate.startsWith('~\\')) {
    return path.join(homeDir, candidate.slice(2));
  }
  return candidate;
}

function isExecutableFile(candidate) {
  if (!candidate) return false;
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableNames(command) {
  if (process.platform !== 'win32' || /\.(cmd|exe|bat)$/i.test(command)) return [command];
  return [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`];
}

function resolveCommand(candidate, env) {
  const expanded = expandHome(candidate, env);
  if (!expanded) return null;
  if (path.isAbsolute(expanded) || expanded.includes('/') || expanded.includes('\\')) {
    const absolutePath = path.resolve(expanded);
    return isExecutableFile(absolutePath) ? absolutePath : null;
  }

  const homeDir = env.HOME || os.homedir();
  const searchDirs = [
    ...(env.PATH || process.env.PATH || '').split(path.delimiter),
    env.NVM_BIN,
    homeDir && path.join(homeDir, '.local', 'bin'),
    homeDir && path.join(homeDir, '.volta', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ].filter(Boolean);

  for (const searchDir of new Set(searchDirs)) {
    for (const name of executableNames(expanded)) {
      const executablePath = path.join(searchDir, name);
      if (isExecutableFile(executablePath)) return executablePath;
    }
  }
  return null;
}

function nativePackageNames() {
  if (process.platform === 'linux') {
    return [
      `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`,
      `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`,
    ];
  }
  return [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`];
}

function resolveBundledNativeClaudeCode() {
  const executableName = process.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const packageName of nativePackageNames()) {
    try {
      const executablePath = require.resolve(`${packageName}/${executableName}`);
      if (isExecutableFile(executablePath)) return executablePath;
    } catch {}
  }
  return null;
}

export function resolveClaudeCodeExecutableInfo({ env = process.env, preferBundledNative = false } = {}) {
  const explicitPath = resolveCommand(env.CLAUDE_CLI_PATH, env);
  if (explicitPath) return { executable: explicitPath, source: 'CLAUDE_CLI_PATH' };

  if (preferBundledNative) {
    const bundledPath = resolveBundledNativeClaudeCode();
    if (bundledPath) return { executable: bundledPath, source: 'bundled-native' };
  }

  const cliPath = resolveCommand('claude', env);
  if (cliPath) return { executable: cliPath, source: 'PATH' };

  const bundledPath = resolveBundledNativeClaudeCode();
  if (bundledPath) return { executable: bundledPath, source: 'bundled-native' };
  return { executable: null, source: null };
}
