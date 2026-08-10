import { authenticatedFetch } from '../../../utils/api';
import type {
  AnalysisRun,
  ExtractionResult,
  ManuscriptSection,
  MetaOverview,
  MetaProject,
  MetaReference,
  MetaSearchRun,
  MetaSearchSource,
  ParsedDocument,
  PdfAsset,
  ScreeningDecision,
} from '../types';

export type SurveillanceSubscription = {
  id: string;
  metaProjectId: string;
  searchStrategy: { pubmed?: string };
  eligibility: Record<string, unknown>;
  frequency: string;
  status: string;
  lastRunAt: string | null;
};

export type SurveillanceChangeSet = {
  generatedAt: string;
  search: { found: number; since: string | null };
  dedup: { novel: number; duplicates: number };
  autoScreen: { autoIncluded: number; autoExcluded: number; toReview: number };
  includedStudies: Array<{ referenceId: string; title: string; confidence: number }>;
  referenceSet: { priorVersion: number | null; newVersion: number } | null;
  pendingReanalysis: { staleArtifactIds: string[]; note: string };
  conclusionsImpact: string;
};

export type SurveillanceRun = {
  id: string;
  status: string;
  stats: Record<string, number>;
  changeSet: SurveillanceChangeSet | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await authenticatedFetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error?: unknown }).error)
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

const base = (metaProjectId: string) => `/api/meta-analysis/${encodeURIComponent(metaProjectId)}`;

function toQuery(params?: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  });
  const value = query.toString();
  return value ? `?${value}` : '';
}

export type MetaArtifactSyncResult = {
  search: {
    exists: boolean;
    artifactPaths: string[];
    files: Array<{
      artifactPath: string;
      imported: number;
      matched: number;
      linked: number;
      skipped: number;
      recordCount: number;
      searchRunCreated: boolean;
      warnings: string[];
    }>;
    imported: number;
    matched: number;
    linked: number;
    skipped: number;
    searchRunsCreated: number;
    warnings: string[];
  };
  screening: {
    artifactPath: string;
    artifactPaths?: string[];
    files?: Array<{
      artifactPath: string;
      imported: number;
      matched: number;
      linked: number;
      upserted: number;
      skipped: number;
      preservedUserDecisions: number;
      recordCount: number;
      warnings: string[];
    }>;
    exists: boolean;
    imported: number;
    matched: number;
    linked: number;
    upserted: number;
    skipped: number;
    preservedUserDecisions: number;
    warnings: string[];
  };
  summary: {
    imported: number;
    matched: number;
    linked: number;
    skipped: number;
    warnings: string[];
    searchRunsCreated: number;
    screeningDecisionsUpserted: number;
    preservedUserDecisions: number;
  };
  reportPath?: string;
};

export type MetaZoteroExportResult = {
  total: number;
  queueSource?: string;
  skippedAcquisitionQueue?: number;
  skippedScreeningAuthorization?: number;
  collection?: {
    path?: string;
    rootKey?: string;
    projectKey?: string;
    reviewKey?: string;
    needsReviewKey?: string;
  };
  exported: number;
  missingAttachment: number;
  failed: number;
  reportPath?: string;
  results?: Array<{
    referenceId: string;
    title?: string | null;
    status: string;
    zoteroItemKey?: string | null;
    zoteroAttachmentKey?: string | null;
    missingAttachment?: boolean;
    matchReason?: string | null;
    error?: string | null;
  }>;
};

export type MetaZoteroResolveResult = {
  total: number;
  queueSource?: string;
  skippedAcquisitionQueue?: number;
  skippedScreeningAuthorization?: number;
  skippedHumanReview?: number;
  skippedAlreadyResolved?: number;
  downloaded: number;
  cached: number;
  manualUploadRequired: number;
  failed: number;
  results?: PdfAsset[];
};

export type MetaZoteroDecisionImportResult = {
  synced: number;
  decisions: {
    include: number;
    maybe: number;
    exclude: number;
  };
  conflicts: Array<{ zoteroItemKey: string; decisions: string[] }>;
  unmatchedZoteroItems: string[];
  artifacts?: {
    jsonPath?: string;
    csvPath?: string;
    records?: number;
  };
  reportPath?: string;
};

export type ZoteroWebCredentialStatus = {
  configured: boolean;
  userId: string | null;
  source?: 'user_credential' | 'environment' | 'mixed' | null;
  apiKeySource?: 'user_credential' | 'environment' | null;
  userIdSource?: 'user_credential' | 'environment' | null;
  username?: string | null;
  displayName?: string | null;
  access?: {
    library: boolean;
    write: boolean;
    files: boolean;
    notes: boolean;
  };
};

export const metaAnalysisApi = {
  getProject: (projectName: string) =>
    requestJson<{ metaProject: MetaProject | null }>(`/api/meta-analysis/project/${encodeURIComponent(projectName)}`),

  initProject: (projectName: string, payload: Partial<MetaProject> & Record<string, unknown>) =>
    requestJson<{ metaProject: MetaProject; created: boolean }>(`/api/meta-analysis/project/${encodeURIComponent(projectName)}/init`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProject: (metaProjectId: string, payload: Record<string, unknown>) =>
    requestJson<{ metaProject: MetaProject }>(base(metaProjectId), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  overview: (metaProjectId: string) => requestJson<MetaOverview>(`${base(metaProjectId)}/overview`),

  searchSources: (metaProjectId: string) =>
    requestJson<{ defaultSourceId: string; sources: MetaSearchSource[] }>(`${base(metaProjectId)}/search/sources`),

  buildQuery: (metaProjectId: string, payload: { disease?: string | null; biomarker?: string | null; reviewType?: string | null; databaseName?: string }) =>
    requestJson<{ databaseName: string; sourceId: string; languageScope: string; ownerSkills: string[]; pubmed: string; conceptBlocks: Array<{ label: string; terms: string[]; query: string }>; warnings?: string[] }>(`${base(metaProjectId)}/search/query-builder`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runPubMedSearch: (metaProjectId: string, payload: { query: string; retmax: number; databaseName?: string }) =>
    requestJson<{ searchRunId: string; resultCount: number; importedCount: number; linkedCount: number; duplicates: number; screeningInputPath?: string; screeningInputCount?: number }>(`${base(metaProjectId)}/search/pubmed`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  searchRuns: (metaProjectId: string) => requestJson<{ searchRuns: MetaSearchRun[] }>(`${base(metaProjectId)}/search-runs`),

  syncArtifacts: (metaProjectId: string) =>
    requestJson<{ sync: MetaArtifactSyncResult }>(`${base(metaProjectId)}/artifacts/sync`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  references: (metaProjectId: string) => requestJson<{ references: MetaReference[] }>(`${base(metaProjectId)}/references`),

  screening: (metaProjectId: string, params?: { limit?: number; offset?: number }) =>
    requestJson<{
      references: MetaReference[];
      decisions: ScreeningDecision[];
      total?: number;
      limit?: number;
      offset?: number;
      workflowStats?: MetaOverview['counts']['screeningStatus'];
    }>(`${base(metaProjectId)}/screening${toQuery(params)}`),

  syncScreeningArtifacts: (metaProjectId: string) =>
    requestJson<{
      sync: {
        artifactPath: string;
        artifactPaths?: string[];
        exists: boolean;
        imported: number;
        matched: number;
        linked: number;
        upserted: number;
        skipped: number;
        preservedUserDecisions: number;
        warnings: string[];
      };
    }>(`${base(metaProjectId)}/screening/sync-artifacts`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  updateScreening: (metaProjectId: string, referenceId: string, payload: Record<string, unknown>) =>
    requestJson<{ decision: ScreeningDecision }>(`${base(metaProjectId)}/screening/${encodeURIComponent(referenceId)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  fullTextAssets: (metaProjectId: string) =>
    requestJson<{ fullTextAssets: PdfAsset[]; pdfAssets: PdfAsset[] }>(`${base(metaProjectId)}/full-text-assets`),

  zoteroWebCredentialStatus: () =>
    requestJson<ZoteroWebCredentialStatus>('/api/settings/zotero-web/status'),

  saveZoteroWebCredentials: (payload: { apiKey: string; userId?: string }) =>
    requestJson<ZoteroWebCredentialStatus & { success: boolean }>('/api/settings/zotero-web/credentials', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  exportFullTextToZotero: (metaProjectId: string, payload: { referenceIds?: string[] } = {}) =>
    requestJson<MetaZoteroExportResult>(`${base(metaProjectId)}/full-text/zotero/export`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resolveFullTextFromZotero: (metaProjectId: string, payload: { referenceIds?: string[] } = {}) =>
    requestJson<MetaZoteroResolveResult>(`${base(metaProjectId)}/full-text/resolve-batch`, {
      method: 'POST',
      body: JSON.stringify({ ...payload, sources: ['zotero'] }),
    }),

  importFullTextDecisionsFromZotero: (metaProjectId: string) =>
    requestJson<MetaZoteroDecisionImportResult>(`${base(metaProjectId)}/full-text/zotero/import-decisions`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  parsedDocuments: (metaProjectId: string) =>
    requestJson<{ parsedDocuments: ParsedDocument[] }>(`${base(metaProjectId)}/parsed-documents`),

  reviewParsedDocument: (metaProjectId: string, referenceId: string) =>
    requestJson<{ parsedDocument: ParsedDocument }>(`${base(metaProjectId)}/parsed-documents/${encodeURIComponent(referenceId)}/review`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    }),

  parseBatch: (metaProjectId: string, payload: { referenceIds: string[]; force?: boolean }) =>
    requestJson<{ total: number; results: ParsedDocument[] }>(`${base(metaProjectId)}/parse/batch`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  markdown: (metaProjectId: string, referenceId: string) =>
    authenticatedFetch(`${base(metaProjectId)}/references/${encodeURIComponent(referenceId)}/markdown`).then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      return response.text();
    }),

  tables: (metaProjectId: string, referenceId: string) =>
    requestJson<unknown>(`${base(metaProjectId)}/references/${encodeURIComponent(referenceId)}/tables`),

  runDiagnosticExtraction: (metaProjectId: string, payload: { referenceIds: string[]; force?: boolean }) =>
    requestJson<{ extractionResults: ExtractionResult[]; skippedParseReview?: number }>(`${base(metaProjectId)}/extract/diagnostic`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  extractions: (metaProjectId: string) =>
    requestJson<{ extractionResults: ExtractionResult[] }>(`${base(metaProjectId)}/extractions`),

  updateExtraction: (metaProjectId: string, extractionId: string, payload: Record<string, unknown>) =>
    requestJson<{ extractionResult: ExtractionResult }>(`${base(metaProjectId)}/extractions/${encodeURIComponent(extractionId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  exportDiagnosticDataset: (metaProjectId: string) =>
    requestJson<{ datasetPath: string; excludedDatasetPath: string; includedCount: number; excludedCount: number }>(`${base(metaProjectId)}/datasets/diagnostic`, {
      method: 'POST',
    }),

  runDiagnosticAnalysis: (metaProjectId: string) =>
    requestJson<{ analysisRun: AnalysisRun; result: { status: string; error: string | null } }>(`${base(metaProjectId)}/analysis/diagnostic/run`, {
      method: 'POST',
    }),

  analysisRuns: (metaProjectId: string) =>
    requestJson<{ analysisRuns: AnalysisRun[] }>(`${base(metaProjectId)}/analysis-runs`),

  surveillanceSubscription: (metaProjectId: string) =>
    requestJson<{ subscription: SurveillanceSubscription | null }>(`${base(metaProjectId)}/surveillance/subscription`),

  subscribeSurveillance: (
    metaProjectId: string,
    payload: { searchStrategy: { pubmed?: string }; eligibility: Record<string, unknown>; frequency?: string },
  ) =>
    requestJson<{ subscription: SurveillanceSubscription }>(`${base(metaProjectId)}/surveillance/subscribe`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runSurveillance: (metaProjectId: string) =>
    requestJson<{ run: SurveillanceRun; changeSet: SurveillanceChangeSet }>(`${base(metaProjectId)}/surveillance/run`, {
      method: 'POST',
    }),

  surveillanceRuns: (metaProjectId: string) =>
    requestJson<{ runs: SurveillanceRun[] }>(`${base(metaProjectId)}/surveillance/runs`),

  manuscript: (metaProjectId: string) =>
    requestJson<{ sections: ManuscriptSection[] }>(`${base(metaProjectId)}/manuscript`),

  generateManuscriptSection: (metaProjectId: string, sectionKey: string) =>
    requestJson<{ section: ManuscriptSection }>(`${base(metaProjectId)}/manuscript/${encodeURIComponent(sectionKey)}`, {
      method: 'POST',
    }),
};
