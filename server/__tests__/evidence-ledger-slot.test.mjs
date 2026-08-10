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
  return { ...dbModule, ...ledgerModule };
}

describe('recordArtifact slot', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-evidence-slot-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('marks artifact validated when validators pass', async () => {
    const { initializeDatabase, userDb, recordArtifact, registerValidator } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('slot-user', 'hashed-password');
    registerValidator('ReferenceSet', 'always-pass', () => ({ passed: true, errors: [] }));

    const { artifact, validation } = recordArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { count: 3 },
    });
    expect(validation.passed).toBe(true);
    expect(artifact.status).toBe('validated');
  });

  it('keeps artifact as draft and records errors when a validator fails', async () => {
    const { initializeDatabase, userDb, recordArtifact, registerValidator } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('slot-user', 'hashed-password');
    registerValidator('AnalysisRun', 'always-fail', () => ({ passed: false, errors: [{ code: 'NOPE', message: 'bad' }] }));

    const { artifact, validation } = recordArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'AnalysisRun', payload: {},
    });
    expect(validation.passed).toBe(false);
    expect(artifact.status).toBe('draft');
    expect(artifact.validation.errors[0].code).toBe('NOPE');
    expect(artifact.validation.errors[0].validatorId).toBe('always-fail');
  });

  it('marks dependents of the prior version stale when a new validated version lands', async () => {
    const { initializeDatabase, userDb, recordArtifact, registerValidator, evidenceLedgerDb } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('slot-user', 'hashed-password');
    registerValidator('ReferenceSet', 'pass', () => ({ passed: true, errors: [] }));
    registerValidator('AnalysisRun', 'pass', () => ({ passed: true, errors: [] }));

    const refsV1 = recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { n: 1 } }).artifact;
    const analysis = recordArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'AnalysisRun', payload: {},
      inputs: [{ artifactId: refsV1.id, version: refsV1.version }],
    }).artifact;
    expect(analysis.status).toBe('validated');

    recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { n: 2 } });

    expect(evidenceLedgerDb.getArtifact(analysis.id).status).toBe('stale');
  });

  it('override requires justification and stamps overriddenBy', async () => {
    const { initializeDatabase, userDb, recordArtifact, registerValidator, overrideValidation } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('slot-user', 'hashed-password');
    registerValidator('AnalysisRun', 'fail', () => ({ passed: false, errors: [{ code: 'X', message: 'x' }] }));

    const { artifact } = recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'AnalysisRun', payload: {} });
    expect(artifact.status).toBe('draft');

    expect(() => overrideValidation(user.id, artifact.id, '')).toThrow(/justification/);

    const overridden = overrideValidation(user.id, artifact.id, 'reviewed manually, data correct');
    expect(overridden.status).toBe('validated');
    expect(overridden.validation.overriddenBy).toBe(user.id);
    expect(overridden.validation.justification).toMatch(/reviewed manually/);
  });
});
