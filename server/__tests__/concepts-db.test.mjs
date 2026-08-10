import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadDatabaseModule() {
  vi.resetModules();
  return import('../database/db.js');
}

describe('conceptsDb', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-concepts-db-'));
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

  it('creates concepts, stores evidence, and reports overview stats', async () => {
    const { conceptsDb, initializeDatabase, referencesDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const createdUser = userDb.createUser('concept-test-user', 'hashed-password');
    const userId = createdUser.id;

    const [referenceId] = referencesDb.importReferences(userId, [
      {
        title: 'Inflammation marker paper',
        authors: [{ family: 'Lin', given: 'Ada' }],
        year: 2025,
        abstract: 'NLR remained associated with mortality after adjustment.',
        journal: 'Clinical Signals',
        itemType: 'article',
        keywords: ['biomarker', 'risk'],
        citationKey: 'Lin2025NLR',
      },
    ], 'bibtex');

    const concept = conceptsDb.createConcept(userId, {
      concept_type: 'indicator',
      canonical_name: 'Neutrophil-to-lymphocyte ratio',
      aliases: ['NLR', 'Neutrophil lymphocyte ratio', 'NLR'],
      description: 'Inflammation-related ratio derived from routine blood counts.',
      status: 'stable',
      source_strategy: 'manual',
      metadata: {
        unit: 'ratio',
        domain: 'inflammation',
      },
    });

    expect(concept?.canonical_name).toBe('Neutrophil-to-lymphocyte ratio');
    expect(concept?.aliases).toEqual(['NLR', 'Neutrophil lymphocyte ratio']);
    expect(concept?.evidence_count).toBe(0);

    const evidence = conceptsDb.createConceptEvidence(userId, concept.id, {
      reference_id: referenceId,
      evidence_type: 'abstract_claim',
      evidence_text: 'Elevated NLR predicted mortality in the adjusted model.',
      evidence_location: 'abstract',
      direction: 'supporting',
      evidence_level: 'moderate',
      review_status: 'accepted',
      metadata: {
        cohort: 'general medical admissions',
      },
    });

    expect(evidence?.reference_id).toBe(referenceId);
    expect(evidence?.reference_title).toBe('Inflammation marker paper');
    expect(evidence?.metadata).toEqual({ cohort: 'general medical admissions' });

    const updatedConcept = conceptsDb.getConcept(userId, concept.id);
    expect(updatedConcept?.evidence_count).toBe(1);

    const searchResults = conceptsDb.listConcepts(userId, {
      search: 'lymphocyte',
      conceptTypes: ['indicator'],
      statuses: ['stable'],
      limit: 20,
      offset: 0,
    });

    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]?.id).toBe(concept.id);

    const overviewStats = conceptsDb.getOverviewStats(userId);
    expect(overviewStats).toMatchObject({
      total_concepts: 1,
      stable_concepts: 1,
      reviewed_concepts: 0,
      candidate_concepts: 0,
      total_evidence: 1,
    });
  });

  it('can detect duplicate canonical names within the same concept type', async () => {
    const { conceptsDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const createdUser = userDb.createUser('concept-dup-user', 'hashed-password');
    const userId = createdUser.id;

    const concept = conceptsDb.createConcept(userId, {
      concept_type: 'disease',
      canonical_name: 'Metabolic dysfunction-associated steatotic liver disease',
      status: 'reviewed',
      source_strategy: 'manual',
    });

    const duplicate = conceptsDb.findConceptByCanonical(
      userId,
      'disease',
      'Metabolic dysfunction-associated steatotic liver disease',
    );

    expect(duplicate?.id).toBe(concept.id);
  });

  it('backfills concept and monitor tables for a legacy migrated auth db', async () => {
    const legacyDb = new Database(process.env.DATABASE_PATH);
    legacyDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        is_active BOOLEAN DEFAULT 1
      );
      CREATE INDEX idx_users_username ON users(username);
      CREATE INDEX idx_users_active ON users(is_active);
    `);
    legacyDb.close();

    const { conceptsDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const createdUser = userDb.createUser('legacy-migration-user', 'hashed-password');
    const userId = createdUser.id;

    expect(conceptsDb.getOverviewStats(userId)).toMatchObject({
      total_concepts: 0,
      stable_concepts: 0,
      reviewed_concepts: 0,
      candidate_concepts: 0,
      total_evidence: 0,
    });

    const validationDb = new Database(process.env.DATABASE_PATH, { readonly: true });
    const tableNames = validationDb.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('clinical_concepts', 'concept_evidence')
      ORDER BY name
    `).all().map((row) => row.name);
    validationDb.close();

    expect(tableNames).toEqual([
      'clinical_concepts',
      'concept_evidence',
    ]);
  });
});
