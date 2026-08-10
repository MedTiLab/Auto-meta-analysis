import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';

import { db, metaAnalysisDb, projectDb, referencesDb, surveillanceDb } from '../database/db.js';
import { extractProjectDirectory } from '../projects.js';
import {
  ensureMetaAnalysisProjectDirs,
  getMetaAnalysisRunDir,
  getMetaDatasetPaths,
  getMetaManuscriptPaths,
  getMetaPublicationPaths,
  getMetaReferencePaths,
  META_NUMBERED_FOLDER_SCHEMA_VERSION,
  getMetaStageDirs,
  META_STAGE_DIRS,
  normalizeMetaFolderSchemaVersion,
  resolveMetaProjectPath,
  toProjectRelativePath,
} from '../utils/meta-analysis-artifacts.js';
import {
  filterHumanReviewedFullTextCandidates,
  isParsedDocumentQualityReviewed,
  isPdfHumanAudited,
} from '../services/meta-analysis/workflow-gates.js';
import { buildPubMedQuery } from '../services/meta-analysis/search-query-builder.js';
import {
  getDefaultMetaSearchSourceId,
  getMetaSearchSourcePolicy,
  resolveMetaSearchSource,
} from '../services/meta-analysis/search-source-policy.js';
import { fetchPubMedSummaries, searchPubMed } from '../services/meta-analysis/pubmed-client.js';
import { resolvePdfForReference } from '../services/meta-analysis/pdf-resolver.js';
import { getZoteroWebClient } from '../utils/zotero-web-client.js';
import { parsePdfWithMinerU } from '../services/meta-analysis/mineru-client.js';
import { syncMetaArtifacts } from '../services/meta-analysis/screening-artifact-sync.js';
import { extractDiagnosticCandidates, normalizeDiagnosticExtractionValue } from '../services/meta-analysis/extraction-service.js';
import { runDiagnosticMetaAnalysis } from '../services/meta-analysis/r-runner.js';
import { runProjectSurveillance } from '../services/meta-analysis/surveillance/surveillance-service.js';
import { writeMethodsSection } from '../services/meta-analysis/manuscript/methods-writer.js';
import { writeResultsSection } from '../services/meta-analysis/manuscript/results-writer.js';
import { draftSection } from '../services/meta-analysis/manuscript/section-drafter.js';

const router = express.Router();

const VALID_SCREENING_STAGES = new Set(['title_abstract', 'full_text', 'final']);
const VALID_SCREENING_DECISIONS = new Set(['include', 'exclude', 'maybe']);
const FULL_TEXT_UPLOAD_TYPES = {
  pdf: { assetType: 'pdf', contentType: 'application/pdf' },
  md: { assetType: 'markdown', contentType: 'text/markdown' },
  markdown: { assetType: 'markdown', contentType: 'text/markdown' },
  html: { assetType: 'html', contentType: 'text/html' },
  htm: { assetType: 'html', contentType: 'text/html' },
  txt: { assetType: 'text', contentType: 'text/plain' },
};
const DIRECT_PARSED_ASSET_TYPES = new Set(['markdown', 'html', 'text']);

function countBy(rows, field) {
  return (rows || []).reduce((acc, row) => {
    const key = row?.[field] || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

const META_NAMED_AGENT_REVIEWER_RE = /^claude(?:[\s:_-]|$)/i;
const META_NON_DECISION_REVIEWER_RE = /^(ai|assistant|auto|automated|model|llm|system)(?:[\s:_-]|$)/i;
const META_SCREENING_STAGE_RANK = {
  final: 3,
  full_text: 2,
  title_abstract: 1,
};

function getReviewerClass(reviewer) {
  const normalized = String(reviewer || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'user') return 'user';
  if (META_NAMED_AGENT_REVIEWER_RE.test(normalized)) return 'named_agent';
  if (META_NON_DECISION_REVIEWER_RE.test(normalized)) return 'ai_pre_screen';
  return 'human_or_named_reviewer';
}

function latestScreeningDecisionByReference(decisions = []) {
  const map = new Map();
  [...decisions]
    .sort((left, right) => {
      const rankDiff = (META_SCREENING_STAGE_RANK[right.stage] || 0) - (META_SCREENING_STAGE_RANK[left.stage] || 0);
      if (rankDiff !== 0) return rankDiff;
      return String(right.updated_at || '').localeCompare(String(left.updated_at || ''));
    })
    .forEach((decision) => {
      if (!map.has(decision.reference_id)) map.set(decision.reference_id, decision);
    });
  return map;
}

function latestScreeningDecisionByReferenceForStage(decisions = [], stage) {
  const map = new Map();
  decisions
    .filter((decision) => decision.stage === stage)
    .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
    .forEach((decision) => {
      if (!map.has(decision.reference_id)) map.set(decision.reference_id, decision);
    });
  return map;
}

function groupScreeningDecisionsByReference(decisions = []) {
  const map = new Map();
  decisions.forEach((decision) => {
    const items = map.get(decision.reference_id) || [];
    items.push(decision);
    map.set(decision.reference_id, items);
  });
  return map;
}

function isReviewedIncludeOrMaybe(decision) {
  if (!decision || !['include', 'maybe'].includes(decision.decision)) return false;
  const reviewerClass = getReviewerClass(decision.reviewer);
  return reviewerClass !== 'ai_pre_screen' && reviewerClass !== 'unknown';
}

function getReferencesForScreeningStage(references = [], decisions = [], stage = null) {
  if (stage === 'full_text') {
    const titleByReference = latestScreeningDecisionByReferenceForStage(decisions, 'title_abstract');
    return references.filter((reference) => isReviewedIncludeOrMaybe(titleByReference.get(reference.id)));
  }
  if (stage === 'final') {
    const fullTextByReference = latestScreeningDecisionByReferenceForStage(decisions, 'full_text');
    return references.filter((reference) => isReviewedIncludeOrMaybe(fullTextByReference.get(reference.id)));
  }
  return references;
}

function countScreeningWorkflowStatusForStage(references = [], decisions = [], stage = null) {
  const stageDecisions = stage ? decisions.filter((decision) => decision.stage === stage) : decisions;
  const latestByReference = stage
    ? latestScreeningDecisionByReferenceForStage(stageDecisions, stage)
    : latestScreeningDecisionByReference(stageDecisions);
  const decisionsByReference = new Map();
  stageDecisions.forEach((decision) => {
    const items = decisionsByReference.get(decision.reference_id) || [];
    items.push(decision);
    decisionsByReference.set(decision.reference_id, items);
  });
  const counts = {
    pending: 0,
    aiPreScreen: 0,
    pendingAgentReview: 0,
    agentReviewed: 0,
    userAuthorized: 0,
    otherReviewer: 0,
    agentConflicts: 0,
  };

  references.forEach((reference) => {
    const decision = latestByReference.get(reference.id);
    const referenceDecisions = decisionsByReference.get(reference.id) || [];
    const uniqueDecisions = new Set(referenceDecisions.map((item) => item.decision).filter(Boolean));
    if (uniqueDecisions.size > 1) counts.agentConflicts += 1;
    if (!decision) {
      counts.pending += 1;
      return;
    }
    const reviewerClass = getReviewerClass(decision.reviewer);
    if (reviewerClass === 'ai_pre_screen') {
      counts.aiPreScreen += 1;
      counts.pendingAgentReview += 1;
    } else if (reviewerClass === 'named_agent') {
      counts.agentReviewed += 1;
    } else if (reviewerClass === 'user') {
      counts.userAuthorized += 1;
    } else {
      counts.otherReviewer += 1;
    }
  });

  return counts;
}

function countScreeningWorkflowStatus(references = [], decisions = []) {
  const counts = countScreeningWorkflowStatusForStage(references, decisions);
  counts.byStage = {
    title_abstract: countScreeningWorkflowStatusForStage(
      getReferencesForScreeningStage(references, decisions, 'title_abstract'),
      decisions,
      'title_abstract',
    ),
    full_text: countScreeningWorkflowStatusForStage(
      getReferencesForScreeningStage(references, decisions, 'full_text'),
      decisions,
      'full_text',
    ),
    final: countScreeningWorkflowStatusForStage(
      getReferencesForScreeningStage(references, decisions, 'final'),
      decisions,
      'final',
    ),
  };
  return counts;
}

function parsePositiveInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function buildPaginatedScreeningPayload({ references = [], decisions = [], limit = 100, offset = 0 } = {}) {
  const latestByReference = latestScreeningDecisionByReference(decisions);
  const decisionsByReference = groupScreeningDecisionsByReference(decisions);
  const screenedReferences = references.filter((reference) => latestByReference.has(reference.id));
  const pageReferences = screenedReferences.slice(offset, offset + limit);
  const pageReferenceIds = new Set(pageReferences.map((reference) => reference.id));
  const pageDecisions = [];
  pageReferenceIds.forEach((referenceId) => {
    pageDecisions.push(...(decisionsByReference.get(referenceId) || []));
  });

  return {
    references: pageReferences,
    decisions: pageDecisions,
    total: screenedReferences.length,
    limit,
    offset,
    workflowStats: countScreeningWorkflowStatus(references, decisions),
  };
}

function normalizeFullTextAssetType(asset) {
  if (!asset) return '';
  const explicit = String(asset.asset_type || asset.assetType || '').trim().toLowerCase();
  if (explicit) return explicit;
  const ext = path.extname(String(asset.file_path || asset.filePath || '')).replace(/^\./, '').toLowerCase();
  return FULL_TEXT_UPLOAD_TYPES[ext]?.assetType || 'pdf';
}

function inferFullTextTypeFromPath(filePath = '') {
  const ext = path.extname(String(filePath || '')).replace(/^\./, '').toLowerCase();
  return FULL_TEXT_UPLOAD_TYPES[ext] || FULL_TEXT_UPLOAD_TYPES.pdf;
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToBasicMarkdown(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '\n')
      .replace(/<\/?(article|main|section|div|p)[^>]*>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

async function registerDirectParsedFullTextAsset({ userId, metaProject, projectPath, reference, asset, artifactOptions = {} }) {
  const assetPath = asset?.file_path ? resolveMetaProjectPath(projectPath, asset.file_path) : null;
  if (!assetPath || !fs.existsSync(assetPath)) return null;
  const assetType = normalizeFullTextAssetType(asset);
  if (!DIRECT_PARSED_ASSET_TYPES.has(assetType)) return null;

  const referencePaths = getMetaReferencePaths(projectPath, reference.id, {
    ...artifactOptions,
    referenceTitle: reference.title,
  });
  await fsPromises.mkdir(referencePaths.mineruDir, { recursive: true });
  const rawText = await fsPromises.readFile(assetPath, 'utf8');
  const markdown = assetType === 'html' ? htmlToBasicMarkdown(rawText) : rawText;
  await fsPromises.writeFile(referencePaths.markdownPath, `${markdown.trim()}\n`, 'utf8');
  await fsPromises.writeFile(referencePaths.parseReportPath, JSON.stringify({
    parser: 'direct_full_text_asset',
    assetType,
    sourcePath: asset.file_path,
    generatedAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  return metaAnalysisDb.upsertParsedDocument(userId, {
    metaProjectId: metaProject.id,
    referenceId: reference.id,
    pdfAssetId: asset.id,
    parser: 'mineru',
    status: 'parsed',
    markdownPath: toProjectRelativePath(projectPath, referencePaths.markdownPath),
    tablesPath: null,
    figuresDir: null,
    pageMapPath: null,
    parseReportPath: toProjectRelativePath(projectPath, referencePaths.parseReportPath),
    qualityScore: markdown.replace(/\s+/g, ' ').length > 3000 ? 0.8 : 0.55,
    error: null,
  });
}

function getFullTextReviewDir(projectPath, artifactOptions = {}) {
  const dirs = getMetaStageDirs(projectPath, artifactOptions);
  return path.join(projectPath, dirs.fullTextReview || dirs.experimentAnalysis || '04_full_text_review');
}

function getFullTextAssetRoot(projectPath, artifactOptions = {}) {
  return path.join(getFullTextReviewDir(projectPath, artifactOptions), 'fulltext');
}

function isPathInsideDir(parentDir, candidatePath) {
  const parent = path.resolve(parentDir);
  const candidate = path.resolve(candidatePath);
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function resolveManifestFullTextPath(projectPath, artifactOptions, rawPath) {
  if (!rawPath) return null;
  let resolved = null;
  try {
    resolved = resolveMetaProjectPath(projectPath, rawPath);
  } catch {
    return null;
  }
  const fullTextRoot = getFullTextAssetRoot(projectPath, artifactOptions);
  if (!isPathInsideDir(fullTextRoot, resolved)) return null;
  return resolved;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function normalizeDoi(value) {
  return String(value || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim().toLowerCase();
}

function buildReferenceLookupMaps(references = []) {
  const byId = new Map();
  const byPmid = new Map();
  const byDoi = new Map();
  const byTitle = new Map();
  references.forEach((reference) => {
    byId.set(reference.id, reference);
    const pmid = inferReferencePmid(reference);
    if (pmid && !byPmid.has(pmid)) byPmid.set(pmid, reference);
    const doi = normalizeDoi(reference.doi || reference.raw_data?.doi);
    if (doi && !byDoi.has(doi)) byDoi.set(doi, reference);
    const title = normalizeTitle(reference.title);
    if (title && !byTitle.has(title)) byTitle.set(title, reference);
  });
  return { byId, byPmid, byDoi, byTitle };
}

function findReferenceForManifestRow(row = {}, lookupMaps) {
  const explicitId = String(row.reference_id || row.referenceId || '').trim();
  if (explicitId && lookupMaps.byId.has(explicitId)) return lookupMaps.byId.get(explicitId);
  const recordId = String(row.record_id || row.recordId || '').trim();
  if (recordId && lookupMaps.byId.has(recordId)) return lookupMaps.byId.get(recordId);
  const pmid = String(row.pmid || row.PMID || '').trim();
  if (pmid && lookupMaps.byPmid.has(pmid)) return lookupMaps.byPmid.get(pmid);
  const doi = normalizeDoi(row.doi || row.DOI);
  if (doi && lookupMaps.byDoi.has(doi)) return lookupMaps.byDoi.get(doi);
  const title = normalizeTitle(row.title || row.Title);
  if (title && lookupMaps.byTitle.has(title)) return lookupMaps.byTitle.get(title);
  return null;
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (quoted && char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function parseManifestCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] ?? '';
      return row;
    }, {});
  });
}

async function readFullTextManifestRows(projectPath, artifactOptions = {}) {
  const fullTextReviewDir = getFullTextReviewDir(projectPath, artifactOptions);
  const candidates = [
    path.join(fullTextReviewDir, 'fulltext_manifest.json'),
    path.join(fullTextReviewDir, 'fulltext_manifest.csv'),
    path.join(fullTextReviewDir, 'pdf_manifest.json'),
    path.join(fullTextReviewDir, 'pdf_manifest.csv'),
  ];
  let fallbackRows = [];
  for (const manifestPath of candidates) {
    if (!fs.existsSync(manifestPath)) continue;
    const raw = await fsPromises.readFile(manifestPath, 'utf8');
    const rows = manifestPath.endsWith('.csv')
      ? parseManifestCsv(raw)
      : (() => {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
          ? parsed
          : (Array.isArray(parsed?.records) ? parsed.records : parsed?.items);
      })();
    if (!Array.isArray(rows)) continue;
    if (!fallbackRows.length) fallbackRows = rows;
    if (rows.some((row) => isFullTextAcquisitionManifestRow(row))) return rows;
  }
  return fallbackRows;
}

function parseManifestBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (['true', 'yes', 'y', '1', 'needed', 'required'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'not_needed', 'skip', 'skipped'].includes(normalized)) return false;
  return null;
}

function getManifestNeedsFullText(row = {}) {
  const keys = [
    'needs_full_text',
    'needsFullText',
    'full_text_required',
    'fullTextRequired',
    'acquisition_queue',
    'acquisitionQueue',
  ];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return parseManifestBoolean(row[key]);
    }
  }
  return null;
}

function isFullTextAcquisitionManifestRow(row = {}) {
  const explicit = getManifestNeedsFullText(row);
  if (explicit !== null) return explicit;
  const status = String(row.status || '').trim().toLowerCase();
  if (['exclude', 'excluded', 'not_needed', 'not_relevant', 'skip', 'skipped'].includes(status)) return false;
  if (row.path || row.file_path || row.markdown_path || row.pdf_path) return true;
  return ['downloaded', 'cached', 'exists', 'manual_upload_required', 'failed', 'unavailable', 'institution_login_required'].includes(status);
}

function normalizeManifestAssetStatus(row = {}, hasReadablePath = false) {
  const status = String(row.status || '').trim().toLowerCase();
  if (hasReadablePath && ['downloaded', 'cached', 'exists', 'xml_fulltext'].includes(status)) return 'downloaded';
  if (!status && !hasReadablePath) return 'not_checked';
  if (status === 'not_checked') return 'not_checked';
  if (status === 'failed') return 'failed';
  if (['not_oa', 'no_oa_pdf', 'no_identifier', 'no_pmcid', 'unavailable', 'institution_login_required'].includes(status)) {
    return 'manual_upload_required';
  }
  return hasReadablePath ? 'downloaded' : (status || 'manual_upload_required');
}

async function syncFullTextManifestAssets({ userId, metaProject, projectPath, artifactOptions = {} }) {
  const rows = await readFullTextManifestRows(projectPath, artifactOptions);
  if (!rows.length) return { rows: [], imported: 0 };
  const references = referencesDb.getProjectReferences(metaProject.project_id, userId);
  const lookupMaps = buildReferenceLookupMaps(references);
  let imported = 0;

  for (const row of rows) {
    if (!isFullTextAcquisitionManifestRow(row)) continue;
    const reference = findReferenceForManifestRow(row, lookupMaps);
    if (!reference) continue;
    const resolvedPath = row.path ? resolveManifestFullTextPath(projectPath, artifactOptions, row.path) : null;
    const hasReadablePath = Boolean(resolvedPath && fs.existsSync(resolvedPath));
    const typeInfo = inferFullTextTypeFromPath(resolvedPath || row.path || '');
    const status = normalizeManifestAssetStatus(row, hasReadablePath);
    const relativePath = hasReadablePath ? toProjectRelativePath(projectPath, resolvedPath) : null;
    metaAnalysisDb.upsertPdfAsset(userId, {
      metaProjectId: metaProject.id,
      referenceId: reference.id,
      source: row.source || (hasReadablePath ? 'manifest' : 'manual_upload'),
      status,
      filePath: relativePath,
      sha256: hasReadablePath ? await sha256File(resolvedPath) : null,
      licenseStatus: row.license_status || row.licenseStatus || row.oa_status || null,
      assetType: row.asset_type || typeInfo.assetType,
      contentType: row.content_type || typeInfo.contentType,
      originalFilename: row.original_filename || row.filename || null,
      sourceUrl: row.source_url || row.url || null,
      error: row.reason || row.error || null,
    });
    imported += 1;
  }
  return { rows, imported };
}

async function getFullTextAcquisitionQueue({ userId, metaProject, projectPath, artifactOptions = {} }) {
  const projectReferences = referencesDb.getProjectReferences(metaProject.project_id, userId);
  const manifestRows = await readFullTextManifestRows(projectPath, artifactOptions);
  if (manifestRows.length) {
    const lookupMaps = buildReferenceLookupMaps(projectReferences);
    const seen = new Set();
    const references = [];
    const rowByReferenceId = new Map();
    for (const row of manifestRows) {
      if (!isFullTextAcquisitionManifestRow(row)) continue;
      const reference = findReferenceForManifestRow(row, lookupMaps);
      if (!reference || seen.has(reference.id)) continue;
      seen.add(reference.id);
      references.push(reference);
      rowByReferenceId.set(reference.id, row);
    }
    return {
      source: 'manifest',
      hasManifest: true,
      references,
      rows: manifestRows,
      rowByReferenceId,
    };
  }

  const assets = metaAnalysisDb.listPdfAssets(userId, metaProject.id);
  const assetReferenceIds = [...new Set(assets.map((asset) => asset.reference_id).filter(Boolean))];
  const references = assetReferenceIds.length
    ? referencesDb.getReferencesByIds(userId, assetReferenceIds)
    : [];
  return {
    source: assetReferenceIds.length ? 'assets' : 'empty',
    hasManifest: false,
    references,
    rows: [],
    rowByReferenceId: new Map(),
  };
}

async function writeFullTextManifest({ projectPath, artifactOptions = {}, references = [], assets = [] }) {
  const fullTextReviewDir = getFullTextReviewDir(projectPath, artifactOptions);
  const assetByReference = new Map((assets || []).map((asset) => [asset.reference_id, asset]));
  const rows = references.map((reference, index) => {
    const asset = assetByReference.get(reference.id);
    return {
      input_index: index + 1,
      reference_id: reference.id,
      needs_full_text: true,
      pmid: reference.raw_data?.pmid || reference.raw_data?.PMID || '',
      doi: reference.doi || reference.raw_data?.doi || '',
      title: reference.title || '',
      status: asset?.status || 'not_checked',
      asset_type: normalizeFullTextAssetType(asset),
      source: asset?.source || '',
      source_url: asset?.source_url || '',
      path: asset?.file_path || '',
      license_status: asset?.license_status || '',
      reason: asset?.error || '',
      checked_at: new Date().toISOString(),
    };
  });
  const headers = ['input_index', 'reference_id', 'needs_full_text', 'pmid', 'doi', 'title', 'status', 'asset_type', 'source', 'source_url', 'path', 'license_status', 'reason', 'checked_at'];
  await fsPromises.mkdir(fullTextReviewDir, { recursive: true });
  await fsPromises.writeFile(path.join(fullTextReviewDir, 'fulltext_manifest.json'), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  await fsPromises.writeFile(
    path.join(fullTextReviewDir, 'fulltext_manifest.csv'),
    `${[headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')}\n`,
    'utf8',
  );
  await fsPromises.writeFile(path.join(fullTextReviewDir, 'pdf_manifest.json'), `${JSON.stringify(rows.filter((row) => row.asset_type === 'pdf'), null, 2)}\n`, 'utf8');
  return rows;
}

function csvEscape(value) {
  if (value == null) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatReferenceAuthors(authors) {
  if (!Array.isArray(authors)) return '';
  return authors
    .map((author) => {
      if (typeof author === 'string') return author;
      const family = String(author?.family || '').trim();
      const given = String(author?.given || '').trim();
      return [family, given].filter(Boolean).join(', ');
    })
    .filter(Boolean)
    .join('; ');
}

function inferReferenceDatabaseName(reference) {
  const source = String(reference?.source || '').trim();
  if (source) return source;
  const rawSource = String(reference?.raw_data?.databaseName || reference?.raw_data?.source || '').trim();
  return rawSource || 'library';
}

function inferReferencePmid(reference) {
  const raw = reference?.raw_data || {};
  const explicit = String(raw.pmid || raw.PMID || '').trim();
  if (explicit) return explicit;
  if (String(reference?.source || '').toLowerCase() === 'pubmed' && reference?.source_id) {
    return String(reference.source_id).replace(/^pmid[-_:]/i, '');
  }
  const citationKey = String(reference?.citation_key || '').trim();
  return /^\d+$/.test(citationKey) ? citationKey : '';
}

async function writeScreeningInputCsv({ userId, metaProject, projectPath, artifactOptions = {} }) {
  const dirs = getMetaStageDirs(projectPath, artifactOptions);
  const searchDedupeDir = path.join(projectPath, dirs.searchDedupe || dirs.literatureReferences || '02_search_dedupe');
  const screeningInputPath = path.join(searchDedupeDir, 'screening_input.csv');
  const references = referencesDb.getProjectReferences(metaProject.project_id, userId);
  const headers = [
    'reference_id',
    'databaseName',
    'pmid',
    'doi',
    'title',
    'year',
    'journal',
    'abstract',
    'authors',
    'url',
  ];
  const rows = references.map((reference) => ({
    reference_id: reference.id,
    databaseName: inferReferenceDatabaseName(reference),
    pmid: inferReferencePmid(reference),
    doi: reference.doi || '',
    title: reference.title || '',
    year: reference.year || '',
    journal: reference.journal || '',
    abstract: reference.abstract || '',
    authors: formatReferenceAuthors(reference.authors),
    url: reference.url || '',
  }));
  await fsPromises.mkdir(searchDedupeDir, { recursive: true });
  await fsPromises.writeFile(
    screeningInputPath,
    `${[
      headers.join(','),
      ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
    ].join('\n')}\n`,
    'utf8',
  );
  return {
    path: toProjectRelativePath(projectPath, screeningInputPath),
    count: rows.length,
  };
}

function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
}

async function resolveProjectContext(projectName, userId) {
  const project = projectDb.getProjectById(projectName);
  if (project?.user_id && project.user_id !== userId) {
    const error = new Error('Project not found');
    error.status = 404;
    throw error;
  }

  const projectPath = await extractProjectDirectory(projectName);
  if (!projectPath || !path.isAbsolute(projectPath)) {
    const error = new Error(`Project "${projectName}" is not resolved to an absolute path`);
    error.status = 400;
    throw error;
  }
  await fsPromises.access(projectPath);
  return {
    projectId: projectName,
    projectPath,
    project,
  };
}

async function loadMetaProject(req, res) {
  const metaProject = metaAnalysisDb.getMetaProject(req.user.id, req.params.metaProjectId);
  if (!metaProject) {
    res.status(404).json({ error: 'Meta analysis project not found' });
    return null;
  }
  return metaProject;
}

async function resolveMetaProjectContext(metaProject) {
  return resolveProjectContext(metaProject.project_id, metaProject.user_id);
}

function getMetaArtifactOptions(project, fallback = {}) {
  return {
    folderSchemaVersion: normalizeMetaFolderSchemaVersion(
      project?.metadata?.metaAnalysis?.folderSchemaVersion
      || fallback.folderSchemaVersion,
    ),
  };
}

function normalizeMetaReviewType(value) {
  return String(value || '').trim().toLowerCase();
}

function getDefaultPrimaryOutcomeForReviewType(reviewType) {
  if (reviewType === 'diagnostic') {
    return 'diagnostic accuracy';
  }
  return reviewType || null;
}

function filterReferencesByHumanScreeningGate({ userId, metaProject, references, artifactOptions }) {
  const decisions = metaAnalysisDb.listScreeningDecisions(userId, metaProject.id);
  return filterHumanReviewedFullTextCandidates(references, decisions);
}

function hasPassedHumanScreeningGate({ userId, metaProject, referenceId, artifactOptions }) {
  const decisions = metaAnalysisDb.listScreeningDecisions(userId, metaProject.id);
  return filterHumanReviewedFullTextCandidates([{ id: referenceId }], decisions).length === 1;
}

function isZoteroOnlySourceRequest(sources = []) {
  const normalized = (sources || []).map((source) => String(source || '').trim().toLowerCase()).filter(Boolean);
  return normalized.length === 1 && normalized[0] === 'zotero';
}

function shouldResolveZoteroFullTextAsset(asset) {
  if (!asset) return true;
  if (['downloaded', 'cached'].includes(asset.status)) return false;
  return ['not_checked', 'manual_upload_required', 'failed'].includes(asset.status);
}

async function resolveFullTextBatch(req, res) {
  if (!isZoteroOnlySourceRequest(req.body.sources || [])) {
    return {
      statusCode: 410,
      payload: {
        error: 'In-app full-text acquisition has been removed. Use sources: ["zotero"] to sync Zotero attachments only.',
      },
    };
  }
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return null;
  const { projectPath, project } = await resolveMetaProjectContext(metaProject);
  const artifactOptions = getMetaArtifactOptions(project);
  ensureMetaAnalysisProjectDirs(projectPath, artifactOptions);
  await syncFullTextManifestAssets({
    userId: req.user.id,
    metaProject,
    projectPath,
    artifactOptions,
  });
  const queue = await getFullTextAcquisitionQueue({
    userId: req.user.id,
    metaProject,
    projectPath,
    artifactOptions,
  });
  const queueReferenceIds = new Set(queue.references.map((reference) => reference.id));
  const requestedReferences = req.body.referenceIds?.length
    ? referencesDb.getReferencesByIds(req.user.id, req.body.referenceIds)
      .filter((reference) => queueReferenceIds.has(reference.id))
    : queue.references;
  const gatedReferences = filterReferencesByHumanScreeningGate({
    userId: req.user.id,
    metaProject,
    references: requestedReferences,
    artifactOptions,
  });
  const assetByReference = new Map(metaAnalysisDb.listPdfAssets(req.user.id, metaProject.id).map((asset) => [asset.reference_id, asset]));
  const references = gatedReferences.filter((reference) => shouldResolveZoteroFullTextAsset(assetByReference.get(reference.id)));

  const results = [];
  for (const reference of references) {
    results.push(await resolvePdfForReference({
      userId: req.user.id,
      metaProject,
      reference,
      projectPath,
      sources: ['zotero'],
      artifactOptions,
    }));
  }
  await writeFullTextManifest({
    projectPath,
    artifactOptions,
    references: filterReferencesByHumanScreeningGate({
      userId: req.user.id,
      metaProject,
      references: queue.references,
      artifactOptions,
    }),
    assets: metaAnalysisDb.listPdfAssets(req.user.id, metaProject.id),
  });

  return {
    total: results.length,
    queueSource: queue.source,
    skippedAcquisitionQueue: req.body.referenceIds?.length
      ? req.body.referenceIds.length - requestedReferences.length
      : 0,
    skippedScreeningAuthorization: requestedReferences.length - gatedReferences.length,
    skippedHumanReview: requestedReferences.length - gatedReferences.length,
    skippedAlreadyResolved: gatedReferences.length - references.length,
    downloaded: results.filter((item) => item.status === 'downloaded').length,
    cached: results.filter((item) => item.status === 'cached').length,
    manualUploadRequired: results.filter((item) => item.status === 'manual_upload_required').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results,
  };
}

function getAssetContentType(asset = {}) {
  const explicit = String(asset.content_type || '').trim();
  if (explicit) return explicit;
  const assetType = normalizeFullTextAssetType(asset);
  if (assetType === 'pdf') return 'application/pdf';
  if (assetType === 'markdown') return 'text/markdown';
  if (assetType === 'html') return 'text/html';
  if (assetType === 'text') return 'text/plain';
  return 'application/octet-stream';
}

function resolveReadyFullTextAssetPath({ projectPath, artifactOptions = {}, asset }) {
  if (!asset || !['downloaded', 'cached'].includes(asset.status) || !asset.file_path) return null;
  let resolved = null;
  try {
    resolved = resolveMetaProjectPath(projectPath, asset.file_path);
  } catch {
    return null;
  }
  if (!isPathInsideDir(getFullTextAssetRoot(projectPath, artifactOptions), resolved)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

function buildZoteroFullTextTags({ metaProject, missingAttachment }) {
  return [
    'medhelp',
    'medhelp:meta-full-text',
    `medhelp:project:${String(metaProject?.project_id || metaProject?.title || 'meta').slice(0, 80)}`,
    missingAttachment ? 'medhelp:fulltext-missing' : 'medhelp:fulltext-ready',
  ];
}

function getZoteroAttachmentTitle(reference, asset) {
  const type = normalizeFullTextAssetType(asset).toUpperCase();
  return `${type} full text - ${String(reference?.title || 'Untitled').slice(0, 140)}`;
}

function getDecisionCollectionName(decision) {
  if (decision === 'include') return 'Include';
  if (decision === 'maybe') return 'Maybe';
  if (decision === 'exclude') return 'Exclude';
  return 'Needs Review';
}

async function writeZoteroHandoffReport({ projectPath, artifactOptions = {}, filename, payload }) {
  const fullTextReviewDir = getFullTextReviewDir(projectPath, artifactOptions);
  const reportPath = path.join(fullTextReviewDir, filename);
  await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });
  await fsPromises.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return toProjectRelativePath(projectPath, reportPath);
}

async function writeScreeningDecisionArtifacts({ userId, metaProject, projectPath, artifactOptions = {} }) {
  const dirs = getMetaStageDirs(projectPath, artifactOptions);
  const screeningDir = path.join(projectPath, dirs.titleAbstractScreening || '03_title_abstract_screening');
  await fsPromises.mkdir(screeningDir, { recursive: true });
  const decisions = metaAnalysisDb.listScreeningDecisions(userId, metaProject.id);
  const references = referencesDb.getProjectReferences(metaProject.project_id, userId);
  const referenceById = new Map(references.map((reference) => [reference.id, reference]));
  const records = decisions
    .map((decision) => {
      const reference = referenceById.get(decision.reference_id) || {};
      return {
        reference_id: decision.reference_id,
        title: reference.title || '',
        doi: reference.doi || '',
        pmid: inferReferencePmid(reference) || '',
        stage: decision.stage,
        decision: decision.decision,
        reviewer: decision.reviewer || '',
        confidence: decision.confidence ?? '',
        reason: decision.reason || '',
        evidenceNote: decision.evidence_note || '',
        updated_at: decision.updated_at || '',
      };
    })
    .sort((left, right) => (
      String(left.stage).localeCompare(String(right.stage))
      || String(left.title).localeCompare(String(right.title))
      || String(left.reference_id).localeCompare(String(right.reference_id))
    ));
  const jsonPath = path.join(screeningDir, 'screening_decisions.json');
  await fsPromises.writeFile(jsonPath, `${JSON.stringify({
    schemaVersion: 'meta-screening-v1',
    generatedAt: new Date().toISOString(),
    records,
  }, null, 2)}\n`, 'utf8');
  const headers = ['reference_id', 'title', 'doi', 'pmid', 'stage', 'decision', 'reviewer', 'confidence', 'reason', 'evidenceNote', 'updated_at'];
  const csvPath = path.join(screeningDir, 'screening_decisions.csv');
  await fsPromises.writeFile(
    csvPath,
    `${[headers.join(','), ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(','))].join('\n')}\n`,
    'utf8',
  );
  return {
    jsonPath: toProjectRelativePath(projectPath, jsonPath),
    csvPath: toProjectRelativePath(projectPath, csvPath),
    records: records.length,
  };
}

async function exportFullTextToZotero(req, res) {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return null;
  const client = getZoteroWebClient(req.user.id);
  if (!client) {
    return {
      statusCode: 400,
      payload: {
        error: 'Zotero Web API credentials are not configured. Save active zotero_user_id and zotero_api_key credentials first.',
      },
    };
  }

  const { projectPath, project } = await resolveMetaProjectContext(metaProject);
  const artifactOptions = getMetaArtifactOptions(project);
  ensureMetaAnalysisProjectDirs(projectPath, artifactOptions);
  await syncFullTextManifestAssets({ userId: req.user.id, metaProject, projectPath, artifactOptions });
  const queue = await getFullTextAcquisitionQueue({ userId: req.user.id, metaProject, projectPath, artifactOptions });
  const queueReferenceIds = new Set(queue.references.map((reference) => reference.id));
  const requestedReferences = req.body?.referenceIds?.length
    ? referencesDb.getReferencesByIds(req.user.id, req.body.referenceIds).filter((reference) => queueReferenceIds.has(reference.id))
    : queue.references;
  const gatedReferences = filterReferencesByHumanScreeningGate({
    userId: req.user.id,
    metaProject,
    references: requestedReferences,
    artifactOptions,
  });
  const assets = metaAnalysisDb.listPdfAssets(req.user.id, metaProject.id);
  const assetByReference = new Map(assets.map((asset) => [asset.reference_id, asset]));
  const collections = await client.ensureMetaFullTextCollections(metaProject.title || metaProject.project_id);
  const results = [];

  for (const reference of gatedReferences) {
    const asset = assetByReference.get(reference.id);
    const readyPath = resolveReadyFullTextAssetPath({ projectPath, artifactOptions, asset });
    const existingExport = metaAnalysisDb.getZoteroExport(req.user.id, metaProject.id, reference.id);
    let zoteroItemKey = existingExport?.zotero_item_key || null;
    let zoteroAttachmentKey = existingExport?.zotero_attachment_key || null;
    const missingAttachment = !readyPath && !zoteroAttachmentKey;
    let matchReason = existingExport?.zotero_item_key ? 'existing_export_record' : null;

    try {
      const tags = buildZoteroFullTextTags({ metaProject, missingAttachment });
      if (!zoteroItemKey) {
        const matched = await client.findTopLevelItemForReference(reference);
        if (matched?.key) {
          zoteroItemKey = matched.key;
          matchReason = matched.matchReason || 'existing_zotero_match';
        }
      }
      if (zoteroItemKey) {
        await client.addItemToCollectionsAndTags(zoteroItemKey, [collections.needsReview.key], tags);
      } else {
        const created = await client.createReferenceItem(reference, {
          collections: [collections.needsReview.key],
          tags,
        });
        zoteroItemKey = created.key;
        matchReason = 'created';
      }

      if (readyPath && !zoteroAttachmentKey) {
        const uploaded = await client.uploadStoredAttachment({
          parentItemKey: zoteroItemKey,
          filePath: readyPath,
          title: getZoteroAttachmentTitle(reference, asset),
          contentType: getAssetContentType(asset),
          tags: ['medhelp:fulltext-asset'],
        });
        zoteroAttachmentKey = uploaded.key;
      }

      const record = metaAnalysisDb.upsertZoteroExport(req.user.id, {
        metaProjectId: metaProject.id,
        referenceId: reference.id,
        zoteroItemKey,
        zoteroAttachmentKey,
        collectionKey: collections.review.key,
        reviewCollectionKey: collections.needsReview.key,
        status: missingAttachment ? 'missing_attachment' : 'exported',
        missingAttachment,
        metadataJson: {
          source: 'meta_full_text_zotero_export',
          matchReason,
          assetId: asset?.id || null,
          assetPath: asset?.file_path || null,
          assetType: normalizeFullTextAssetType(asset),
          exportedAt: new Date().toISOString(),
        },
      });
      results.push({ referenceId: reference.id, title: reference.title, status: record.status, zoteroItemKey, zoteroAttachmentKey, missingAttachment, matchReason });
    } catch (error) {
      metaAnalysisDb.upsertZoteroExport(req.user.id, {
        metaProjectId: metaProject.id,
        referenceId: reference.id,
        zoteroItemKey,
        zoteroAttachmentKey,
        collectionKey: collections.review.key,
        reviewCollectionKey: collections.needsReview.key,
        status: 'failed',
        missingAttachment,
        error: error instanceof Error ? error.message : String(error),
        metadataJson: {
          source: 'meta_full_text_zotero_export',
          assetId: asset?.id || null,
          exportedAt: new Date().toISOString(),
        },
      });
      results.push({
        referenceId: reference.id,
        title: reference.title,
        status: 'failed',
        zoteroItemKey,
        zoteroAttachmentKey,
        missingAttachment,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const payload = {
    total: results.length,
    queueSource: queue.source,
    skippedAcquisitionQueue: req.body?.referenceIds?.length ? req.body.referenceIds.length - requestedReferences.length : 0,
    skippedScreeningAuthorization: requestedReferences.length - gatedReferences.length,
    collection: {
      rootKey: collections.root.key,
      projectKey: collections.project.key,
      reviewKey: collections.review.key,
      needsReviewKey: collections.needsReview.key,
      path: `MedHelp/${metaProject.title || metaProject.project_id}/04 Full Text Review/Needs Review`,
    },
    exported: results.filter((item) => item.status === 'exported').length,
    missingAttachment: results.filter((item) => item.status === 'missing_attachment').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results,
  };
  payload.reportPath = await writeZoteroHandoffReport({
    projectPath,
    artifactOptions,
    filename: 'zotero_handoff_report.json',
    payload: {
      schemaVersion: 'meta-zotero-handoff-v1',
      generatedAt: new Date().toISOString(),
      ...payload,
    },
  });
  return { statusCode: 200, payload };
}

async function importFullTextDecisionsFromZotero(req, res) {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return null;
  const client = getZoteroWebClient(req.user.id);
  if (!client) {
    return {
      statusCode: 400,
      payload: {
        error: 'Zotero Web API credentials are not configured. Save active zotero_user_id and zotero_api_key credentials first.',
      },
    };
  }

  const { projectPath, project } = await resolveMetaProjectContext(metaProject);
  const artifactOptions = getMetaArtifactOptions(project);
  ensureMetaAnalysisProjectDirs(projectPath, artifactOptions);
  const collections = await client.ensureMetaFullTextCollections(metaProject.title || metaProject.project_id);
  const decisionCollections = [
    { decision: 'include', collection: collections.include },
    { decision: 'maybe', collection: collections.maybe },
    { decision: 'exclude', collection: collections.exclude },
  ];
  const priorities = { include: 3, maybe: 2, exclude: 1 };
  const memberships = new Map();
  for (const { decision, collection } of decisionCollections) {
    const keys = await client.listCollectionTopLevelItemKeys(collection.key);
    for (const key of keys) {
      const item = memberships.get(key) || { itemKey: key, decisions: [] };
      item.decisions.push(decision);
      memberships.set(key, item);
    }
  }

  const conflicts = [];
  const decisionByItemKey = new Map();
  for (const membership of memberships.values()) {
    const unique = [...new Set(membership.decisions)];
    unique.sort((left, right) => priorities[right] - priorities[left]);
    if (unique.length > 1) {
      conflicts.push({ zoteroItemKey: membership.itemKey, decisions: unique });
    }
    decisionByItemKey.set(membership.itemKey, unique[0]);
  }

  const exports = metaAnalysisDb.listZoteroExports(req.user.id, metaProject.id);
  const exportByItemKey = new Map(exports.filter((row) => row.zotero_item_key).map((row) => [row.zotero_item_key, row]));
  const synced = [];
  const unmatchedZoteroItems = [];
  for (const [itemKey, decision] of decisionByItemKey.entries()) {
    const exported = exportByItemKey.get(itemKey);
    if (!exported) {
      unmatchedZoteroItems.push(itemKey);
      continue;
    }
    const collectionName = getDecisionCollectionName(decision);
    const upserted = metaAnalysisDb.upsertScreeningDecision(req.user.id, {
      metaProjectId: metaProject.id,
      referenceId: exported.reference_id,
      stage: 'full_text',
      decision,
      reviewer: 'user',
      reason: `Synced from Zotero collection: ${collectionName}`,
      evidenceNote: '',
      confidence: 1,
      metadataJson: {
        source: 'zotero_collection',
        zoteroItemKey: itemKey,
        zoteroCollection: collectionName,
        syncedAt: new Date().toISOString(),
      },
    });
    synced.push(upserted);
  }

  const artifactWrite = await writeScreeningDecisionArtifacts({
    userId: req.user.id,
    metaProject,
    projectPath,
    artifactOptions,
  });
  const payload = {
    synced: synced.length,
    decisions: {
      include: synced.filter((item) => item.decision === 'include').length,
      maybe: synced.filter((item) => item.decision === 'maybe').length,
      exclude: synced.filter((item) => item.decision === 'exclude').length,
    },
    conflicts,
    unmatchedZoteroItems,
    artifacts: artifactWrite,
  };
  payload.reportPath = await writeZoteroHandoffReport({
    projectPath,
    artifactOptions,
    filename: 'zotero_decision_sync_report.json',
    payload: {
      schemaVersion: 'meta-zotero-decision-sync-v1',
      generatedAt: new Date().toISOString(),
      ...payload,
    },
  });
  return { statusCode: 200, payload };
}

function buildOverview(userId, metaProject, artifactRoots = META_STAGE_DIRS) {
  const references = referencesDb.getProjectReferences(metaProject.project_id, userId);
  const searchRuns = metaAnalysisDb.listSearchRuns(userId, metaProject.id);
  const screening = metaAnalysisDb.listScreeningDecisions(userId, metaProject.id);
  const pdfAssets = metaAnalysisDb.listPdfAssets(userId, metaProject.id);
  const parsedDocuments = metaAnalysisDb.listParsedDocuments(userId, metaProject.id);
  const extractions = metaAnalysisDb.listExtractionResults(userId, metaProject.id);
  const analysisRuns = metaAnalysisDb.listAnalysisRuns(userId, metaProject.id);
  const manuscriptSections = metaAnalysisDb.listManuscriptSections(userId, metaProject.id);
  const screeningStatus = countScreeningWorkflowStatus(references, screening);
  const confirmedExtractions = extractions.filter((row) => row.review_status === 'confirmed').length;
  const needsReviewExtractions = extractions.filter((row) => row.review_status === 'needs_review' || row.review_status === 'candidate').length;

  return {
    metaProject,
    artifactRoots,
    dashboardSummary: {
      sources: {
        total: references.length,
        searchRuns: searchRuns.length,
        withCachedPdf: references.filter((ref) => Number(ref.pdf_cached || 0) > 0).length,
      },
      confirmed: {
        total: screeningStatus.agentReviewed + screeningStatus.userAuthorized + confirmedExtractions,
        screening: screeningStatus.agentReviewed + screeningStatus.userAuthorized,
        extractions: confirmedExtractions,
        pendingReview: screeningStatus.pendingAgentReview + needsReviewExtractions,
      },
      records: {
        screeningDecisions: screening.length,
        pdfAssets: pdfAssets.length,
        parsedDocuments: parsedDocuments.length,
        extractionResults: extractions.length,
        analysisRuns: analysisRuns.length,
        manuscriptSections: manuscriptSections.length,
      },
    },
    counts: {
      references: {
        total: references.length,
        withCachedPdf: references.filter((ref) => Number(ref.pdf_cached || 0) > 0).length,
      },
      searchRuns: { total: searchRuns.length },
      screening: countBy(screening, 'decision'),
      screeningStatus,
      pdfAssets: countBy(pdfAssets, 'status'),
      parsedDocuments: countBy(parsedDocuments, 'status'),
      extractions: countBy(extractions, 'review_status'),
      analysisRuns: countBy(analysisRuns, 'status'),
      manuscriptSections: { total: manuscriptSections.length },
    },
  };
}

function findExistingPubMedReference(userId, record) {
  if (record.doi) {
    const byDoi = db.prepare('SELECT id FROM references_library WHERE user_id = ? AND LOWER(doi) = LOWER(?) LIMIT 1').get(userId, record.doi);
    if (byDoi?.id) return byDoi.id;
  }
  if (record.pmid) {
    const bySource = db.prepare('SELECT id FROM references_library WHERE user_id = ? AND source = ? AND source_id = ? LIMIT 1').get(userId, 'pubmed', record.pmid);
    if (bySource?.id) return bySource.id;
  }
  const normalized = normalizeTitle(record.title);
  if (normalized) {
    const rows = db.prepare('SELECT id, title FROM references_library WHERE user_id = ?').all(userId);
    const byTitle = rows.find((row) => normalizeTitle(row.title) === normalized);
    if (byTitle?.id) return byTitle.id;
  }
  return null;
}

function importPubMedRecords(userId, records) {
  const importedIds = [];
  const duplicateIds = [];
  const newItems = [];

  for (const record of records) {
    const existingId = findExistingPubMedReference(userId, record);
    if (existingId) {
      duplicateIds.push(existingId);
      importedIds.push(existingId);
      continue;
    }
    newItems.push({
      citationKey: record.pmid,
      title: record.title,
      authors: record.authors,
      year: record.year,
      abstract: record.abstract,
      doi: record.doi,
      url: record.url,
      journal: record.journal,
      itemType: 'article',
      keywords: ['PubMed'],
      rawData: {
        pmid: record.pmid,
        pmcid: record.pmcid,
        doi: record.doi,
        source: 'pubmed',
        raw: record.raw,
      },
    });
  }

  if (newItems.length > 0) {
    importedIds.push(...referencesDb.importReferences(userId, newItems, 'pubmed', { libraryVisible: false }));
  }

  return {
    referenceIds: [...new Set(importedIds)],
    importedCount: newItems.length,
    duplicates: duplicateIds.length,
  };
}

async function writeDiagnosticDataset({ userId, metaProject, projectPath, artifactOptions = {} }) {
  const paths = getMetaDatasetPaths(projectPath, artifactOptions);
  await fsPromises.mkdir(paths.datasetsDir, { recursive: true });
  const references = referencesDb.getProjectReferences(metaProject.project_id, userId);
  const referenceById = new Map(references.map((ref) => [ref.id, ref]));
  const rows = metaAnalysisDb
    .listExtractionResults(userId, metaProject.id, { extractionType: 'diagnostic' })
    .filter((row) => row.review_status === 'confirmed' && row.field_name === 'diagnosticData');

  const headers = [
    'study_id',
    'reference_id',
    'first_author',
    'year',
    'country',
    'cancer_type',
    'biomarker',
    'sample_type',
    'assay_method',
    'cutoff',
    'TP',
    'FP',
    'FN',
    'TN',
    'sensitivity',
    'specificity',
    'AUC',
    'source_page',
    'source_table',
    'review_status',
  ];

  const completeRows = [];
  const excludedRows = [];

  rows.forEach((row, index) => {
    const ref = referenceById.get(row.reference_id);
    const normalized = normalizeDiagnosticExtractionValue(row.value_json || {});
    const output = {
      study_id: normalized.firstAuthor || ref?.title || `study_${index + 1}`,
      reference_id: row.reference_id,
      first_author: normalized.firstAuthor || '',
      year: normalized.year || ref?.year || '',
      country: normalized.country || '',
      cancer_type: normalized.cancerType || '',
      biomarker: normalized.biomarker || metaProject.biomarker || '',
      sample_type: normalized.sampleType || '',
      assay_method: normalized.assayMethod || '',
      cutoff: normalized.cutoff || '',
      TP: normalized.TP,
      FP: normalized.FP,
      FN: normalized.FN,
      TN: normalized.TN,
      sensitivity: normalized.sensitivity ?? '',
      specificity: normalized.specificity ?? '',
      AUC: normalized.AUC ?? '',
      source_page: row.page ?? '',
      source_table: row.table_label || '',
      review_status: row.review_status,
    };
    const has2x2 = ['TP', 'FP', 'FN', 'TN'].every((field) => output[field] !== null && output[field] !== '');
    if (has2x2) completeRows.push(output);
    else excludedRows.push(output);
  });

  const serialize = (items) => [
    headers.join(','),
    ...items.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');

  await Promise.all([
    fsPromises.writeFile(paths.diagnosticDatasetPath, `${serialize(completeRows)}\n`, 'utf8'),
    fsPromises.writeFile(paths.diagnosticExcludedDatasetPath, `${serialize(excludedRows)}\n`, 'utf8'),
  ]);

  return {
    datasetPath: toProjectRelativePath(projectPath, paths.diagnosticDatasetPath),
    excludedDatasetPath: toProjectRelativePath(projectPath, paths.diagnosticExcludedDatasetPath),
    includedCount: completeRows.length,
    excludedCount: excludedRows.length,
  };
}

async function readOutputJson(projectPath, outputPath) {
  try {
    const resolved = resolveMetaProjectPath(projectPath, outputPath);
    return JSON.parse(await fsPromises.readFile(resolved, 'utf8'));
  } catch {
    return null;
  }
}

router.get('/project/:projectName', async (req, res) => {
  try {
    await resolveProjectContext(req.params.projectName, req.user.id);
    const metaProject = metaAnalysisDb.getMetaProjectByProjectId(req.user.id, req.params.projectName);
    res.json({ metaProject });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load meta analysis project' });
  }
});

router.post('/project/:projectName/init', async (req, res) => {
  try {
    const { projectId, projectPath, project } = await resolveProjectContext(req.params.projectName, req.user.id);
    const artifactOptions = getMetaArtifactOptions(project, req.body || {});
    ensureMetaAnalysisProjectDirs(projectPath, artifactOptions);
    const existing = metaAnalysisDb.getMetaProjectByProjectId(req.user.id, projectId);
    if (existing) {
      return res.json({ metaProject: existing, created: false });
    }

    const reviewType = normalizeMetaReviewType(req.body.reviewType);
    const metaProject = metaAnalysisDb.createMetaProject(req.user.id, {
      projectId,
      reviewType,
      title: req.body.title || `${req.params.projectName} Meta project`,
      disease: req.body.disease || '',
      biomarker: req.body.biomarker || '',
      population: req.body.population || '',
      indexTest: req.body.indexTest || '',
      referenceStandard: req.body.referenceStandard || '',
      primaryOutcome: req.body.primaryOutcome ?? getDefaultPrimaryOutcomeForReviewType(reviewType),
      protocolJson: req.body.protocolJson || {},
    });

    res.json({ metaProject, created: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to initialize meta analysis project' });
  }
});

router.patch('/:metaProjectId', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const updated = metaAnalysisDb.updateMetaProject(req.user.id, metaProject.id, req.body || {});
    res.json({ metaProject: updated });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update meta analysis project' });
  }
});

router.get('/:metaProjectId/overview', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const { projectPath, project } = await resolveMetaProjectContext(metaProject);
    res.json(buildOverview(req.user.id, metaProject, getMetaStageDirs(projectPath, getMetaArtifactOptions(project))));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load overview' });
  }
});

router.post('/:metaProjectId/search/query-builder', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  const source = resolveMetaSearchSource(req.body.databaseName || req.body.sourceId || 'pubmed');
  if (source.id !== 'pubmed') {
    return res.status(400).json({
      error: `${source.label} is not supported by the PubMed query builder. Follow the project memory source-routing rules or import records explicitly.`,
      source,
    });
  }
  res.json(buildPubMedQuery({
    disease: req.body.disease ?? metaProject.disease,
    biomarker: req.body.biomarker ?? metaProject.biomarker,
    reviewType: req.body.reviewType ?? metaProject.review_type,
  }));
});

router.get('/:metaProjectId/search/sources', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({
    defaultSourceId: getDefaultMetaSearchSourceId(),
    sources: getMetaSearchSourcePolicy(),
  });
});

router.post('/:metaProjectId/search/pubmed', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const source = resolveMetaSearchSource(req.body.databaseName || req.body.sourceId || 'pubmed');
    if (source.id !== 'pubmed') {
      return res.status(400).json({
        error: `${source.label} is not supported by the PubMed search endpoint. Follow the project memory source-routing rules or import records explicitly.`,
        source,
      });
    }
    const { projectPath, project } = await resolveMetaProjectContext(metaProject);
    const artifactOptions = getMetaArtifactOptions(project);
    const artifactDirs = ensureMetaAnalysisProjectDirs(projectPath, artifactOptions);
    const query = String(req.body.query || '').trim();
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const searchResult = await searchPubMed(query, { retmax: req.body.retmax || 200 });
    const records = await fetchPubMedSummaries(searchResult.ids);
    const imported = importPubMedRecords(req.user.id, records);
    const linkedCount = referencesDb.bulkLinkIds(metaProject.project_id, imported.referenceIds);
    const screeningInput = await writeScreeningInputCsv({
      userId: req.user.id,
      metaProject,
      projectPath,
      artifactOptions,
    });
    const searchRunId = `meta_search_${crypto.randomUUID()}`;
    const rawPath = path.join(artifactDirs.pubmedRunsDir, `${searchRunId}.json`);
    await fsPromises.writeFile(rawPath, `${JSON.stringify({ query, searchResult, records }, null, 2)}\n`, 'utf8');
    const searchRun = metaAnalysisDb.createSearchRun(req.user.id, {
      id: searchRunId,
      metaProjectId: metaProject.id,
      databaseName: 'pubmed',
      queryText: query,
      resultCount: searchResult.count,
      importedCount: imported.importedCount,
      rawResponsePath: toProjectRelativePath(projectPath, rawPath),
      metadataJson: {
        linkedCount,
        duplicates: imported.duplicates,
      },
    });

    res.json({
      searchRunId: searchRun.id,
      resultCount: searchResult.count,
      importedCount: imported.importedCount,
      linkedCount,
      duplicates: imported.duplicates,
      screeningInputPath: screeningInput.path,
      screeningInputCount: screeningInput.count,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'PubMed search failed' });
  }
});

router.get('/:metaProjectId/search-runs', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({ searchRuns: metaAnalysisDb.listSearchRuns(req.user.id, metaProject.id) });
});

router.post('/:metaProjectId/artifacts/sync', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const { projectPath, project } = await resolveMetaProjectContext(metaProject);
    const sync = await syncMetaArtifacts({
      userId: req.user.id,
      metaProject,
      projectPath,
      artifactOptions: getMetaArtifactOptions(project),
    });
    res.json({ sync });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to sync meta artifacts' });
  }
});

router.get('/:metaProjectId/references', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({ references: referencesDb.getProjectReferences(metaProject.project_id, req.user.id) });
});

router.get('/:metaProjectId/screening', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  const references = referencesDb.getProjectReferences(metaProject.project_id, req.user.id);
  const decisions = metaAnalysisDb.listScreeningDecisions(req.user.id, metaProject.id);
  if (req.query.limit !== undefined || req.query.offset !== undefined) {
    const limit = parsePositiveInteger(req.query.limit, 100, { min: 1, max: 500 });
    const offset = parsePositiveInteger(req.query.offset, 0, { min: 0 });
    return res.json(buildPaginatedScreeningPayload({ references, decisions, limit, offset }));
  }
  res.json({
    references,
    decisions,
  });
});

router.post('/:metaProjectId/screening/sync-artifacts', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const { projectPath, project } = await resolveMetaProjectContext(metaProject);
    const artifacts = await syncMetaArtifacts({
      userId: req.user.id,
      metaProject,
      projectPath,
      artifactOptions: getMetaArtifactOptions(project),
    });
    res.json({ sync: artifacts.screening, screening: artifacts.screening, artifacts });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to sync screening artifact' });
  }
});

router.post('/:metaProjectId/screening/:referenceId', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  const stage = req.body.stage || 'title_abstract';
  const decision = req.body.decision || 'maybe';
  if (!VALID_SCREENING_STAGES.has(stage) || !VALID_SCREENING_DECISIONS.has(decision)) {
    return res.status(400).json({ error: 'Invalid screening stage or decision' });
  }
  const reference = referencesDb.getReference(req.params.referenceId, req.user.id);
  if (!reference) {
    return res.status(404).json({ error: 'Reference not found' });
  }
  const screeningPayload = {
    metaProjectId: metaProject.id,
    referenceId: reference.id,
    stage,
    decision,
    reason: req.body.reason || '',
    reviewer: req.body.reviewer || req.user.username || 'user',
    evidenceNote: req.body.evidenceNote || '',
  };
  if (Object.prototype.hasOwnProperty.call(req.body, 'confidence')) {
    screeningPayload.confidence = req.body.confidence;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'metadataJson') || Object.prototype.hasOwnProperty.call(req.body, 'metadata_json')) {
    screeningPayload.metadataJson = req.body.metadataJson || req.body.metadata_json || null;
  }
  const screeningDecision = metaAnalysisDb.upsertScreeningDecision(req.user.id, screeningPayload);
  res.json({ decision: screeningDecision });
});

router.get('/:metaProjectId/full-text-assets', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const { projectPath, project } = await resolveMetaProjectContext(metaProject);
    const artifactOptions = getMetaArtifactOptions(project);
    await syncFullTextManifestAssets({
      userId: req.user.id,
      metaProject,
      projectPath,
      artifactOptions,
    });
    const fullTextAssets = metaAnalysisDb.listPdfAssets(req.user.id, metaProject.id);
    res.json({
      fullTextAssets,
      pdfAssets: fullTextAssets,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Full-text asset sync failed' });
  }
});

router.post('/:metaProjectId/full-text/resolve-batch', async (req, res) => {
  try {
    const payload = await resolveFullTextBatch(req, res);
    if (!payload) return;
    if (payload.payload) {
      return res.status(payload.statusCode || 200).json(payload.payload);
    }
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Full-text resolution failed' });
  }
});

router.post('/:metaProjectId/full-text/zotero/export', async (req, res) => {
  try {
    const result = await exportFullTextToZotero(req, res);
    if (!result) return;
    res.status(result.statusCode || 200).json(result.payload);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Zotero full-text export failed' });
  }
});

router.post('/:metaProjectId/full-text/zotero/import-decisions', async (req, res) => {
  try {
    const result = await importFullTextDecisionsFromZotero(req, res);
    if (!result) return;
    res.status(result.statusCode || 200).json(result.payload);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Zotero full-text decision import failed' });
  }
});

router.get('/:metaProjectId/references/:referenceId/pdf', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const { projectPath, project } = await resolveMetaProjectContext(metaProject);
    const artifactOptions = getMetaArtifactOptions(project);
    const reference = referencesDb.getReference(req.params.referenceId, req.user.id);
    const asset = metaAnalysisDb.getPdfAsset(req.user.id, metaProject.id, req.params.referenceId);
    const paths = getMetaReferencePaths(projectPath, req.params.referenceId, {
      ...artifactOptions,
      referenceTitle: reference?.title,
    });
    const pdfPath = asset?.file_path
      ? resolveMetaProjectPath(projectPath, asset.file_path)
      : paths.pdfPath;
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'PDF not found' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    fs.createReadStream(pdfPath).pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to serve PDF' });
  }
});

router.get('/:metaProjectId/parsed-documents', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({ parsedDocuments: metaAnalysisDb.listParsedDocuments(req.user.id, metaProject.id) });
});

router.patch('/:metaProjectId/parsed-documents/:referenceId/review', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const existing = metaAnalysisDb.getParsedDocument(req.user.id, metaProject.id, req.params.referenceId);
    if (!existing || !['parsed', 'reviewed'].includes(existing.status)) {
      return res.status(409).json({ error: 'A parsed MinerU document is required before parse-quality review' });
    }
    const reviewed = metaAnalysisDb.upsertParsedDocument(req.user.id, {
      metaProjectId: metaProject.id,
      referenceId: existing.reference_id,
      pdfAssetId: existing.pdf_asset_id,
      parser: existing.parser,
      status: 'reviewed',
      markdownPath: existing.markdown_path,
      tablesPath: existing.tables_path,
      figuresDir: existing.figures_dir,
      pageMapPath: existing.page_map_path,
      parseReportPath: existing.parse_report_path,
      qualityScore: existing.quality_score,
      error: null,
    });
    res.json({ parsedDocument: reviewed });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Parse review failed' });
  }
});

router.post('/:metaProjectId/parse/batch', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const { projectPath, project } = await resolveMetaProjectContext(metaProject);
    const artifactOptions = getMetaArtifactOptions(project);
    await syncFullTextManifestAssets({
      userId: req.user.id,
      metaProject,
      projectPath,
      artifactOptions,
    });
    const queue = await getFullTextAcquisitionQueue({
      userId: req.user.id,
      metaProject,
      projectPath,
      artifactOptions,
    });
    const queueReferenceIds = new Set(queue.references.map((reference) => reference.id));
    const references = (req.body.referenceIds?.length
      ? referencesDb.getReferencesByIds(req.user.id, req.body.referenceIds)
      : referencesDb.getReferencesByIds(
        req.user.id,
        metaAnalysisDb
          .listPdfAssets(req.user.id, metaProject.id)
          .filter((asset) => ['downloaded', 'cached'].includes(asset.status) && asset.file_path)
          .map((asset) => asset.reference_id),
      )).filter((reference) => queueReferenceIds.has(reference.id));
    const results = [];

    for (const reference of references) {
      const existing = metaAnalysisDb.getParsedDocument(req.user.id, metaProject.id, reference.id);
      if (['parsed', 'reviewed'].includes(existing?.status) && !req.body.force) {
        results.push(existing);
        continue;
      }
      const pdfAsset = metaAnalysisDb.getPdfAsset(req.user.id, metaProject.id, reference.id);
      const referencePaths = getMetaReferencePaths(projectPath, reference.id, {
        ...artifactOptions,
        referenceTitle: reference.title,
      });
      if (!hasPassedHumanScreeningGate({
        userId: req.user.id,
        metaProject,
        referenceId: reference.id,
        artifactOptions,
      })) {
        results.push(metaAnalysisDb.upsertParsedDocument(req.user.id, {
          metaProjectId: metaProject.id,
          referenceId: reference.id,
          pdfAssetId: pdfAsset?.id || null,
          status: 'failed',
          error: 'Title/abstract AI second-screen or user override include/maybe decision is required before full-text parsing',
        }));
        continue;
      }
      if (!isPdfHumanAudited(pdfAsset, { requireExplicitAudit: false })) {
        results.push(metaAnalysisDb.upsertParsedDocument(req.user.id, {
          metaProjectId: metaProject.id,
          referenceId: reference.id,
          pdfAssetId: pdfAsset?.id || null,
          status: 'failed',
          error: 'Full-text source/upload authorization is required before parsing',
        }));
        continue;
      }
      const pdfPath = pdfAsset?.file_path
        ? resolveMetaProjectPath(projectPath, pdfAsset.file_path)
        : referencePaths.pdfPath;
      if (!isPathInsideDir(getFullTextAssetRoot(projectPath, artifactOptions), pdfPath)) {
        results.push(metaAnalysisDb.upsertParsedDocument(req.user.id, {
          metaProjectId: metaProject.id,
          referenceId: reference.id,
          pdfAssetId: pdfAsset?.id || null,
          status: 'failed',
          error: 'Full-text parsing is restricted to 04_full_text_review/fulltext/',
        }));
        continue;
      }
      if (!fs.existsSync(pdfPath)) {
        results.push(metaAnalysisDb.upsertParsedDocument(req.user.id, {
          metaProjectId: metaProject.id,
          referenceId: reference.id,
          pdfAssetId: pdfAsset?.id || null,
          status: 'failed',
          error: 'Audited full-text file was not found on disk',
        }));
        continue;
      }
      const assetType = normalizeFullTextAssetType(pdfAsset);
      if (DIRECT_PARSED_ASSET_TYPES.has(assetType)) {
        const parsed = await registerDirectParsedFullTextAsset({
          userId: req.user.id,
          metaProject,
          projectPath,
          reference,
          asset: pdfAsset,
          artifactOptions,
        });
        results.push(parsed || metaAnalysisDb.upsertParsedDocument(req.user.id, {
          metaProjectId: metaProject.id,
          referenceId: reference.id,
          pdfAssetId: pdfAsset?.id || null,
          status: 'failed',
          error: 'Direct full-text asset could not be converted to Markdown',
        }));
        continue;
      }
      if (assetType !== 'pdf') {
        results.push(metaAnalysisDb.upsertParsedDocument(req.user.id, {
          metaProjectId: metaProject.id,
          referenceId: reference.id,
          pdfAssetId: pdfAsset?.id || null,
          status: 'failed',
          error: `Unsupported full-text asset type: ${assetType}`,
        }));
        continue;
      }
      metaAnalysisDb.upsertParsedDocument(req.user.id, {
        metaProjectId: metaProject.id,
        referenceId: reference.id,
        pdfAssetId: pdfAsset?.id || null,
        status: 'running',
      });
      const parsed = await parsePdfWithMinerU({
        pdfPath,
        outputDir: referencePaths.mineruDir,
        outputBasename: referencePaths.artifactBasename,
        options: req.body.options || {},
        userId: req.user.id,
      });
      results.push(metaAnalysisDb.upsertParsedDocument(req.user.id, {
        metaProjectId: metaProject.id,
        referenceId: reference.id,
        pdfAssetId: pdfAsset?.id || null,
        parser: 'mineru',
        status: parsed.status,
        markdownPath: parsed.markdownPath ? toProjectRelativePath(projectPath, parsed.markdownPath) : null,
        tablesPath: parsed.tablesPath ? toProjectRelativePath(projectPath, parsed.tablesPath) : null,
        figuresDir: parsed.figuresDir ? toProjectRelativePath(projectPath, parsed.figuresDir) : null,
        pageMapPath: parsed.pageMapPath ? toProjectRelativePath(projectPath, parsed.pageMapPath) : null,
        parseReportPath: parsed.parseReportPath ? toProjectRelativePath(projectPath, parsed.parseReportPath) : null,
        qualityScore: parsed.qualityScore || 0,
        error: parsed.error || null,
      }));
    }

    res.json({ total: results.length, results });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Parse batch failed' });
  }
});

router.get('/:metaProjectId/references/:referenceId/markdown', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  const { projectPath } = await resolveMetaProjectContext(metaProject);
  const parsed = metaAnalysisDb.getParsedDocument(req.user.id, metaProject.id, req.params.referenceId);
  if (!parsed?.markdown_path) return res.status(404).json({ error: 'Markdown not found' });
  res.type('text/markdown').send(await fsPromises.readFile(resolveMetaProjectPath(projectPath, parsed.markdown_path), 'utf8'));
});

router.get('/:metaProjectId/references/:referenceId/tables', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  const { projectPath } = await resolveMetaProjectContext(metaProject);
  const parsed = metaAnalysisDb.getParsedDocument(req.user.id, metaProject.id, req.params.referenceId);
  if (!parsed?.tables_path) return res.status(404).json({ error: 'Tables not found' });
  res.json(JSON.parse(await fsPromises.readFile(resolveMetaProjectPath(projectPath, parsed.tables_path), 'utf8')));
});

router.post('/:metaProjectId/extract/diagnostic', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const { project } = await resolveMetaProjectContext(metaProject);
    const artifactOptions = getMetaArtifactOptions(project);
    const references = req.body.referenceIds?.length
      ? referencesDb.getReferencesByIds(req.user.id, req.body.referenceIds)
      : referencesDb.getProjectReferences(metaProject.project_id, req.user.id);
    const created = [];
    let skippedParseReview = 0;
    for (const reference of references) {
      const parsedDocument = metaAnalysisDb.getParsedDocument(req.user.id, metaProject.id, reference.id);
      if (!isParsedDocumentQualityReviewed(parsedDocument, { requireExplicitReview: false })) {
        skippedParseReview += 1;
        continue;
      }
      if (!req.body.force) {
        const existing = metaAnalysisDb.listExtractionResults(req.user.id, metaProject.id, {
          referenceId: reference.id,
          extractionType: 'diagnostic',
        });
        if (existing.length > 0) {
          created.push(...existing);
          continue;
        }
      }
      const candidates = extractDiagnosticCandidates({ reference, parsedDocument });
      for (const candidate of candidates) {
        created.push(metaAnalysisDb.createExtractionResult(req.user.id, {
          metaProjectId: metaProject.id,
          referenceId: reference.id,
          ...candidate,
        }));
      }
    }
    res.json({ extractionResults: created, skippedParseReview });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Diagnostic extraction failed' });
  }
});

router.get('/:metaProjectId/extractions', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({
    extractionResults: metaAnalysisDb.listExtractionResults(req.user.id, metaProject.id, {
      reviewStatus: req.query.reviewStatus,
      referenceId: req.query.referenceId,
      extractionType: req.query.extractionType,
    }),
  });
});

router.patch('/:metaProjectId/extractions/:extractionId', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  const updated = metaAnalysisDb.updateExtractionReviewStatus(req.user.id, req.params.extractionId, req.body || {});
  if (!updated || updated.meta_project_id !== metaProject.id) {
    return res.status(404).json({ error: 'Extraction result not found' });
  }
  res.json({ extractionResult: updated });
});

router.post('/:metaProjectId/datasets/diagnostic', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const { projectPath, project } = await resolveMetaProjectContext(metaProject);
    res.json(await writeDiagnosticDataset({
      userId: req.user.id,
      metaProject,
      projectPath,
      artifactOptions: getMetaArtifactOptions(project),
    }));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to export diagnostic dataset' });
  }
});

router.post('/:metaProjectId/analysis/diagnostic/run', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const { projectPath, project } = await resolveMetaProjectContext(metaProject);
    const artifactOptions = getMetaArtifactOptions(project);
    const dataset = await writeDiagnosticDataset({ userId: req.user.id, metaProject, projectPath, artifactOptions });
    const analysisRunId = `meta_run_${crypto.randomUUID()}`;
    const runDir = getMetaAnalysisRunDir(projectPath, analysisRunId, artifactOptions);
    await fsPromises.mkdir(runDir, { recursive: true });
    const datasetPaths = getMetaDatasetPaths(projectPath, artifactOptions);
    const inputCsvPath = path.join(runDir, 'input.csv');
    await fsPromises.copyFile(datasetPaths.diagnosticDatasetPath, inputCsvPath);
    const scriptPath = path.resolve('scripts/r/meta-analysis/diagnostic_meta.R');
    const analysisRun = metaAnalysisDb.createAnalysisRun(req.user.id, {
      id: analysisRunId,
      metaProjectId: metaProject.id,
      analysisType: 'diagnostic',
      model: req.body.model || 'fixed_descriptive',
      inputDatasetPath: toProjectRelativePath(projectPath, inputCsvPath),
      scriptPath,
      outputJsonPath: toProjectRelativePath(projectPath, path.join(runDir, 'output.json')),
      figuresJson: ['forest_sensitivity.png', 'forest_specificity.png', 'sroc.png', 'deeks_funnel.png'],
      status: 'running',
    });
    const result = await runDiagnosticMetaAnalysis({ inputCsvPath, outputDir: runDir, scriptPath });
    const publicationPaths = getMetaPublicationPaths(projectPath, artifactOptions);
    await fsPromises.mkdir(publicationPaths.figuresDir, { recursive: true });
    const figureNames = ['forest_sensitivity.png', 'forest_specificity.png', 'sroc.png', 'deeks_funnel.png'];
    const figurePaths = [];
    for (const figureName of figureNames) {
      const sourceFigurePath = path.join(runDir, figureName);
      if (fs.existsSync(sourceFigurePath)) {
        const targetFigurePath = path.join(publicationPaths.figuresDir, figureName);
        await fsPromises.copyFile(sourceFigurePath, targetFigurePath);
        figurePaths.push(toProjectRelativePath(projectPath, targetFigurePath));
      }
    }
    const updated = metaAnalysisDb.updateAnalysisRun(req.user.id, analysisRun.id, {
      status: result.status,
      error: result.error,
      finishedAt: result.finishedAt,
      ...(figurePaths.length > 0 ? { figuresJson: figurePaths } : {}),
    });
    res.json({ analysisRun: updated, dataset, result });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Diagnostic analysis failed' });
  }
});

router.get('/:metaProjectId/analysis-runs', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({ analysisRuns: metaAnalysisDb.listAnalysisRuns(req.user.id, metaProject.id) });
});

router.post('/:metaProjectId/surveillance/subscribe', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const subscription = surveillanceDb.createSubscription(req.user.id, {
      metaProjectId: metaProject.id,
      searchStrategy: req.body.searchStrategy || {},
      eligibility: req.body.eligibility || {},
      frequency: req.body.frequency || 'weekly',
    });
    res.json({ subscription });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create surveillance subscription' });
  }
});

router.get('/:metaProjectId/surveillance/subscription', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({ subscription: surveillanceDb.getSubscriptionByProject(metaProject.id) });
});

router.post('/:metaProjectId/surveillance/run', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const result = await runProjectSurveillance({ userId: req.user.id, metaProject });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Surveillance run failed' });
  }
});

router.get('/:metaProjectId/surveillance/runs', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({ runs: surveillanceDb.listRuns(metaProject.id) });
});

router.get('/:metaProjectId/analysis-runs/:analysisRunId', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  const run = metaAnalysisDb.getAnalysisRun(req.user.id, req.params.analysisRunId);
  if (!run || run.meta_project_id !== metaProject.id) {
    return res.status(404).json({ error: 'Analysis run not found' });
  }
  const { projectPath } = await resolveMetaProjectContext(metaProject);
  res.json({ analysisRun: run, output: await readOutputJson(projectPath, run.output_json_path) });
});

async function upsertDraftSection({ req, res, sectionKey, content }) {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return null;
  const { projectPath, project } = await resolveMetaProjectContext(metaProject);
  const manuscriptPaths = getMetaManuscriptPaths(projectPath, getMetaArtifactOptions(project));
  await fsPromises.mkdir(manuscriptPaths.sectionsDir, { recursive: true });
  const section = metaAnalysisDb.upsertManuscriptSection(req.user.id, {
    metaProjectId: metaProject.id,
    sectionKey,
    contentMarkdown: content,
    sourceJson: { generatedAt: new Date().toISOString() },
  });
  await fsPromises.writeFile(path.join(manuscriptPaths.sectionsDir, `${sectionKey}.md`), `${content}\n`, 'utf8');
  const sections = metaAnalysisDb.listManuscriptSections(req.user.id, metaProject.id);
  await fsPromises.writeFile(
    manuscriptPaths.manuscriptMarkdownPath,
    `${sections.map((item) => item.content_markdown).filter(Boolean).join('\n\n')}\n`,
    'utf8',
  );
  return section;
}

router.post('/:metaProjectId/manuscript/methods', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  const section = await upsertDraftSection({ req, res, sectionKey: 'methods', content: writeMethodsSection(metaProject) });
  if (section) res.json({ section });
});

router.post('/:metaProjectId/manuscript/results', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  const { projectPath, project } = await resolveMetaProjectContext(metaProject);
  const artifactOptions = getMetaArtifactOptions(project);
  const overview = buildOverview(req.user.id, metaProject, getMetaStageDirs(projectPath, artifactOptions));
  const latestRun = metaAnalysisDb.listAnalysisRuns(req.user.id, metaProject.id)[0] || null;
  const output = latestRun ? await readOutputJson(projectPath, latestRun.output_json_path) : null;
  const section = await upsertDraftSection({
    req,
    res,
    sectionKey: 'results',
    content: writeResultsSection({ metaProject, overview, latestRun: latestRun ? { ...latestRun, output_json: output } : null }),
  });
  if (section) res.json({ section });
});

for (const sectionKey of ['introduction', 'discussion', 'conclusion']) {
  router.post(`/:metaProjectId/manuscript/${sectionKey}`, async (req, res) => {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const section = await upsertDraftSection({
      req,
      res,
      sectionKey,
      content: draftSection(sectionKey, { metaProject }),
    });
    if (section) res.json({ section });
  });
}

router.get('/:metaProjectId/manuscript', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({ sections: metaAnalysisDb.listManuscriptSections(req.user.id, metaProject.id) });
});

router.post('/:metaProjectId/export/docx', async (req, res) => {
  res.status(501).json({ error: 'DOCX export is planned after manuscript citation handling is implemented' });
});

export const __testing = {
  isFullTextAcquisitionManifestRow,
  normalizeManifestAssetStatus,
};

export default router;
