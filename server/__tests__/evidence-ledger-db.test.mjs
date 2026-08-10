import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadDatabaseModule() {
  vi.resetModules();
  return import('../database/db.js');
}

describe('evidenceLedgerDb schema', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-evidence-ledger-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('creates the evidence ledger tables on initialize', async () => {
    const { db, initializeDatabase } = await loadDatabaseModule();
    await initializeDatabase();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'meta_evidence_%'")
      .all()
      .map((r) => r.name);
    expect(tables).toContain('meta_evidence_artifacts');
    expect(tables).toContain('meta_evidence_artifact_edges');
  });

  it('assigns monotonic versions per (project,type) and hashes content', async () => {
    const { evidenceLedgerDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('ledger-user', 'hashed-password');

    const v1 = evidenceLedgerDb.createArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { count: 10 },
    });
    const v2 = evidenceLedgerDb.createArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { count: 12 },
    });
    const other = evidenceLedgerDb.createArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ScreeningDecisionSet', payload: { included: 5 },
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(other.version).toBe(1);
    expect(v1.status).toBe('draft');
    expect(v1.payload).toEqual({ count: 10 });
    expect(typeof v1.contentHash).toBe('string');
    expect(v1.contentHash).not.toBe(v2.contentHash);

    const fetched = evidenceLedgerDb.getArtifact(v1.id);
    expect(fetched.id).toBe(v1.id);
    expect(fetched.version).toBe(1);
  });

  it('records dependency edges and collects transitive dependents', async () => {
    const { evidenceLedgerDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('ledger-user', 'hashed-password');

    const refs = evidenceLedgerDb.createArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: {} });
    const extraction = evidenceLedgerDb.createArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ExtractionSet', payload: {},
      inputs: [{ artifactId: refs.id, version: refs.version }],
    });
    const analysis = evidenceLedgerDb.createArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'AnalysisRun', payload: {},
      inputs: [{ artifactId: extraction.id, version: extraction.version }],
    });

    const directDeps = evidenceLedgerDb.getDependents(refs.id);
    expect(directDeps.map((a) => a.id)).toEqual([extraction.id]);

    const transitive = evidenceLedgerDb.collectTransitiveDependents(refs.id);
    expect(new Set(transitive)).toEqual(new Set([extraction.id, analysis.id]));
  });

  it('updates status, lists by type, and respects locked when marking stale', async () => {
    const { evidenceLedgerDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('ledger-user', 'hashed-password');

    const a = evidenceLedgerDb.createArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: {} });
    const updated = evidenceLedgerDb.setArtifactStatus(a.id, 'validated', { passed: true, errors: [] });
    expect(updated.status).toBe('validated');
    expect(updated.validation).toEqual({ passed: true, errors: [] });

    const b = evidenceLedgerDb.createArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: {} });
    const list = evidenceLedgerDb.listArtifacts('mp-1', { type: 'ReferenceSet' });
    expect(list).toHaveLength(2);
    expect(list[0].version).toBe(1);
    expect(evidenceLedgerDb.getLatestArtifact('mp-1', 'ReferenceSet').version).toBe(2);

    evidenceLedgerDb.setArtifactStatus(a.id, 'locked');
    const lockedThenStale = evidenceLedgerDb.setArtifactStatus(a.id, 'locked');
    evidenceLedgerDb.markStale([a.id, b.id]);
    expect(evidenceLedgerDb.getArtifact(a.id).status).toBe('locked'); // locked 不被 stale 覆盖
    expect(evidenceLedgerDb.getArtifact(b.id).status).toBe('stale');
    expect(lockedThenStale.status).toBe('locked');
  });
});
