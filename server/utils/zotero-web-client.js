import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { credentialsDb } from '../database/db.js';

const ZOTERO_WEB_API_BASE = 'https://api.zotero.org';
const ZOTERO_WEB_API_VERSION = '3';
const ZOTERO_MIN_REQUEST_INTERVAL_MS = Number.parseInt(process.env.ZOTERO_MIN_REQUEST_INTERVAL_MS || '1200', 10);
const ZOTERO_RATE_LIMIT_RETRIES = Number.parseInt(process.env.ZOTERO_RATE_LIMIT_RETRIES || '6', 10);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterMs(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const seconds = Number.parseFloat(text);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(text);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function normalizeCredentialValue(value) {
  return String(value || '').trim();
}

function getCredentialFromStore(userId, type) {
  if (!userId) return '';
  try {
    return normalizeCredentialValue(credentialsDb.getActiveCredential(userId, type));
  } catch (error) {
    console.warn(`[zotero-web-client] Failed to read ${type} credential:`, error.message);
    return '';
  }
}

function resolveCredentialWithSource({ storedValue, envValue }) {
  const stored = normalizeCredentialValue(storedValue);
  const env = normalizeCredentialValue(envValue);
  if (stored) {
    return { value: stored, source: 'user_credential' };
  }
  if (env) {
    return { value: env, source: 'environment' };
  }
  return { value: '', source: null };
}

function combineCredentialSources(apiKeySource, userIdSource) {
  const sources = [apiKeySource, userIdSource].filter(Boolean);
  if (sources.length === 0) return null;
  return sources.every((source) => source === sources[0]) ? sources[0] : 'mixed';
}

export function getZoteroWebCredentials(userId) {
  const apiKey = resolveCredentialWithSource({
    storedValue: getCredentialFromStore(userId, 'zotero_api_key'),
    envValue: process.env.ZOTERO_API_KEY,
  });
  const zoteroUserId = resolveCredentialWithSource({
    storedValue: getCredentialFromStore(userId, 'zotero_user_id'),
    envValue: process.env.ZOTERO_USER_ID,
  });
  return {
    apiKey: apiKey.value,
    userId: zoteroUserId.value,
    configured: Boolean(apiKey.value && zoteroUserId.value),
    source: combineCredentialSources(apiKey.source, zoteroUserId.source),
    apiKeySource: apiKey.source,
    userIdSource: zoteroUserId.source,
  };
}

export function getZoteroWebCredentialStatus(userId) {
  const credentials = getZoteroWebCredentials(userId);
  return {
    configured: credentials.configured,
    userId: credentials.userId ? String(credentials.userId) : null,
    source: credentials.source,
    apiKeySource: credentials.apiKeySource,
    userIdSource: credentials.userIdSource,
  };
}

export async function inspectZoteroWebApiKey(apiKey, options = {}) {
  const normalizedKey = normalizeCredentialValue(apiKey);
  if (!normalizedKey) {
    throw new Error('Zotero API key is required');
  }
  const baseUrl = String(options.baseUrl || process.env.ZOTERO_API_BASE_URL || ZOTERO_WEB_API_BASE).replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/keys/current`, {
    headers: {
      'Zotero-API-Key': normalizedKey,
      'Zotero-API-Version': ZOTERO_WEB_API_VERSION,
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`Zotero API key validation failed (${response.status}): ${text || response.statusText}`);
  }
  const payload = text ? JSON.parse(text) : {};
  const access = payload.access?.user || {};
  const userId = normalizeCredentialValue(payload.userID || payload.userId || payload.user_id);
  if (!userId) {
    throw new Error('Zotero API key validation did not return a userID');
  }
  return {
    userId,
    username: normalizeCredentialValue(payload.username),
    displayName: normalizeCredentialValue(payload.displayName),
    access: {
      library: Boolean(access.library),
      write: Boolean(access.write),
      files: Boolean(access.files),
      notes: Boolean(access.notes),
    },
    raw: payload,
  };
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

function extractPmidFromText(value) {
  const text = String(value || '');
  return text.match(/\bPMID\s*[:=]?\s*(\d{4,})\b/i)?.[1]
    || text.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1]
    || '';
}

function inferReferencePmid(reference) {
  const raw = reference?.raw_data || {};
  return normalizePmid(raw.pmid || raw.PMID || raw.pubmed_id || raw.pubmedId)
    || (String(reference?.source || '').toLowerCase() === 'pubmed' ? normalizePmid(reference.source_id) : '')
    || (/^\d+$/.test(String(reference?.citation_key || '').trim()) ? String(reference.citation_key).trim() : '');
}

function inferZoteroItemPmid(rawItem) {
  const data = rawItem?.data || rawItem || {};
  return normalizePmid(data.PMID || data.pmid || extractPmidFromText(data.extra) || extractPmidFromText(data.url));
}

function inferZoteroItemDoi(rawItem) {
  const data = rawItem?.data || rawItem || {};
  return normalizeDoi(data.DOI || data.doi);
}

function inferZoteroItemYear(rawItem) {
  const data = rawItem?.data || rawItem || {};
  const match = String(data.date || '').match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

function uniqueTags(tags = []) {
  const seen = new Set();
  return tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function serializeTags(tags = []) {
  return uniqueTags(tags).map((tag) => ({ tag }));
}

function mergeCollections(existing = [], additions = []) {
  return [...new Set([...existing, ...additions].filter(Boolean))];
}

function mergeTags(existing = [], additions = []) {
  const tagNames = [
    ...existing.map((tag) => String(tag?.tag || '').trim()).filter(Boolean),
    ...additions,
  ];
  return serializeTags(tagNames);
}

function parseWriteResponse(payload, index = 0) {
  const key = String(index);
  const success = payload?.successful?.[key] || payload?.success?.[key] || payload?.unchanged?.[key];
  if (typeof success === 'string') return { key: success, data: null };
  if (success?.key) return { key: success.key, data: success.data || success };
  if (success?.data?.key) return { key: success.data.key, data: success.data };
  const failed = payload?.failed?.[key];
  if (failed) {
    const message = failed.message || failed.code || JSON.stringify(failed);
    throw new Error(`Zotero write failed: ${message}`);
  }
  throw new Error(`Zotero write response did not include created item ${key}`);
}

function buildReferenceExtra(reference) {
  const lines = [];
  const pmid = inferReferencePmid(reference);
  if (pmid) lines.push(`PMID: ${pmid}`);
  if (reference?.id) lines.push(`MedHelp Reference ID: ${reference.id}`);
  return lines.join('\n') || null;
}

function referenceToZoteroData(reference, { collections = [], tags = [] } = {}) {
  const creators = Array.isArray(reference?.authors)
    ? reference.authors.map((author) => ({
      creatorType: 'author',
      firstName: String(author?.given || '').trim(),
      lastName: String(author?.family || '').trim() || String(author || '').trim(),
    })).filter((author) => author.firstName || author.lastName)
    : [];

  const data = {
    itemType: 'journalArticle',
    title: reference?.title || 'Untitled',
    creators,
    abstractNote: reference?.abstract || '',
    publicationTitle: reference?.journal || '',
    date: reference?.year ? String(reference.year) : '',
    DOI: reference?.doi || '',
    url: reference?.url || '',
    extra: buildReferenceExtra(reference) || '',
    collections: collections.filter(Boolean),
    tags: serializeTags(tags),
  };

  return Object.fromEntries(Object.entries(data).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined;
  }));
}

export class ZoteroWebClient {
  constructor({ userId, apiKey, baseUrl = ZOTERO_WEB_API_BASE } = {}) {
    if (!userId || !apiKey) {
      throw new Error('Zotero Web API credentials are required');
    }
    this.userId = String(userId);
    this.apiKey = String(apiKey);
    this.baseUrl = String(baseUrl || ZOTERO_WEB_API_BASE).replace(/\/$/, '');
    this.lastRequestAt = 0;
  }

  endpoint(pathname) {
    const normalized = String(pathname || '').startsWith('/') ? pathname : `/${pathname}`;
    return `${this.baseUrl}/users/${encodeURIComponent(this.userId)}${normalized}`;
  }

  headers(extra = {}) {
    return {
      'Zotero-API-Key': this.apiKey,
      'Zotero-API-Version': ZOTERO_WEB_API_VERSION,
      ...extra,
    };
  }

  async waitForRequestSlot() {
    const interval = Number.isFinite(ZOTERO_MIN_REQUEST_INTERVAL_MS)
      ? Math.max(0, ZOTERO_MIN_REQUEST_INTERVAL_MS)
      : 750;
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < interval) {
      await sleep(interval - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  async request(pathname, options = {}) {
    const maxAttempts = Number.isFinite(ZOTERO_RATE_LIMIT_RETRIES)
      ? Math.max(1, ZOTERO_RATE_LIMIT_RETRIES)
      : 5;
    let lastRateLimitText = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.waitForRequestSlot();
      const response = await fetch(this.endpoint(pathname), {
        ...options,
        headers: this.headers(options.headers || {}),
      });
      const text = await response.text().catch(() => '');
      if (response.status === 429 && attempt < maxAttempts) {
        lastRateLimitText = text || response.statusText;
        const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
        const fallbackMs = Math.min(30000, 2000 * attempt);
        await sleep(retryAfterMs ?? fallbackMs);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Zotero Web API ${response.status}: ${text || response.statusText}`);
      }
      if (!text) return null;
      return JSON.parse(text);
    }
    throw new Error(`Zotero Web API 429: ${lastRateLimitText || 'Request rate limit exceeded'}`);
  }

  async requestForm(pathname, params, options = {}) {
    return this.request(pathname, {
      ...options,
      method: options.method || 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(options.headers || {}),
      },
      body: params instanceof URLSearchParams ? params.toString() : new URLSearchParams(params).toString(),
    });
  }

  async paginated(pathname, { limit = 100 } = {}) {
    const rows = [];
    let start = 0;
    while (true) {
      const separator = String(pathname).includes('?') ? '&' : '?';
      const page = await this.request(`${pathname}${separator}limit=${limit}&start=${start}`) || [];
      rows.push(...page);
      if (!Array.isArray(page) || page.length < limit) break;
      start += limit;
    }
    return rows;
  }

  async getCollections() {
    const rows = await this.paginated('/collections');
    return rows.map((row) => ({
      key: row.data?.key || row.key,
      name: row.data?.name || row.name || '',
      parentKey: row.data?.parentCollection || null,
      raw: row,
    })).filter((collection) => collection.key);
  }

  async createCollection(name, parentCollection = null) {
    const payload = [{
      name,
      parentCollection: parentCollection || false,
    }];
    return parseWriteResponse(await this.request('/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
  }

  async ensureCollectionPath(pathSegments = []) {
    const segments = pathSegments.map((segment) => String(segment || '').trim()).filter(Boolean);
    let collections = await this.getCollections();
    let parentKey = null;
    const ensured = [];
    for (const name of segments) {
      let collection = collections.find((item) => item.name === name && (item.parentKey || null) === (parentKey || null));
      if (!collection) {
        const created = await this.createCollection(name, parentKey);
        collection = { key: created.key, name, parentKey };
        collections = [...collections, collection];
      }
      ensured.push(collection);
      parentKey = collection.key;
    }
    return ensured;
  }

  async ensureMetaFullTextCollections(projectTitle) {
    const base = await this.ensureCollectionPath(['MedHelp', projectTitle || 'Untitled Meta Project', '04 Full Text Review']);
    const review = base[base.length - 1];
    const children = {};
    for (const name of ['Needs Review', 'Include', 'Maybe', 'Exclude']) {
      const child = (await this.ensureCollectionPath(['MedHelp', projectTitle || 'Untitled Meta Project', '04 Full Text Review', name])).at(-1);
      children[name] = child;
    }
    return {
      root: base[0],
      project: base[1],
      review,
      needsReview: children['Needs Review'],
      include: children.Include,
      maybe: children.Maybe,
      exclude: children.Exclude,
      children,
    };
  }

  async searchItems(query, { limit = 25 } = {}) {
    const params = new URLSearchParams({
      q: String(query || ''),
      itemType: '-attachment',
      limit: String(limit),
    });
    return this.request(`/items?${params.toString()}`) || [];
  }

  async findTopLevelItemForReference(reference) {
    const referenceDoi = normalizeDoi(reference?.doi || reference?.raw_data?.doi);
    if (referenceDoi) {
      const doiMatches = (await this.searchItems(referenceDoi)).filter((item) => inferZoteroItemDoi(item) === referenceDoi);
      if (doiMatches[0]) return { key: doiMatches[0].data?.key || doiMatches[0].key, raw: doiMatches[0], matchReason: 'doi' };
    }

    const referencePmid = inferReferencePmid(reference);
    if (referencePmid) {
      const pmidMatches = (await this.searchItems(referencePmid)).filter((item) => inferZoteroItemPmid(item) === referencePmid);
      if (pmidMatches[0]) return { key: pmidMatches[0].data?.key || pmidMatches[0].key, raw: pmidMatches[0], matchReason: 'pmid' };
    }

    const normalizedTitle = normalizeTitle(reference?.title);
    if (normalizedTitle) {
      const titleMatches = (await this.searchItems(String(reference.title || '').slice(0, 160)))
        .filter((item) => {
          const data = item.data || item;
          return normalizeTitle(data.title) === normalizedTitle
            && (!reference?.year || !inferZoteroItemYear(item) || Number(reference.year) === Number(inferZoteroItemYear(item)));
        });
      if (titleMatches[0]) return { key: titleMatches[0].data?.key || titleMatches[0].key, raw: titleMatches[0], matchReason: 'title_year' };
    }

    return null;
  }

  async getItem(itemKey) {
    return this.request(`/items/${encodeURIComponent(itemKey)}`);
  }

  async createReferenceItem(reference, { collections = [], tags = [] } = {}) {
    const payload = [referenceToZoteroData(reference, { collections, tags })];
    const response = await this.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseWriteResponse(response);
  }

  async addItemToCollectionsAndTags(itemKey, collections = [], tags = []) {
    const item = await this.getItem(itemKey);
    const data = {
      ...(item.data || {}),
      collections: mergeCollections(item.data?.collections || [], collections),
      tags: mergeTags(item.data?.tags || [], tags),
    };
    await this.request(`/items/${encodeURIComponent(itemKey)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(item.version ? { 'If-Unmodified-Since-Version': String(item.version) } : {}),
      },
      body: JSON.stringify(data),
    });
    return { key: itemKey, data };
  }

  async createAttachmentItem({ parentItemKey, filename, title, contentType, tags = [] }) {
    const payload = [{
      itemType: 'attachment',
      parentItem: parentItemKey,
      linkMode: 'imported_file',
      title: title || filename,
      filename,
      contentType: contentType || 'application/octet-stream',
      tags: serializeTags(tags),
    }];
    const response = await this.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseWriteResponse(response);
  }

  async uploadStoredAttachment({ parentItemKey, filePath, title, contentType, tags = [] }) {
    const buffer = fs.readFileSync(filePath);
    const stats = fs.statSync(filePath);
    const filename = path.basename(filePath);
    const attachment = await this.createAttachmentItem({
      parentItemKey,
      filename,
      title: title || filename,
      contentType,
      tags,
    });
    const md5 = crypto.createHash('md5').update(buffer).digest('hex');
    const uploadParams = new URLSearchParams({
      md5,
      filename,
      filesize: String(buffer.length),
      mtime: String(Math.round(stats.mtimeMs)),
    });
    const upload = await this.requestForm(`/items/${encodeURIComponent(attachment.key)}/file`, uploadParams, {
      headers: { 'If-None-Match': '*' },
    });
    if (upload?.exists) {
      return { key: attachment.key, uploaded: false, exists: true };
    }
    if (!upload?.url || !upload?.uploadKey) {
      throw new Error('Zotero did not return file upload authorization');
    }
    const prefix = Buffer.from(upload.prefix || '', 'utf8');
    const suffix = Buffer.from(upload.suffix || '', 'utf8');
    const uploadBody = Buffer.concat([prefix, buffer, suffix]);
    const fileResponse = await fetch(upload.url, {
      method: 'POST',
      headers: { 'Content-Type': upload.contentType || 'application/octet-stream' },
      body: uploadBody,
    });
    if (!fileResponse.ok) {
      const text = await fileResponse.text().catch(() => '');
      throw new Error(`Zotero file upload ${fileResponse.status}: ${text || fileResponse.statusText}`);
    }
    await this.requestForm(`/items/${encodeURIComponent(attachment.key)}/file`, new URLSearchParams({ upload: upload.uploadKey }), {
      headers: { 'If-None-Match': '*' },
    });
    return { key: attachment.key, uploaded: true, exists: false };
  }

  async listCollectionItems(collectionKey) {
    return this.paginated(`/collections/${encodeURIComponent(collectionKey)}/items?itemType=-attachment`);
  }

  async listCollectionTopLevelItemKeys(collectionKey) {
    const items = await this.listCollectionItems(collectionKey);
    return items
      .map((item) => item.data?.key || item.key)
      .filter(Boolean);
  }
}

export function getZoteroWebClient(userId, options = {}) {
  const credentials = getZoteroWebCredentials(userId);
  if (!credentials.configured) {
    return null;
  }
  return new ZoteroWebClient({
    userId: credentials.userId,
    apiKey: credentials.apiKey,
    baseUrl: options.baseUrl || process.env.ZOTERO_API_BASE_URL || ZOTERO_WEB_API_BASE,
  });
}
