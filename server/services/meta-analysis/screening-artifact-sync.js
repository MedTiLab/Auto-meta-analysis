import crypto from 'crypto';
import { promises as fsPromises } from 'fs';
import path from 'path';

import { db, metaAnalysisDb, referencesDb } from '../../database/db.js';
import { getMetaStageDirs, toProjectRelativePath } from '../../utils/meta-analysis-artifacts.js';

const SEARCH_INPUT_FILENAMES = ['screening_input.csv', 'screening_input.json', 'screening_input.tsv'];
const SCREENING_ARTIFACT_FILE = 'screening_decisions.csv';
const SCREENING_ARTIFACT_FILENAMES = ['screening_decisions.csv', 'screening_decisions.json', 'screening_decisions.tsv'];
const SYNC_REPORT_FILE = 'sync_report.json';
const VALID_DECISIONS = new Set(['include', 'exclude', 'maybe']);
const VALID_STAGES = new Set(['title_abstract', 'full_text', 'final']);
const NAMED_AGENT_REVIEWER_RE = /^claude(?:[\s:_-]|$)/i;
const AI_PRE_SCREEN_REVIEWER_RE = /^(ai|assistant|auto|automated|model|llm|system)(?:[\s:_-]|$)/i;
const CSV_HEADER_ALIASES = {
  ai_decision: 'decision',
  article_title: 'title',
  article: 'title',
  author: 'authors',
  authors: 'authors',
  confidence_score: 'confidence',
  citation_title: 'title',
  container_title: 'journal',
  database: 'databaseName',
  database_name: 'databaseName',
  doi: 'doi',
  evidence: 'evidenceNote',
  evidence_note: 'evidenceNote',
  evidence_snippet: 'evidenceNote',
  final_decision: 'decision',
  id: 'id',
  journal: 'journal',
  link: 'url',
  paper_title: 'title',
  pmid: 'pmid',
  pubmed_id: 'pmid',
  pubmedid: 'pmid',
  publication_date: 'publicationDate',
  publication_year: 'year',
  pub_year: 'year',
  rationale: 'reason',
  recommendation: 'recommendation',
  record_id: 'source_id',
  reviewer: 'reviewer',
  screening_decision: 'screeningDecision',
  source_database: 'databaseName',
  source_id: 'source_id',
  source_title: 'journal',
  source: 'source',
  stage: 'stage',
  study_title: 'title',
  summary: 'abstract',
  title: 'title',
  url: 'url',
  year: 'year',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTitle(title) {
  return normalizeText(title).toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
}

function normalizeDoi(value) {
  return normalizeText(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase();
}

function normalizePmid(value) {
  return normalizeText(value).replace(/^pubmed[-_:]/i, '').replace(/^pmid[-_:]/i, '').trim();
}

function normalizeStage(value) {
  const normalized = normalizeText(value || 'title_abstract').toLowerCase();
  if (normalized === 'title_abstract_screening' || normalized === 'title-abstract') return 'title_abstract';
  return VALID_STAGES.has(normalized) ? normalized : 'title_abstract';
}

function normalizeDecision(value) {
  const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');
  if (['included', 'eligible', 'yes', 'keep', 'retain', 'include_with_caution'].includes(normalized)) return 'include';
  if (['excluded', 'not_eligible', 'ineligible', 'no', 'remove', 'reject'].includes(normalized)) return 'exclude';
  if (['uncertain', 'unsure', 'needs_review', 'needs_full_text', 'review', 'unclear_fulltext', 'unclear_full_text'].includes(normalized)) return 'maybe';
  return VALID_DECISIONS.has(normalized) ? normalized : null;
}

function normalizeConfidence(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = normalizeText(value);
  const numeric = Number(text.endsWith('%') ? text.slice(0, -1) : text);
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 1 && numeric <= 100) return Number((numeric / 100).toFixed(4));
  if (numeric < 0 || numeric > 1) return null;
  return numeric;
}

function normalizeAuthors(authors) {
  if (typeof authors === 'string' && authors.trim()) return [authors.trim()];
  if (!Array.isArray(authors)) return [];
  return authors
    .map((author) => {
      if (typeof author === 'string') return author.trim();
      if (author && typeof author === 'object') return author;
      return null;
    })
    .filter(Boolean);
}

function hashKey(value) {
  return crypto.createHash('sha1').update(normalizeText(value)).digest('hex').slice(0, 16);
}

function importReferenceId(userId, source, item) {
  let key = item.citationKey;
  if (!key) {
    key = crypto.createHash('sha256')
      .update(`${item.title || ''}|${JSON.stringify(item.authors || [])}|${item.year || ''}`)
      .digest('hex')
      .slice(0, 16);
  }
  return `${source}_${userId}_${key}`;
}

function referenceYearKey(year) {
  if (year === null || year === undefined || year === '') return '';
  const numeric = Number(year);
  return Number.isFinite(numeric) ? String(numeric) : '';
}

function addReferenceToLookup(lookup, reference = {}) {
  const id = normalizeText(reference.id);
  if (!id) return;
  lookup.byId.add(id);

  const doi = normalizeDoi(reference.doi);
  if (doi && !lookup.byDoi.has(doi)) lookup.byDoi.set(doi, id);

  const identifierCandidates = [
    reference.source_id,
    reference.sourceId,
    reference.citation_key,
    reference.citationKey,
  ];
  identifierCandidates.forEach((candidate) => {
    const normalized = normalizePmid(candidate);
    if (normalized && !lookup.byPmid.has(normalized)) lookup.byPmid.set(normalized, id);
  });

  const title = normalizeTitle(reference.title);
  if (!title) return;
  if (!lookup.byTitleOnly.has(title)) lookup.byTitleOnly.set(title, id);
  const year = referenceYearKey(reference.year);
  if (year) {
    const titleYearKey = `${title}\u0000${year}`;
    if (!lookup.byTitleYear.has(titleYearKey)) lookup.byTitleYear.set(titleYearKey, id);
  }
}

function buildReferenceLookup(userId) {
  const rows = db.prepare(`
    SELECT id, title, year, doi, source, source_id, citation_key
    FROM references_library
    WHERE user_id = ?
  `).all(userId);
  const lookup = {
    byId: new Set(),
    byDoi: new Map(),
    byPmid: new Map(),
    byTitleYear: new Map(),
    byTitleOnly: new Map(),
  };
  rows.forEach((row) => addReferenceToLookup(lookup, row));
  return lookup;
}

function findExistingReferenceInLookup(lookup, record, databaseName = '') {
  const referenceId = normalizeText(firstPresent(record.referenceId, record.reference_id, record.libraryReferenceId));
  if (referenceId && lookup.byId.has(referenceId)) return referenceId;

  const doi = getRecordDoi(record);
  if (doi && lookup.byDoi.has(doi)) return lookup.byDoi.get(doi);

  const pmid = getRecordPmid(record, databaseName);
  if (pmid && lookup.byPmid.has(pmid)) return lookup.byPmid.get(pmid);

  const title = normalizeTitle(getRecordTitle(record));
  if (!title) return null;
  const year = referenceYearKey(getRecordYear(record));
  if (year) {
    const byTitleYear = lookup.byTitleYear.get(`${title}\u0000${year}`);
    if (byTitleYear) return byTitleYear;
    return null;
  }
  return lookup.byTitleOnly.get(title) || null;
}

function queueReferenceImport({ importsBySource, lookup, userId, source, item }) {
  const referenceId = importReferenceId(userId, source, item);
  if (!lookup.byId.has(referenceId)) {
    const bucket = importsBySource.get(source) || [];
    bucket.push(item);
    importsBySource.set(source, bucket);
    addReferenceToLookup(lookup, {
      id: referenceId,
      title: item.title,
      year: item.year,
      doi: item.doi,
      source,
      source_id: item.citationKey,
      citation_key: item.citationKey,
    });
  }
  return referenceId;
}

function flushReferenceImports(userId, importsBySource) {
  for (const [source, items] of importsBySource.entries()) {
    if (items.length > 0) {
      referencesDb.importReferences(userId, items, source, { libraryVisible: false });
    }
  }
}

function bulkUpsertScreeningDecisions(userId, payloads = []) {
  if (!payloads.length) return;
  const upsert = db.prepare(`
    INSERT INTO meta_screening_decisions (
      id, user_id, meta_project_id, reference_id, stage, decision, reason, reviewer, evidence_note, confidence, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(meta_project_id, reference_id, stage) DO UPDATE SET
      decision = excluded.decision,
      reason = excluded.reason,
      reviewer = excluded.reviewer,
      evidence_note = excluded.evidence_note,
      confidence = CASE WHEN ? THEN excluded.confidence ELSE meta_screening_decisions.confidence END,
      metadata_json = CASE WHEN ? THEN excluded.metadata_json ELSE meta_screening_decisions.metadata_json END,
      updated_at = CURRENT_TIMESTAMP
  `);
  const tx = db.transaction((rows) => {
    rows.forEach((payload) => {
      const hasConfidence = Object.prototype.hasOwnProperty.call(payload, 'confidence');
      const hasMetadata = Object.prototype.hasOwnProperty.call(payload, 'metadataJson')
        || Object.prototype.hasOwnProperty.call(payload, 'metadata_json');
      upsert.run(
        payload.id || `meta_screen_${crypto.randomUUID()}`,
        userId,
        payload.metaProjectId || payload.meta_project_id,
        payload.referenceId || payload.reference_id,
        payload.stage || 'title_abstract',
        payload.decision || 'maybe',
        payload.reason || null,
        payload.reviewer || null,
        payload.evidenceNote || payload.evidence_note || null,
        hasConfidence && payload.confidence != null ? Number(payload.confidence) : null,
        hasMetadata ? JSON.stringify(payload.metadataJson || payload.metadata_json || null) : null,
        hasConfidence ? 1 : 0,
        hasMetadata ? 1 : 0,
      );
    });
  });
  tx(payloads);
}

function sanitizeSourceSegment(value, fallback = 'json') {
  const normalized = normalizeText(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return normalized || fallback;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return '';
}

function getRecordTitle(record = {}) {
  return normalizeText(firstPresent(
    record.title,
    record.articleTitle,
    record.article_title,
    record.name,
    record.citationTitle,
  ));
}

function getRecordAbstract(record = {}) {
  return normalizeText(firstPresent(record.abstract, record.summary, record.description));
}

function getRecordDoi(record = {}) {
  return normalizeDoi(firstPresent(record.doi, record.DOI, record.identifiers?.doi, record.ids?.doi));
}

function getRecordPmid(record = {}, databaseName = '') {
  const explicit = firstPresent(
    record.pmid,
    record.PMID,
    record.pubmedId,
    record.pubmed_id,
    record.identifiers?.pmid,
    record.ids?.pmid,
  );
  if (explicit) return normalizePmid(explicit);
  const sourceId = firstPresent(record.source_id, record.sourceId, record.id);
  if (/pubmed/i.test(databaseName) && /^\d+$/.test(normalizeText(sourceId))) {
    return normalizePmid(sourceId);
  }
  return '';
}

function getRecordYear(record = {}) {
  const direct = firstPresent(record.year, record.publicationYear, record.publication_year);
  if (direct) {
    const numeric = Number(direct);
    if (Number.isFinite(numeric)) return numeric;
  }
  const dateText = normalizeText(firstPresent(record.published, record.publicationDate, record.publication_date, record.date));
  const match = dateText.match(/\b(18|19|20|21)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function buildCitationKey(record, databaseName = '') {
  const pmid = getRecordPmid(record, databaseName);
  if (pmid) {
    return /pubmed/i.test(databaseName)
      ? pmid.replace(/[^a-zA-Z0-9._-]+/g, '_')
      : `pmid_${pmid.replace(/[^a-zA-Z0-9._-]+/g, '_')}`;
  }
  const doi = getRecordDoi(record);
  if (doi) return `doi_${hashKey(doi)}`;
  return `screen_${hashKey(`${getRecordTitle(record)}|${getRecordYear(record) || ''}`)}`;
}

function findReferenceByDoi(userId, doi) {
  if (!doi) return null;
  return db.prepare('SELECT id FROM references_library WHERE user_id = ? AND LOWER(doi) = LOWER(?) LIMIT 1').get(userId, doi)?.id || null;
}

function findReferenceByPmid(userId, pmid) {
  if (!pmid) return null;
  const variants = [...new Set([pmid, `pmid_${pmid}`])];
  const placeholders = variants.map(() => '?').join(',');
  return db.prepare(`
    SELECT id FROM references_library
    WHERE user_id = ?
      AND (
        (source = 'pubmed' AND source_id IN (${placeholders}))
        OR citation_key IN (${placeholders})
        OR source_id IN (${placeholders})
      )
    LIMIT 1
  `).get(userId, ...variants, ...variants, ...variants)?.id || null;
}

function findReferenceByTitleYear(userId, title, year) {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return null;
  const rows = db.prepare('SELECT id, title, year FROM references_library WHERE user_id = ?').all(userId);
  const normalizedYear = year == null || year === '' ? null : Number(year);
  const match = rows.find((row) => {
    if (normalizeTitle(row.title) !== normalizedTitle) return false;
    if (!normalizedYear) return true;
    return Number(row.year || 0) === normalizedYear;
  });
  return match?.id || null;
}

function findExistingReference(userId, record, databaseName = '') {
  const referenceId = normalizeText(firstPresent(record.referenceId, record.reference_id, record.libraryReferenceId));
  if (referenceId && referencesDb.getReference(referenceId, userId)) return referenceId;
  const doi = getRecordDoi(record);
  const byDoi = findReferenceByDoi(userId, doi);
  if (byDoi) return byDoi;
  const pmid = getRecordPmid(record, databaseName);
  const byPmid = findReferenceByPmid(userId, pmid);
  if (byPmid) return byPmid;
  return findReferenceByTitleYear(userId, getRecordTitle(record), getRecordYear(record));
}

function inferDatabaseName({ payload = {}, record = {}, artifactRelativePath = '' } = {}) {
  const explicit = firstPresent(
    payload.databaseName,
    payload.database_name,
    payload.database,
    payload.sourceKey,
    payload.source_key,
    payload.source,
    record.databaseName,
    record.database_name,
    record.database,
    record.sourceKey,
    record.source_key,
    record.source,
  );
  if (explicit) return sanitizeSourceSegment(explicit, 'json');
  if (/pubmed/i.test(artifactRelativePath)) return 'pubmed';
  if (/openalex/i.test(artifactRelativePath)) return 'openalex';
  if (/europe[-_]?pmc/i.test(artifactRelativePath)) return 'europe_pmc';
  if (/crossref/i.test(artifactRelativePath)) return 'crossref';
  if (/medrxiv/i.test(artifactRelativePath)) return 'medrxiv';
  if (/arxiv/i.test(artifactRelativePath)) return 'arxiv';
  if (/zotero/i.test(artifactRelativePath)) return 'zotero';
  if (/bib/i.test(artifactRelativePath)) return 'bibtex';
  return 'json';
}

function getImportSource(databaseName) {
  const normalized = sanitizeSourceSegment(databaseName, 'json');
  if (normalized === 'pubmed') return 'pubmed';
  if (normalized === 'zotero') return 'zotero';
  if (normalized === 'bibtex') return 'bibtex';
  return `meta_search_${normalized}`;
}

function buildImportItem(record, {
  payload = {},
  artifactRelativePath,
  index,
  databaseName,
  importKind,
} = {}) {
  const doi = getRecordDoi(record);
  const pmid = getRecordPmid(record, databaseName);
  const citationKey = buildCitationKey(record, databaseName);
  const recordMetadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  return {
    citationKey,
    title: getRecordTitle(record),
    authors: normalizeAuthors(record.authors),
    year: getRecordYear(record),
    abstract: getRecordAbstract(record),
    doi,
    url: normalizeText(firstPresent(record.url, record.link, record.uri)),
    journal: normalizeText(firstPresent(record.journal, record.containerTitle, record.container_title, record.sourceTitle)),
    itemType: record.itemType || record.item_type || 'article',
    keywords: ['Meta screening', `Meta ${databaseName}`],
    rawData: {
      ...recordMetadata,
      source: importKind,
      databaseName,
      syncedFrom: artifactRelativePath,
      sourceFormat: payload.sourceFormat || null,
      recordIndex: index,
      schemaVersion: payload.schemaVersion || payload.schema_version || null,
      pmid,
      doi,
      sourceRecordId: firstPresent(record.source_id, record.sourceId, record.id) || null,
    },
  };
}

function getReviewerClass(reviewer) {
  const normalized = normalizeText(reviewer).toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'user') return 'user';
  if (NAMED_AGENT_REVIEWER_RE.test(normalized)) return 'named_agent';
  if (AI_PRE_SCREEN_REVIEWER_RE.test(normalized)) return 'ai_pre_screen';
  return 'human_or_named_reviewer';
}

function buildScreeningMetadata({ payload, record, artifactRelativePath, index, reviewer, existingDecision }) {
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const reviewerClass = getReviewerClass(reviewer);
  const previousAiPreScreen = existingDecision
    && getReviewerClass(existingDecision.reviewer) === 'ai_pre_screen'
    && reviewerClass === 'named_agent'
    ? {
        reviewer: existingDecision.reviewer,
        decision: existingDecision.decision,
        reason: existingDecision.reason,
        evidenceNote: existingDecision.evidence_note,
        confidence: existingDecision.confidence,
        metadata: existingDecision.metadata_json || null,
        updatedAt: existingDecision.updated_at,
      }
    : metadata.previousAiPreScreen || metadata.previous_ai_pre_screen || null;

  return {
    ...metadata,
    schemaVersion: payload.schemaVersion || payload.schema_version || 'meta-screening-v1',
    syncedFrom: artifactRelativePath,
    sourceFormat: payload.sourceFormat || 'json',
    source: 'screening_artifact',
    sourceDatabase: inferDatabaseName({ payload, record, artifactRelativePath }),
    recordIndex: index,
    pmid: getRecordPmid(record) || null,
    doi: getRecordDoi(record) || null,
    rubric: record.rubric || record.scores || null,
    conflict: record.conflict ?? record.hasConflict ?? null,
    reviewerClass,
    agentReviewStatus: record.agentReviewStatus
      || record.agent_review_status
      || (reviewerClass === 'ai_pre_screen' ? 'pending_review' : null)
      || (reviewerClass === 'named_agent' ? 'reviewed' : null),
    userAuthorizationState: record.userAuthorizationState
      || record.user_authorization_state
      || (reviewerClass === 'user' ? 'authorized' : null),
    previousAiPreScreen,
  };
}

function isUserDecision(decision) {
  return normalizeText(decision?.reviewer).toLowerCase() === 'user';
}

function getRecordDecision(record = {}) {
  return normalizeDecision(firstPresent(
    record.decision,
    record.screeningDecision,
    record.screening_decision,
    record.recommendation,
    record.final_decision,
    record.finalDecision,
    record.reviewer2_decision,
    record.reviewer2Decision,
    record.reviewer1_decision,
    record.reviewer1Decision,
    record.ai_decision,
    record.aiDecision,
    record.pre_classification,
    record.preClassification,
    record.inclusion_decision,
    record.inclusionDecision,
  ));
}

function getRecordReviewer(record = {}, fallback = '') {
  return normalizeText(firstPresent(
    record.reviewer,
    record.reviewer_id,
    record.reviewerId,
    record.reviewer2_id,
    record.reviewer2Id,
    record.reviewer1_id,
    record.reviewer1Id,
    record.ai_reviewer,
    record.aiReviewer,
    fallback,
  ));
}

function inferDefaultReviewer({ payload = {}, records = [], artifactRelativePath = '' } = {}) {
  const explicit = normalizeText(payload.reviewer || payload.defaultReviewer || payload.default_reviewer);
  if (explicit) return explicit;
  if (/ai|smart|reviewer1/i.test(artifactRelativePath)) return 'ai_pre_screen';
  if (records.some((record) => record && typeof record === 'object' && (record.ai_decision || record.aiDecision))) return 'ai_pre_screen';
  return 'ai_pre_screen';
}

function normalizeCsvHeader(value) {
  return normalizeText(value)
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseDelimitedRows(raw, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let lineNumber = 1;
  let rowLineNumber = 1;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
        if (char === '\n') lineNumber += 1;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      row.push(field);
      if (row.some((value) => normalizeText(value))) {
        rows.push({ values: row, lineNumber: rowLineNumber });
      }
      row = [];
      field = '';
      if (char === '\r' && next === '\n') index += 1;
      lineNumber += 1;
      rowLineNumber = lineNumber;
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error('unterminated quoted field');
  }

  row.push(field);
  if (row.some((value) => normalizeText(value))) {
    rows.push({ values: row, lineNumber: rowLineNumber });
  }
  return rows;
}

function parseDelimitedRecords(raw, delimiter = ',') {
  const rows = parseDelimitedRows(raw, delimiter);
  if (rows.length === 0) return [];
  const headers = rows[0].values.map((header) => normalizeText(header));
  return rows.slice(1).map((row, rowIndex) => {
    const csvColumns = {};
    const record = {
      metadata: {
        csvLineNumber: row.lineNumber,
        csvRowNumber: rowIndex + 1,
        csvColumns,
      },
    };
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      const value = normalizeText(row.values[columnIndex]);
      if (!value) return;
      csvColumns[header] = value;
      const normalizedHeader = normalizeCsvHeader(header);
      const key = CSV_HEADER_ALIASES[normalizedHeader] || normalizedHeader;
      if (record[key] === undefined) record[key] = value;
    });
    return record;
  });
}

async function readArtifactFile(artifactPath) {
  const extension = path.extname(artifactPath).toLowerCase();
  try {
    const raw = await fsPromises.readFile(artifactPath, 'utf8');
    if (extension === '.json') {
      const payload = JSON.parse(raw);
      return {
        exists: true,
        payload,
        records: extractRecordArray(payload),
        format: 'json',
        error: null,
      };
    }
    if (extension === '.csv' || extension === '.tsv') {
      const records = parseDelimitedRecords(raw, extension === '.tsv' ? '\t' : ',');
      return {
        exists: true,
        payload: {
          records,
          sourceFormat: extension.slice(1),
        },
        records,
        format: extension.slice(1),
        error: null,
      };
    }
    return { exists: true, payload: null, records: [], format: extension.slice(1), error: new Error(`unsupported artifact extension ${extension}`) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, payload: null, records: [], format: extension.slice(1), error: null };
    return { exists: true, payload: null, records: [], format: extension.slice(1), error };
  }
}

async function getArtifactSignature(artifactPath) {
  const stats = await fsPromises.stat(artifactPath);
  return {
    size: stats.size,
    mtimeMs: Math.round(stats.mtimeMs),
  };
}

function signaturesMatch(left, right) {
  return Boolean(left && right && left.size === right.size && left.mtimeMs === right.mtimeMs);
}

function getPreviousFileResult(previousSyncReport, section, artifactRelativePath) {
  const files = previousSyncReport?.[section]?.files;
  if (!Array.isArray(files)) return null;
  return files.find((file) => file?.artifactPath === artifactRelativePath) || null;
}

async function readPreviousSyncReport(projectPath, artifactOptions = {}) {
  try {
    const reportPath = getSyncReportPath(projectPath, artifactOptions);
    return JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
  } catch {
    return null;
  }
}

function extractRecordArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.records,
    payload.decisions,
    payload.references,
    payload.results,
    payload.items,
    payload.articles,
    payload.papers,
  ];
  return candidates.find(Array.isArray) || [];
}

async function firstExistingCanonicalArtifact(dirPath, filenames) {
  for (const filename of filenames) {
    const artifactPath = path.join(dirPath, filename);
    try {
      const stats = await fsPromises.stat(artifactPath);
      if (stats.isFile()) return [artifactPath];
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return [];
}

function getSearchArtifactCandidatePaths(projectPath, artifactOptions = {}) {
  const dirs = getMetaStageDirs(projectPath, artifactOptions);
  const searchDedupeDir = path.join(projectPath, dirs.searchDedupe || dirs.literatureReferences || '02_search_dedupe');
  const searchDir = path.join(searchDedupeDir, 'search');
  return {
    searchDedupeDir,
    searchDir,
    importedRecordsDir: path.join(searchDir, 'imported_records'),
    pubmedRunsDir: path.join(searchDir, 'pubmed_runs'),
    runsDir: path.join(searchDedupeDir, 'runs'),
  };
}

async function collectSearchArtifactPaths(projectPath, artifactOptions = {}) {
  const paths = getSearchArtifactCandidatePaths(projectPath, artifactOptions);
  return firstExistingCanonicalArtifact(paths.searchDedupeDir, SEARCH_INPUT_FILENAMES);
}

function inferQueryText(payload = {}) {
  return normalizeText(firstPresent(payload.query, payload.queryText, payload.query_text, payload.searchTerm, payload.search_term));
}

function inferResultCount(payload = {}, records = []) {
  const numeric = Number(firstPresent(payload.resultCount, payload.result_count, payload.count, payload.total, payload.totalResults, payload.total_results));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : records.length;
}

function emptySearchResult() {
  return {
    exists: false,
    artifactPaths: [],
    files: [],
    imported: 0,
    matched: 0,
    linked: 0,
    skipped: 0,
    searchRunsCreated: 0,
    warnings: [],
  };
}

export function getScreeningArtifactPath(projectPath, artifactOptions = {}) {
  const dirs = getMetaStageDirs(projectPath, artifactOptions);
  return path.join(projectPath, dirs.titleAbstractScreening || '03_title_abstract_screening', SCREENING_ARTIFACT_FILE);
}

async function collectScreeningArtifactPaths(projectPath, artifactOptions = {}) {
  const screeningDir = path.dirname(getScreeningArtifactPath(projectPath, artifactOptions));
  const artifactPaths = await firstExistingCanonicalArtifact(screeningDir, SCREENING_ARTIFACT_FILENAMES);
  const pathsWithStats = await Promise.all(artifactPaths.map(async (artifactPath) => ({
    artifactPath,
    stats: await fsPromises.stat(artifactPath),
  })));
  return pathsWithStats
    .sort((left, right) => left.stats.mtimeMs - right.stats.mtimeMs || left.artifactPath.localeCompare(right.artifactPath))
    .map((entry) => entry.artifactPath);
}

export function getSyncReportPath(projectPath, artifactOptions = {}) {
  const dirs = getMetaStageDirs(projectPath, artifactOptions);
  return path.join(projectPath, dirs.titleAbstractScreening || '03_title_abstract_screening', SYNC_REPORT_FILE);
}

export async function syncSearchArtifacts({
  userId,
  metaProject,
  projectPath,
  artifactOptions = {},
  previousSyncReport = null,
} = {}) {
  const result = emptySearchResult();
  const artifactPaths = await collectSearchArtifactPaths(projectPath, artifactOptions);
  result.exists = artifactPaths.length > 0;
  result.artifactPaths = artifactPaths.map((artifactPath) => toProjectRelativePath(projectPath, artifactPath));

  const existingRuns = metaAnalysisDb.listSearchRuns(userId, metaProject.id);
  const runByRawPath = new Set(existingRuns.map((run) => normalizeText(run.raw_response_path)));
  const referenceLookup = buildReferenceLookup(userId);

  for (const artifactPath of artifactPaths) {
    const artifactRelativePath = toProjectRelativePath(projectPath, artifactPath);
    const fileResult = {
      artifactPath: artifactRelativePath,
      imported: 0,
      matched: 0,
      linked: 0,
      skipped: 0,
      recordCount: 0,
      unchanged: false,
      signature: await getArtifactSignature(artifactPath),
      searchRunCreated: false,
      warnings: [],
    };
    result.files.push(fileResult);

    const previousFile = getPreviousFileResult(previousSyncReport, 'search', artifactRelativePath);
    if (signaturesMatch(fileResult.signature, previousFile?.signature) && runByRawPath.has(artifactRelativePath)) {
      fileResult.unchanged = true;
      fileResult.recordCount = Number(previousFile?.recordCount || 0);
      continue;
    }

    const artifact = await readArtifactFile(artifactPath);
    if (artifact.error) {
      const warning = `${artifactRelativePath}: invalid ${artifact.format?.toUpperCase() || 'artifact'} (${artifact.error.message})`;
      fileResult.warnings.push(warning);
      result.warnings.push(warning);
      continue;
    }

    const payload = artifact.payload && typeof artifact.payload === 'object' ? artifact.payload : {};
    const records = artifact.records || extractRecordArray(artifact.payload);
    fileResult.recordCount = records.length;
    if (!records.length) {
      const warning = `${artifactRelativePath}: no records array found`;
      fileResult.warnings.push(warning);
      result.warnings.push(warning);
      continue;
    }

    const databaseName = inferDatabaseName({ payload, record: records[0], artifactRelativePath });
    const importSource = getImportSource(databaseName);
    const importsBySource = new Map();
    const referenceIdsToLink = new Set();
    for (const [index, record] of records.entries()) {
      if (!record || typeof record !== 'object') {
        fileResult.skipped += 1;
        result.skipped += 1;
        const warning = `${artifactRelativePath}: record ${index + 1} is not an object`;
        fileResult.warnings.push(warning);
        result.warnings.push(warning);
        continue;
      }

      let referenceId = findExistingReferenceInLookup(referenceLookup, record, databaseName);
      if (referenceId) {
        fileResult.matched += 1;
        result.matched += 1;
      } else {
        if (!getRecordTitle(record)) {
          fileResult.skipped += 1;
          result.skipped += 1;
          const warning = `${artifactRelativePath}: record ${index + 1} has no title and could not be imported`;
          fileResult.warnings.push(warning);
          result.warnings.push(warning);
          continue;
        }
        const importItem = buildImportItem(record, {
            payload,
            artifactRelativePath,
            index,
            databaseName,
            importKind: `meta_search_${artifact.format || 'artifact'}`,
        });
        referenceId = queueReferenceImport({
          importsBySource,
          lookup: referenceLookup,
          userId,
          source: importSource,
          item: importItem,
        });
        fileResult.imported += 1;
        result.imported += 1;
      }

      referenceIdsToLink.add(referenceId);
    }

    flushReferenceImports(userId, importsBySource);
    const linked = referencesDb.bulkLinkIds(metaProject.project_id, Array.from(referenceIdsToLink));
    fileResult.linked += linked;
    result.linked += linked;

    if (!runByRawPath.has(artifactRelativePath)) {
      metaAnalysisDb.createSearchRun(userId, {
        metaProjectId: metaProject.id,
        databaseName,
        queryText: inferQueryText(payload),
        resultCount: inferResultCount(payload, records),
        importedCount: fileResult.imported,
        rawResponsePath: artifactRelativePath,
        metadataJson: {
          source: 'search_artifact',
          syncedFrom: artifactRelativePath,
          recordCount: records.length,
          linkedCount: fileResult.linked,
          skipped: fileResult.skipped,
          warnings: fileResult.warnings,
        },
      });
      runByRawPath.add(artifactRelativePath);
      fileResult.searchRunCreated = true;
      result.searchRunsCreated += 1;
    }
  }

  return result;
}

export async function syncScreeningArtifact({
  userId,
  metaProject,
  projectPath,
  artifactOptions = {},
  previousSyncReport = null,
} = {}) {
  const primaryArtifactPath = getScreeningArtifactPath(projectPath, artifactOptions);
  const primaryArtifactRelativePath = toProjectRelativePath(projectPath, primaryArtifactPath);
  const artifactPaths = await collectScreeningArtifactPaths(projectPath, artifactOptions);
  const result = {
    artifactPath: primaryArtifactRelativePath,
    artifactPaths: artifactPaths.map((artifactPath) => toProjectRelativePath(projectPath, artifactPath)),
    files: [],
    exists: artifactPaths.length > 0,
    imported: 0,
    matched: 0,
    linked: 0,
    upserted: 0,
    skipped: 0,
    preservedUserDecisions: 0,
    warnings: [],
  };

  const existingDecisions = metaAnalysisDb.listScreeningDecisions(userId, metaProject.id);
  const existingDecisionByKey = new Map(existingDecisions.map((decision) => [`${decision.reference_id}:${decision.stage}`, decision]));
  const referenceLookup = buildReferenceLookup(userId);

  for (const artifactPath of artifactPaths) {
    const artifactRelativePath = toProjectRelativePath(projectPath, artifactPath);
    const fileResult = {
      artifactPath: artifactRelativePath,
      imported: 0,
      matched: 0,
      linked: 0,
      upserted: 0,
      skipped: 0,
      preservedUserDecisions: 0,
      recordCount: 0,
      unchanged: false,
      signature: await getArtifactSignature(artifactPath),
      warnings: [],
    };
    result.files.push(fileResult);

    const previousFile = getPreviousFileResult(previousSyncReport, 'screening', artifactRelativePath);
    const hasSyncedDecisions = existingDecisions.length > 0 || Number(previousFile?.recordCount || 0) === 0;
    if (hasSyncedDecisions && signaturesMatch(fileResult.signature, previousFile?.signature)) {
      fileResult.unchanged = true;
      fileResult.recordCount = Number(previousFile?.recordCount || 0);
      continue;
    }

    const artifact = await readArtifactFile(artifactPath);
    if (artifact.error) {
      const warning = `${artifactRelativePath}: invalid ${artifact.format?.toUpperCase() || 'artifact'} (${artifact.error.message})`;
      fileResult.warnings.push(warning);
      result.warnings.push(warning);
      continue;
    }

    const payload = artifact.payload && typeof artifact.payload === 'object' && !Array.isArray(artifact.payload)
      ? artifact.payload
      : {};
    const records = artifact.records || extractRecordArray(artifact.payload);
    fileResult.recordCount = records.length;
    if (!records.length) {
      const warning = `${artifactRelativePath}: no records or decisions array found`;
      fileResult.warnings.push(warning);
      result.warnings.push(warning);
      continue;
    }

    const defaultReviewer = inferDefaultReviewer({ payload, records, artifactRelativePath });
    const defaultStage = normalizeStage(payload.stage);
    const importSource = `meta_screening_${artifact.format || 'artifact'}`;
    const importsBySource = new Map();
    const referenceIdsToLink = new Set();
    const screeningPayloads = [];

    for (const [index, record] of records.entries()) {
      if (!record || typeof record !== 'object') {
        fileResult.skipped += 1;
        result.skipped += 1;
        const warning = `${artifactRelativePath}: record ${index + 1} is not an object`;
        fileResult.warnings.push(warning);
        result.warnings.push(warning);
        continue;
      }

      const decision = getRecordDecision(record);
      const title = getRecordTitle(record);
      if (!decision) {
        fileResult.skipped += 1;
        result.skipped += 1;
        const warning = `${artifactRelativePath}: record ${index + 1} has invalid decision "${record.decision || record.screeningDecision || record.recommendation || record.ai_decision || record.reviewer1_decision || record.final_decision || ''}"`;
        fileResult.warnings.push(warning);
        result.warnings.push(warning);
        continue;
      }

      const databaseName = inferDatabaseName({ payload, record, artifactRelativePath });
      let referenceId = findExistingReferenceInLookup(referenceLookup, record, databaseName);
      if (referenceId) {
        fileResult.matched += 1;
        result.matched += 1;
      } else {
        if (!title) {
          fileResult.skipped += 1;
          result.skipped += 1;
          const warning = `${artifactRelativePath}: record ${index + 1} has no title and could not be matched to an existing reference`;
          fileResult.warnings.push(warning);
          result.warnings.push(warning);
          continue;
        }
        const importItem = buildImportItem(record, {
            payload,
            artifactRelativePath,
            index,
            databaseName,
            importKind: `meta_screening_${artifact.format || 'artifact'}`,
        });
        referenceId = queueReferenceImport({
          importsBySource,
          lookup: referenceLookup,
          userId,
          source: importSource,
          item: importItem,
        });
        fileResult.imported += 1;
        result.imported += 1;
      }

      referenceIdsToLink.add(referenceId);

      const stage = normalizeStage(record.stage || defaultStage);
      const reviewer = getRecordReviewer(record, defaultReviewer);
      const existingDecision = existingDecisionByKey.get(`${referenceId}:${stage}`);
      if (isUserDecision(existingDecision) && reviewer.toLowerCase() !== 'user') {
        fileResult.preservedUserDecisions += 1;
        result.preservedUserDecisions += 1;
        continue;
      }

      const confidence = normalizeConfidence(record.confidence);
      const metadataJson = buildScreeningMetadata({ payload, record, artifactRelativePath, index, reviewer, existingDecision });
      const screeningPayload = {
        metaProjectId: metaProject.id,
        referenceId,
        stage,
        decision,
        reason: record.reason || record.rationale || record.ai_reason || record.reviewer1_reason || record.reviewer2_reason || record.notes || '',
        reviewer,
        evidenceNote: record.evidenceNote || record.evidence_note || record.evidence || record.evidenceSnippet || record.evidence_snippet || '',
        confidence,
        metadataJson,
      };
      screeningPayloads.push(screeningPayload);
      existingDecisionByKey.set(`${referenceId}:${stage}`, {
        reference_id: referenceId,
        stage,
        decision,
        reason: screeningPayload.reason || null,
        reviewer,
        evidence_note: screeningPayload.evidenceNote || null,
        confidence,
        metadata_json: metadataJson,
      });
      fileResult.upserted += 1;
      result.upserted += 1;
    }

    flushReferenceImports(userId, importsBySource);
    const linked = referencesDb.bulkLinkIds(metaProject.project_id, Array.from(referenceIdsToLink));
    fileResult.linked += linked;
    result.linked += linked;
    bulkUpsertScreeningDecisions(userId, screeningPayloads);
  }

  return result;
}

async function writeSyncReport({ projectPath, artifactOptions, sync }) {
  const reportPath = getSyncReportPath(projectPath, artifactOptions);
  await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });
  const report = {
    schemaVersion: 'meta-artifact-sync-report-v1',
    generatedAt: new Date().toISOString(),
    summary: sync.summary,
    search: sync.search,
    screening: sync.screening,
  };
  await fsPromises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return toProjectRelativePath(projectPath, reportPath);
}

export async function syncMetaArtifacts({
  userId,
  metaProject,
  projectPath,
  artifactOptions = {},
} = {}) {
  const previousSyncReport = await readPreviousSyncReport(projectPath, artifactOptions);
  const search = await syncSearchArtifacts({ userId, metaProject, projectPath, artifactOptions, previousSyncReport });
  const screening = await syncScreeningArtifact({ userId, metaProject, projectPath, artifactOptions, previousSyncReport });
  const sync = {
    search,
    screening,
    summary: {
      imported: search.imported + screening.imported,
      matched: search.matched + screening.matched,
      linked: search.linked + screening.linked,
      skipped: search.skipped + screening.skipped,
      warnings: [...search.warnings, ...screening.warnings],
      searchRunsCreated: search.searchRunsCreated,
      screeningDecisionsUpserted: screening.upserted,
      preservedUserDecisions: screening.preservedUserDecisions,
    },
  };
  sync.reportPath = await writeSyncReport({ projectPath, artifactOptions, sync });
  return sync;
}
