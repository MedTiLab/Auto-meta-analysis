import express from 'express';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import multer from 'multer';
import { metaAnalysisDb, referencesDb } from '../database/db.js';
import { extractProjectDirectory } from '../projects.js';
import { syncReferencesToMetaFullTextArtifacts } from '../utils/meta-full-text-reference-artifacts.js';
import { syncReferencesToProjectArtifacts, removeReferenceArtifactsFromProject } from '../utils/reference-project-artifacts.js';
import { buildAggregatedProjectReferences } from '../utils/project-reference-aggregate.js';
import { getZoteroClient } from '../utils/zotero-client.js';
import { getZoteroWebCredentialStatus } from '../utils/zotero-web-client.js';
import { parseBibtex } from '../utils/parsers/bibtex-parser.js';
import { resolveReferencesPdfCacheDir } from '../utils/storagePaths.js';

const router = express.Router();

// Multer for BibTeX file upload (in-memory, max 5 MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function getPdfCacheDir() {
  return resolveReferencesPdfCacheDir();
}

function ensurePdfCacheDir() {
  const pdfCacheDir = getPdfCacheDir();
  if (!fs.existsSync(pdfCacheDir)) {
    fs.mkdirSync(pdfCacheDir, { recursive: true });
  }
}

function getSafeReferenceCacheId(referenceId) {
  return String(referenceId || '').replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function getCachedPdfPath(referenceId) {
  return path.join(getPdfCacheDir(), `${getSafeReferenceCacheId(referenceId)}.pdf`);
}

async function resolveProjectAbsolutePath(projectName) {
  const projectPath = await extractProjectDirectory(projectName);
  if (!path.isAbsolute(projectPath)) {
    const error = new Error(`Project "${projectName}" is not resolved to an absolute path.`);
    error.code = 'NON_ABSOLUTE_PROJECT_PATH';
    throw error;
  }

  try {
    await fsPromises.access(projectPath);
  } catch (error) {
    error.code = error.code || 'PROJECT_NOT_FOUND';
    throw error;
  }

  return projectPath;
}

function formatProjectPathError(projectName, error) {
  if (error?.code === 'NON_ABSOLUTE_PROJECT_PATH') {
    return {
      status: 400,
      payload: { error: 'Invalid project path', message: error.message },
    };
  }

  return {
    status: 404,
    payload: { error: 'Project not found', message: `Project "${projectName}" does not exist` },
  };
}

function isMetaProjectDirectory(projectPath) {
  try {
    const instance = JSON.parse(fs.readFileSync(path.join(projectPath, 'instance.json'), 'utf8'));
    const kind = String(instance?.metadata?.projectKind || instance?.projectKind || instance?.kind || '').toLowerCase();
    return kind === 'meta'
      || kind === 'meta_analysis'
      || kind === 'meta-analysis'
      || Boolean(instance?.MetaAnalysis || instance?.metaAnalysis || instance?.metadata?.metaAnalysis);
  } catch {
    return false;
  }
}

function createProjectPdfResolver(userId) {
  let zoteroContextPromise = null;

  const getZoteroContext = async () => {
    if (!zoteroContextPromise) {
      zoteroContextPromise = (async () => {
        const { client } = await getZoteroClient();
        if (!client) {
          return null;
        }
        const libraries = await client.getLibraries();
        return { client, libraryId: libraries[0]?.id };
      })();
    }

    return zoteroContextPromise;
  };

  return async (reference) => {
    ensurePdfCacheDir();
    const cachedPdfPath = getCachedPdfPath(reference.id);
    if (fs.existsSync(cachedPdfPath)) {
      if (!reference.pdf_cached) {
        referencesDb.setPdfCached(reference.id, true);
      }
      return { pdfSourcePath: cachedPdfPath };
    }

    if (reference.source === 'zotero' && reference.source_id) {
      try {
        const zoteroContext = await getZoteroContext();
        if (zoteroContext?.client) {
          const pdfBuffer = await zoteroContext.client.getItemPdf(zoteroContext.libraryId, reference.source_id);
          if (pdfBuffer) {
            fs.writeFileSync(cachedPdfPath, pdfBuffer);
            referencesDb.setPdfCached(reference.id, true);
            return { pdfSourcePath: cachedPdfPath };
          }
        }
      } catch (error) {
        console.warn(`[References] Failed to fetch Zotero PDF for ${reference.id}:`, error.message);
      }
    }

    return {};
  };
}

function groupProjectLinks(links) {
  return links.reduce((accumulator, link) => {
    if (!accumulator.has(link.project_id)) {
      accumulator.set(link.project_id, []);
    }
    accumulator.get(link.project_id).push(link.reference_id);
    return accumulator;
  }, new Map());
}

async function cleanupProjectArtifactsFromLinks(links) {
  const grouped = groupProjectLinks(links || []);
  for (const [projectName, referenceIds] of grouped.entries()) {
    try {
      const projectPath = await resolveProjectAbsolutePath(projectName);
      await removeReferenceArtifactsFromProject({
        projectPath,
        projectName,
        referenceIds,
      });
    } catch (error) {
      console.warn(`[References] Failed to clean project artifacts for ${projectName}:`, error.message);
    }
  }
}

function syncReferenceArtifactsToLinkedProjects(reference, userId, pdfSourcePath) {
  if (!reference?.id || !pdfSourcePath) {
    return;
  }

  const links = referencesDb.getReferenceProjectLinks(userId, [reference.id]);
  if (!links.length) {
    return;
  }

  void (async () => {
    for (const link of links) {
      try {
        const projectPath = await resolveProjectAbsolutePath(link.project_id);
        const metaProject = metaAnalysisDb.getMetaProjectByProjectId(userId, link.project_id);
        const isMetaImport = Boolean(metaProject || isMetaProjectDirectory(projectPath));
        if (isMetaImport) {
          await syncReferencesToMetaFullTextArtifacts({
            userId,
            metaProject,
            projectPath,
            references: [reference],
            resolvePdfSource: async () => ({ pdfSourcePath }),
          });
        } else {
          await syncReferencesToProjectArtifacts({
            projectPath,
            projectName: link.project_id,
            references: [reference],
            resolvePdfSource: async () => ({ pdfSourcePath }),
          });
        }
      } catch (error) {
        console.warn(`[References] Failed to mirror PDF artifact for ${reference.id} -> ${link.project_id}:`, error.message);
      }
    }
  })();
}

// ---------------------------------------------------------------------------
// IMPORTANT: All literal/multi-segment routes MUST come before /:id
// to avoid Express matching "tags", "project", "zotero" etc. as an :id param.
// ---------------------------------------------------------------------------

/** GET /api/references — list user references (paginated, searchable) */
router.get('/', async (req, res) => {
  try {
    const { search, tags, folderId, limit, offset } = req.query;
    const parsedTags = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const parsedLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
    const parsedOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
    const filters = {
      search: search || undefined,
      tags: parsedTags,
      folderId: folderId || undefined,
    };
    const refs = referencesDb.getUserReferences(req.user.id, {
      ...filters,
      limit: parsedLimit,
      offset: parsedOffset,
    });
    const total = referencesDb.countUserReferences(req.user.id, filters);
    res.json({ references: refs, total, limit: parsedLimit, offset: parsedOffset });
  } catch (error) {
    console.error('Error fetching references:', error);
    res.status(500).json({ error: 'Failed to fetch references' });
  }
});

function normalizeFolderName(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** GET /api/references/folders — list local literature folders. */
router.get('/folders', (req, res) => {
  try {
    res.json(referencesDb.getFolders(req.user.id));
  } catch (error) {
    console.error('Error fetching reference folders:', error);
    res.status(500).json({ error: 'Failed to fetch reference folders' });
  }
});

/** POST /api/references/folders — create a local literature folder. */
router.post('/folders', (req, res) => {
  try {
    const name = normalizeFolderName(req.body?.name);
    const parentId = typeof req.body?.parentId === 'string' && req.body.parentId.trim()
      ? req.body.parentId.trim()
      : null;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });
    if (name.length > 80) return res.status(400).json({ error: 'Folder name must be 80 characters or fewer' });
    const folder = referencesDb.createFolder(req.user.id, name, parentId);
    if (!folder) return res.status(404).json({ error: 'Parent folder not found' });
    res.status(201).json({ folder });
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A folder with this name already exists' });
    }
    console.error('Error creating reference folder:', error);
    res.status(500).json({ error: 'Failed to create reference folder' });
  }
});

/** PATCH /api/references/folders/:folderId — rename a local literature folder. */
router.patch('/folders/:folderId', (req, res) => {
  try {
    const name = normalizeFolderName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Folder name is required' });
    if (name.length > 80) return res.status(400).json({ error: 'Folder name must be 80 characters or fewer' });
    const folder = referencesDb.renameFolder(req.user.id, req.params.folderId, name);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json({ folder });
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A folder with this name already exists' });
    }
    console.error('Error renaming reference folder:', error);
    res.status(500).json({ error: 'Failed to rename reference folder' });
  }
});

/** DELETE /api/references/folders/:folderId — delete a folder, preserving its references. */
router.delete('/folders/:folderId', (req, res) => {
  try {
    const deleted = referencesDb.deleteFolder(req.user.id, req.params.folderId);
    if (!deleted) return res.status(404).json({ error: 'Folder not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting reference folder:', error);
    res.status(500).json({ error: 'Failed to delete reference folder' });
  }
});

/** POST /api/references/folders/:folderId/references — add references to a folder. */
router.post('/folders/:folderId/references', (req, res) => {
  try {
    const referenceIds = Array.isArray(req.body?.referenceIds)
      ? [...new Set(req.body.referenceIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))]
      : [];
    if (referenceIds.length === 0) return res.status(400).json({ error: 'referenceIds array is required' });
    if (referenceIds.length > 500) return res.status(400).json({ error: 'Cannot add more than 500 references at once' });
    const added = referencesDb.addReferencesToFolder(req.user.id, req.params.folderId, referenceIds);
    if (added === null) return res.status(404).json({ error: 'Folder not found' });
    res.json({ success: true, added });
  } catch (error) {
    console.error('Error adding references to folder:', error);
    res.status(500).json({ error: 'Failed to add references to folder' });
  }
});

/** DELETE /api/references/folders/:folderId/references/:referenceId — remove one folder membership. */
router.delete('/folders/:folderId/references/:referenceId', (req, res) => {
  try {
    const removed = referencesDb.removeReferenceFromFolder(
      req.user.id,
      req.params.folderId,
      req.params.referenceId,
    );
    if (!removed) return res.status(404).json({ error: 'Folder membership not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing reference from folder:', error);
    res.status(500).json({ error: 'Failed to remove reference from folder' });
  }
});

/** DELETE /api/references/folders/references/:referenceId — remove all folder memberships. */
router.delete('/folders/references/:referenceId', (req, res) => {
  try {
    const removed = referencesDb.removeReferenceFromAllFolders(req.user.id, req.params.referenceId);
    if (removed === null) return res.status(404).json({ error: 'Reference not found' });
    res.json({ success: true, removed });
  } catch (error) {
    console.error('Error removing reference from all folders:', error);
    res.status(500).json({ error: 'Failed to remove reference from folders' });
  }
});

/** GET /api/references/tags — all user tags */
router.get('/tags', async (req, res) => {
  try {
    const tags = referencesDb.getTags(req.user.id);
    res.json({ tags });
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

/** GET /api/references/zotero/status — check Zotero connectivity */
router.get('/zotero/status', async (req, res) => {
  try {
    const { mode, localRunning, localApiDisabled, endpoint, detail } = await getZoteroClient();
    const web = getZoteroWebCredentialStatus(req.user.id);
    res.json({
      connected: mode !== null,
      mode,
      localAvailable: mode === 'local',
      localRunning,
      localApiDisabled,
      endpoint: endpoint || null,
      detail: detail || null,
      webConfigured: web.configured,
      webUserId: web.userId,
      writeAvailable: web.configured,
    });
  } catch (error) {
    console.error('Error checking Zotero status:', error);
    res.json({
      connected: false,
      mode: null,
      localAvailable: false,
      localRunning: false,
      localApiDisabled: false,
      endpoint: null,
      detail: error instanceof Error ? error.message : null,
      webConfigured: false,
      webUserId: null,
      writeAvailable: false,
    });
  }
});

/** GET /api/references/zotero/collections — list Zotero collections */
router.get('/zotero/collections', async (req, res) => {
  try {
    const { client, mode } = await getZoteroClient();
    if (!client) {
      return res.status(503).json({ error: 'Zotero not available' });
    }
    const libraries = await client.getLibraries();
    const collections = await client.getCollections(libraries[0]?.id);
    res.json({ collections, mode });
  } catch (error) {
    console.error('Error fetching Zotero collections:', error);
    res.status(500).json({ error: 'Failed to fetch Zotero collections' });
  }
});

/** GET /api/references/zotero/items — browse Zotero items without importing */
router.get('/zotero/items', async (req, res) => {
  try {
    const { client } = await getZoteroClient();
    if (!client) {
      return res.status(503).json({ error: 'Zotero not available' });
    }
    const { collectionKey, limit, start } = req.query;
    if (collectionKey && !/^[A-Za-z0-9]+$/.test(collectionKey)) {
      return res.status(400).json({ error: 'Invalid collectionKey format' });
    }
    const libraries = await client.getLibraries();
    const libraryId = libraries[0]?.id;
    const items = await client.getItems(libraryId, {
      collectionKey: collectionKey || undefined,
      limit: parseInt(limit) || 100,
      start: parseInt(start) || 0,
    });
    // Strip rawData before sending to client
    const mapped = items.map(({ rawData, ...rest }) => rest);
    res.json({ items: mapped });
  } catch (error) {
    console.error('Error browsing Zotero items:', error);
    res.status(500).json({ error: 'Failed to browse Zotero items' });
  }
});

/** POST /api/references/sync/zotero — sync from Zotero */
router.post('/sync/zotero', async (req, res) => {
  try {
    const { client, mode, localApiDisabled, endpoint, detail } = await getZoteroClient();
    if (!client) {
      const error = localApiDisabled
        ? `Zotero is running${endpoint ? ` at ${endpoint}` : ''}, but the local API is disabled. Enable it in Zotero → Settings → Advanced → Allow other applications to communicate with Zotero.`
        : `Zotero desktop is not reachable${endpoint ? ` at ${endpoint}` : ''}. Start the Zotero app and try again.${detail ? ` (${detail})` : ''}`;
      return res.status(503).json({ error });
    }

    const { collectionKey, projectName, sourceIds } = req.body || {};
    let projectPath = null;
    if (projectName) {
      try {
        projectPath = await resolveProjectAbsolutePath(projectName);
      } catch (error) {
        const formatted = formatProjectPathError(projectName, error);
        return res.status(formatted.status).json(formatted.payload);
      }
    }
    if (collectionKey && !/^[A-Za-z0-9]+$/.test(collectionKey)) {
      return res.status(400).json({ error: 'Invalid collectionKey format' });
    }
    const metaProject = projectName
      ? metaAnalysisDb.getMetaProjectByProjectId(req.user.id, projectName)
      : null;
    const isMetaImport = Boolean(projectName && (metaProject || isMetaProjectDirectory(projectPath)));
    if (
      isMetaImport
      && !collectionKey
      && (!Array.isArray(sourceIds) || sourceIds.length === 0)
    ) {
      return res.status(400).json({
        error: 'Meta projects require choosing a Zotero collection or selected items before importing full text.',
      });
    }
    const libraries = await client.getLibraries();
    const libraryId = libraries[0]?.id;

    // Fetch all items (paginated)
    let allItems = [];
    let start = 0;
    const pageSize = 100;
    while (true) {
      const batch = await client.getItems(libraryId, { collectionKey, limit: pageSize, start });
      allItems.push(...batch);
      if (batch.length < pageSize) break;
      start += pageSize;
    }

    // Filter by sourceIds if provided (selective import)
    if (sourceIds?.length > 0) {
      const allowed = new Set(sourceIds);
      allItems = allItems.filter(item => allowed.has(item.sourceId));
    }

    const ids = referencesDb.syncFromZotero(req.user.id, allItems);
    let linked = 0;
    let artifactSync = null;
    if (projectName && ids.length > 0) {
      linked = referencesDb.bulkLinkIds(projectName, ids);
      try {
        const syncedReferences = referencesDb.getReferencesByIds(req.user.id, ids);
        if (isMetaImport) {
          artifactSync = await syncReferencesToMetaFullTextArtifacts({
            userId: req.user.id,
            metaProject,
            projectPath,
            references: syncedReferences,
            resolvePdfSource: createProjectPdfResolver(req.user.id),
          });
        } else {
          artifactSync = await syncReferencesToProjectArtifacts({
            projectPath,
            projectName,
            references: syncedReferences,
            resolvePdfSource: createProjectPdfResolver(req.user.id),
          });
        }
      } catch (error) {
        await removeReferenceArtifactsFromProject({
          projectPath,
          projectName,
          referenceIds: ids,
        }).catch(() => {});
        referencesDb.bulkUnlinkIds(projectName, ids);
        throw new Error(`Project artifact sync failed: ${error.message}`);
      }
    }
    res.json({
      success: true,
      synced: ids.length,
      linked,
      mode,
      total: allItems.length,
      ids,
      artifactMode: artifactSync?.artifactMode || (projectName ? 'literature_references' : null),
      artifactSync,
    });
  } catch (error) {
    console.error('Error syncing Zotero:', error);
    const msg = error.message || 'Unknown error';
    if (msg.includes('ECONNREFUSED')) {
      return res.status(503).json({ error: 'Cannot connect to Zotero desktop. Is it running?' });
    }
    if (error.name === 'AbortError' || msg.includes('timeout')) {
      return res.status(504).json({ error: 'Zotero connection timed out.' });
    }
    if (msg.includes('Zotero API')) {
      return res.status(502).json({ error: msg });
    }
    res.status(500).json({ error: `Sync failed: ${msg}` });
  }
});

/** POST /api/references/import/bibtex — import BibTeX file */
router.post('/import/bibtex', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    const content = req.file.buffer.toString('utf-8');
    const entries = parseBibtex(content);
    if (entries.length === 0) {
      return res.status(400).json({ error: 'No valid BibTeX entries found' });
    }
    const projectName = req.body?.projectName;
    let projectPath = null;
    if (projectName) {
      try {
        projectPath = await resolveProjectAbsolutePath(projectName);
      } catch (error) {
        const formatted = formatProjectPathError(projectName, error);
        return res.status(formatted.status).json(formatted.payload);
      }
    }
    const ids = referencesDb.importReferences(req.user.id, entries, 'bibtex');
    let linked = 0;
    if (projectName && ids.length > 0) {
      linked = referencesDb.bulkLinkIds(projectName, ids);
      try {
        const importedReferences = referencesDb.getReferencesByIds(req.user.id, ids);
        const metaProject = metaAnalysisDb.getMetaProjectByProjectId(req.user.id, projectName);
        const isMetaImport = Boolean(metaProject || isMetaProjectDirectory(projectPath));
        if (isMetaImport) {
          await syncReferencesToMetaFullTextArtifacts({
            userId: req.user.id,
            metaProject,
            projectPath,
            references: importedReferences,
          });
        } else {
          await syncReferencesToProjectArtifacts({
            projectPath,
            projectName,
            references: importedReferences,
          });
        }
      } catch (error) {
        await removeReferenceArtifactsFromProject({
          projectPath,
          projectName,
          referenceIds: ids,
        }).catch(() => {});
        referencesDb.bulkUnlinkIds(projectName, ids);
        throw new Error(`Project artifact sync failed: ${error.message}`);
      }
    }
    res.json({ success: true, imported: ids.length, linked, total: entries.length, ids });
  } catch (error) {
    console.error('Error importing BibTeX:', error);
    const msg = error.message || 'Unknown error';
    res.status(500).json({ error: `Import failed: ${msg}` });
  }
});

/** POST /api/references/import/pubmed — add one PubMed result to the global library */
router.post('/import/pubmed', async (req, res) => {
  try {
    const item = req.body?.item || {};
    const folderId = typeof req.body?.folderId === 'string' && req.body.folderId.trim()
      ? req.body.folderId.trim()
      : null;
    if (folderId && !referencesDb.getFolder(req.user.id, folderId)) {
      return res.status(404).json({ error: 'Selected literature folder was not found' });
    }
    const title = String(item.title || '').trim();
    const rawPmid = String(item.id || item.pmid || '').trim();
    const pmid = rawPmid.match(/\b\d{5,10}\b/)?.[0] || rawPmid;
    if (!title) {
      return res.status(400).json({ error: 'PubMed title is required' });
    }

    const rawAuthors = Array.isArray(item.authors)
      ? item.authors
      : String(item.authors || '').split(/,|;|\band\b/i);
    const authors = rawAuthors
      .map((author) => {
        if (author && typeof author === 'object') {
          return {
            family: String(author.family || author.name || '').trim(),
            given: String(author.given || '').trim(),
          };
        }
        return { family: String(author || '').trim(), given: '' };
      })
      .filter((author) => author.family || author.given);
    const publishedYear = String(item.published || '').match(/\b(19|20)\d{2}\b/)?.[0];
    const keywords = Array.isArray(item.matched_keywords)
      ? item.matched_keywords.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const ids = referencesDb.importReferences(req.user.id, [{
      title,
      authors,
      year: publishedYear ? Number(publishedYear) : null,
      abstract: String(item.abstract || '').trim() || null,
      doi: String(item.doi || '').trim() || null,
      url: String(item.link || (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '')).trim() || null,
      journal: String(item.journal || '').trim() || null,
      itemType: 'journalArticle',
      keywords,
      citationKey: pmid ? `PMID${pmid}` : null,
      rawData: item,
    }], 'pubmed');

    const foldered = folderId && ids.length > 0
      ? referencesDb.addReferencesToFolder(req.user.id, folderId, ids)
      : 0;

    res.status(201).json({ success: true, imported: ids.length, foldered, folderId, ids });
  } catch (error) {
    console.error('Error importing PubMed reference:', error);
    res.status(500).json({ error: error.message || 'Failed to import PubMed reference' });
  }
});

// ---------------------------------------------------------------------------
// Project ↔ Reference linking (multi-segment — must come before /:id)
// ---------------------------------------------------------------------------

/** GET /api/references/project/:projectName — references linked to a project */
router.get('/project/:projectName', async (req, res) => {
  try {
    const refs = referencesDb.getProjectReferences(req.params.projectName, req.user.id);
    res.json({ references: refs });
  } catch (error) {
    console.error('Error fetching project references:', error);
    res.status(500).json({ error: 'Failed to fetch project references' });
  }
});

/** GET /api/references/project/:projectName/aggregate — linked references + local project artifacts */
router.get('/project/:projectName/aggregate', async (req, res) => {
  try {
    let projectPath;
    try {
      projectPath = await resolveProjectAbsolutePath(req.params.projectName);
    } catch (error) {
      const formatted = formatProjectPathError(req.params.projectName, error);
      return res.status(formatted.status).json(formatted.payload);
    }

    const linkedReferences = referencesDb.getProjectReferences(req.params.projectName, req.user.id);
    const aggregated = await buildAggregatedProjectReferences({
      projectPath,
      linkedReferences,
    });

    res.json(aggregated);
  } catch (error) {
    console.error('Error fetching aggregated project references:', error);
    res.status(500).json({ error: 'Failed to fetch aggregated project references' });
  }
});

/** POST /api/references/project/:projectName/:id — link reference to project */
router.post('/project/:projectName/:id', async (req, res) => {
  try {
    let projectPath;
    try {
      projectPath = await resolveProjectAbsolutePath(req.params.projectName);
    } catch (error) {
      const formatted = formatProjectPathError(req.params.projectName, error);
      return res.status(formatted.status).json(formatted.payload);
    }

    const linked = referencesDb.linkToProject(req.params.projectName, req.params.id, req.user.id);
    if (!linked) {
      return res.status(404).json({ error: 'Reference not found' });
    }

    try {
      const reference = referencesDb.getReference(req.params.id, req.user.id);
      if (!reference) {
        referencesDb.unlinkFromProject(req.params.projectName, req.params.id, req.user.id);
        return res.status(404).json({ error: 'Reference not found' });
      }
      const metaProject = metaAnalysisDb.getMetaProjectByProjectId(req.user.id, req.params.projectName);
      const isMetaImport = Boolean(metaProject || isMetaProjectDirectory(projectPath));
      if (isMetaImport) {
        await syncReferencesToMetaFullTextArtifacts({
          userId: req.user.id,
          metaProject,
          projectPath,
          references: [reference],
          resolvePdfSource: createProjectPdfResolver(req.user.id),
        });
      } else {
        await syncReferencesToProjectArtifacts({
          projectPath,
          projectName: req.params.projectName,
          references: [reference],
          resolvePdfSource: createProjectPdfResolver(req.user.id),
        });
      }
    } catch (error) {
      await removeReferenceArtifactsFromProject({
        projectPath,
        projectName: req.params.projectName,
        referenceIds: [req.params.id],
      }).catch(() => {});
      referencesDb.unlinkFromProject(req.params.projectName, req.params.id, req.user.id);
      return res.status(500).json({ error: `Failed to sync project artifact: ${error.message}` });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error linking reference:', error);
    res.status(500).json({ error: 'Failed to link reference to project' });
  }
});

/** DELETE /api/references/project/:projectName/:id — unlink reference from project */
router.delete('/project/:projectName/:id', async (req, res) => {
  try {
    const removed = referencesDb.unlinkFromProject(req.params.projectName, req.params.id, req.user.id);
    if (!removed) {
      return res.status(404).json({ error: 'Link not found' });
    }
    void cleanupProjectArtifactsFromLinks([{ project_id: req.params.projectName, reference_id: req.params.id }]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error unlinking reference:', error);
    res.status(500).json({ error: 'Failed to unlink reference from project' });
  }
});

// ---------------------------------------------------------------------------
// Single-item routes (parameterized — must come LAST)
// ---------------------------------------------------------------------------

/** POST /api/references/bulk-delete — delete multiple references */
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    if (ids.length > 500) {
      return res.status(400).json({ error: 'Cannot delete more than 500 references at once' });
    }
    const links = referencesDb.getReferenceProjectLinks(req.user.id, ids);
    const deleted = referencesDb.bulkDeleteReferences(req.user.id, ids);
    void cleanupProjectArtifactsFromLinks(links);
    res.json({ success: true, deleted });
  } catch (error) {
    console.error('Error bulk-deleting references:', error);
    res.status(500).json({ error: 'Failed to delete references' });
  }
});

/** GET /api/references/:id/pdf — serve cached or fetch PDF */
router.get('/:id/pdf', async (req, res) => {
  try {
    ensurePdfCacheDir();
    const ref = referencesDb.getReference(req.params.id, req.user.id);
    if (!ref) {
      return res.status(404).json({ error: 'Reference not found' });
    }

    // Sanitize ID for filesystem path and verify no traversal
    const pdfPath = getCachedPdfPath(ref.id);
    const resolvedPath = path.resolve(pdfPath);
    const pdfCacheDir = getPdfCacheDir();
    if (!resolvedPath.startsWith(path.resolve(pdfCacheDir))) {
      return res.status(400).json({ error: 'Invalid reference ID' });
    }

    // Serve from cache if available
    if (fs.existsSync(pdfPath)) {
      referencesDb.setPdfCached(ref.id, true);
      syncReferenceArtifactsToLinkedProjects(ref, req.user.id, pdfPath);
      res.setHeader('Content-Type', 'application/pdf');
      return fs.createReadStream(pdfPath).pipe(res);
    }

    // Try to fetch from Zotero
    if (ref.source === 'zotero' && ref.source_id) {
      const { client } = await getZoteroClient();
      if (client) {
        const libraries = await client.getLibraries();
        const pdfBuffer = await client.getItemPdf(libraries[0]?.id, ref.source_id);
        if (pdfBuffer) {
          fs.writeFileSync(pdfPath, pdfBuffer);
          referencesDb.setPdfCached(ref.id, true);
          syncReferenceArtifactsToLinkedProjects(ref, req.user.id, pdfPath);
          res.setHeader('Content-Type', 'application/pdf');
          return res.send(pdfBuffer);
        }
      }
    }

    res.status(404).json({ error: 'PDF not available' });
  } catch (error) {
    console.error('Error fetching PDF:', error);
    res.status(500).json({ error: 'Failed to fetch PDF' });
  }
});

/** GET /api/references/:id — single reference detail */
router.get('/:id', async (req, res) => {
  try {
    const ref = referencesDb.getReference(req.params.id, req.user.id);
    if (!ref) {
      return res.status(404).json({ error: 'Reference not found' });
    }
    res.json({ reference: ref });
  } catch (error) {
    console.error('Error fetching reference:', error);
    res.status(500).json({ error: 'Failed to fetch reference' });
  }
});

/** DELETE /api/references/:id — delete a reference */
router.delete('/:id', async (req, res) => {
  try {
    const links = referencesDb.getReferenceProjectLinks(req.user.id, [req.params.id]);
    const deleted = referencesDb.deleteReference(req.user.id, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Reference not found' });
    }
    void cleanupProjectArtifactsFromLinks(links);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting reference:', error);
    res.status(500).json({ error: 'Failed to delete reference' });
  }
});

export default router;
