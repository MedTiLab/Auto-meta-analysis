import path from 'path';
import { promises as fs } from 'fs';

function getAutoResearchRunDir(projectPath, runId) {
  return path.join(projectPath, '.pipeline', 'runs', runId);
}

async function ensureAutoResearchRunDir(projectPath, runId) {
  const runDir = getAutoResearchRunDir(projectPath, runId);
  await fs.mkdir(runDir, { recursive: true });
  return runDir;
}

async function writeAutoResearchRunJson(projectPath, runId, fileName, payload) {
  const runDir = await ensureAutoResearchRunDir(projectPath, runId);
  const targetPath = path.join(runDir, fileName);
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
  return targetPath;
}

async function readAutoResearchRunJson(projectPath, runId, fileName) {
  try {
    const runDir = getAutoResearchRunDir(projectPath, runId);
    const targetPath = path.join(runDir, fileName);
    const raw = await fs.readFile(targetPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readAutoResearchRunRecentEvents(projectPath, runId, limit = 5) {
  try {
    const runDir = getAutoResearchRunDir(projectPath, runId);
    const eventsPath = path.join(runDir, 'events.jsonl');
    const raw = await fs.readFile(eventsPath, 'utf8');
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    return lines
      .slice(Math.max(0, lines.length - limit))
      .reverse()
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function readAutoResearchRunSummary(projectPath, runId, options = {}) {
  const eventLimit = Number.isFinite(options.eventLimit) ? Math.max(1, Number(options.eventLimit)) : 5;
  const [heartbeat, checkpoint, stageSummary, recentEvents] = await Promise.all([
    readAutoResearchRunJson(projectPath, runId, 'heartbeat.json'),
    readAutoResearchRunJson(projectPath, runId, 'checkpoint.json'),
    readAutoResearchRunJson(projectPath, runId, 'stage-summary.json'),
    readAutoResearchRunRecentEvents(projectPath, runId, eventLimit),
  ]);

  return {
    heartbeat,
    checkpoint,
    stageSummary,
    recentEvents,
  };
}

export {
  ensureAutoResearchRunDir,
  getAutoResearchRunDir,
  readAutoResearchRunJson,
  readAutoResearchRunRecentEvents,
  readAutoResearchRunSummary,
  writeAutoResearchRunJson,
};
