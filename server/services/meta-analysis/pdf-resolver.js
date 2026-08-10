import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';

import { metaAnalysisDb, referencesDb } from '../../database/db.js';
import { resolveReferencesPdfCacheDir } from '../../utils/storagePaths.js';
import { getZoteroClient } from '../../utils/zotero-client.js';
import {
  META_NUMBERED_FOLDER_SCHEMA_VERSION,
  getMetaReferencePaths,
  normalizeMetaFolderSchemaVersion,
  toProjectRelativePath,
} from '../../utils/meta-analysis-artifacts.js';
import { markPdfAuditPending } from './workflow-gates.js';
import { downloadFromPmc, downloadHtmlFromPmc } from './downloaders/pmc.js';
import { downloadFromEuropePmc, downloadHtmlFromEuropePmc } from './downloaders/europe-pmc.js';
import { downloadFromUnpaywall } from './downloaders/unpaywall.js';

const FULL_TEXT_ASSET_EXTENSIONS = {
  pdf: 'pdf',
  html: 'html',
  markdown: 'md',
  text: 'txt',
};

function safeReferenceCacheId(referenceId) {
  return String(referenceId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function cachedReferencePdfPath(referenceId) {
  return path.join(resolveReferencesPdfCacheDir(), `${safeReferenceCacheId(referenceId)}.pdf`);
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function writeResolvedAsset({
  projectPath,
  reference,
  buffer = null,
  sourcePath = null,
  artifactOptions = {},
  assetType = 'pdf',
  fileExtension = null,
}) {
  const paths = getMetaReferencePaths(projectPath, reference.id, {
    ...artifactOptions,
    referenceTitle: reference.title,
  });
  await fsPromises.mkdir(paths.referenceDir, { recursive: true });
  const normalizedAssetType = String(assetType || 'pdf').toLowerCase();
  const extension = fileExtension || FULL_TEXT_ASSET_EXTENSIONS[normalizedAssetType] || 'bin';
  const targetPath = normalizedAssetType === 'pdf'
    ? paths.pdfPath
    : path.join(paths.referenceDir, `${paths.artifactBasename}.${extension}`);
  if (buffer) {
    await fsPromises.writeFile(targetPath, buffer);
  } else if (sourcePath) {
    await fsPromises.copyFile(sourcePath, targetPath);
  } else {
    throw new Error('No full-text buffer or source path provided');
  }
  return {
    filePath: targetPath,
    relativeFilePath: toProjectRelativePath(projectPath, targetPath),
    sha256: await sha256File(targetPath),
  };
}

function normalizeLicenseStatusForWorkflow(licenseStatus, artifactOptions = {}) {
  if (normalizeMetaFolderSchemaVersion(artifactOptions.folderSchemaVersion) === META_NUMBERED_FOLDER_SCHEMA_VERSION) {
    return markPdfAuditPending(licenseStatus);
  }
  return licenseStatus || null;
}

function normalizeDoi(value) {
  return String(value || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim().toLowerCase();
}

function normalizePmid(value) {
  return String(value || '').replace(/^pubmed[-_:]/i, '').replace(/^pmid[-_:]/i, '').trim();
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function inferReferencePmid(reference) {
  const raw = reference?.raw_data || {};
  const explicit = normalizePmid(raw.pmid || raw.PMID || raw.pubmed_id || raw.pubmedId);
  if (explicit) return explicit;
  if (String(reference?.source || '').toLowerCase() === 'pubmed' && reference?.source_id) {
    return normalizePmid(reference.source_id);
  }
  const citationKey = String(reference?.citation_key || '').trim();
  return /^\d+$/.test(citationKey) ? citationKey : '';
}

function extractPmidFromText(value) {
  const text = String(value || '');
  return text.match(/\bPMID\s*[:=]?\s*(\d{4,})\b/i)?.[1]
    || text.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1]
    || '';
}

function inferZoteroItemPmid(item) {
  return normalizePmid(
    item?.pmid
      || item?.rawData?.data?.PMID
      || extractPmidFromText(item?.extra)
      || extractPmidFromText(item?.url)
      || extractPmidFromText(item?.rawData?.data?.extra)
      || extractPmidFromText(item?.rawData?.data?.url),
  );
}

function inferReferenceDoi(reference) {
  return normalizeDoi(reference?.doi || reference?.raw_data?.doi || reference?.raw_data?.DOI);
}

function inferZoteroItemDoi(item) {
  return normalizeDoi(item?.doi || item?.rawData?.data?.DOI || item?.rawData?.DOI);
}

function yearsCompatible(reference, item) {
  if (!reference?.year || !item?.year) return true;
  return Number(reference.year) === Number(item.year);
}

function uniqueZoteroItems(items = []) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = item?.sourceId || item?.rawData?.key || item?.rawData?.data?.key || normalizeTitle(item?.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

async function searchZoteroItems(client, libraryId, query) {
  const text = String(query || '').trim();
  if (!text) return [];
  try {
    return uniqueZoteroItems(await client.searchItems(libraryId, text));
  } catch {
    return [];
  }
}

async function persistMatchedZoteroPdf(client, libraryId, item, matchReason) {
  const itemKey = item?.sourceId || item?.rawData?.key || item?.rawData?.data?.key;
  if (!itemKey) return null;
  const pdfBuffer = await client.getItemPdf(libraryId, itemKey);
  if (!pdfBuffer) return null;
  return {
    status: 'downloaded',
    source: 'zotero',
    licenseStatus: 'zotero_attachment',
    pdfBuffer,
    url: `zotero://select/library/items/${itemKey}`,
    error: null,
    matchReason,
  };
}

async function resolveMatchedZoteroItems(client, libraryId, items, matchReason) {
  for (const item of items) {
    const resolved = await persistMatchedZoteroPdf(client, libraryId, item, matchReason);
    if (resolved) return resolved;
  }
  if (items.length > 0) {
    return {
      status: 'manual_upload_required',
      source: 'zotero',
      licenseStatus: 'zotero_attachment',
      error: 'Matched Zotero item has no stored PDF attachment',
    };
  }
  return null;
}

async function resolveFromZotero(reference) {
  const { client } = await getZoteroClient();
  if (!client) {
    return { status: 'unavailable', source: 'zotero', error: 'Zotero is not available' };
  }
  const libraries = await client.getLibraries();
  const libraryId = libraries[0]?.id;

  if (String(reference.source || '').toLowerCase() === 'zotero' && reference.source_id) {
    const pdfBuffer = await client.getItemPdf(libraryId, reference.source_id);
    if (!pdfBuffer) {
      return { status: 'manual_upload_required', source: 'zotero', error: 'No Zotero PDF attachment found' };
    }
    return {
      status: 'downloaded',
      source: 'zotero',
      licenseStatus: 'zotero_attachment',
      pdfBuffer,
      url: `zotero://select/library/items/${reference.source_id}`,
    };
  }

  const referenceDoi = inferReferenceDoi(reference);
  if (referenceDoi) {
    const doiMatches = (await searchZoteroItems(client, libraryId, referenceDoi))
      .filter((item) => inferZoteroItemDoi(item) === referenceDoi);
    const resolved = await resolveMatchedZoteroItems(client, libraryId, doiMatches, 'doi');
    if (resolved) return resolved;
  }

  const referencePmid = inferReferencePmid(reference);
  if (referencePmid) {
    const pmidMatches = (await searchZoteroItems(client, libraryId, referencePmid))
      .filter((item) => inferZoteroItemPmid(item) === referencePmid);
    const resolved = await resolveMatchedZoteroItems(client, libraryId, pmidMatches, 'pmid');
    if (resolved) return resolved;
  }

  const referenceTitle = normalizeTitle(reference.title);
  if (referenceTitle) {
    const titleQuery = String(reference.title || '').slice(0, 160);
    const titleMatches = (await searchZoteroItems(client, libraryId, titleQuery))
      .filter((item) => normalizeTitle(item.title) === referenceTitle && yearsCompatible(reference, item));
    const resolved = await resolveMatchedZoteroItems(client, libraryId, titleMatches, 'title');
    if (resolved) return resolved;
  }

  return {
    status: 'manual_upload_required',
    source: 'zotero',
    licenseStatus: 'zotero_attachment',
    error: 'No matching Zotero PDF attachment found',
  };
}

async function persistAsset({ userId, metaProject, reference, projectPath, result, artifactOptions = {} }) {
  const assetType = result.assetType || 'pdf';
  const contentType = result.contentType || (assetType === 'pdf' ? 'application/pdf' : null);
  const buffer = result.pdfBuffer || result.assetBuffer;
  if (buffer) {
    const written = await writeResolvedAsset({
      projectPath,
      reference,
      buffer,
      artifactOptions,
      assetType,
      fileExtension: result.fileExtension,
    });
    if (assetType === 'pdf') referencesDb.setPdfCached(reference.id, true);
    return metaAnalysisDb.upsertPdfAsset(userId, {
      metaProjectId: metaProject.id,
      referenceId: reference.id,
      source: result.source,
      status: 'downloaded',
      filePath: written.relativeFilePath,
      sha256: written.sha256,
      licenseStatus: normalizeLicenseStatusForWorkflow(result.licenseStatus, artifactOptions),
      assetType,
      contentType,
      sourceUrl: result.url || null,
      error: null,
    });
  }

  if (result.sourcePath) {
    const written = await writeResolvedAsset({
      projectPath,
      reference,
      sourcePath: result.sourcePath,
      artifactOptions,
      assetType,
      fileExtension: result.fileExtension,
    });
    return metaAnalysisDb.upsertPdfAsset(userId, {
      metaProjectId: metaProject.id,
      referenceId: reference.id,
      source: result.source,
      status: result.status || 'downloaded',
      filePath: written.relativeFilePath,
      sha256: written.sha256,
      licenseStatus: normalizeLicenseStatusForWorkflow(result.licenseStatus, artifactOptions),
      assetType,
      contentType,
      sourceUrl: result.url || null,
      error: null,
    });
  }

  return metaAnalysisDb.upsertPdfAsset(userId, {
    metaProjectId: metaProject.id,
    referenceId: reference.id,
    source: result.source || 'manual',
    status: result.status || 'manual_upload_required',
    filePath: null,
    sha256: null,
    licenseStatus: normalizeLicenseStatusForWorkflow(result.licenseStatus, artifactOptions),
    assetType,
    contentType,
    sourceUrl: result.url || null,
    error: result.error || null,
  });
}

export async function resolvePdfForReference({
  userId,
  metaProject,
  reference,
  projectPath,
  sources = ['cache', 'zotero', 'pmc', 'europe_pmc', 'unpaywall'],
  artifactOptions = {},
}) {
  const enabled = new Set(sources || []);

  try {
    if (enabled.has('cache')) {
      const cachePath = cachedReferencePdfPath(reference.id);
      if (fs.existsSync(cachePath)) {
        return await persistAsset({
          userId,
          metaProject,
          reference,
          projectPath,
          artifactOptions,
          result: {
            status: 'cached',
            source: 'cache',
            sourcePath: cachePath,
            licenseStatus: 'existing_reference_cache',
          },
        });
      }
    }

    const resolvers = [
      ['zotero', resolveFromZotero],
      ['pmc', downloadFromPmc],
      ['europe_pmc', downloadFromEuropePmc],
      ['unpaywall', downloadFromUnpaywall],
    ];

    let lastResult = null;
    for (const [source, resolver] of resolvers) {
      if (!enabled.has(source)) continue;
      try {
        const result = await resolver(reference);
        lastResult = result;
        if (result?.pdfBuffer) {
          return await persistAsset({
            userId,
            metaProject,
            reference,
            projectPath,
            result,
            artifactOptions,
          });
        }
      } catch (error) {
        lastResult = {
          status: 'failed',
          source,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const openFullTextResolvers = [
      ['pmc_html', 'pmc', downloadHtmlFromPmc],
      ['europe_pmc_html', 'europe_pmc', downloadHtmlFromEuropePmc],
    ];
    for (const [source, parentSource, resolver] of openFullTextResolvers) {
      if (!enabled.has(source) && !enabled.has(parentSource)) continue;
      try {
        const result = await resolver(reference);
        lastResult = result;
        if (result?.assetBuffer) {
          return await persistAsset({
            userId,
            metaProject,
            reference,
            projectPath,
            result,
            artifactOptions,
          });
        }
      } catch (error) {
        lastResult = {
          status: 'failed',
          source,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return await persistAsset({
      userId,
      metaProject,
      reference,
      projectPath,
      artifactOptions,
      result: lastResult || {
        status: 'manual_upload_required',
        source: 'manual',
        error: 'No legal full-text source resolved automatically',
      },
    });
  } catch (error) {
    return metaAnalysisDb.upsertPdfAsset(userId, {
      metaProjectId: metaProject.id,
      referenceId: reference.id,
      source: 'resolver',
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
