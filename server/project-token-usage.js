import { promises as fs } from 'fs';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { resolveDefaultWorkspacesRoot } from './utils/workspacePaths.js';
import { isLegacyDataImportEnabled } from './utils/storagePaths.js';
import readline from 'readline';

import { encodeProjectPath } from './projects.js';

const CACHE_TTL_MS = 5_000;

let summaryCache = null;

function createEmptyUsageTotals() {
  return {
    todayTokens: 0,
    weekTokens: 0,
  };
}

const CURRENT_DEFAULT_WORKSPACES_ROOT = resolveDefaultWorkspacesRoot();
const LEGACY_DEFAULT_WORKSPACES_ROOTS = [
  path.join(os.homedir(), 'dr-claw'),
  path.join(os.homedir(), 'vibelab'),
];

function normalizeProjectRefs(projectRefs = []) {
  return projectRefs
    .filter((project) => project && typeof project.name === 'string' && typeof project.fullPath === 'string')
    .map((project) => ({
      name: project.name,
      fullPath: project.fullPath,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getUsageWindowBounds(now = new Date()) {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(todayStart);
  const dayOfWeek = weekStart.getDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);

  return {
    nowMs: now.getTime(),
    todayStartMs: todayStart.getTime(),
    weekStartMs: weekStart.getTime(),
    cacheKey: `${todayStart.toISOString()}|${weekStart.toISOString()}`,
  };
}

function addUsageForTimestamp(target, timestampMs, tokens, bounds) {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(tokens) || tokens <= 0) {
    return;
  }

  if (timestampMs >= bounds.weekStartMs && timestampMs <= bounds.nowMs) {
    target.weekTokens += tokens;
  }

  if (timestampMs >= bounds.todayStartMs && timestampMs <= bounds.nowMs) {
    target.todayTokens += tokens;
  }
}

function remapCurrentProjectPathsToLegacy(projectPath) {
  if (!isLegacyDataImportEnabled()) {
    return [];
  }

  if (!projectPath) {
    return [];
  }

  const normalizedPath = path.resolve(projectPath);
  if (
    normalizedPath !== CURRENT_DEFAULT_WORKSPACES_ROOT &&
    !normalizedPath.startsWith(CURRENT_DEFAULT_WORKSPACES_ROOT + path.sep)
  ) {
    return [];
  }

  return LEGACY_DEFAULT_WORKSPACES_ROOTS.map((legacyRoot) => (
    path.join(
      legacyRoot,
      path.relative(CURRENT_DEFAULT_WORKSPACES_ROOT, normalizedPath),
    )
  ));
}

function getClaudeProjectDirs(projectRef) {
  const projectDirs = new Set();

  if (projectRef?.fullPath) {
    projectDirs.add(path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(projectRef.fullPath)));

    for (const legacyProjectPath of remapCurrentProjectPathsToLegacy(projectRef.fullPath)) {
      projectDirs.add(path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(legacyProjectPath)));
    }
  }

  return [...projectDirs];
}

async function collectJsonlFiles(dirPath) {
  const files = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...await collectJsonlFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`[token-usage] Failed to read directory ${dirPath}:`, error.message);
    }
  }

  return files;
}

function getClaudeUsageSnapshot(entry) {
  const usage = entry?.message?.usage;
  if (!usage) {
    return null;
  }

  const model = entry?.message?.model;
  if (model === '<synthetic>') {
    return null;
  }

  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  // Cache fields are metadata about prompt reuse and otherwise inflate dashboard totals.
  const totalTokens = inputTokens + outputTokens;

  return {
    timestampMs: new Date(entry.timestamp || 0).getTime(),
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

async function summarizeClaudeProject(projectRef, bounds) {
  const totals = createEmptyUsageTotals();
  const projectDirs = getClaudeProjectDirs(projectRef);
  const jsonlFiles = (
    await Promise.all(projectDirs.map((projectDir) => collectJsonlFiles(projectDir)))
  ).flat();
  const requestUsageMap = new Map();
  let fallbackIndex = 0;

  for (const filePath of jsonlFiles) {
    try {
      const fileStream = fsSync.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'assistant' || !entry.message?.usage) {
            continue;
          }

          const snapshot = getClaudeUsageSnapshot(entry);
          if (!snapshot || snapshot.totalTokens <= 0) {
            continue;
          }

          const rawRequestId = typeof entry.requestId === 'string' ? entry.requestId.trim() : '';
          const requestKey = rawRequestId || `${filePath}:${entry.uuid || entry.timestamp || fallbackIndex++}`;
          const previous = requestUsageMap.get(requestKey);

          if (!previous) {
            requestUsageMap.set(requestKey, snapshot);
            continue;
          }

          requestUsageMap.set(requestKey, {
            timestampMs: Math.max(previous.timestampMs, snapshot.timestampMs),
            inputTokens: Math.max(previous.inputTokens, snapshot.inputTokens),
            outputTokens: Math.max(previous.outputTokens, snapshot.outputTokens),
            totalTokens: Math.max(previous.totalTokens, snapshot.totalTokens),
          });
        } catch {
          // Skip malformed JSONL rows.
        }
      }
    } catch (error) {
      console.warn(`[token-usage] Failed to read Claude session file ${filePath}:`, error.message);
    }
  }

  for (const usage of requestUsageMap.values()) {
    addUsageForTimestamp(totals, usage.timestampMs, usage.totalTokens, bounds);
  }

  return totals;
}

function mergeUsageTotals(...totalsList) {
  return totalsList.reduce((merged, totals) => ({
    todayTokens: merged.todayTokens + Number(totals?.todayTokens || 0),
    weekTokens: merged.weekTokens + Number(totals?.weekTokens || 0),
  }), createEmptyUsageTotals());
}

export async function getProjectTokenUsageSummary(projectRefs = []) {
  const normalizedProjectRefs = normalizeProjectRefs(projectRefs);
  const bounds = getUsageWindowBounds();
  const cacheKey = `${bounds.cacheKey}|${JSON.stringify(normalizedProjectRefs)}`;

  if (summaryCache && summaryCache.key === cacheKey && summaryCache.expiresAt > Date.now()) {
    return summaryCache.data;
  }

  const projectUsageEntries = await Promise.all(
    normalizedProjectRefs.map(async (projectRef) => {
      const claudeTotals = await summarizeClaudeProject(projectRef, bounds);

      return [
        projectRef.name,
        claudeTotals,
      ];
    }),
  );

  const projects = Object.fromEntries(projectUsageEntries);
  const workspace = Object.values(projects).reduce(
    (accumulator, totals) => mergeUsageTotals(accumulator, totals),
    createEmptyUsageTotals(),
  );

  const data = {
    generatedAt: new Date().toISOString(),
    workspace,
    projects,
  };

  summaryCache = {
    key: cacheKey,
    expiresAt: Date.now() + CACHE_TTL_MS,
    data,
  };

  return data;
}

export function clearProjectTokenUsageSummaryCache() {
  summaryCache = null;
}
