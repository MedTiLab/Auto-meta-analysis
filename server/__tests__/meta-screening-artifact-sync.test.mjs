import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot = null;

async function loadModules() {
  vi.resetModules();
  const database = await import('../database/db.js');
  const sync = await import('../services/meta-analysis/screening-artifact-sync.js');
  const gates = await import('../services/meta-analysis/workflow-gates.js');
  await database.initializeDatabase();
  return { database, sync, gates };
}

async function createMetaFixture(database, username = 'meta-sync-user') {
  const user = database.userDb.createUser(username, 'hashed-password');
  const projectName = `${username}-project`;
  const projectPath = path.join(tempRoot, projectName);
  await mkdir(path.join(projectPath, '03_title_abstract_screening'), { recursive: true });
  database.projectDb.upsertProject(projectName, user.id, 'Meta Sync Project', projectPath, 0, null, {
    projectKind: 'meta',
    metaAnalysis: { folderSchemaVersion: 'meta-v2' },
  });
  const metaProject = database.metaAnalysisDb.createMetaProject(user.id, {
    projectId: projectName,
    reviewType: 'diagnostic',
    title: 'Meta Sync Project',
  });
  return { user, projectName, projectPath, metaProject };
}

async function writeScreeningJson(projectPath, payload) {
  await writeFile(
    path.join(projectPath, '03_title_abstract_screening', 'screening_decisions.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

async function writeScreeningCsv(projectPath, content) {
  await writeFile(
    path.join(projectPath, '03_title_abstract_screening', 'screening_decisions.csv'),
    content,
    'utf8',
  );
}

describe('Meta screening artifact sync', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medautodata-meta-screening-sync-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('imports new JSON screening records, links them to the project, and remains idempotent', async () => {
    const { database, sync, gates } = await loadModules();
    const { user, projectPath, metaProject } = await createMetaFixture(database);

    await writeScreeningJson(projectPath, {
      schemaVersion: 'meta-screening-v1',
      reviewer: 'claude',
      stage: 'title_abstract',
      records: [
        {
          pmid: '123456',
          doi: '10.1000/example',
          title: 'Diagnostic Biomarker Accuracy in Lung Cancer',
          authors: [{ family: 'Alpha', given: 'Ann' }],
          year: 2026,
          journal: 'Meta Medicine',
          abstract: 'A diagnostic accuracy study.',
          decision: 'include',
          confidence: 0.86,
          reason: 'Matches the biomarker and diagnostic accuracy PICO.',
          evidenceNote: 'Reports sensitivity and specificity.',
        },
      ],
    });

    const firstSync = await sync.syncScreeningArtifact({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });
    const secondSync = await sync.syncScreeningArtifact({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    const references = database.referencesDb.getProjectReferences(metaProject.project_id, user.id);
    const decisions = database.metaAnalysisDb.listScreeningDecisions(user.id, metaProject.id);

    expect(firstSync.imported).toBe(1);
    expect(firstSync.linked).toBe(1);
    expect(firstSync.upserted).toBe(1);
    expect(secondSync.imported).toBe(0);
    expect(references).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].reviewer).toBe('claude');
    expect(decisions[0].confidence).toBeCloseTo(0.86);
    expect(decisions[0].metadata_json?.schemaVersion).toBe('meta-screening-v1');
    expect(gates.filterHumanReviewedFullTextCandidates(references, decisions)).toHaveLength(1);
  });

  it('matches existing references, skips invalid rows, and preserves user decisions on later syncs', async () => {
    const { database, sync } = await loadModules();
    const { user, projectPath, metaProject } = await createMetaFixture(database, 'meta-sync-existing');
    const [existingReferenceId] = database.referencesDb.importReferences(user.id, [
      {
        title: 'Existing PubMed Diagnostic Paper',
        authors: [{ family: 'Beta', given: 'Ben' }],
        year: 2025,
        abstract: 'Existing abstract.',
        doi: '10.2000/existing',
        journal: 'Existing Journal',
        citationKey: '777777',
      },
    ], 'pubmed');

    await writeScreeningJson(projectPath, {
      schemaVersion: 'meta-screening-v1',
      reviewer: 'claude',
      records: [
        {
          pmid: '777777',
          doi: '10.2000/existing',
          title: 'Existing PubMed Diagnostic Paper',
          year: 2025,
          decision: 'maybe',
          confidence: 91,
          reason: 'Potentially eligible.',
        },
        {
          title: 'Invalid Decision Paper',
          decision: 'unclear',
        },
      ],
    });

    const firstSync = await sync.syncScreeningArtifact({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });
    database.metaAnalysisDb.upsertScreeningDecision(user.id, {
      metaProjectId: metaProject.id,
      referenceId: existingReferenceId,
      stage: 'title_abstract',
      decision: 'exclude',
      reviewer: 'user',
      reason: 'User excluded after inspection.',
    });
    const secondSync = await sync.syncScreeningArtifact({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    const references = database.referencesDb.getProjectReferences(metaProject.project_id, user.id);
    const decisions = database.metaAnalysisDb.listScreeningDecisions(user.id, metaProject.id);

    expect(firstSync.imported).toBe(0);
    expect(firstSync.matched).toBe(1);
    expect(firstSync.skipped).toBe(1);
    expect(firstSync.warnings[0]).toContain('invalid decision');
    expect(secondSync.preservedUserDecisions).toBe(1);
    expect(references).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe('exclude');
    expect(decisions[0].reviewer).toBe('user');
  });

  it('imports only the final deduped screening input table as AI screening input', async () => {
    const { database, sync } = await loadModules();
    const { user, projectPath, metaProject } = await createMetaFixture(database, 'meta-sync-search');
    await mkdir(path.join(projectPath, '02_search_dedupe', 'search', 'imported_records'), { recursive: true });

    await writeFile(
      path.join(projectPath, '02_search_dedupe', 'search', 'imported_records', 'pubmed.json'),
      `${JSON.stringify([
        {
          pmid: '900001',
          title: 'PubMed AI Screening Input Paper',
          year: 2026,
          journal: 'PubMed Journal',
          abstract: 'A PubMed search result.',
        },
      ], null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(projectPath, '02_search_dedupe', 'screening_input.csv'),
      [
        'source,pmid,doi,title,year,journal',
        'pubmed,900001,,"Final Deduped PubMed Paper",2026,PubMed Journal',
        'openalex,,10.3000/openalex,"Final Deduped OpenAlex Paper",2025,OpenAlex Journal',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(projectPath, '02_search_dedupe', 'search_results_openalex.json'),
      `${JSON.stringify({
        databaseName: 'openalex',
        query: 'diagnostic biomarker',
        records: [
          {
            doi: '10.3000/openalex',
            title: 'OpenAlex Search Result Paper',
            year: 2025,
            journal: 'OpenAlex Journal',
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const syncResult = await sync.syncMetaArtifacts({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    const references = database.referencesDb.getProjectReferences(metaProject.project_id, user.id);
    const decisions = database.metaAnalysisDb.listScreeningDecisions(user.id, metaProject.id);
    const searchRuns = database.metaAnalysisDb.listSearchRuns(user.id, metaProject.id);
    const report = JSON.parse(await readFile(path.join(projectPath, '03_title_abstract_screening', 'sync_report.json'), 'utf8'));

    expect(syncResult.search.imported).toBe(2);
    expect(syncResult.search.searchRunsCreated).toBe(1);
    expect(references).toHaveLength(2);
    expect(decisions).toHaveLength(0);
    expect(searchRuns).toHaveLength(1);
    expect(searchRuns[0].raw_response_path).toBe('02_search_dedupe/screening_input.csv');
    expect(report.summary.imported).toBe(2);
  });

  it('ignores raw source records and legacy screening filenames when canonical tables are missing', async () => {
    const { database, sync } = await loadModules();
    const { user, projectPath, metaProject } = await createMetaFixture(database, 'meta-sync-canonical-only');
    await mkdir(path.join(projectPath, '02_search_dedupe', 'search', 'imported_records'), { recursive: true });

    await writeFile(
      path.join(projectPath, '02_search_dedupe', 'search', 'imported_records', 'pubmed.csv'),
      [
        'PMID,Title,Year,Journal',
        '910001,"Raw PubMed Source Should Not Sync",2026,Raw Journal',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(projectPath, '03_title_abstract_screening', 'screening_titleabstract.csv'),
      [
        'PMID,Title,Decision,Reviewer',
        '910001,"Legacy Screening Should Not Sync",include,claude',
      ].join('\n'),
      'utf8',
    );

    const syncResult = await sync.syncMetaArtifacts({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    const references = database.referencesDb.getProjectReferences(metaProject.project_id, user.id);
    const decisions = database.metaAnalysisDb.listScreeningDecisions(user.id, metaProject.id);

    expect(syncResult.search.exists).toBe(false);
    expect(syncResult.screening.exists).toBe(false);
    expect(references).toHaveLength(0);
    expect(decisions).toHaveLength(0);
  });

  it('imports CSV search inputs and CSV AI pre-screen decisions', async () => {
    const { database, sync, gates } = await loadModules();
    const { user, projectPath, metaProject } = await createMetaFixture(database, 'meta-sync-csv');
    await mkdir(path.join(projectPath, '02_search_dedupe'), { recursive: true });

    await writeFile(
      path.join(projectPath, '02_search_dedupe', 'screening_input.csv'),
      [
        'PMID,Title,Year,Journal,Abstract',
        '990001,"CSV Search, Diagnostic Paper",2026,CSV Journal,"Search record with comma, quoted correctly."',
      ].join('\n'),
      'utf8',
    );
    await writeScreeningCsv(projectPath, [
      'PMID,Title,Decision,Confidence,Reason,Evidence Note,Reviewer',
      '990001,"CSV Search, Diagnostic Paper",include,83%,"Matches PICO","Reports diagnostic accuracy",ai_pre_screen',
    ].join('\n'));

    const syncResult = await sync.syncMetaArtifacts({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    const references = database.referencesDb.getProjectReferences(metaProject.project_id, user.id);
    const decisions = database.metaAnalysisDb.listScreeningDecisions(user.id, metaProject.id);
    const searchRuns = database.metaAnalysisDb.listSearchRuns(user.id, metaProject.id);

    expect(syncResult.search.imported).toBe(1);
    expect(syncResult.screening.matched).toBe(1);
    expect(syncResult.screening.upserted).toBe(1);
    expect(syncResult.screening.artifactPaths).toContain('03_title_abstract_screening/screening_decisions.csv');
    expect(references).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].reviewer).toBe('ai_pre_screen');
    expect(decisions[0].confidence).toBeCloseTo(0.83);
    expect(decisions[0].metadata_json.sourceFormat).toBe('csv');
    expect(searchRuns[0].raw_response_path).toBe('02_search_dedupe/screening_input.csv');
    expect(gates.filterHumanReviewedFullTextCandidates(references, decisions)).toHaveLength(0);
  });

  it('skips unchanged canonical artifacts after a sync report has been written', async () => {
    const { database, sync } = await loadModules();
    const { user, projectPath, metaProject } = await createMetaFixture(database, 'meta-sync-unchanged');
    await mkdir(path.join(projectPath, '02_search_dedupe'), { recursive: true });

    await writeFile(
      path.join(projectPath, '02_search_dedupe', 'screening_input.csv'),
      [
        'PMID,Title,Year,Journal,Abstract',
        '770001,"Unchanged Search Input Paper",2026,CSV Journal,"Search input."',
      ].join('\n'),
      'utf8',
    );
    await writeScreeningCsv(projectPath, [
      'PMID,Title,Decision,Confidence,Reason,Evidence Note,Reviewer',
      '770001,"Unchanged Search Input Paper",include,0.8,"Matches PICO","Reports diagnostic accuracy",claude',
    ].join('\n'));

    const firstSync = await sync.syncMetaArtifacts({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });
    const secondSync = await sync.syncMetaArtifacts({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    expect(firstSync.summary.imported).toBe(1);
    expect(firstSync.summary.screeningDecisionsUpserted).toBe(1);
    expect(secondSync.summary.imported).toBe(0);
    expect(secondSync.summary.screeningDecisionsUpserted).toBe(0);
    expect(secondSync.search.files[0].unchanged).toBe(true);
    expect(secondSync.screening.files[0].unchanged).toBe(true);
  });

  it('accepts decisions arrays, keeps AI pre-screen from advancing gates, and preserves pre-screen metadata after Claude review', async () => {
    const { database, sync, gates } = await loadModules();
    const { user, projectPath, metaProject } = await createMetaFixture(database, 'meta-sync-ai-review');

    await writeScreeningJson(projectPath, {
      schemaVersion: 'meta-screening-v1',
      reviewer: 'ai_pre_screen',
      decisions: [
        {
          pmid: '880001',
          title: 'AI Pre Screen Diagnostic Study',
          year: 2026,
          decision: 'include',
          confidence: 0.72,
          reason: 'Likely matches PICO.',
          evidenceNote: 'Title mentions diagnostic accuracy.',
        },
      ],
    });

    await sync.syncMetaArtifacts({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    let references = database.referencesDb.getProjectReferences(metaProject.project_id, user.id);
    let decisions = database.metaAnalysisDb.listScreeningDecisions(user.id, metaProject.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].reviewer).toBe('ai_pre_screen');
    expect(decisions[0].metadata_json.agentReviewStatus).toBe('pending_review');
    expect(gates.filterHumanReviewedFullTextCandidates(references, decisions)).toHaveLength(0);

    await writeScreeningJson(projectPath, {
      schemaVersion: 'meta-screening-v1',
      reviewer: 'claude',
      decisions: [
        {
          pmid: '880001',
          title: 'AI Pre Screen Diagnostic Study',
          year: 2026,
          decision: 'maybe',
          confidence: 0.82,
          reason: 'Claude review keeps it for full-text inspection.',
          evidenceNote: 'Abstract should be checked for 2x2 data.',
        },
      ],
    });

    await sync.syncMetaArtifacts({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    references = database.referencesDb.getProjectReferences(metaProject.project_id, user.id);
    decisions = database.metaAnalysisDb.listScreeningDecisions(user.id, metaProject.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe('maybe');
    expect(decisions[0].reviewer).toBe('claude');
    expect(decisions[0].metadata_json.previousAiPreScreen.decision).toBe('include');
    expect(gates.filterHumanReviewedFullTextCandidates(references, decisions)).toHaveLength(1);
  });

  it('reports invalid JSON artifacts without blocking other sync work', async () => {
    const { database, sync } = await loadModules();
    const { user, projectPath, metaProject } = await createMetaFixture(database, 'meta-sync-invalid-json');
    await mkdir(path.join(projectPath, '02_search_dedupe'), { recursive: true });
    await writeFile(path.join(projectPath, '02_search_dedupe', 'screening_input.json'), '{ bad json', 'utf8');

    await writeScreeningJson(projectPath, {
      schemaVersion: 'meta-screening-v1',
      reviewer: 'claude',
      records: [
        {
          title: 'Valid Screening Paper Despite Broken Search JSON',
          decision: 'include',
        },
      ],
    });

    const syncResult = await sync.syncMetaArtifacts({
      userId: user.id,
      metaProject,
      projectPath,
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    const references = database.referencesDb.getProjectReferences(metaProject.project_id, user.id);
    const decisions = database.metaAnalysisDb.listScreeningDecisions(user.id, metaProject.id);

    expect(syncResult.summary.warnings.some((warning) => warning.includes('invalid JSON'))).toBe(true);
    expect(references).toHaveLength(1);
    expect(decisions).toHaveLength(1);
  });
});
