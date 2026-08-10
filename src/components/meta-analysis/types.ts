import type { Reference } from '../references/types';

export interface MetaProject {
  id: string;
  user_id: number;
  project_id: string;
  review_type: string;
  title: string;
  disease: string | null;
  biomarker: string | null;
  population: string | null;
  index_test: string | null;
  reference_standard: string | null;
  primary_outcome: string | null;
  protocol_json: Record<string, unknown> | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MetaOverview {
  metaProject: MetaProject;
  artifactRoots?: Record<string, string>;
  dashboardSummary?: {
    sources: {
      total: number;
      searchRuns: number;
      withCachedPdf: number;
    };
    confirmed: {
      total: number;
      screening: number;
      extractions: number;
      pendingReview: number;
    };
    records: {
      screeningDecisions: number;
      pdfAssets: number;
      parsedDocuments: number;
      extractionResults: number;
      analysisRuns: number;
      manuscriptSections: number;
    };
  };
  counts: {
    references: { total: number; withCachedPdf: number };
    searchRuns: { total: number };
    screening: Record<string, number>;
    screeningStatus?: {
      pending: number;
      aiPreScreen: number;
      pendingAgentReview: number;
      agentReviewed: number;
      userAuthorized: number;
      otherReviewer: number;
      agentConflicts?: number;
      byStage?: Record<'title_abstract' | 'full_text' | 'final', {
        pending: number;
        aiPreScreen: number;
        pendingAgentReview: number;
        agentReviewed: number;
        userAuthorized: number;
        otherReviewer: number;
        agentConflicts?: number;
      }>;
    };
    pdfAssets: Record<string, number>;
    parsedDocuments: Record<string, number>;
    extractions: Record<string, number>;
    analysisRuns: Record<string, number>;
    manuscriptSections: { total: number };
  };
}

export interface MetaSearchRun {
  id: string;
  database_name: string;
  query_text: string;
  result_count: number;
  imported_count: number;
  raw_response_path: string | null;
  searched_at: string;
  metadata_json: Record<string, unknown> | null;
}

export interface MetaSearchSource {
  id: string;
  label: string;
  mode: 'direct' | 'sync' | 'explicit' | 'import';
  languageScope: string;
  strategySkill: string;
  executionSkill: string | null;
  outputPath: string;
  note: string;
}

export interface ScreeningDecision {
  id: string;
  meta_project_id: string;
  reference_id: string;
  stage: 'title_abstract' | 'full_text' | 'final';
  decision: 'include' | 'exclude' | 'maybe';
  reason: string | null;
  reviewer: string | null;
  evidence_note: string | null;
  confidence: number | null;
  metadata_json: Record<string, unknown> | null;
  updated_at: string;
}

export interface PdfAsset {
  id: string;
  meta_project_id: string;
  reference_id: string;
  source: string;
  status: string;
  file_path: string | null;
  sha256: string | null;
  license_status: string | null;
  asset_type?: 'pdf' | 'markdown' | 'html' | 'text' | string | null;
  content_type?: string | null;
  original_filename?: string | null;
  source_url?: string | null;
  error: string | null;
  updated_at: string;
}

export interface ParsedDocument {
  id: string;
  meta_project_id: string;
  reference_id: string;
  pdf_asset_id: string | null;
  parser: string;
  status: string;
  markdown_path: string | null;
  tables_path: string | null;
  figures_dir: string | null;
  page_map_path: string | null;
  parse_report_path: string | null;
  quality_score: number | null;
  error: string | null;
  updated_at: string;
}

export interface ExtractionResult {
  id: string;
  meta_project_id: string;
  reference_id: string;
  extraction_type: string;
  field_name: string;
  value_json: Record<string, unknown> | null;
  evidence_text: string | null;
  evidence_location: string | null;
  page: number | null;
  table_label: string | null;
  confidence: number | null;
  review_status: 'candidate' | 'confirmed' | 'rejected' | 'needs_review';
  reviewer_note: string | null;
  updated_at: string;
}

export interface AnalysisRun {
  id: string;
  meta_project_id: string;
  analysis_type: string;
  model: string | null;
  input_dataset_path: string | null;
  script_path: string | null;
  output_json_path: string | null;
  figures_json: string[] | null;
  status: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface ManuscriptSection {
  id: string;
  section_key: string;
  content_markdown: string | null;
  source_json: Record<string, unknown> | null;
  version: number;
  review_status: string;
  updated_at: string;
}

export type MetaReference = Reference;
