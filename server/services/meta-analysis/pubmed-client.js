import fetch from 'node-fetch';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const DEFAULT_TIMEOUT_MS = 30000;

function stripXml(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDoi(doi) {
  return String(doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim().toLowerCase() || null;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`NCBI request failed (${response.status})`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(endpoint, params) {
  const url = new URL(`${EUTILS_BASE}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function parsePubmedXmlArticles(xml) {
  const articles = new Map();
  const chunks = String(xml || '').split(/<\/PubmedArticle>/i);
  for (const chunk of chunks) {
    const pmid = chunk.match(/<PMID[^>]*>(.*?)<\/PMID>/i)?.[1]?.trim();
    if (!pmid) continue;
    const abstractParts = [...chunk.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi)]
      .map((match) => stripXml(match[1]))
      .filter(Boolean);
    const doi = [...chunk.matchAll(/<ArticleId[^>]*IdType="doi"[^>]*>(.*?)<\/ArticleId>/gi)]
      .map((match) => normalizeDoi(stripXml(match[1])))
      .find(Boolean);
    const pmcid = [...chunk.matchAll(/<ArticleId[^>]*IdType="pmc"[^>]*>(.*?)<\/ArticleId>/gi)]
      .map((match) => stripXml(match[1]))
      .find(Boolean);
    articles.set(pmid, {
      abstract: abstractParts.join('\n\n') || null,
      doi: doi || null,
      pmcid: pmcid || null,
    });
  }
  return articles;
}

export async function searchPubMed(query, { retmax = 200 } = {}) {
  const url = buildUrl('esearch.fcgi', {
    db: 'pubmed',
    term: query,
    retmode: 'json',
    retmax: Math.max(1, Math.min(Number(retmax) || 200, 1000)),
    sort: 'relevance',
  });
  const json = await fetchWithTimeout(url).then((response) => response.json());
  const ids = json?.esearchresult?.idlist || [];
  return {
    ids,
    count: Number(json?.esearchresult?.count || ids.length || 0),
    raw: json,
  };
}

export async function fetchPubMedSummaries(pmids = []) {
  const ids = [...new Set((pmids || []).map(String).filter(Boolean))];
  if (ids.length === 0) {
    return [];
  }

  const summaryUrl = buildUrl('esummary.fcgi', {
    db: 'pubmed',
    id: ids.join(','),
    retmode: 'json',
  });
  const fetchUrl = buildUrl('efetch.fcgi', {
    db: 'pubmed',
    id: ids.join(','),
    retmode: 'xml',
  });

  const [summaryJson, articleXml] = await Promise.all([
    fetchWithTimeout(summaryUrl).then((response) => response.json()),
    fetchWithTimeout(fetchUrl).then((response) => response.text()),
  ]);

  const xmlByPmid = parsePubmedXmlArticles(articleXml);
  const result = summaryJson?.result || {};

  return ids
    .map((pmid) => {
      const summary = result[pmid];
      if (!summary || typeof summary !== 'object') return null;
      return normalizePubMedRecord({
        ...summary,
        pmid,
        xml: xmlByPmid.get(pmid) || {},
      });
    })
    .filter(Boolean);
}

export function normalizePubMedRecord(raw = {}) {
  const articleIds = Array.isArray(raw.articleids) ? raw.articleids : [];
  const articleId = (type) => articleIds.find((item) => item.idtype === type)?.value || null;
  const doi = normalizeDoi(raw.xml?.doi || articleId('doi'));
  const pmcid = raw.xml?.pmcid || articleId('pmc') || null;
  const authors = Array.isArray(raw.authors)
    ? raw.authors.map((author) => {
        const name = String(author.name || '').trim();
        const parts = name.split(/\s+/);
        return {
          family: parts.length > 1 ? parts.slice(0, -1).join(' ') : name,
          given: parts.length > 1 ? parts.slice(-1).join(' ') : '',
        };
      }).filter((author) => author.family || author.given)
    : [];
  const yearMatch = String(raw.pubdate || raw.epubdate || '').match(/\b(19|20)\d{2}\b/);

  return {
    pmid: String(raw.pmid || raw.uid || '').trim(),
    pmcid,
    doi,
    title: stripXml(raw.title || 'Untitled PubMed record'),
    authors,
    year: yearMatch ? Number(yearMatch[0]) : null,
    journal: raw.fulljournalname || raw.source || null,
    abstract: raw.xml?.abstract || null,
    url: raw.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${raw.pmid}/` : null,
    raw,
  };
}
