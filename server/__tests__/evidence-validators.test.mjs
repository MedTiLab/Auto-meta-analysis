import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractionProvenanceValidator,
  analysisPlanAdherenceValidator,
} from '../services/meta-analysis/evidence-validators.js';

describe('extractionProvenanceValidator', () => {
  it('fails rows missing source provenance', () => {
    const result = extractionProvenanceValidator({ payload: { rows: [
      { value: 1, source: { parsedDocumentId: 'pd1', locator: 'table2' } },
      { value: 2 },
    ] } });
    expect(result.passed).toBe(false);
    expect(result.errors[0].code).toBe('EXTRACTION_PROVENANCE_MISSING');
  });

  it('passes when all rows carry parsedDocumentId + locator', () => {
    const result = extractionProvenanceValidator({ payload: { rows: [
      { value: 1, source: { parsedDocumentId: 'pd1', locator: 't2' } },
    ] } });
    expect(result.passed).toBe(true);
  });
});

describe('core validators wired into recordArtifact', () => {
  const originalDatabasePath = process.env.DATABASE_PATH;
  let tempRoot = null;

  async function loadModules() {
    vi.resetModules();
    const dbModule = await import('../database/db.js');
    const ledgerModule = await import('../services/meta-analysis/evidence-ledger.js');
    const validatorsModule = await import('../services/meta-analysis/evidence-validators.js');
    return { ...dbModule, ...ledgerModule, ...validatorsModule };
  }

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-core-validators-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('blocks an ExtractionSet whose rows lack provenance', async () => {
    const { initializeDatabase, userDb, recordArtifact, registerCoreEvidenceValidators } = await loadModules();
    await initializeDatabase();
    registerCoreEvidenceValidators();
    const user = userDb.createUser('wire-user', 'hashed-password');

    const { artifact, validation } = recordArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ExtractionSet',
      payload: { rows: [{ value: 5 }] },
    });
    expect(validation.passed).toBe(false);
    expect(artifact.status).toBe('draft');
    expect(validation.errors.map((e) => e.code)).toContain('EXTRACTION_PROVENANCE_MISSING');
  });
});

describe('analysisPlanAdherenceValidator', () => {
  it('flags deviation, missing heterogeneity, and pooled-without-dataset', () => {
    const result = analysisPlanAdherenceValidator({ payload: {
      analysisPlan: { effectMeasure: 'OR', model: 'random-effects-REML' },
      effectMeasure: 'RR', model: 'random-effects-REML',
      pooledEstimates: [{ comparison: 'A-B', estimate: 0.7 }],
      dataset: { rows: [] },
    } });
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('ANALYSIS_PLAN_DEVIATION');
    expect(codes).toContain('HETEROGENEITY_NOT_REPORTED');
    expect(codes).toContain('POOLED_ESTIMATE_WITHOUT_DATASET');
  });

  it('passes a plan-adherent analysis with heterogeneity and dataset rows', () => {
    const result = analysisPlanAdherenceValidator({ payload: {
      analysisPlan: { effectMeasure: 'OR', model: 'random-effects-REML' },
      effectMeasure: 'OR', model: 'random-effects-REML',
      heterogeneity: { i2: 0.42, tau2: 0.1 },
      pooledEstimates: [{ comparison: 'A-B', estimate: 0.7 }],
      dataset: { rows: [{ study: 'S1' }] },
    } });
    expect(result.passed).toBe(true);
  });
});
