export function normalizeDoi(doi) {
  if (!doi) return null;
  const cleaned = String(doi).trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  return cleaned || null;
}

export function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function getPmid(ref) {
  if (ref.pmid) return String(ref.pmid);
  if (ref.source === 'pubmed' && ref.sourceId) return String(ref.sourceId);
  return null;
}

function emptyIndex() {
  return { dois: new Set(), pmids: new Set(), titles: new Set() };
}

function addToIndex(index, ref) {
  const doi = normalizeDoi(ref.doi);
  if (doi) index.dois.add(doi);
  const pmid = getPmid(ref);
  if (pmid) index.pmids.add(pmid);
  const title = normalizeTitle(ref.title);
  if (title) index.titles.add(title);
}

export function buildCorpusIndex(corpusRefs = []) {
  const index = emptyIndex();
  for (const ref of corpusRefs) addToIndex(index, ref);
  return index;
}

export function isDuplicate(candidate, index) {
  const doi = normalizeDoi(candidate.doi);
  if (doi && index.dois.has(doi)) return true;
  const pmid = getPmid(candidate);
  if (pmid && index.pmids.has(pmid)) return true;
  const title = normalizeTitle(candidate.title);
  if (title && index.titles.has(title)) return true;
  return false;
}

export function dedupAgainstCorpus(candidates = [], corpusRefs = []) {
  const corpusIndex = buildCorpusIndex(corpusRefs);
  const batchIndex = emptyIndex();
  const novel = [];
  const duplicates = [];
  for (const candidate of candidates) {
    if (isDuplicate(candidate, corpusIndex) || isDuplicate(candidate, batchIndex)) {
      duplicates.push(candidate);
    } else {
      novel.push(candidate);
      addToIndex(batchIndex, candidate);
    }
  }
  return { novel, duplicates };
}
