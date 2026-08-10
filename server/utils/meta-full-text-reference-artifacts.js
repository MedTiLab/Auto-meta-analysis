import crypto from 'crypto';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';

import { metaAnalysisDb } from '../database/db.js';
import {
  getMetaFolderSchemaVersion,
  getMetaReferencePaths,
  getMetaStageDirs,
  toProjectRelativePath,
} from './meta-analysis-artifacts.js';

function csvEscape(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function inferPmid(reference = {}) {
  const raw = reference.raw_data?.pmid ?? reference.raw_data?.PMID ?? reference.pmid ?? '';
  return String(Array.isArray(raw) ? raw[0] : raw).trim();
}

function buildReferenceMetadata(reference, paths, pdfRelativePath = null) {
  return {
    schemaVersion: 'meta-fulltext-reference-v1',
    referenceId: reference.id,
    title: reference.title || 'Untitled',
    authors: Array.isArray(reference.authors) ? reference.authors : [],
    year: reference.year ?? null,
    abstract: reference.abstract ?? null,
    doi: reference.doi ?? null,
    pmid: inferPmid(reference) || null,
    url: reference.url ?? null,
    journal: reference.journal ?? null,
    itemType: reference.item_type || 'article',
    source: reference.source || '',
    sourceId: reference.source_id ?? null,
    keywords: Array.isArray(reference.keywords) ? reference.keywords : [],
    citationKey: reference.citation_key ?? null,
    artifactDir: paths.relativeReferenceDir,
    files: {
      metadata: 'metadata.json',
      pdf: pdfRelativePath ? path.basename(pdfRelativePath) : null,
    },
    syncedAt: new Date().toISOString(),
  };
}

async function copyPdfToMetaFullText({ projectPath, reference, paths, pdfSourcePath, pdfBuffer }) {
  if (pdfBuffer && Buffer.isBuffer(pdfBuffer)) {
    await fsPromises.writeFile(paths.pdfPath, pdfBuffer);
  } else if (pdfSourcePath && fs.existsSync(pdfSourcePath)) {
    await fsPromises.copyFile(pdfSourcePath, paths.pdfPath);
  } else if (!fs.existsSync(paths.pdfPath)) {
    return null;
  }

  return {
    filePath: paths.pdfPath,
    relativePath: toProjectRelativePath(projectPath, paths.pdfPath),
    sha256: await sha256File(paths.pdfPath),
    originalFilename: path.basename(paths.pdfPath),
  };
}

async function writeZoteroReferenceIndex({ projectPath, artifactOptions, rows }) {
  const dirs = getMetaStageDirs(projectPath, artifactOptions);
  const fullTextReviewDir = path.join(projectPath, dirs.fullTextReview || dirs.experimentAnalysis || '04_full_text_review');
  await fsPromises.mkdir(fullTextReviewDir, { recursive: true });

  const headers = [
    'reference_id',
    'title',
    'doi',
    'pmid',
    'zotero_item_key',
    'status',
    'metadata_path',
    'pdf_path',
  ];
  await fsPromises.writeFile(
    path.join(fullTextReviewDir, 'zotero_references.json'),
    `${JSON.stringify({
      schemaVersion: 'meta-zotero-references-v1',
      generatedAt: new Date().toISOString(),
      records: rows,
    }, null, 2)}\n`,
    'utf8',
  );
  await fsPromises.writeFile(
    path.join(fullTextReviewDir, 'zotero_references.csv'),
    `${[headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')}\n`,
    'utf8',
  );
}

export async function syncReferencesToMetaFullTextArtifacts({
  userId,
  metaProject = null,
  projectPath,
  references,
  resolvePdfSource,
}) {
  const artifactOptions = {
    folderSchemaVersion: getMetaFolderSchemaVersion(projectPath),
  };
  const rows = [];

  for (const reference of references || []) {
    if (!reference?.id) continue;

    const paths = getMetaReferencePaths(projectPath, reference.id, {
      ...artifactOptions,
      referenceTitle: reference.title,
    });
    await fsPromises.mkdir(paths.referenceDir, { recursive: true });

    let resolvedPdfSource = {};
    if (typeof resolvePdfSource === 'function') {
      resolvedPdfSource = await resolvePdfSource(reference) || {};
    }

    const writtenPdf = await copyPdfToMetaFullText({
      projectPath,
      reference,
      paths,
      pdfSourcePath: resolvedPdfSource.pdfSourcePath || null,
      pdfBuffer: resolvedPdfSource.pdfBuffer || null,
    });
    const metadata = buildReferenceMetadata(reference, paths, writtenPdf?.relativePath || null);
    await fsPromises.writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

    if (writtenPdf && metaProject?.id) {
      metaAnalysisDb.upsertPdfAsset(userId, {
        metaProjectId: metaProject.id,
        referenceId: reference.id,
        source: 'zotero',
        status: 'downloaded',
        filePath: writtenPdf.relativePath,
        sha256: writtenPdf.sha256,
        licenseStatus: 'zotero_attachment',
        assetType: 'pdf',
        contentType: 'application/pdf',
        originalFilename: writtenPdf.originalFilename,
        sourceUrl: reference.url || null,
        error: null,
      });
    }

    rows.push({
      reference_id: reference.id,
      title: reference.title || '',
      doi: reference.doi || '',
      pmid: inferPmid(reference),
      zotero_item_key: reference.source_id || '',
      status: writtenPdf ? 'downloaded' : 'metadata_only',
      metadata_path: toProjectRelativePath(projectPath, paths.metadataPath),
      pdf_path: writtenPdf?.relativePath || '',
    });
  }

  await writeZoteroReferenceIndex({ projectPath, artifactOptions, rows });

  return {
    artifactMode: 'meta_full_text_review',
    total: rows.length,
    downloaded: rows.filter((row) => row.status === 'downloaded').length,
    metadataOnly: rows.filter((row) => row.status === 'metadata_only').length,
    rows,
  };
}
