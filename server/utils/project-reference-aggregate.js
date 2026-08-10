import path from 'path';
import { promises as fsPromises } from 'fs';

import {
  META_NUMBERED_FOLDER_SCHEMA_VERSION,
  getMetaFolderSchemaVersion,
} from './meta-analysis-artifacts.js';

const PROJECT_REFERENCE_ROOTS = [
  'Literature/references',
  'literature/references',
  'Survey/references',
  'Research/references',
  'Ideation/references',
];

const META_PROJECT_REFERENCE_ROOTS = [
  '04_full_text_review/fulltext',
];

const REFERENCE_ARTIFACT_METADATA_FILENAME = 'metadata.json';
const REFERENCE_ARTIFACT_EXTRACT_FILENAME = 'extract.txt';
const REFERENCE_ARTIFACT_NOTE_FILENAME = 'note.md';
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_SUMMARY_CHARS = 500;
const SUPPORTED_LOOSE_REFERENCE_EXTENSIONS = new Set([
  '.pdf',
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.jsonl',
  '.bib',
  '.tex',
  '.html',
  '.htm',
]);

function collapseWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeAuthors(authors = []) {
  if (!Array.isArray(authors)) {
    return [];
  }

  return authors
    .map((author) => {
      if (!author || typeof author !== 'object') {
        return null;
      }

      const family = collapseWhitespace(author.family);
      const given = collapseWhitespace(author.given);
      if (!family && !given) {
        return null;
      }

      return {
        family,
        given,
      };
    })
    .filter(Boolean);
}

function normalizeKeywords(keywords = []) {
  if (!Array.isArray(keywords)) {
    return [];
  }
  return keywords.map((keyword) => collapseWhitespace(keyword)).filter(Boolean);
}

function humanizeStem(fileName = '') {
  return String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readTextPreview(fullPath) {
  try {
    const stats = await fsPromises.stat(fullPath);
    if (stats.size > MAX_TEXT_FILE_BYTES) {
      return '';
    }

    const content = await fsPromises.readFile(fullPath, 'utf8');
    return collapseWhitespace(content).slice(0, MAX_SUMMARY_CHARS);
  } catch {
    return '';
  }
}

async function readJson(fullPath) {
  try {
    const content = await fsPromises.readFile(fullPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function toRelative(projectPath, fullPath) {
  return path.relative(projectPath, fullPath).split(path.sep).join('/');
}

function buildReferenceRecord(reference = {}) {
  return {
    id: reference.id || '',
    user_id: Number.isFinite(reference.user_id) ? reference.user_id : 0,
    title: collapseWhitespace(reference.title || '') || 'Untitled Reference',
    authors: normalizeAuthors(reference.authors),
    year: Number.isFinite(reference.year) ? reference.year : null,
    abstract: collapseWhitespace(reference.abstract || '') || null,
    doi: collapseWhitespace(reference.doi || '') || null,
    url: collapseWhitespace(reference.url || '') || null,
    journal: collapseWhitespace(reference.journal || '') || null,
    item_type: collapseWhitespace(reference.item_type || '') || 'article',
    source: collapseWhitespace(reference.source || '') || 'project_local',
    source_id: collapseWhitespace(reference.source_id || '') || null,
    keywords: normalizeKeywords(reference.keywords),
    citation_key: collapseWhitespace(reference.citation_key || '') || null,
    pdf_cached: Number(reference.pdf_cached) > 0 ? 1 : 0,
    created_at: reference.created_at || new Date(0).toISOString(),
    updated_at: reference.updated_at || new Date(0).toISOString(),
    linked_at: reference.linked_at || null,
    project_linked: Boolean(reference.project_linked),
    has_local_artifact: Boolean(reference.has_local_artifact),
    local_artifact_dir: reference.local_artifact_dir || null,
    local_relative_path: reference.local_relative_path || null,
    local_pdf_path: reference.local_pdf_path || null,
    local_files: Array.isArray(reference.local_files) ? reference.local_files : [],
    origin: reference.origin || 'project_local',
    artifact_source: reference.artifact_source || null,
  };
}

async function buildArtifactReference(projectPath, artifactDir, stats) {
  const metadataPath = path.join(artifactDir, REFERENCE_ARTIFACT_METADATA_FILENAME);
  const extractPath = path.join(artifactDir, REFERENCE_ARTIFACT_EXTRACT_FILENAME);
  const notePath = path.join(artifactDir, REFERENCE_ARTIFACT_NOTE_FILENAME);
  const metadata = await readJson(metadataPath);

  const children = await fsPromises.readdir(artifactDir, { withFileTypes: true });
  const files = children
    .filter((child) => child.isFile() && !child.name.startsWith('.'))
    .map((child) => child.name)
    .sort();

  const pdfFile = files.find((fileName) => path.extname(fileName).toLowerCase() === '.pdf') || null;
  const summary = collapseWhitespace(metadata?.abstract || '')
    || await readTextPreview(extractPath)
    || await readTextPreview(notePath);

  return buildReferenceRecord({
    id: collapseWhitespace(metadata?.referenceId || metadata?.id || '') || `local:${toRelative(projectPath, artifactDir)}`,
    title: metadata?.title || humanizeStem(path.basename(artifactDir)),
    authors: metadata?.authors,
    year: metadata?.year,
    abstract: summary,
    doi: metadata?.doi,
    url: metadata?.url,
    journal: metadata?.journal,
    item_type: metadata?.item_type || metadata?.itemType || 'projectArtifact',
    source: metadata?.source || 'project_local',
    source_id: metadata?.source_id,
    keywords: metadata?.keywords,
    citation_key: metadata?.citation_key,
    pdf_cached: pdfFile ? 1 : 0,
    created_at: stats.mtime.toISOString(),
    updated_at: stats.mtime.toISOString(),
    project_linked: false,
    has_local_artifact: true,
    local_artifact_dir: toRelative(projectPath, artifactDir),
    local_relative_path: toRelative(projectPath, artifactDir),
    local_pdf_path: pdfFile ? toRelative(projectPath, path.join(artifactDir, pdfFile)) : null,
    local_files: files.map((fileName) => toRelative(projectPath, path.join(artifactDir, fileName))),
    origin: 'project_local',
    artifact_source: 'metadata',
  });
}

async function buildLooseFileReference(projectPath, fullPath, stats) {
  const relativePath = toRelative(projectPath, fullPath);
  const extension = path.extname(fullPath).toLowerCase();
  const preview = extension === '.pdf' ? '' : await readTextPreview(fullPath);

  return buildReferenceRecord({
    id: `project-file:${relativePath}`,
    title: humanizeStem(path.basename(fullPath)) || path.basename(fullPath),
    abstract: preview || null,
    item_type: extension === '.pdf' ? 'pdf' : 'projectArtifact',
    source: 'project_file',
    source_id: relativePath,
    pdf_cached: extension === '.pdf' ? 1 : 0,
    created_at: stats.mtime.toISOString(),
    updated_at: stats.mtime.toISOString(),
    project_linked: false,
    has_local_artifact: true,
    local_artifact_dir: toRelative(projectPath, path.dirname(fullPath)),
    local_relative_path: relativePath,
    local_pdf_path: extension === '.pdf' ? relativePath : null,
    local_files: [relativePath],
    origin: 'project_local',
    artifact_source: 'file',
  });
}

async function collectLocalReferencesFromRoot(projectPath, rootRelativeDir) {
  const rootPath = path.join(projectPath, rootRelativeDir);
  if (!(await pathExists(rootPath))) {
    return [];
  }

  const references = [];

  async function walk(currentDir) {
    const children = await fsPromises.readdir(currentDir, { withFileTypes: true });
    const childNames = new Set(children.map((child) => child.name));

    if (childNames.has(REFERENCE_ARTIFACT_METADATA_FILENAME)) {
      const stats = await fsPromises.stat(currentDir);
      references.push(await buildArtifactReference(projectPath, currentDir, stats));
      return;
    }

    for (const child of children) {
      if (child.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(currentDir, child.name);
      if (child.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const extension = path.extname(child.name).toLowerCase();
      if (!SUPPORTED_LOOSE_REFERENCE_EXTENSIONS.has(extension)) {
        continue;
      }

      if (
        child.name === REFERENCE_ARTIFACT_NOTE_FILENAME
        || child.name === REFERENCE_ARTIFACT_EXTRACT_FILENAME
      ) {
        continue;
      }

      const stats = await fsPromises.stat(fullPath);
      references.push(await buildLooseFileReference(projectPath, fullPath, stats));
    }
  }

  await walk(rootPath);
  return references;
}

export async function collectLocalProjectReferences(projectPath) {
  const localReferences = [];
  const seenRoots = new Set();
  const roots = getMetaFolderSchemaVersion(projectPath) === META_NUMBERED_FOLDER_SCHEMA_VERSION
    ? META_PROJECT_REFERENCE_ROOTS
    : PROJECT_REFERENCE_ROOTS;

  for (const rootRelativeDir of roots) {
    const rootPath = path.join(projectPath, rootRelativeDir);
    let realRoot = '';
    try {
      realRoot = await fsPromises.realpath(rootPath);
    } catch {
      continue;
    }
    if (seenRoots.has(realRoot)) {
      continue;
    }
    seenRoots.add(realRoot);
    const refs = await collectLocalReferencesFromRoot(projectPath, rootRelativeDir);
    localReferences.push(...refs);
  }

  return localReferences;
}

function getReferenceMatchKey(reference = {}) {
  if (reference.id) {
    return `id:${reference.id}`;
  }
  if (reference.doi) {
    return `doi:${String(reference.doi).toLowerCase()}`;
  }
  if (reference.citation_key) {
    return `citation:${String(reference.citation_key).toLowerCase()}`;
  }
  return null;
}

function mergeReferenceRecords(baseReference, localReference) {
  const mergedLocalFiles = new Set([
    ...(Array.isArray(baseReference.local_files) ? baseReference.local_files : []),
    ...(Array.isArray(localReference.local_files) ? localReference.local_files : []),
  ]);

  return buildReferenceRecord({
    ...baseReference,
    abstract: baseReference.abstract || localReference.abstract,
    doi: baseReference.doi || localReference.doi,
    url: baseReference.url || localReference.url,
    journal: baseReference.journal || localReference.journal,
    source: baseReference.source || localReference.source,
    source_id: baseReference.source_id || localReference.source_id,
    citation_key: baseReference.citation_key || localReference.citation_key,
    keywords: baseReference.keywords?.length ? baseReference.keywords : localReference.keywords,
    pdf_cached: baseReference.pdf_cached || localReference.pdf_cached,
    updated_at: new Date(
      Math.max(
        new Date(baseReference.updated_at || 0).getTime(),
        new Date(localReference.updated_at || 0).getTime(),
      ),
    ).toISOString(),
    project_linked: Boolean(baseReference.project_linked),
    has_local_artifact: true,
    local_artifact_dir: baseReference.local_artifact_dir || localReference.local_artifact_dir,
    local_relative_path: baseReference.local_relative_path || localReference.local_relative_path,
    local_pdf_path: baseReference.local_pdf_path || localReference.local_pdf_path,
    local_files: Array.from(mergedLocalFiles),
    origin: 'merged',
    artifact_source: localReference.artifact_source || baseReference.artifact_source,
  });
}

function compareReferences(left, right) {
  if (left.project_linked !== right.project_linked) {
    return left.project_linked ? -1 : 1;
  }
  if (left.has_local_artifact !== right.has_local_artifact) {
    return left.has_local_artifact ? -1 : 1;
  }

  const updatedDelta = new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime();
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  return left.title.localeCompare(right.title);
}

export async function buildAggregatedProjectReferences({ projectPath, linkedReferences = [] }) {
  const isNumberedMetaProject = getMetaFolderSchemaVersion(projectPath) === META_NUMBERED_FOLDER_SCHEMA_VERSION;
  const effectiveLinkedReferences = isNumberedMetaProject ? [] : linkedReferences;
  const normalizedLinked = effectiveLinkedReferences.map((reference) => buildReferenceRecord({
    ...reference,
    project_linked: true,
    has_local_artifact: false,
    origin: 'library',
  }));

  const merged = new Map();
  const matchesByDoi = new Map();
  const matchesByCitationKey = new Map();

  for (const reference of normalizedLinked) {
    merged.set(reference.id, reference);
    if (reference.doi) {
      matchesByDoi.set(String(reference.doi).toLowerCase(), reference.id);
    }
    if (reference.citation_key) {
      matchesByCitationKey.set(String(reference.citation_key).toLowerCase(), reference.id);
    }
  }

  const localReferences = await collectLocalProjectReferences(projectPath);
  for (const localReference of localReferences) {
    let matchId = null;
    const localMatchKey = getReferenceMatchKey(localReference);
    if (localMatchKey?.startsWith('id:') && merged.has(localReference.id)) {
      matchId = localReference.id;
    } else if (localReference.doi && matchesByDoi.has(String(localReference.doi).toLowerCase())) {
      matchId = matchesByDoi.get(String(localReference.doi).toLowerCase());
    } else if (
      localReference.citation_key
      && matchesByCitationKey.has(String(localReference.citation_key).toLowerCase())
    ) {
      matchId = matchesByCitationKey.get(String(localReference.citation_key).toLowerCase());
    }

    if (matchId && merged.has(matchId)) {
      merged.set(matchId, mergeReferenceRecords(merged.get(matchId), localReference));
      continue;
    }

    merged.set(localReference.id, localReference);
  }

  const references = Array.from(merged.values()).sort(compareReferences);
  return {
    references,
    stats: {
      total_count: references.length,
      linked_count: references.filter((reference) => reference.project_linked).length,
      local_only_count: references.filter((reference) => !reference.project_linked).length,
      local_artifact_count: references.filter((reference) => reference.has_local_artifact).length,
    },
  };
}
