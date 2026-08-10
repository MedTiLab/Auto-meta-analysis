import path from 'path';
import { promises as fs } from 'fs';

function getSessionExecutionMemoryDir(projectPath, sessionId) {
  return path.join(projectPath, '.pipeline', 'sessions', sessionId);
}

function getRunExecutionMemoryDir(projectPath, runId) {
  return path.join(projectPath, '.pipeline', 'runs', runId);
}

function getExecutionMemoryScopeDir(scopeRef) {
  if (!scopeRef?.projectPath) {
    return null;
  }
  if (scopeRef.scope === 'run') {
    return scopeRef.runId ? getRunExecutionMemoryDir(scopeRef.projectPath, scopeRef.runId) : null;
  }
  return scopeRef.sessionId ? getSessionExecutionMemoryDir(scopeRef.projectPath, scopeRef.sessionId) : null;
}

function getExecutionMemoryPaths(scopeRef) {
  const rootDir = getExecutionMemoryScopeDir(scopeRef);
  return {
    rootDir,
    microtasksPath: rootDir ? path.join(rootDir, 'microtasks.json') : null,
    ledgerPath: rootDir ? path.join(rootDir, 'results-ledger.jsonl') : null,
    sessionSummaryPath: rootDir ? path.join(rootDir, 'session-summary.md') : null,
    workingSummaryPath: scopeRef?.projectPath
      ? path.join(scopeRef.projectPath, '.pipeline', 'docs', 'working-summary.md')
      : null,
  };
}

async function ensureExecutionMemoryDir(scopeRef) {
  const paths = getExecutionMemoryPaths(scopeRef);
  if (!paths.rootDir) {
    return paths;
  }
  await fs.mkdir(paths.rootDir, { recursive: true });
  if (paths.workingSummaryPath) {
    await fs.mkdir(path.dirname(paths.workingSummaryPath), { recursive: true });
  }
  return paths;
}

async function readJsonIfExists(filePath, fallback = null) {
  if (!filePath) {
    return fallback;
  }
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, payload) {
  if (!filePath) {
    return null;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

async function appendJsonl(filePath, payload) {
  if (!filePath) {
    return null;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  return filePath;
}

async function readJsonl(filePath, limit = 200) {
  if (!filePath) {
    return [];
  }
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const tail = Number.isFinite(limit) ? lines.slice(Math.max(0, lines.length - limit)) : lines;
    return tail
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function readTextIfExists(filePath, fallback = '') {
  if (!filePath) {
    return fallback;
  }
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeText(filePath, content) {
  if (!filePath) {
    return null;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

async function replaceMarkedSection(filePath, markerKey, content) {
  if (!filePath || !markerKey) {
    return null;
  }
  const startMarker = `<!-- execution-memory:start ${markerKey} -->`;
  const endMarker = `<!-- execution-memory:end ${markerKey} -->`;
  const block = `${startMarker}\n${content.trim()}\n${endMarker}\n`;
  const existing = await readTextIfExists(filePath, '');
  const pattern = new RegExp(
    `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n?`,
    'm',
  );
  const nextContent = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trim()}\n\n${block}`.trimStart();
  await writeText(filePath, `${nextContent.trimEnd()}\n`);
  return filePath;
}

async function moveExecutionMemoryDir(sourceScopeRef, targetScopeRef) {
  const sourceDir = getExecutionMemoryScopeDir(sourceScopeRef);
  const targetDir = getExecutionMemoryScopeDir(targetScopeRef);
  if (!sourceDir || !targetDir || sourceDir === targetDir) {
    return false;
  }
  try {
    await fs.access(sourceDir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  try {
    await fs.access(targetDir);
    return false;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.rename(sourceDir, targetDir);
  return true;
}

function buildExecutionMemoryMarkerKey(scopeRef) {
  if (scopeRef?.scope === 'run') {
    return scopeRef?.runId ? `run:${scopeRef.runId}` : null;
  }
  return scopeRef?.sessionId ? `session:${scopeRef.sessionId}` : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export {
  appendJsonl,
  buildExecutionMemoryMarkerKey,
  ensureExecutionMemoryDir,
  getExecutionMemoryPaths,
  getExecutionMemoryScopeDir,
  moveExecutionMemoryDir,
  readJsonIfExists,
  readJsonl,
  readTextIfExists,
  replaceMarkedSection,
  writeJson,
  writeText,
};
