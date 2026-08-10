import type { Project } from '../types/app';

export type ProjectKind = 'meta';

export const META_PROJECT_TEMPLATE_ID = 'medical-meta-project';
export const META_PROJECT_WORKFLOW = 'meta';
export const META_PROJECT_FOLDER_SCHEMA_VERSION = 'meta-v2';
export const LEGACY_META_PROJECT_FOLDER_SCHEMA_VERSION = 'clinical-meta-v2';

export const META_PROJECT_LEGACY_ARTIFACT_ROOTS = [
  'Literature/reports',
  'Literature/references',
  'Ideation/ideas',
  'Experiment/datasets',
  'Experiment/analysis',
  'Publication/manuscript',
  'Publication/figures',
  'Publication/tables',
  'Publication/supplementary',
  'Promotion/homepage',
  'Promotion/slides',
  'Promotion/audio',
  'Promotion/video',
] as const;

export const META_PROJECT_NUMBERED_ARTIFACT_ROOTS = [
  '00_literature',
  '01_protocol',
  '02_search_dedupe',
  '03_title_abstract_screening',
  '04_full_text_review',
  '05_data_extraction',
  '06_quality_assessment',
  '07_data_analysis',
  '08_results_figures',
  '09_manuscript_submission',
  '10_presentation',
] as const;

export const META_PROJECT_ARTIFACT_ROOTS = META_PROJECT_NUMBERED_ARTIFACT_ROOTS;

export function getProjectMetadata(project?: Project | null): Record<string, unknown> {
  const metadata = project?.metadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}

export function getMetaFolderSchemaVersion(project?: Project | null): string {
  const metadata = getProjectMetadata(project);
  const metaAnalysis = metadata.metaAnalysis;
  if (metaAnalysis && typeof metaAnalysis === 'object' && !Array.isArray(metaAnalysis)) {
    const folderSchemaVersion = (metaAnalysis as Record<string, unknown>).folderSchemaVersion;
    if (typeof folderSchemaVersion === 'string' && folderSchemaVersion.trim()) {
      return folderSchemaVersion.trim();
    }
  }
  return '';
}

export function usesMetaNumberedFolders(project?: Project | null): boolean {
  const folderSchemaVersion = getMetaFolderSchemaVersion(project);
  return folderSchemaVersion === META_PROJECT_FOLDER_SCHEMA_VERSION
    || folderSchemaVersion === LEGACY_META_PROJECT_FOLDER_SCHEMA_VERSION;
}

export function getMetaProjectArtifactRoots(project?: Project | null): readonly string[] {
  return usesMetaNumberedFolders(project)
    ? META_PROJECT_NUMBERED_ARTIFACT_ROOTS
    : META_PROJECT_LEGACY_ARTIFACT_ROOTS;
}

export function getProjectKind(project?: Project | null): ProjectKind {
  const metadata = getProjectMetadata(project);
  const rawKind = String(metadata.projectKind || metadata.kind || '').toLowerCase();

  if (rawKind === 'meta' || rawKind === 'meta_analysis' || rawKind === 'meta-analysis') {
    return 'meta';
  }

  return 'meta';
}

export function isMetaProject(project?: Project | null): boolean {
  return getProjectKind(project) === 'meta';
}

export function getMetaReviewType(project?: Project | null): string {
  const metadata = getProjectMetadata(project);
  const metaAnalysis = metadata.metaAnalysis;
  if (metaAnalysis && typeof metaAnalysis === 'object' && !Array.isArray(metaAnalysis)) {
    const reviewType = (metaAnalysis as Record<string, unknown>).reviewType;
    if (typeof reviewType === 'string' && reviewType.trim()) {
      return reviewType.trim();
    }
  }
  return '';
}
