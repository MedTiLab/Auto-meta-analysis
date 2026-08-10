import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadModules() {
  vi.resetModules();
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  const ledger = await import('../services/meta-analysis/evidence-ledger.js');
  const service = await import('../services/meta-analysis/surveillance/surveillance-service.js');
  return { database, ledger, service };
}

describe('runProjectSurveillance (real corpus/screening/ledger, fake search)', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-surv-service-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('dedups a known study, auto-includes a novel one, versions the ReferenceSet, and stales the dependent', async () => {
    const { database, ledger, service } = await loadModules();
    const user = database.userDb.createUser('svc-user', 'hashed-password');
    const projectName = 'svc-user-project';
    database.projectDb.upsertProject(projectName, user.id, 'Svc Project', path.join(tempRoot, projectName), 0, null, { projectKind: 'meta' });
    const metaProject = database.metaAnalysisDb.createMetaProject(user.id, { projectId: projectName, reviewType: 'network', title: 'Svc Project' });

    const [oldId] = database.referencesDb.importReferences(user.id, [{ title: 'Old NMA', doi: '10.1/old', citationKey: '11111' }], 'pubmed');
    database.referencesDb.bulkLinkIds(projectName, [oldId]);

    const refsV1 = ledger.recordArtifact(user.id, { metaProjectId: metaProject.id, type: 'ReferenceSet', payload: { addedReferenceIds: [oldId] } }).artifact;
    const analysis = ledger.recordArtifact(user.id, {
      metaProjectId: metaProject.id, type: 'AnalysisRun', payload: { note: 'baseline' },
      inputs: [{ artifactId: refsV1.id, version: refsV1.version }],
    }).artifact;

    database.surveillanceDb.createSubscription(user.id, {
      metaProjectId: metaProject.id,
      searchStrategy: { pubmed: '("network meta-analysis"[tiab])' },
      eligibility: { includeKeywordsAny: ['network meta-analysis'] },
    });

    const searchSource = { search: async () => ([
      { doi: '10.1/old', pmid: '11111', title: 'dup reprint', source: 'pubmed', sourceId: '11111', raw: {} },
      { doi: '10.9/new', pmid: '22222', title: 'A network meta-analysis of DOACs', abstract: '', year: 2026, source: 'pubmed', sourceId: '22222', raw: { authors: [] } },
    ]) };

    const { run, changeSet } = await service.runProjectSurveillance({ userId: user.id, metaProject, searchSource });

    expect(changeSet.dedup.duplicates).toBe(1);
    expect(changeSet.dedup.novel).toBe(1);
    expect(changeSet.autoScreen.autoIncluded).toBe(1);
    expect(changeSet.referenceSet.newVersion).toBe(2);
    expect(database.evidenceLedgerDb.getArtifact(analysis.id).status).toBe('stale');
    expect(changeSet.pendingReanalysis.staleArtifactIds).toContain(analysis.id);

    expect(database.referencesDb.getProjectReferences(projectName, user.id)).toHaveLength(2);
    expect(database.surveillanceDb.getRun(run.id).stats.autoIncluded).toBe(1);
  });
});
