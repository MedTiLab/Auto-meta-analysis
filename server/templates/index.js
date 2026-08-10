import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_CLAUDE_MEMORY_RELATIVE_PATH = path.join('.claude', 'rules', 'project.md');
const LEGACY_PROJECT_CLAUDE_MEMORY_RELATIVE_PATH = 'CLAUDE.md';
export const PROJECT_AGENTS_RELATIVE_PATH = 'AGENTS.md';
export const TEMPLATE_AGENTS_PATH = path.join(__dirname, 'AGENTS.md');
const TEMPLATE_VARIANTS = {
  meta: {
    claude: 'CLAUDE.meta.md',
    agents: 'AGENTS.meta.md',
  },
};

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function getPreferredProjectClaudeMemoryPath(projectPath) {
  return path.join(projectPath, PROJECT_CLAUDE_MEMORY_RELATIVE_PATH);
}

export async function resolveProjectClaudeMemoryPath(projectPath) {
  const legacyPath = path.join(projectPath, LEGACY_PROJECT_CLAUDE_MEMORY_RELATIVE_PATH);
  if (await pathExists(legacyPath)) {
    return legacyPath;
  }

  const preferredPath = getPreferredProjectClaudeMemoryPath(projectPath);
  if (await pathExists(preferredPath)) {
    return preferredPath;
  }

  return legacyPath;
}

async function linkOrCopyFile(sourcePath, destPath) {
  if (await pathExists(destPath)) return;

  await fs.mkdir(path.dirname(destPath), { recursive: true });

  try {
    await fs.link(sourcePath, destPath);
  } catch (err) {
    if (err.code === 'EXDEV' || err.code === 'EPERM') {
      await fs.copyFile(sourcePath, destPath);
      return;
    }
    throw err;
  }
}

function normalizeTemplateKind(value) {
  return 'meta';
}

async function ensureProjectClaudeMemoryFiles(projectPath, projectKind = 'meta') {
  const templates = TEMPLATE_VARIANTS[normalizeTemplateKind(projectKind)] || TEMPLATE_VARIANTS.meta;
  const preferredPath = getPreferredProjectClaudeMemoryPath(projectPath);
  const legacyPath = path.join(projectPath, LEGACY_PROJECT_CLAUDE_MEMORY_RELATIVE_PATH);
  const preferredExists = await pathExists(preferredPath);
  const legacyExists = await pathExists(legacyPath);

  if (legacyExists && preferredExists) return;

  if (legacyExists) {
    await linkOrCopyFile(legacyPath, preferredPath);
    return;
  }

  if (preferredExists) {
    await linkOrCopyFile(preferredPath, legacyPath);
    return;
  }

  await fs.copyFile(path.join(__dirname, templates.claude), legacyPath);
  await linkOrCopyFile(legacyPath, preferredPath);
}

/**
 * Static template files to copy into new Research Lab projects.
 * Each entry maps a source template to its destination path relative to the project root.
 */
const TEMPLATES = [];

function getRootProjectTemplates(projectKind = 'meta') {
  const templates = TEMPLATE_VARIANTS[normalizeTemplateKind(projectKind)] || TEMPLATE_VARIANTS.meta;
  return [
    { src: templates.agents, dest: PROJECT_AGENTS_RELATIVE_PATH },
  ];
}

export function getProjectAgentsPath(projectPath) {
  return path.join(projectPath, PROJECT_AGENTS_RELATIVE_PATH);
}

export async function resolveProjectAgentsPath(projectPath) {
  const projectAgentsPath = getProjectAgentsPath(projectPath);
  if (await pathExists(projectAgentsPath)) {
    return projectAgentsPath;
  }
  return TEMPLATE_AGENTS_PATH;
}

/**
 * Write agent instruction template files into a project directory.
 * Copies static .md templates from this directory.
 * Skips any file that already exists so user customizations are preserved.
 * @param {string} projectPath - Absolute path to the project directory.
 */
export async function writeProjectTemplates(projectPath, options = {}) {
  const includeRootAgentTemplates = options?.includeRootAgentTemplates === true;
  const projectKind = normalizeTemplateKind(options?.projectKind);

  try {
    await ensureProjectClaudeMemoryFiles(projectPath, projectKind);
  } catch (err) {
    console.error('[templates] Failed to write Claude project memory files:', err.message);
  }

  const templatesToWrite = includeRootAgentTemplates
    ? [...TEMPLATES, ...getRootProjectTemplates(projectKind)]
    : TEMPLATES;

  for (const { src, dest } of templatesToWrite) {
    const destPath = path.join(projectPath, dest);
    try {
      const exists = await pathExists(destPath);
      if (exists) continue;

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(path.join(__dirname, src), destPath);
    } catch (err) {
      console.error(`[templates] Failed to write ${dest}:`, err.message);
    }
  }
}
