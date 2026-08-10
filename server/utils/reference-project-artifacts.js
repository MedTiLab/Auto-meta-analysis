import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { promises as fsPromises } from 'fs';

import { writeKnowledgeBaseManifest } from './project-knowledge-base.js';
import {
  getMetaFolderSchemaVersion,
  getMetaReferencePaths,
  META_NUMBERED_FOLDER_SCHEMA_VERSION,
} from './meta-analysis-artifacts.js';

const LEGACY_REFERENCE_ARTIFACTS_RELATIVE_DIR = 'Literature/references';
const META_REFERENCE_ARTIFACTS_RELATIVE_DIR = '04_full_text_review/fulltext';
const REFERENCE_ARTIFACT_METADATA_FILENAME = 'metadata.json';
const REFERENCE_ARTIFACT_NOTE_FILENAME = 'note.md';
const REFERENCE_ARTIFACT_EXTRACT_FILENAME = 'extract.txt';
const REFERENCE_ARTIFACT_PDF_FILENAME = 'paper.pdf';

function collapseWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatAuthors(authors = []) {
  if (!Array.isArray(authors) || authors.length === 0) {
    return '';
  }
  return authors
    .map((author) => {
      if (!author || typeof author !== 'object') {
        return '';
      }
      const family = collapseWhitespace(author.family);
      const given = collapseWhitespace(author.given);
      if (family && given) {
        return `${family}, ${given}`;
      }
      return family || given;
    })
    .filter(Boolean)
    .join('; ');
}

function buildFallbackExtractText(reference) {
  const lines = [
    `Title: ${collapseWhitespace(reference?.title || 'Untitled')}`,
  ];

  const authors = formatAuthors(reference?.authors);
  if (authors) {
    lines.push(`Authors: ${authors}`);
  }
  if (reference?.year) {
    lines.push(`Year: ${reference.year}`);
  }
  if (reference?.journal) {
    lines.push(`Journal: ${collapseWhitespace(reference.journal)}`);
  }
  if (reference?.item_type) {
    lines.push(`Item Type: ${collapseWhitespace(reference.item_type)}`);
  }
  if (reference?.source) {
    lines.push(`Source: ${collapseWhitespace(reference.source)}`);
  }
  if (reference?.citation_key) {
    lines.push(`Citation Key: ${collapseWhitespace(reference.citation_key)}`);
  }
  if (reference?.doi) {
    lines.push(`DOI: ${collapseWhitespace(reference.doi)}`);
  }
  if (reference?.url) {
    lines.push(`URL: ${collapseWhitespace(reference.url)}`);
  }
  if (Array.isArray(reference?.keywords) && reference.keywords.length > 0) {
    lines.push(`Keywords: ${reference.keywords.map((keyword) => collapseWhitespace(keyword)).filter(Boolean).join(', ')}`);
  }

  if (reference?.abstract) {
    lines.push('', 'Abstract:', collapseWhitespace(reference.abstract));
  }

  return `${lines.join('\n')}\n`;
}

function buildReferenceNoteMarkdown(reference, artifactPaths, options = {}) {
  const authors = formatAuthors(reference?.authors);
  const lines = [`# ${collapseWhitespace(reference?.title || 'Untitled Reference')}`, ''];

  lines.push(`- Reference ID: ${reference.id}`);
  lines.push(`- Artifact directory: ${artifactPaths.relativeArtifactDir}`);

  if (authors) {
    lines.push(`- Authors: ${authors}`);
  }
  if (reference?.year) {
    lines.push(`- Year: ${reference.year}`);
  }
  if (reference?.journal) {
    lines.push(`- Journal: ${collapseWhitespace(reference.journal)}`);
  }
  if (reference?.item_type) {
    lines.push(`- Item type: ${collapseWhitespace(reference.item_type)}`);
  }
  if (reference?.source) {
    lines.push(`- Source: ${collapseWhitespace(reference.source)}`);
  }
  if (reference?.source_id) {
    lines.push(`- Source ID: ${collapseWhitespace(reference.source_id)}`);
  }
  if (reference?.citation_key) {
    lines.push(`- Citation key: ${collapseWhitespace(reference.citation_key)}`);
  }
  if (reference?.doi) {
    lines.push(`- DOI: ${collapseWhitespace(reference.doi)}`);
  }
  if (reference?.url) {
    lines.push(`- URL: ${collapseWhitespace(reference.url)}`);
  }
  if (Array.isArray(reference?.keywords) && reference.keywords.length > 0) {
    lines.push(`- Keywords: ${reference.keywords.map((keyword) => collapseWhitespace(keyword)).filter(Boolean).join(', ')}`);
  }

  const availableFiles = [
    REFERENCE_ARTIFACT_METADATA_FILENAME,
    REFERENCE_ARTIFACT_NOTE_FILENAME,
    REFERENCE_ARTIFACT_EXTRACT_FILENAME,
  ];
  if (options.hasPdf) {
    availableFiles.push(REFERENCE_ARTIFACT_PDF_FILENAME);
  }
  lines.push(`- Files: ${availableFiles.join(', ')}`);

  if (reference?.abstract) {
    lines.push('', '## Abstract', '', String(reference.abstract).trim());
  }

  lines.push('', '## Notes', '', 'Canonical project artifact for this reference. Reuse this folder for project notes, comparisons, and downstream writing support.');

  return `${lines.join('\n').trim()}\n`;
}

function sanitizeReferenceArtifactDir(referenceId) {
  const normalized = String(referenceId || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 96);
  const digest = crypto.createHash('sha1').update(String(referenceId || 'reference')).digest('hex').slice(0, 10);
  return `${normalized || 'reference'}-${digest}`;
}

export function getReferenceArtifactPaths(projectPath, referenceId) {
  const dirName = sanitizeReferenceArtifactDir(referenceId);
  const rootRelativeDir = getMetaFolderSchemaVersion(projectPath) === META_NUMBERED_FOLDER_SCHEMA_VERSION
    ? META_REFERENCE_ARTIFACTS_RELATIVE_DIR
    : LEGACY_REFERENCE_ARTIFACTS_RELATIVE_DIR;
  const relativeArtifactDir = path.join(rootRelativeDir, dirName).split(path.sep).join('/');
  const artifactDir = path.join(projectPath, relativeArtifactDir);
  return {
    dirName,
    relativeArtifactDir,
    artifactDir,
    metadataPath: path.join(artifactDir, REFERENCE_ARTIFACT_METADATA_FILENAME),
    notePath: path.join(artifactDir, REFERENCE_ARTIFACT_NOTE_FILENAME),
    extractPath: path.join(artifactDir, REFERENCE_ARTIFACT_EXTRACT_FILENAME),
    pdfPath: path.join(artifactDir, REFERENCE_ARTIFACT_PDF_FILENAME),
  };
}

function tryExtractPdfText(pdfPath, extractPath) {
  try {
    const result = spawnSync('pdftotext', ['-q', '-enc', 'UTF-8', pdfPath, extractPath], {
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function syncReferenceArtifactToProject({
  projectPath,
  projectName,
  reference,
  pdfSourcePath = null,
  pdfBuffer = null,
}) {
  if (!reference?.id) {
    throw new Error('Reference id is required for artifact sync');
  }

  const artifactPaths = getReferenceArtifactPaths(projectPath, reference.id);
  await fsPromises.mkdir(artifactPaths.artifactDir, { recursive: true });

  let hasPdf = false;
  if (pdfBuffer && Buffer.isBuffer(pdfBuffer)) {
    await fsPromises.writeFile(artifactPaths.pdfPath, pdfBuffer);
    hasPdf = true;
  } else if (pdfSourcePath && fs.existsSync(pdfSourcePath)) {
    await fsPromises.copyFile(pdfSourcePath, artifactPaths.pdfPath);
    hasPdf = true;
  } else {
    hasPdf = await pathExists(artifactPaths.pdfPath);
  }

  let extractSource = 'fallback';
  let extractReady = false;
  if (hasPdf && tryExtractPdfText(artifactPaths.pdfPath, artifactPaths.extractPath)) {
    extractSource = 'pdf';
    extractReady = true;
  }

  if (!extractReady) {
    const fallbackExtract = buildFallbackExtractText(reference);
    await fsPromises.writeFile(artifactPaths.extractPath, fallbackExtract, 'utf8');
  }

  const metadata = {
    schemaVersion: '1.0',
    referenceId: reference.id,
    title: reference.title || 'Untitled',
    authors: Array.isArray(reference.authors) ? reference.authors : [],
    year: reference.year ?? null,
    abstract: reference.abstract ?? null,
    doi: reference.doi ?? null,
    url: reference.url ?? null,
    journal: reference.journal ?? null,
    item_type: reference.item_type || 'article',
    source: reference.source || '',
    source_id: reference.source_id ?? null,
    keywords: Array.isArray(reference.keywords) ? reference.keywords : [],
    citation_key: reference.citation_key ?? null,
    projectName,
    artifactDir: artifactPaths.relativeArtifactDir,
    files: {
      metadata: REFERENCE_ARTIFACT_METADATA_FILENAME,
      note: REFERENCE_ARTIFACT_NOTE_FILENAME,
      extract: REFERENCE_ARTIFACT_EXTRACT_FILENAME,
      pdf: hasPdf ? REFERENCE_ARTIFACT_PDF_FILENAME : null,
    },
    extractSource,
    syncedAt: new Date().toISOString(),
  };

  const noteMarkdown = buildReferenceNoteMarkdown(reference, artifactPaths, { hasPdf });

  await Promise.all([
    fsPromises.writeFile(artifactPaths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
    fsPromises.writeFile(artifactPaths.notePath, noteMarkdown, 'utf8'),
  ]);

  return {
    ...artifactPaths,
    hasPdf,
    extractSource,
  };
}

export async function syncReferencesToProjectArtifacts({
  projectPath,
  projectName,
  references,
  resolvePdfSource,
}) {
  const artifacts = [];

  for (const reference of references || []) {
    let resolvedPdfSource = {};
    if (typeof resolvePdfSource === 'function') {
      try {
        resolvedPdfSource = await resolvePdfSource(reference) || {};
      } catch (error) {
        console.warn(`[References] Failed to resolve PDF source for ${reference?.id}:`, error.message);
      }
    }

    const artifact = await syncReferenceArtifactToProject({
      projectPath,
      projectName,
      reference,
      pdfSourcePath: resolvedPdfSource.pdfSourcePath || null,
      pdfBuffer: resolvedPdfSource.pdfBuffer || null,
    });
    artifacts.push(artifact);
  }

  const { manifest, kbPaths } = await writeKnowledgeBaseManifest(projectPath, projectName);
  return {
    artifacts,
    manifest,
    kbPaths,
  };
}

export async function removeReferenceArtifactsFromProject({
  projectPath,
  projectName,
  referenceIds,
}) {
  const removed = [];
  const seenDirs = new Set();
  const isMetaProject = getMetaFolderSchemaVersion(projectPath) === META_NUMBERED_FOLDER_SCHEMA_VERSION;

  for (const referenceId of referenceIds || []) {
    const removalTargets = [getReferenceArtifactPaths(projectPath, referenceId)];
    if (isMetaProject) {
      const metaPaths = getMetaReferencePaths(projectPath, referenceId, {
        folderSchemaVersion: META_NUMBERED_FOLDER_SCHEMA_VERSION,
      });
      removalTargets.push({
        artifactDir: metaPaths.referenceDir,
        relativeArtifactDir: metaPaths.relativeReferenceDir,
      });
    }

    for (const artifactPaths of removalTargets) {
      if (seenDirs.has(artifactPaths.artifactDir)) {
        continue;
      }
      seenDirs.add(artifactPaths.artifactDir);
      await fsPromises.rm(artifactPaths.artifactDir, { recursive: true, force: true });
      removed.push(artifactPaths.relativeArtifactDir);
    }
  }

  const { manifest, kbPaths } = await writeKnowledgeBaseManifest(projectPath, projectName);
  return {
    removed,
    manifest,
    kbPaths,
  };
}
