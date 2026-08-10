import { mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadDatabaseModule() {
  vi.resetModules();
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  return database;
}

describe('Meta full-text asset storage', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medautodata-meta-fulltext-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('../utils/zotero-client.js');
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('persists full-text asset metadata on the compatible meta_pdf_assets table', async () => {
    const { initializeDatabase, metaAnalysisDb, projectDb, referencesDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const user = userDb.createUser('fulltext-asset-user', 'hashed-password');
    const projectName = 'fulltext-asset-project';
    const projectPath = path.join(tempRoot, projectName);
    await mkdir(projectPath, { recursive: true });
    projectDb.upsertProject(projectName, user.id, 'Full Text Asset Project', projectPath, 0, null, {
      projectKind: 'meta',
      metaAnalysis: { folderSchemaVersion: 'meta-v2' },
    });
    const metaProject = metaAnalysisDb.createMetaProject(user.id, {
      projectId: projectName,
      reviewType: 'diagnostic',
      title: 'Full Text Asset Project',
    });
    const [referenceId] = referencesDb.importReferences(user.id, [{
      title: 'Open HTML full text',
      authors: [{ family: 'Open', given: 'Ada' }],
      year: 2026,
      doi: '10.1000/fulltext',
      abstract: 'A full text asset test.',
      journal: 'Open Journal',
      itemType: 'article',
      citationKey: 'Open2026FullText',
    }], 'bibtex');

    const asset = metaAnalysisDb.upsertPdfAsset(user.id, {
      metaProjectId: metaProject.id,
      referenceId,
      source: 'pmc_html',
      status: 'downloaded',
      filePath: '04_full_text_review/fulltext/ref/open.html',
      sha256: 'abc123',
      licenseStatus: 'open_access',
      assetType: 'html',
      contentType: 'text/html',
      originalFilename: 'open.html',
      sourceUrl: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/',
      error: null,
    });

    expect(asset).toMatchObject({
      reference_id: referenceId,
      source: 'pmc_html',
      status: 'downloaded',
      asset_type: 'html',
      content_type: 'text/html',
      original_filename: 'open.html',
      source_url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/',
    });
  });

  it('persists Zotero handoff state by reference to avoid duplicate pushes', async () => {
    const { metaAnalysisDb, projectDb, referencesDb, userDb } = await loadDatabaseModule();

    const user = userDb.createUser('zotero-export-state-user', 'hashed-password');
    const projectName = 'zotero-export-state-project';
    const projectPath = path.join(tempRoot, projectName);
    await mkdir(projectPath, { recursive: true });
    projectDb.upsertProject(projectName, user.id, 'Zotero Export State Project', projectPath, 0, null, {
      projectKind: 'meta',
      metaAnalysis: { folderSchemaVersion: 'meta-v2' },
    });
    const metaProject = metaAnalysisDb.createMetaProject(user.id, {
      projectId: projectName,
      reviewType: 'diagnostic',
      title: 'Zotero Export State Project',
    });
    const [referenceId] = referencesDb.importReferences(user.id, [{
      title: 'Zotero export state',
      authors: [{ family: 'State', given: 'Zoe' }],
      year: 2026,
      doi: '10.1000/zotero-export-state',
      itemType: 'article',
      citationKey: 'State2026ZoteroExport',
    }], 'pubmed');

    metaAnalysisDb.upsertZoteroExport(user.id, {
      metaProjectId: metaProject.id,
      referenceId,
      zoteroItemKey: 'ITEM1',
      collectionKey: 'REVIEW',
      reviewCollectionKey: 'NEEDS',
      status: 'missing_attachment',
      missingAttachment: true,
    });
    const updated = metaAnalysisDb.upsertZoteroExport(user.id, {
      metaProjectId: metaProject.id,
      referenceId,
      zoteroAttachmentKey: 'ATTACH1',
      status: 'exported',
      missingAttachment: false,
      metadataJson: { matchReason: 'existing_export_record' },
    });

    expect(updated).toMatchObject({
      reference_id: referenceId,
      zotero_item_key: 'ITEM1',
      zotero_attachment_key: 'ATTACH1',
      status: 'exported',
      missing_attachment: false,
      metadata_json: { matchReason: 'existing_export_record' },
    });
    expect(metaAnalysisDb.listZoteroExports(user.id, metaProject.id)).toHaveLength(1);
  });

  it('records manual_upload_required when automatic full-text resolution finds no legal source', async () => {
    const { metaAnalysisDb, projectDb, referencesDb, userDb } = await loadDatabaseModule();
    const { resolvePdfForReference } = await import('../services/meta-analysis/pdf-resolver.js');

    const user = userDb.createUser('fulltext-missing-user', 'hashed-password');
    const projectName = 'fulltext-missing-project';
    const projectPath = path.join(tempRoot, projectName);
    await mkdir(projectPath, { recursive: true });
    projectDb.upsertProject(projectName, user.id, 'Full Text Missing Project', projectPath, 0, null, {
      projectKind: 'meta',
      metaAnalysis: { folderSchemaVersion: 'meta-v2' },
    });
    const metaProject = metaAnalysisDb.createMetaProject(user.id, {
      projectId: projectName,
      reviewType: 'diagnostic',
      title: 'Full Text Missing Project',
    });
    const [referenceId] = referencesDb.importReferences(user.id, [{
      title: 'No open full text',
      authors: [{ family: 'Closed', given: 'Bea' }],
      year: 2026,
      abstract: 'No identifiers.',
      journal: 'Closed Journal',
      itemType: 'article',
      citationKey: 'Closed2026NoText',
    }], 'bibtex');
    const reference = referencesDb.getReference(referenceId, user.id);

    const asset = await resolvePdfForReference({
      userId: user.id,
      metaProject,
      reference,
      projectPath,
      sources: [],
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    expect(asset).toMatchObject({
      reference_id: referenceId,
      status: 'manual_upload_required',
      asset_type: 'pdf',
    });
    expect(asset.error).toContain('No legal full-text source');
  });

  it('treats explicit needs_full_text manifest rows as the full-text acquisition queue', async () => {
    const { __testing } = await import('../routes/meta-analysis.js');

    expect(__testing.isFullTextAcquisitionManifestRow({
      reference_id: 'eligible',
      needs_full_text: true,
      status: 'not_checked',
    })).toBe(true);
    expect(__testing.isFullTextAcquisitionManifestRow({
      reference_id: 'title-abstract-only',
      status: 'not_checked',
    })).toBe(false);
    expect(__testing.isFullTextAcquisitionManifestRow({
      reference_id: 'legacy-downloaded',
      status: 'downloaded',
      path: '04_full_text_review/fulltext/ref/paper.pdf',
    })).toBe(true);
    expect(__testing.isFullTextAcquisitionManifestRow({
      reference_id: 'excluded',
      needs_full_text: false,
      status: 'manual_upload_required',
    })).toBe(false);
  });

  it('resolves a user-owned Zotero PDF attachment by DOI for non-Zotero references', async () => {
    vi.doMock('../utils/zotero-client.js', () => ({
      getZoteroClient: async () => ({
        client: {
          getLibraries: async () => [{ id: 0, type: 'user', name: 'My Library' }],
          searchItems: async (_libraryId, query) => (String(query).includes('10.1000/zotero-fulltext')
            ? [{
              sourceId: 'ZOTERO1',
              title: 'Zotero matched full text',
              year: 2026,
              doi: '10.1000/zotero-fulltext',
            }]
            : []),
          getItemPdf: async (_libraryId, itemKey) => (itemKey === 'ZOTERO1'
            ? Buffer.from('%PDF-1.4 zotero attachment')
            : null),
        },
        mode: 'local',
        localRunning: true,
        localApiDisabled: false,
      }),
    }));
    const { metaAnalysisDb, projectDb, referencesDb, userDb } = await loadDatabaseModule();
    const { resolvePdfForReference } = await import('../services/meta-analysis/pdf-resolver.js');

    const user = userDb.createUser('zotero-fulltext-user', 'hashed-password');
    const projectName = 'zotero-fulltext-project';
    const projectPath = path.join(tempRoot, projectName);
    await mkdir(projectPath, { recursive: true });
    projectDb.upsertProject(projectName, user.id, 'Zotero Full Text Project', projectPath, 0, null, {
      projectKind: 'meta',
      metaAnalysis: { folderSchemaVersion: 'meta-v2' },
    });
    const metaProject = metaAnalysisDb.createMetaProject(user.id, {
      projectId: projectName,
      reviewType: 'diagnostic',
      title: 'Zotero Full Text Project',
    });
    const [referenceId] = referencesDb.importReferences(user.id, [{
      title: 'Zotero matched full text',
      authors: [{ family: 'Library', given: 'Zoe' }],
      year: 2026,
      doi: '10.1000/zotero-fulltext',
      abstract: 'A Zotero DOI match test.',
      journal: 'Library Journal',
      itemType: 'article',
      citationKey: 'Zotero2026FullText',
    }], 'pubmed');
    const reference = referencesDb.getReference(referenceId, user.id);

    const asset = await resolvePdfForReference({
      userId: user.id,
      metaProject,
      reference,
      projectPath,
      sources: ['zotero'],
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    expect(asset).toMatchObject({
      reference_id: referenceId,
      status: 'downloaded',
      source: 'zotero',
      asset_type: 'pdf',
      source_url: 'zotero://select/library/items/ZOTERO1',
    });
    expect(asset.license_status).toContain('zotero_attachment');
  });

  it('records manual upload when a queued Zotero lookup finds no matching attachment', async () => {
    vi.doMock('../utils/zotero-client.js', () => ({
      getZoteroClient: async () => ({
        client: {
          getLibraries: async () => [{ id: 0, type: 'user', name: 'My Library' }],
          searchItems: async () => [],
          getItemPdf: async () => null,
        },
        mode: 'local',
        localRunning: true,
        localApiDisabled: false,
      }),
    }));
    const { metaAnalysisDb, projectDb, referencesDb, userDb } = await loadDatabaseModule();
    const { resolvePdfForReference } = await import('../services/meta-analysis/pdf-resolver.js');

    const user = userDb.createUser('zotero-missing-user', 'hashed-password');
    const projectName = 'zotero-missing-project';
    const projectPath = path.join(tempRoot, projectName);
    await mkdir(projectPath, { recursive: true });
    projectDb.upsertProject(projectName, user.id, 'Zotero Missing Project', projectPath, 0, null, {
      projectKind: 'meta',
      metaAnalysis: { folderSchemaVersion: 'meta-v2' },
    });
    const metaProject = metaAnalysisDb.createMetaProject(user.id, {
      projectId: projectName,
      reviewType: 'diagnostic',
      title: 'Zotero Missing Project',
    });
    const [referenceId] = referencesDb.importReferences(user.id, [{
      title: 'No Zotero match',
      authors: [{ family: 'Library', given: 'Noah' }],
      year: 2026,
      doi: '10.1000/no-zotero-match',
      abstract: 'A Zotero missing match test.',
      journal: 'Library Journal',
      itemType: 'article',
      citationKey: 'Zotero2026Missing',
    }], 'pubmed');
    const reference = referencesDb.getReference(referenceId, user.id);

    const asset = await resolvePdfForReference({
      userId: user.id,
      metaProject,
      reference,
      projectPath,
      sources: ['zotero'],
      artifactOptions: { folderSchemaVersion: 'meta-v2' },
    });

    expect(asset).toMatchObject({
      reference_id: referenceId,
      source: 'zotero',
      status: 'manual_upload_required',
    });
    expect(asset.error).toContain('No matching Zotero PDF attachment');
  });
});
