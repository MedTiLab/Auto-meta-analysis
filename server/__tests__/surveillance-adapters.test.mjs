import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPubmedSearchSource, formatEdatRange } from '../services/meta-analysis/surveillance/surveillance-adapters.js';

describe('formatEdatRange', () => {
  it('formats an ISO timestamp into a PubMed EDAT range', () => {
    expect(formatEdatRange('2026-05-01T12:00:00.000Z')).toBe('("2026/05/01"[EDAT] : "3000"[EDAT])');
  });
});

describe('createPubmedSearchSource', () => {
  it('appends an EDAT range when `since` is given and maps records to candidates', async () => {
    const calls = [];
    const fakeSearch = async (query, opts) => { calls.push({ query, opts }); return { ids: ['111', '222'], count: 2 }; };
    const fakeSummaries = async (ids) => ids.map((pmid) => ({
      pmid, doi: `10.1/${pmid}`, title: `Paper ${pmid}`, abstract: 'a', year: 2026, journal: 'J', authors: [], url: `u/${pmid}`,
    }));
    const source = createPubmedSearchSource({ searchPubMed: fakeSearch, fetchPubMedSummaries: fakeSummaries });

    const candidates = await source.search({ pubmed: '("network meta-analysis"[tiab])' }, { since: '2026-05-01T00:00:00.000Z' });

    expect(calls[0].query).toContain('("network meta-analysis"[tiab])');
    expect(calls[0].query).toContain('[EDAT]');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ pmid: '111', doi: '10.1/111', source: 'pubmed', sourceId: '111' });
    expect(candidates[0].raw.title).toBe('Paper 111');
  });

  it('omits the date range on first run (no since)', async () => {
    const calls = [];
    const fakeSearch = async (query) => { calls.push(query); return { ids: [], count: 0 }; };
    const source = createPubmedSearchSource({ searchPubMed: fakeSearch, fetchPubMedSummaries: async () => [] });
    await source.search({ pubmed: '(x)' }, {});
    expect(calls[0]).toBe('(x)');
  });
});

describe('createReferencesCorpus (real DB)', () => {
  const originalDatabasePath = process.env.DATABASE_PATH;
  let tempRoot = null;

  async function loadDb() {
    vi.resetModules();
    const database = await import('../database/db.js');
    await database.initializeDatabase();
    return database;
  }
  async function makeFixture(database, username = 'corpus-user') {
    const user = database.userDb.createUser(username, 'hashed-password');
    const projectName = `${username}-project`;
    database.projectDb.upsertProject(projectName, user.id, 'Corpus Project', path.join(tempRoot, projectName), 0, null, { projectKind: 'meta' });
    const metaProject = database.metaAnalysisDb.createMetaProject(user.id, { projectId: projectName, reviewType: 'network', title: 'Corpus Project' });
    return { user, projectName, metaProject };
  }

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-corpus-adapter-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('adds a candidate to the project corpus and lists it back for dedup', async () => {
    const database = await loadDb();
    const { createReferencesCorpus } = await import('../services/meta-analysis/surveillance/surveillance-adapters.js');
    const { user, metaProject } = await makeFixture(database);

    const corpus = createReferencesCorpus({ userId: user.id, metaProject, referencesDb: database.referencesDb });

    expect(await corpus.list(metaProject.id)).toHaveLength(0);

    const { id } = await corpus.add(user.id, metaProject.id, {
      doi: '10.9/new', pmid: '22222', title: 'A network meta-analysis of X', abstract: 'abc', year: 2026, source: 'pubmed', sourceId: '22222',
      raw: { authors: [{ family: 'Lin', given: 'A' }], journal: 'J', url: 'u' },
    });
    expect(id).toBeTruthy();

    const listed = await corpus.list(metaProject.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ doi: '10.9/new', title: 'A network meta-analysis of X', source: 'pubmed', sourceId: '22222' });
  });

  it('records an agent screening decision via upsertScreeningDecision', async () => {
    const database = await loadDb();
    const { createReferencesCorpus, createScreeningRecorder } = await import('../services/meta-analysis/surveillance/surveillance-adapters.js');
    const { user, metaProject } = await makeFixture(database, 'screen-user');

    const corpus = createReferencesCorpus({ userId: user.id, metaProject, referencesDb: database.referencesDb });
    const { id: referenceId } = await corpus.add(user.id, metaProject.id, {
      doi: '10.9/s', pmid: '333', title: 'An NMA', source: 'pubmed', sourceId: '333', raw: {},
    });

    const screening = createScreeningRecorder({ metaAnalysisDb: database.metaAnalysisDb });
    const decision = await screening.record({
      userId: user.id, metaProjectId: metaProject.id, referenceId,
      decision: 'include', confidence: 0.85, reviewer: 'surveillance-agent', reason: 'matched include criteria',
    });

    expect(decision.decision).toBe('include');
    const stored = database.metaAnalysisDb.listScreeningDecisions(user.id, metaProject.id);
    const agentDecision = stored.find((d) => d.reviewer === 'surveillance-agent');
    expect(agentDecision).toBeTruthy();
    expect(agentDecision.decision).toBe('include');
  });
});
