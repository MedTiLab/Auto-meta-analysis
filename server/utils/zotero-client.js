/**
 * Zotero Client — interface for local Zotero desktop API.
 *
 * Some machines expose the local API only on 127.0.0.1 while others resolve
 * localhost to a working loopback address. Probe a few candidates to avoid
 * brittle IPv4/IPv6 or hosts-file mismatches.
 */

const LOCAL_BASE_CANDIDATES = [
  'http://127.0.0.1:23119/api',
  'http://localhost:23119/api',
  'http://[::1]:23119/api',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Zotero API ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchBuffer(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    throw new Error(`Zotero file fetch ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function mapZoteroItem(raw) {
  const d = raw.data || raw;
  const creators = (d.creators || []).map((c) => ({
    family: c.lastName || '',
    given: c.firstName || '',
  }));
  return {
    sourceId: d.key || raw.key,
    title: d.title || 'Untitled',
    authors: creators,
    year: d.date ? parseInt(d.date.match(/\b(\d{4})\b/)?.[1], 10) || null : null,
    abstract: d.abstractNote || null,
    doi: d.DOI || null,
    pmid: d.PMID || d.pmid || d.extra?.match(/\bPMID\s*[:=]\s*(\d+)\b/i)?.[1] || null,
    url: d.url || null,
    journal: d.publicationTitle || d.journalAbbreviation || null,
    itemType: d.itemType || 'article',
    keywords: (d.tags || []).map((t) => t.tag),
    citationKey: d.citationKey || d.extra?.match(/Citation Key:\s*(\S+)/i)?.[1] || null,
    extra: d.extra || null,
    rawData: raw,
  };
}

// ---------------------------------------------------------------------------
// Local client  (Zotero Desktop — localhost:23119)
// ---------------------------------------------------------------------------

export class ZoteroLocalClient {
  constructor(baseCandidates = LOCAL_BASE_CANDIDATES) {
    this.baseCandidates = Array.isArray(baseCandidates) && baseCandidates.length > 0
      ? [...baseCandidates]
      : [...LOCAL_BASE_CANDIDATES];
    this.base = this.baseCandidates[0];
  }

  async probeBase(base) {
    try {
      const res = await fetch(`${base}/users/0/items?limit=1`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        return {
          available: true,
          running: true,
          apiDisabled: false,
          endpoint: base,
          detail: `Connected to Zotero local API at ${base}`,
        };
      }
      if (res.status === 403) {
        return {
          available: false,
          running: true,
          apiDisabled: true,
          endpoint: base,
          detail: `Zotero is running at ${base}, but local API access is disabled`,
        };
      }

      const text = await res.text().catch(() => '');
      return {
        available: false,
        running: true,
        apiDisabled: false,
        endpoint: base,
        detail: `Zotero responded at ${base} with HTTP ${res.status}${text ? `: ${text}` : ''}`,
      };
    } catch (error) {
      return {
        available: false,
        running: false,
        apiDisabled: false,
        endpoint: base,
        detail: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /** Detailed status: { available, running, apiDisabled }. */
  async checkStatus() {
    let apiDisabledStatus = null;
    let runningStatus = null;
    let lastStatus = null;

    for (const base of this.baseCandidates) {
      const status = await this.probeBase(base);
      lastStatus = status;

      if (status.available) {
        this.base = base;
        return status;
      }

      if (status.apiDisabled && !apiDisabledStatus) {
        apiDisabledStatus = status;
      } else if (status.running && !runningStatus) {
        runningStatus = status;
      }
    }

    if (apiDisabledStatus) {
      this.base = apiDisabledStatus.endpoint;
      return apiDisabledStatus;
    }

    if (runningStatus) {
      this.base = runningStatus.endpoint;
      return runningStatus;
    }

    return lastStatus || {
      available: false,
      running: false,
      apiDisabled: false,
      endpoint: this.baseCandidates[0] || null,
      detail: 'Zotero local API is unreachable',
    };
  }

  /** Returns true if the Zotero desktop app is reachable with API enabled. */
  async isAvailable() {
    const { available } = await this.checkStatus();
    return available;
  }

  async getLibraries() {
    // Local API only has the personal library (users/0).
    return [{ id: 0, type: 'user', name: 'My Library' }];
  }

  async getCollections(libraryId = 0) {
    const raw = await fetchJson(`${this.base}/users/${libraryId}/collections`);
    return raw.map((c) => ({
      key: c.data?.key || c.key,
      name: c.data?.name || c.name || '',
      parentKey: c.data?.parentCollection || null,
    }));
  }

  async getItems(libraryId = 0, { collectionKey, query, limit = 50, start = 0 } = {}) {
    const params = new URLSearchParams({ limit: String(limit), start: String(start), itemType: '-attachment' });
    if (query) params.set('q', query);
    const base = collectionKey
      ? `${this.base}/users/${libraryId}/collections/${encodeURIComponent(collectionKey)}/items`
      : `${this.base}/users/${libraryId}/items`;
    const raw = await fetchJson(`${base}?${params}`);
    return raw.map(mapZoteroItem);
  }

  async searchItems(libraryId = 0, query) {
    return this.getItems(libraryId, { query });
  }

  async getItemPdf(libraryId = 0, itemKey) {
    // Fetch children to find the PDF attachment.
    const children = await fetchJson(`${this.base}/users/${libraryId}/items/${encodeURIComponent(itemKey)}/children`);
    const pdfAttachment = children.find(
      (c) => (c.data?.contentType || c.contentType) === 'application/pdf',
    );
    if (!pdfAttachment) return null;
    const attachKey = pdfAttachment.data?.key || pdfAttachment.key;
    return fetchBuffer(`${this.base}/users/${libraryId}/items/${attachKey}/file`);
  }
}

// ---------------------------------------------------------------------------
// Factory: local-only
// ---------------------------------------------------------------------------

/**
 * Returns {client, mode} where mode is 'local' | null.
 */
export async function getZoteroClient() {
  const local = new ZoteroLocalClient();
  const localStatus = await local.checkStatus();

  if (localStatus.available) {
    return {
      client: local,
      mode: 'local',
      localRunning: true,
      localApiDisabled: false,
      endpoint: localStatus.endpoint || local.base,
      detail: localStatus.detail || null,
    };
  }

  return {
    client: null,
    mode: null,
    localRunning: localStatus.running,
    localApiDisabled: localStatus.apiDisabled,
    endpoint: localStatus.endpoint || null,
    detail: localStatus.detail || null,
  };
}
