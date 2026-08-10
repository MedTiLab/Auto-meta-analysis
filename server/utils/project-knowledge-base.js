import path from 'path';
import { promises as fsPromises } from 'fs';

const DEFAULT_RESEARCH_BRIEF_PATH = '.pipeline/docs/research_brief.json';
const DEFAULT_KB_DIRNAME = 'kb';
const DEFAULT_KB_MANIFEST_FILENAME = 'manifest.json';
const DEFAULT_KB_MANIFEST_RELATIVE_PATH = '.pipeline/docs/kb/manifest.json';
const DEFAULT_KB_NEWS_RELATIVE_DIR = '.pipeline/docs/kb/news';
const DEFAULT_KB_NOTES_RELATIVE_DIR = '.pipeline/docs/kb/notes';
const DEFAULT_KB_UPLOADS_RELATIVE_DIR = '.pipeline/docs/kb/uploads';
const MAX_KB_SUMMARY_CHARS = 600;
const MAX_KB_TEXT_FILE_BYTES = 1024 * 1024;
const REFERENCE_ARTIFACT_METADATA_FILENAME = 'metadata.json';
const REFERENCE_ARTIFACT_EXTRACT_FILENAME = 'extract.txt';
const REFERENCE_ARTIFACT_NOTE_FILENAME = 'note.md';
const REFERENCE_ARTIFACT_PDF_FILENAME = 'paper.pdf';

const KNOWLEDGE_BASE_SOURCE_DIRECTORIES = [
  { relativeDir: '00_literature/reports', sourceType: 'literature_report', tags: ['literature', 'report', 'meta'] },
  { relativeDir: '00_literature/references', sourceType: 'literature_reference', tags: ['literature', 'reference', 'meta'] },
  { relativeDir: '00_literature/topic_selection', sourceType: 'literature_report', tags: ['literature', 'topic-selection', 'meta'] },
  { relativeDir: '00_literature/scoping_review', sourceType: 'literature_report', tags: ['literature', 'scoping-review', 'meta'] },
  { relativeDir: 'Literature/reports', sourceType: 'literature_report', tags: ['literature', 'report'] },
  { relativeDir: 'literature/reports', sourceType: 'literature_report', tags: ['literature', 'report', 'legacy-lowercase'] },
  { relativeDir: 'Research/reports', sourceType: 'literature_report', tags: ['literature', 'report', 'legacy-survey'] },
  { relativeDir: 'Publication', sourceType: 'publication_artifact', tags: ['publication'] },
  { relativeDir: 'reports', sourceType: 'project_report', tags: ['report'] },
  { relativeDir: 'drafts', sourceType: 'draft', tags: ['draft'] },
  { relativeDir: DEFAULT_KB_NEWS_RELATIVE_DIR, sourceType: 'news_reference', tags: ['news', 'monitor'] },
  { relativeDir: DEFAULT_KB_NOTES_RELATIVE_DIR, sourceType: 'manual_note', tags: ['manual', 'note'] },
  { relativeDir: DEFAULT_KB_UPLOADS_RELATIVE_DIR, sourceType: 'user_upload', tags: ['upload', 'document'] },
];

/** Subset used by the research library “report preview” (excludes kb internals). */
const REPORT_PREVIEW_SOURCE_DESCRIPTORS = [
  { relativeDir: '00_literature/reports', sourceType: 'literature_report', tags: ['literature', 'report', 'meta'] },
  { relativeDir: '00_literature/topic_selection', sourceType: 'literature_report', tags: ['literature', 'topic-selection', 'meta'] },
  { relativeDir: '00_literature/scoping_review', sourceType: 'literature_report', tags: ['literature', 'scoping-review', 'meta'] },
  { relativeDir: 'Literature/reports', sourceType: 'literature_report', tags: ['literature', 'report'] },
  { relativeDir: 'literature/reports', sourceType: 'literature_report', tags: ['literature', 'report', 'legacy-lowercase'] },
  { relativeDir: 'Research/reports', sourceType: 'literature_report', tags: ['literature', 'report', 'legacy-survey'] },
  { relativeDir: 'Publication', sourceType: 'publication_artifact', tags: ['publication'] },
  { relativeDir: 'reports', sourceType: 'project_report', tags: ['report'] },
  { relativeDir: 'drafts', sourceType: 'draft', tags: ['draft'] },
];

const KNOWLEDGE_BASE_TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'csv', 'tsv', 'html', 'htm']);
const KNOWLEDGE_BASE_METADATA_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'rtf',
  'odt',
  'xls',
  'xlsx',
  'xlsm',
  'ods',
  'ppt',
  'pptx',
  'odp',
]);

function collapseWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => collapseWhitespace(value))
    .filter(Boolean);
}

function humanizeFileStem(fileName = '') {
  const stem = String(fileName || '').replace(/\.[^.]+$/, '');
  return stem
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

function getPipelinePaths(projectPath) {
  const root = path.join(projectPath, '.pipeline');
  const docsDir = path.join(root, 'docs');
  return {
    root,
    docsDir,
    configFile: path.join(root, 'config.json'),
    tasksFile: path.join(root, 'tasks', 'tasks.json'),
  };
}

export function getKnowledgeBasePaths(projectPath) {
  const pipelinePaths = getPipelinePaths(projectPath);
  const kbDir = path.join(pipelinePaths.docsDir, DEFAULT_KB_DIRNAME);
  return {
    kbDir,
    manifestFile: path.join(kbDir, DEFAULT_KB_MANIFEST_FILENAME),
    manifestRelativePath: DEFAULT_KB_MANIFEST_RELATIVE_PATH,
  };
}

async function readKnowledgeBaseSummary(fullPath) {
  const extension = path.extname(fullPath).replace(/^\./, '').toLowerCase();

  if (extension === 'pdf') {
    const sidecar = `${fullPath}.kb_extract.txt`;
    try {
      const stats = await fsPromises.stat(sidecar);
      if (stats.size > MAX_KB_TEXT_FILE_BYTES) {
        return '';
      }
      const content = await fsPromises.readFile(sidecar, 'utf8');
      return collapseWhitespace(content).slice(0, MAX_KB_SUMMARY_CHARS);
    } catch {
      return '';
    }
  }

  if (!KNOWLEDGE_BASE_TEXT_EXTENSIONS.has(extension)) {
    return '';
  }

  try {
    const stats = await fsPromises.stat(fullPath);
    if (stats.size > MAX_KB_TEXT_FILE_BYTES) {
      return '';
    }

    const content = await fsPromises.readFile(fullPath, 'utf8');
    return collapseWhitespace(content).slice(0, MAX_KB_SUMMARY_CHARS);
  } catch {
    return '';
  }
}

function normalizeReferenceArtifactMetadata(raw = null) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  return {
    referenceId: collapseWhitespace(raw.referenceId || raw.id || ''),
    title: collapseWhitespace(raw.title || ''),
    abstract: collapseWhitespace(raw.abstract || ''),
    keywords: normalizeStringArray(raw.keywords),
    source: collapseWhitespace(raw.source || ''),
    itemType: collapseWhitespace(raw.item_type || raw.itemType || ''),
  };
}

async function readReferenceArtifactMetadata(artifactDir, metadataCache) {
  if (metadataCache.has(artifactDir)) {
    return metadataCache.get(artifactDir);
  }

  const metadataPath = path.join(artifactDir, REFERENCE_ARTIFACT_METADATA_FILENAME);
  if (!(await pathExists(metadataPath))) {
    metadataCache.set(artifactDir, null);
    return null;
  }

  try {
    const content = await fsPromises.readFile(metadataPath, 'utf8');
    const parsed = JSON.parse(content);
    const normalized = normalizeReferenceArtifactMetadata(parsed);
    metadataCache.set(artifactDir, normalized);
    return normalized;
  } catch {
    metadataCache.set(artifactDir, null);
    return null;
  }
}

function shouldSkipReferenceArtifactFile(fileName, extension, artifactMetadata, siblingNames) {
  if (!artifactMetadata) {
    return false;
  }

  if (fileName === REFERENCE_ARTIFACT_METADATA_FILENAME) {
    return true;
  }

  if (
    fileName === REFERENCE_ARTIFACT_PDF_FILENAME
    && siblingNames.has(REFERENCE_ARTIFACT_EXTRACT_FILENAME)
  ) {
    return true;
  }

  return false;
}

function buildKnowledgeBaseEntryTitle(fileName, artifactMetadata) {
  if (artifactMetadata?.title) {
    const normalizedFileName = String(fileName || '').toLowerCase();
    if (normalizedFileName === REFERENCE_ARTIFACT_NOTE_FILENAME) {
      return `${artifactMetadata.title} note`;
    }
    if (normalizedFileName === REFERENCE_ARTIFACT_EXTRACT_FILENAME) {
      return `${artifactMetadata.title} extract`;
    }
    if (normalizedFileName === REFERENCE_ARTIFACT_PDF_FILENAME) {
      return artifactMetadata.title;
    }
    return artifactMetadata.title;
  }

  return humanizeFileStem(fileName) || fileName;
}

function buildKnowledgeBaseEntryTags(baseTags, extension, artifactMetadata) {
  const values = [
    ...baseTags,
    extension,
    artifactMetadata?.source || '',
    artifactMetadata?.itemType || '',
    ...(Array.isArray(artifactMetadata?.keywords) ? artifactMetadata.keywords : []),
  ];

  const seen = new Set();
  const tags = [];
  for (const value of values) {
    const normalized = collapseWhitespace(value);
    if (!normalized) {
      continue;
    }
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    tags.push(normalized);
  }

  return tags;
}

async function collectKnowledgeBaseFileEntries(projectPath, descriptor) {
  const sourceRoot = path.join(projectPath, descriptor.relativeDir);
  if (!(await pathExists(sourceRoot))) {
    return [];
  }

  const entries = [];
  const metadataCache = new Map();

  async function walk(currentDir) {
    const children = await fsPromises.readdir(currentDir, { withFileTypes: true });
    const siblingNames = new Set(children.map((child) => child.name));

    for (const child of children) {
      if (child.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(currentDir, child.name);
      if (child.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (child.name.endsWith('.kb_extract.txt')) {
        continue;
      }

      const extension = path.extname(child.name).replace(/^\./, '').toLowerCase();
      const supported = KNOWLEDGE_BASE_TEXT_EXTENSIONS.has(extension) || KNOWLEDGE_BASE_METADATA_EXTENSIONS.has(extension);
      if (!supported) {
        continue;
      }

      const artifactMetadata = await readReferenceArtifactMetadata(path.dirname(fullPath), metadataCache);
      if (shouldSkipReferenceArtifactFile(child.name, extension, artifactMetadata, siblingNames)) {
        continue;
      }

      const stats = await fsPromises.stat(fullPath);
      const relativePath = path.relative(projectPath, fullPath).split(path.sep).join('/');

      let summary = await readKnowledgeBaseSummary(fullPath);
      if (!summary && artifactMetadata?.abstract) {
        summary = artifactMetadata.abstract.slice(0, MAX_KB_SUMMARY_CHARS);
      }

      const isTextKind = KNOWLEDGE_BASE_TEXT_EXTENSIONS.has(extension)
        || extension === 'markdown'
        || (extension === 'pdf' && Boolean(summary));

      entries.push({
        id: `file:${relativePath}`,
        sourceType: descriptor.sourceType,
        title: buildKnowledgeBaseEntryTitle(child.name, artifactMetadata),
        relativePath,
        tags: buildKnowledgeBaseEntryTags(descriptor.tags, extension, artifactMetadata),
        updatedAt: stats.mtime.toISOString(),
        summary,
        kind: isTextKind ? 'text' : 'metadata',
      });
    }
  }

  await walk(sourceRoot);
  return entries;
}

async function collectKnowledgeBaseFileEntriesFromDescriptors(projectPath, descriptors) {
  const fileEntries = [];
  const seenSourceRoots = new Set();

  for (const descriptor of descriptors) {
    const sourceRoot = path.join(projectPath, descriptor.relativeDir);
    let realSourceRoot = '';
    try {
      realSourceRoot = await fsPromises.realpath(sourceRoot);
    } catch {
      continue;
    }
    if (seenSourceRoots.has(realSourceRoot)) {
      continue;
    }
    seenSourceRoots.add(realSourceRoot);
    const entries = await collectKnowledgeBaseFileEntries(projectPath, descriptor);
    fileEntries.push(...entries);
  }

  return fileEntries;
}

function buildResearchBriefKnowledgeBaseEntry(briefData, updatedAt) {
  const title = collapseWhitespace(briefData?.meta?.title) || 'Research Brief';
  const summary = collapseWhitespace([
    briefData?.sections?.literature?.core_research_question,
    briefData?.sections?.survey?.core_research_question,
    briefData?.sections?.ideation?.clinical_or_scientific_gap,
    briefData?.sections?.literature?.knowledge_base_scope,
    briefData?.sections?.survey?.knowledge_base_scope,
    briefData?.sections?.literature?.synthesis_summary,
    briefData?.sections?.survey?.synthesis_summary,
  ].filter(Boolean).join(' ')).slice(0, MAX_KB_SUMMARY_CHARS);

  if (!summary && title === 'Research Brief') {
    return null;
  }

  return {
    id: 'brief:research_brief',
    sourceType: 'research_brief',
    title,
    relativePath: DEFAULT_RESEARCH_BRIEF_PATH,
    tags: ['brief', 'research'],
    updatedAt,
    summary,
    kind: 'virtual',
  };
}

export async function buildKnowledgeBaseManifest(projectPath, projectName) {
  const generatedAt = new Date().toISOString();
  const briefPath = path.join(projectPath, DEFAULT_RESEARCH_BRIEF_PATH);
  let briefData = null;
  let briefUpdatedAt = generatedAt;

  if (await pathExists(briefPath)) {
    try {
      const [content, stats] = await Promise.all([
        fsPromises.readFile(briefPath, 'utf8'),
        fsPromises.stat(briefPath),
      ]);
      briefData = JSON.parse(content);
      briefUpdatedAt = stats.mtime.toISOString();
    } catch (error) {
      console.warn('[KnowledgeBase] Failed to read research brief:', error.message);
    }
  }

  const fileEntries = await collectKnowledgeBaseFileEntriesFromDescriptors(projectPath, KNOWLEDGE_BASE_SOURCE_DIRECTORIES);

  const virtualEntries = [];
  const briefEntry = buildResearchBriefKnowledgeBaseEntry(briefData, briefUpdatedAt);
  if (briefEntry) {
    virtualEntries.push(briefEntry);
  }

  const entries = [...fileEntries, ...virtualEntries].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || 0).getTime();
    return rightTime - leftTime;
  });

  const sourceBreakdown = entries.reduce((accumulator, entry) => {
    accumulator[entry.sourceType] = (accumulator[entry.sourceType] || 0) + 1;
    return accumulator;
  }, {});

  return {
    version: '1.0',
    projectName,
    generatedAt,
    manifestPath: DEFAULT_KB_MANIFEST_RELATIVE_PATH,
    entryCount: entries.length,
    sourceBreakdown,
    entries,
  };
}

export async function writeKnowledgeBaseManifest(projectPath, projectName) {
  const kbPaths = getKnowledgeBasePaths(projectPath);
  const manifest = await buildKnowledgeBaseManifest(projectPath, projectName);
  await fsPromises.mkdir(kbPaths.kbDir, { recursive: true });
  await fsPromises.writeFile(kbPaths.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    manifest,
    kbPaths,
  };
}

export async function listReportPreviewEntries(projectPath) {
  const fileEntries = await collectKnowledgeBaseFileEntriesFromDescriptors(projectPath, REPORT_PREVIEW_SOURCE_DESCRIPTORS);
  return fileEntries.sort((left, right) => {
    const leftTime = new Date(left.updatedAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || 0).getTime();
    return rightTime - leftTime;
  });
}
