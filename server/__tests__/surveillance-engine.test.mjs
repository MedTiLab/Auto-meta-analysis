import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadModules() {
  vi.resetModules();
  const dbModule = await import('../database/db.js');
  const ledgerModule = await import('../services/meta-analysis/evidence-ledger.js');
  const engineModule = await import('../services/meta-analysis/surveillance/surveillance-engine.js');
  return { ...dbModule, ...ledgerModule, ...engineModule };
}

function makeFakeCorpus(initial = []) {
  const store = initial.map((r, i) => ({ id: `seed-${i}`, ...r }));
  let seq = store.length;
  return {
    store,
    list: async () => store,
    add: async (_userId, _metaProjectId, ref) => { const id = `ref-${++seq}`; store.push({ id, ...ref }); return { id }; },
  };
}

function makeFakeScreening() {
  const calls = [];
  return { calls, record: async (payload) => { calls.push(payload); return payload; } };
}

function buildLedgerDeps(mod) {
  return {
    recordArtifact: mod.recordArtifact,
    getLatestArtifact: mod.evidenceLedgerDb.getLatestArtifact,
    collectTransitiveDependents: mod.evidenceLedgerDb.collectTransitiveDependents,
  };
}

describe('runSurveillanceCycle', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-surv-engine-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('auto-includes a new study, creates a new ReferenceSet version, and cascades stale to dependents', async () => {
    const mod = await loadModules();
    const { initializeDatabase, userDb, evidenceLedgerDb, recordArtifact, surveillanceDb, runSurveillanceCycle } = mod;
    await initializeDatabase();
    const user = userDb.createUser('surv-user', 'hashed-password');

    const refsV1 = recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { addedReferenceIds: [] } }).artifact;
    const analysis = recordArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'AnalysisRun', payload: { note: 'baseline' },
      inputs: [{ artifactId: refsV1.id, version: refsV1.version }],
    }).artifact;
    expect(analysis.status).toBe('validated');

    const subscription = surveillanceDb.createSubscription(user.id, {
      metaProjectId: 'mp-1',
      searchStrategy: { pubmed: '("network meta-analysis"[tiab])' },
      eligibility: { includeKeywordsAny: ['network meta-analysis'] },
    });

    const corpus = makeFakeCorpus([]);
    const screening = makeFakeScreening();
    const searchSource = { search: async () => ([
      { doi: '10.9/new', title: 'A new network meta-analysis of DOACs', abstract: '', year: 2026 },
    ]) };

    const { run, changeSet } = await runSurveillanceCycle({
      userId: user.id,
      subscription,
      deps: { searchSource, corpus, screening, ledger: buildLedgerDeps(mod), surveillanceDb, clock: { now: () => '2026-05-30T00:00:00.000Z' } },
    });

    expect(changeSet.autoScreen.autoIncluded).toBe(1);
    expect(screening.calls[0].reviewer).toBe('surveillance-agent');
    expect(screening.calls[0].decision).toBe('include');

    expect(changeSet.referenceSet.priorVersion).toBe(1);
    expect(changeSet.referenceSet.newVersion).toBe(2);
    expect(evidenceLedgerDb.getLatestArtifact('mp-1', 'ReferenceSet').version).toBe(2);

    expect(evidenceLedgerDb.getArtifact(analysis.id).status).toBe('stale');
    expect(changeSet.pendingReanalysis.staleArtifactIds).toContain(analysis.id);

    expect(surveillanceDb.getRun(run.id).stats.autoIncluded).toBe(1);
    expect(surveillanceDb.getSubscription(subscription.id).lastRunAt).toBe('2026-05-30T00:00:00.000Z');
  });

  it('routes borderline candidates to human review without creating a new version', async () => {
    const mod = await loadModules();
    const { initializeDatabase, userDb, evidenceLedgerDb, recordArtifact, surveillanceDb, runSurveillanceCycle } = mod;
    await initializeDatabase();
    const user = userDb.createUser('surv-user', 'hashed-password');

    recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { addedReferenceIds: [] } }).artifact;

    const subscription = surveillanceDb.createSubscription(user.id, {
      metaProjectId: 'mp-1',
      eligibility: { includeKeywordsAny: ['network meta-analysis'] },
    });

    const corpus = makeFakeCorpus([]);
    const screening = makeFakeScreening();
    const searchSource = { search: async () => ([
      { doi: '10.9/maybe', title: 'A narrative overview of clotting', abstract: '', year: 2026 },
    ]) };

    const { changeSet } = await runSurveillanceCycle({
      userId: user.id, subscription,
      deps: { searchSource, corpus, screening, ledger: buildLedgerDeps(mod), surveillanceDb, clock: { now: () => '2026-05-30T00:00:00.000Z' } },
    });

    expect(changeSet.autoScreen.toReview).toBe(1);
    expect(changeSet.autoScreen.autoIncluded).toBe(0);
    expect(screening.calls[0].decision).toBe('maybe');
    expect(changeSet.referenceSet).toBeNull();
    expect(changeSet.conclusionsImpact).toBe('no-change');
    expect(evidenceLedgerDb.getLatestArtifact('mp-1', 'ReferenceSet').version).toBe(1);
  });

  it('skips candidates already present in the corpus', async () => {
    const mod = await loadModules();
    const { initializeDatabase, userDb, recordArtifact, surveillanceDb, runSurveillanceCycle } = mod;
    await initializeDatabase();
    const user = userDb.createUser('surv-user', 'hashed-password');
    recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { addedReferenceIds: [] } });

    const subscription = surveillanceDb.createSubscription(user.id, {
      metaProjectId: 'mp-1', eligibility: { includeKeywordsAny: ['network meta-analysis'] },
    });

    const corpus = makeFakeCorpus([{ doi: '10.9/dup', title: 'Already known NMA' }]);
    const screening = makeFakeScreening();
    const searchSource = { search: async () => ([
      { doi: '10.9/DUP', title: 'Already known NMA (reprint)', abstract: '', year: 2026 },
    ]) };

    const { changeSet } = await runSurveillanceCycle({
      userId: user.id, subscription,
      deps: { searchSource, corpus, screening, ledger: buildLedgerDeps(mod), surveillanceDb, clock: { now: () => '2026-05-30T00:00:00.000Z' } },
    });

    expect(changeSet.search.found).toBe(1);
    expect(changeSet.dedup.duplicates).toBe(1);
    expect(changeSet.dedup.novel).toBe(0);
    expect(screening.calls).toHaveLength(0);
    expect(changeSet.referenceSet).toBeNull();
  });
});
