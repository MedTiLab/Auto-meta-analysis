export interface ReferenceAuthor {
  family: string;
  given: string;
}

export interface Reference {
  id: string;
  user_id: number;
  title: string;
  authors: ReferenceAuthor[];
  year: number | null;
  abstract: string | null;
  doi: string | null;
  url: string | null;
  journal: string | null;
  item_type: string;
  source: string;
  source_id: string | null;
  keywords: string[];
  citation_key: string | null;
  pdf_cached: number;
  created_at: string;
  updated_at: string;
  linked_at?: string;
}

export interface ProjectReference extends Reference {
  project_linked?: boolean;
  has_local_artifact?: boolean;
  local_artifact_dir?: string | null;
  local_relative_path?: string | null;
  local_pdf_path?: string | null;
  local_files?: string[];
  origin?: 'library' | 'project_local' | 'merged';
  artifact_source?: 'metadata' | 'file' | null;
}

export interface ProjectReferenceStats {
  total_count: number;
  linked_count: number;
  local_only_count: number;
  local_artifact_count: number;
}

export interface ReferenceTag {
  tag: string;
  count: number;
}

export interface ReferenceFolder {
  id: string;
  name: string;
  parent_id: string | null;
  reference_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReferenceFolderStats {
  total_count: number;
  unfiled_count: number;
}

export interface ZoteroCollection {
  key: string;
  name: string;
  parentKey: string | null;
}

export interface ZoteroStatus {
  connected: boolean;
  mode: 'local' | null;
  localAvailable: boolean;
  localRunning: boolean;
  localApiDisabled: boolean;
  endpoint?: string | null;
  detail?: string | null;
}

export interface ZoteroItem {
  sourceId: string;
  title: string;
  authors: ReferenceAuthor[];
  year: number | null;
  journal: string | null;
  itemType: string;
  abstract?: string | null;
  doi?: string | null;
  url?: string | null;
  keywords?: string[];
  citationKey?: string | null;
}

export function formatAuthors(authors: ReferenceAuthor[], maxCount = 3): string {
  if (!authors || authors.length === 0) return '';
  const names = authors.map((a) => {
    if (a.family && a.given) return `${a.family}, ${a.given.charAt(0)}.`;
    return a.family || a.given || '';
  });
  if (names.length <= maxCount) return names.join('; ');
  return `${names.slice(0, maxCount).join('; ')} et al.`;
}

export function formatReferenceChatPrompt(ref: Reference): string {
  const lines: string[] = [];
  lines.push(`Title: ${ref.title}`);
  if (ref.authors.length > 0) {
    lines.push(`Authors: ${formatAuthors(ref.authors, 10)}`);
  }
  if (ref.year) lines.push(`Year: ${ref.year}`);
  if (ref.journal) lines.push(`Journal: ${ref.journal}`);
  if (ref.doi) lines.push(`DOI: https://doi.org/${ref.doi}`);
  else if (ref.url) lines.push(`URL: ${ref.url}`);
  return lines.join('\n');
}

export function formatReferenceContext(ref: Reference): string {
  const lines: string[] = ['[Reference Context]'];
  lines.push(`Title: ${ref.title}`);
  if (ref.authors.length > 0) {
    lines.push(`Authors: ${formatAuthors(ref.authors, 10)}`);
  }
  if (ref.year) lines.push(`Year: ${ref.year}`);
  if (ref.journal) lines.push(`Journal: ${ref.journal}`);
  if (ref.doi) lines.push(`DOI: ${ref.doi}`);
  if (ref.abstract) {
    lines.push(`Abstract: ${ref.abstract}`);
  }
  if (ref.keywords.length > 0) {
    lines.push(`Keywords: ${ref.keywords.join(', ')}`);
  }
  lines.push('---');
  return lines.join('\n');
}
