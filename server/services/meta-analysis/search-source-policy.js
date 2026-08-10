const DEFAULT_SOURCE_ID = 'pubmed';

const SOURCE_POLICY = [
  {
    id: 'pubmed',
    label: 'PubMed/MEDLINE',
    mode: 'direct',
    languageScope: 'english',
    strategySkill: 'pubmed-search-strategy',
    executionSkill: 'pubmed-database',
    outputPath: '02_search_dedupe/search/imported_records/pubmed.csv',
    note: 'Default formal Meta search source. Query design belongs to pubmed-search-strategy; API execution belongs to pubmed-database.',
  },
  {
    id: 'zotero',
    label: 'Zotero/user library',
    mode: 'sync',
    languageScope: 'user-library',
    strategySkill: 'zotero-medautodata-library',
    executionSkill: 'zotero-medautodata-library',
    outputPath: '02_search_dedupe/search/imported_records/zotero.csv',
    note: 'Library sync only. Do not treat Zotero as an external database search.',
  },
  {
    id: 'openalex',
    label: 'OpenAlex/OA discovery',
    mode: 'explicit',
    languageScope: 'explicit-only',
    strategySkill: 'openalex-database',
    executionSkill: 'openalex-database',
    outputPath: '02_search_dedupe/search/imported_records/openalex.csv',
    note: 'Use only when the user explicitly asks for OpenAlex, citation chasing, or open-access discovery.',
  },
  {
    id: 'chinese',
    label: 'Chinese/CNKI traceability',
    mode: 'explicit',
    languageScope: 'chinese-explicit-only',
    strategySkill: 'real-literature-trace',
    executionSkill: 'real-literature-trace',
    outputPath: '02_search_dedupe/search/imported_records/chinese_literature.csv',
    note: 'Use only when the user explicitly asks for Chinese literature, CNKI, or traceable Chinese records.',
  },
  {
    id: 'manual-import',
    label: 'Embase/Cochrane/WOS/Scopus/SinoMed/WanFang/VIP export',
    mode: 'import',
    languageScope: 'user-provided-export',
    strategySkill: 'citation-management',
    executionSkill: null,
    outputPath: '02_search_dedupe/search/imported_records/<source>.csv',
    note: 'No local automated search skill is available. Require user-provided exports or manually imported records.',
  },
];

const SOURCE_ALIASES = {
  medline: 'pubmed',
  'pubmed-medline': 'pubmed',
  oa: 'openalex',
  openalex: 'openalex',
  'openalex-oa': 'openalex',
  'oa-discovery': 'openalex',
  'citation-discovery': 'openalex',
  cnki: 'chinese',
  chinese: 'chinese',
  'chinese-cnki': 'chinese',
  'chinese-literature': 'chinese',
  'web-of-science': 'manual-import',
  wos: 'manual-import',
  scopus: 'manual-import',
  embase: 'manual-import',
  cochrane: 'manual-import',
  sinomed: 'manual-import',
  wanfang: 'manual-import',
  vip: 'manual-import',
};

export function getMetaSearchSourcePolicy() {
  return SOURCE_POLICY.map((source) => ({ ...source }));
}

export function getDefaultMetaSearchSourceId() {
  return DEFAULT_SOURCE_ID;
}

export function normalizeMetaSearchSourceId(value) {
  return String(value || DEFAULT_SOURCE_ID).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

export function resolveMetaSearchSource(value) {
  const sourceId = normalizeMetaSearchSourceId(value);
  const canonicalId = SOURCE_ALIASES[sourceId] || sourceId;
  return SOURCE_POLICY.find((source) => source.id === canonicalId)
    || SOURCE_POLICY.find((source) => source.id === 'manual-import')
    || SOURCE_POLICY[0];
}
