import { searchPubMed as defaultSearchPubMed, fetchPubMedSummaries as defaultFetchPubMedSummaries } from '../pubmed-client.js';

export function formatEdatRange(sinceIso) {
  const d = new Date(sinceIso);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `("${yyyy}/${mm}/${dd}"[EDAT] : "3000"[EDAT])`;
}

export function createPubmedSearchSource(overrides = {}) {
  const searchPubMed = overrides.searchPubMed || defaultSearchPubMed;
  const fetchPubMedSummaries = overrides.fetchPubMedSummaries || defaultFetchPubMedSummaries;
  return {
    async search(searchStrategy, { since } = {}) {
      const base = (searchStrategy && searchStrategy.pubmed) || '';
      const query = since ? `${base} AND ${formatEdatRange(since)}` : base;
      const { ids } = await searchPubMed(query, { retmax: 200 });
      const records = await fetchPubMedSummaries(ids);
      return records.map((r) => ({
        doi: r.doi || null,
        pmid: r.pmid || null,
        title: r.title,
        abstract: r.abstract || null,
        year: r.year || null,
        source: 'pubmed',
        sourceId: r.pmid || null,
        raw: r,
      }));
    },
  };
}

export function createReferencesCorpus({ userId, metaProject, referencesDb }) {
  const projectId = metaProject.project_id;
  return {
    async list() {
      const rows = referencesDb.getProjectReferences(projectId, userId) || [];
      return rows.map((r) => ({
        id: r.id,
        doi: r.doi || null,
        title: r.title,
        source: r.source || null,
        sourceId: r.sourceId || r.source_id || null,
      }));
    },
    async add(_userId, _metaProjectId, candidate) {
      const raw = candidate.raw || {};
      const ids = referencesDb.importReferences(userId, [{
        title: candidate.title,
        authors: raw.authors || [],
        year: candidate.year ?? raw.year ?? null,
        abstract: candidate.abstract ?? raw.abstract ?? null,
        doi: candidate.doi ?? raw.doi ?? null,
        url: raw.url || null,
        journal: raw.journal || null,
        itemType: 'article',
        citationKey: candidate.pmid || candidate.sourceId || null,
        keywords: [],
        rawData: raw,
      }], candidate.source || 'pubmed', { libraryVisible: false });
      const id = ids[0];
      referencesDb.bulkLinkIds(projectId, [id]);
      return { id };
    },
  };
}

export function createScreeningRecorder({ metaAnalysisDb }) {
  return {
    async record({ userId, metaProjectId, referenceId, decision, confidence, reviewer, reason }) {
      return metaAnalysisDb.upsertScreeningDecision(userId, {
        metaProjectId,
        referenceId,
        stage: 'title_abstract',
        decision,
        reason: reason || '',
        reviewer: reviewer || 'surveillance-agent',
        confidence,
      });
    },
  };
}
