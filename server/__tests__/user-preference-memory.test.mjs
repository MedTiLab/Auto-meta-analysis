import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadModules() {
  vi.resetModules();
  const dbModule = await import('../database/db.js');
  const memoryModule = await import('../utils/userPreferenceMemory.js');
  return { ...dbModule, ...memoryModule };
}

describe('user preference memory', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-user-memory-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalDatabasePath;
    }

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('builds a hidden prompt block from enabled memories', async () => {
    const {
      initializeDatabase,
      userDb,
      userPreferenceMemoryDb,
      buildUserPreferenceMemoryBlock,
      prependUserPreferenceMemoryToPrompt,
    } = await loadModules();

    await initializeDatabase();
    const createdUser = userDb.createUser('memory-test-user', 'hashed-password');

    userPreferenceMemoryDb.create(createdUser.id, 'Prefer concise answers', 'preference');
    userPreferenceMemoryDb.create(createdUser.id, 'Use Python unless I ask otherwise', 'workflow');

    const block = buildUserPreferenceMemoryBlock(createdUser.id, { maxItems: 5 });
    expect(block).toContain('<user_preferences>');
    expect(block).toContain('[workflow] Use Python unless I ask otherwise');
    expect(block).toContain('[preference] Prefer concise answers');

    const prompt = prependUserPreferenceMemoryToPrompt('请继续分析数据。', createdUser.id);
    expect(prompt).toContain('<user_preferences>');
    expect(prompt).toContain('请继续分析数据。');
  });

  it('respects the user-level memory toggle and avoids duplicate injection', async () => {
    const {
      initializeDatabase,
      userDb,
      userPreferenceMemoryDb,
      prependUserPreferenceMemoryToPrompt,
    } = await loadModules();

    await initializeDatabase();
    const createdUser = userDb.createUser('memory-disabled-user', 'hashed-password');
    userPreferenceMemoryDb.create(createdUser.id, '# Prefer bullet summaries', 'preference');

    userPreferenceMemoryDb.setMemoryEnabled(createdUser.id, false);
    expect(prependUserPreferenceMemoryToPrompt('继续', createdUser.id)).toBe('继续');

    userPreferenceMemoryDb.setMemoryEnabled(createdUser.id, true);
    const once = prependUserPreferenceMemoryToPrompt('继续', createdUser.id);
    const twice = prependUserPreferenceMemoryToPrompt(once, createdUser.id);
    expect(twice).toBe(once);
    expect(once).not.toContain('# Prefer bullet summaries');
    expect(once).toContain('Prefer bullet summaries');
  });

  it('injects the selected analysis language as hidden prompt context', async () => {
    const {
      initializeDatabase,
      userDb,
      prependUserPreferenceMemoryToPrompt,
    } = await loadModules();

    await initializeDatabase();
    const createdUser = userDb.createUser('analysis-language-user', 'hashed-password');

    const prompt = prependUserPreferenceMemoryToPrompt('继续分析数据。', createdUser.id, {
      analysisLanguage: 'r',
    });

    expect(prompt).toContain('<analysis_preferences>');
    expect(prompt).toContain('Prefer R for statistical analysis code');
    expect(prompt).toContain('继续分析数据。');

    const duplicated = prependUserPreferenceMemoryToPrompt(prompt, createdUser.id, {
      analysisLanguage: 'r',
    });
    expect(duplicated).toBe(prompt);
  });

  it('prefers project-scoped memories when building a prompt for that project', async () => {
    const {
      initializeDatabase,
      userDb,
      userPreferenceMemoryDb,
      buildUserPreferenceMemoryBlock,
      prependUserPreferenceMemoryToPrompt,
    } = await loadModules();

    await initializeDatabase();
    const createdUser = userDb.createUser('project-memory-user', 'hashed-password');
    const projectPath = '/tmp/demo-project';

    userPreferenceMemoryDb.create(createdUser.id, 'Use concise summaries', 'preference');
    userPreferenceMemoryDb.create(createdUser.id, 'This project targets Vancouver citations', 'workflow', 'project', projectPath);

    const projectBlock = buildUserPreferenceMemoryBlock(createdUser.id, {
      projectPath,
      maxItems: 5,
    });
    expect(projectBlock).toContain('[project] [workflow] This project targets Vancouver citations');
    expect(projectBlock).toContain('Use concise summaries');

    const otherProjectBlock = buildUserPreferenceMemoryBlock(createdUser.id, {
      projectPath: '/tmp/other-project',
      maxItems: 5,
    });
    expect(otherProjectBlock).not.toContain('This project targets Vancouver citations');

    const prompt = prependUserPreferenceMemoryToPrompt('继续写 discussion。', createdUser.id, { projectPath });
    expect(prompt).toContain('This project targets Vancouver citations');
  });

  it('applies meta project memories by project kind', async () => {
    const {
      initializeDatabase,
      userDb,
      userPreferenceMemoryDb,
      buildUserPreferenceMemoryBlock,
    } = await loadModules();

    await initializeDatabase();
    const createdUser = userDb.createUser('project-kind-memory-user', 'hashed-password');

    userPreferenceMemoryDb.create(createdUser.id, 'Follow PRISMA flow for meta projects', 'workflow', 'meta');
    userPreferenceMemoryDb.create(createdUser.id, 'Keep responses concise', 'preference');

    const metaBlock = buildUserPreferenceMemoryBlock(createdUser.id, {
      projectPath: '/tmp/meta-project',
      projectKind: 'meta',
      maxItems: 5,
    });
    expect(metaBlock).toContain('[meta project] [workflow] Follow PRISMA flow for meta projects');
    expect(metaBlock).not.toContain('cohort-study assumptions');
    expect(metaBlock).toContain('Keep responses concise');

    const globalOnlyBlock = buildUserPreferenceMemoryBlock(createdUser.id, { maxItems: 5 });
    expect(globalOnlyBlock).not.toContain('PRISMA flow');
    expect(globalOnlyBlock).toContain('Keep responses concise');
  });
});
