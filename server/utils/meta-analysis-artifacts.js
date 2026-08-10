import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const META_FOLDER_SCHEMA_VERSION = 'meta-v2';
export const META_LEGACY_FOLDER_SCHEMA_VERSION = 'clinical-meta-v2';
export const META_NUMBERED_FOLDER_SCHEMA_VERSION = META_FOLDER_SCHEMA_VERSION;

export const META_NUMBERED_WORKFLOW_DIRS = [
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
];

export const META_LEGACY_STAGE_DIRS = {
  literatureReports: 'Literature/reports',
  literatureReferences: 'Literature/references',
  ideationIdeas: 'Ideation/ideas',
  experimentDatasets: 'Experiment/datasets',
  experimentAnalysis: 'Experiment/analysis',
  publicationManuscript: 'Publication/manuscript',
  publicationFigures: 'Publication/figures',
  publicationTables: 'Publication/tables',
  publicationSupplementary: 'Publication/supplementary',
  promotionHomepage: 'Promotion/homepage',
  promotionSlides: 'Promotion/slides',
  promotionAudio: 'Promotion/audio',
  promotionVideo: 'Promotion/video',
};

export const META_NUMBERED_STAGE_DIRS = {
  literature: '00_literature',
  protocol: '01_protocol',
  searchDedupe: '02_search_dedupe',
  titleAbstractScreening: '03_title_abstract_screening',
  fullTextReview: '04_full_text_review',
  dataExtraction: '05_data_extraction',
  qualityAssessment: '06_quality_assessment',
  dataAnalysis: '07_data_analysis',
  resultsFigures: '08_results_figures',
  manuscriptSubmission: '09_manuscript_submission',
  presentation: '10_presentation',
  literatureReports: '00_literature/reports',
  literatureReferences: '00_literature/references',
  ideationIdeas: '00_literature/topic_selection',
  scopingReview: '00_literature/scoping_review',
  experimentDatasets: '05_data_extraction',
  experimentAnalysis: '07_data_analysis',
  publicationManuscript: '09_manuscript_submission',
  publicationFigures: '08_results_figures',
  publicationTables: '08_results_figures',
  publicationSupplementary: '09_manuscript_submission',
  promotionHomepage: '10_presentation',
  promotionSlides: '10_presentation',
  promotionAudio: '10_presentation',
  promotionVideo: '10_presentation',
};

export const META_STAGE_DIRS = META_LEGACY_STAGE_DIRS;

function normalizeProjectPath(projectPath) {
  if (!projectPath || !path.isAbsolute(projectPath)) {
    throw new Error('An absolute projectPath is required');
  }
  return path.resolve(projectPath);
}

export function normalizeMetaFolderSchemaVersion(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === META_FOLDER_SCHEMA_VERSION || normalized === META_LEGACY_FOLDER_SCHEMA_VERSION) {
    return META_FOLDER_SCHEMA_VERSION;
  }
  return null;
}

function readMetaFolderSchemaVersion(projectPath) {
  if (!projectPath) {
    return null;
  }

  try {
    const rawInstance = fs.readFileSync(path.join(normalizeProjectPath(projectPath), 'instance.json'), 'utf8');
    const instance = JSON.parse(rawInstance);
    return normalizeMetaFolderSchemaVersion(
      instance?.MetaAnalysis?.folderSchemaVersion
      || instance?.metaAnalysis?.folderSchemaVersion
      || instance?.metadata?.metaAnalysis?.folderSchemaVersion,
    );
  } catch {
    return null;
  }
}

export function getMetaFolderSchemaVersion(projectPath, options = {}) {
  return normalizeMetaFolderSchemaVersion(
    options.folderSchemaVersion
    || options.metaAnalysis?.folderSchemaVersion
    || options.metadata?.metaAnalysis?.folderSchemaVersion,
  ) || readMetaFolderSchemaVersion(projectPath);
}

export function isNumberedMetaFolderSchema(projectPath, options = {}) {
  return getMetaFolderSchemaVersion(projectPath, options) === META_NUMBERED_FOLDER_SCHEMA_VERSION;
}

export function getMetaStageDirs(projectPath, options = {}) {
  return isNumberedMetaFolderSchema(projectPath, options)
    ? META_NUMBERED_STAGE_DIRS
    : META_LEGACY_STAGE_DIRS;
}

function sanitizeSegment(value, fallback) {
  const raw = String(value || fallback || '').trim();
  const normalized = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 96);
  const digest = crypto.createHash('sha1').update(raw || fallback || 'meta').digest('hex').slice(0, 10);
  return `${normalized || fallback}-${digest}`;
}

function sanitizeFileStem(value, fallback) {
  const raw = String(value || fallback || '').trim();
  return raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 140)
    || fallback;
}

function assertInsideProject(projectPath, targetPath) {
  const projectRoot = normalizeProjectPath(projectPath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== projectRoot && !resolvedTarget.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Resolved meta-analysis artifact path escapes project root: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

function joinInsideProject(projectPath, ...segments) {
  return assertInsideProject(projectPath, path.join(normalizeProjectPath(projectPath), ...segments));
}

export function getMetaAnalysisRoot(projectPath, options = {}) {
  const dirs = getMetaStageDirs(projectPath, options);
  return joinInsideProject(projectPath, dirs.experimentAnalysis);
}

export function getMetaReferenceDir(projectPath, referenceId, options = {}) {
  const dirs = getMetaStageDirs(projectPath, options);
  const rootDir = dirs.fullTextReview || dirs.experimentAnalysis;
  return joinInsideProject(
    projectPath,
    rootDir,
    'fulltext',
    sanitizeSegment(referenceId, 'reference'),
  );
}

export function getMetaReferencePaths(projectPath, referenceId, options = {}) {
  const dirs = getMetaStageDirs(projectPath, options);
  const referenceDir = getMetaReferenceDir(projectPath, referenceId, options);
  const mineruDir = assertInsideProject(projectPath, path.join(referenceDir, 'mineru'));
  const artifactBasename = sanitizeFileStem(
    options.referenceTitle || options.title || options.reference?.title,
    'paper',
  );
  const extractionDir = dirs.dataExtraction
    ? joinInsideProject(projectPath, dirs.dataExtraction, 'extraction', sanitizeSegment(referenceId, 'reference'))
    : assertInsideProject(projectPath, path.join(referenceDir, 'extraction'));
  const relativeReferenceDir = path
    .relative(normalizeProjectPath(projectPath), referenceDir)
    .split(path.sep)
    .join('/');

  return {
    referenceDir,
    relativeReferenceDir,
    artifactBasename,
    metadataPath: assertInsideProject(projectPath, path.join(referenceDir, 'metadata.json')),
    pdfPath: assertInsideProject(projectPath, path.join(referenceDir, `${artifactBasename}.pdf`)),
    mineruDir,
    markdownPath: assertInsideProject(projectPath, path.join(mineruDir, `${artifactBasename}.md`)),
    tablesPath: assertInsideProject(projectPath, path.join(mineruDir, 'tables.json')),
    figuresDir: assertInsideProject(projectPath, path.join(mineruDir, 'figures')),
    pageMapPath: assertInsideProject(projectPath, path.join(mineruDir, 'page_map.json')),
    parseReportPath: assertInsideProject(projectPath, path.join(mineruDir, 'parse_report.json')),
    extractionDir,
    diagnosticCandidatesPath: assertInsideProject(projectPath, path.join(extractionDir, 'diagnostic_candidates.json')),
    diagnosticConfirmedPath: assertInsideProject(projectPath, path.join(extractionDir, 'diagnostic_confirmed.json')),
  };
}

export function getMetaDatasetPaths(projectPath, options = {}) {
  const dirs = getMetaStageDirs(projectPath, options);
  const datasetsDir = joinInsideProject(projectPath, dirs.experimentDatasets);
  return {
    datasetsDir,
    diagnosticDatasetPath: assertInsideProject(projectPath, path.join(datasetsDir, 'diagnostic_dataset.csv')),
    diagnosticExcludedDatasetPath: assertInsideProject(projectPath, path.join(datasetsDir, 'diagnostic_dataset_excluded.csv')),
  };
}

export function getMetaAnalysisRunDir(projectPath, analysisRunId, options = {}) {
  const dirs = getMetaStageDirs(projectPath, options);
  return joinInsideProject(
    projectPath,
    dirs.experimentAnalysis,
    'runs',
    sanitizeSegment(analysisRunId, 'analysis_run'),
  );
}

export function getMetaManuscriptPaths(projectPath, options = {}) {
  const dirs = getMetaStageDirs(projectPath, options);
  const manuscriptDir = joinInsideProject(projectPath, dirs.publicationManuscript);
  const sectionsDir = assertInsideProject(projectPath, path.join(manuscriptDir, 'sections'));
  return {
    manuscriptDir,
    sectionsDir,
    manuscriptMarkdownPath: assertInsideProject(projectPath, path.join(manuscriptDir, 'manuscript.md')),
    manuscriptDocxPath: assertInsideProject(projectPath, path.join(manuscriptDir, 'manuscript.docx')),
  };
}

export function getMetaPublicationPaths(projectPath, options = {}) {
  const dirs = getMetaStageDirs(projectPath, options);
  return {
    figuresDir: joinInsideProject(projectPath, dirs.publicationFigures),
    tablesDir: joinInsideProject(projectPath, dirs.publicationTables),
    supplementaryDir: joinInsideProject(projectPath, dirs.publicationSupplementary),
  };
}

export function ensureMetaAnalysisProjectDirs(projectPath, options = {}) {
  const dirsForSchema = getMetaStageDirs(projectPath, options);
  const numberedSchema = isNumberedMetaFolderSchema(projectPath, options);
  const manuscriptPaths = getMetaManuscriptPaths(projectPath, options);
  const datasetPaths = getMetaDatasetPaths(projectPath, options);
  const publicationPaths = getMetaPublicationPaths(projectPath, options);
  const experimentAnalysisDir = getMetaAnalysisRoot(projectPath, options);
  const literatureReportsDir = joinInsideProject(projectPath, dirsForSchema.literatureReports);
  const literatureReferencesDir = joinInsideProject(projectPath, dirsForSchema.literatureReferences);
  const ideationIdeasDir = joinInsideProject(projectPath, dirsForSchema.ideationIdeas);
  const scopingReviewDir = dirsForSchema.scopingReview
    ? joinInsideProject(projectPath, dirsForSchema.scopingReview)
    : null;
  const protocolDir = joinInsideProject(projectPath, dirsForSchema.protocol || dirsForSchema.ideationIdeas);
  const searchDedupeDir = joinInsideProject(projectPath, dirsForSchema.searchDedupe || dirsForSchema.literatureReferences);
  const titleAbstractScreeningDir = dirsForSchema.titleAbstractScreening
    ? joinInsideProject(projectPath, dirsForSchema.titleAbstractScreening)
    : null;
  const fullTextReviewDir = joinInsideProject(projectPath, dirsForSchema.fullTextReview || dirsForSchema.experimentAnalysis);
  const dataExtractionDir = joinInsideProject(projectPath, dirsForSchema.dataExtraction || dirsForSchema.experimentDatasets);
  const qualityDir = joinInsideProject(projectPath, dirsForSchema.qualityAssessment || path.join(dirsForSchema.experimentAnalysis, 'quality'));
  const resultsFiguresDir = joinInsideProject(projectPath, dirsForSchema.resultsFigures || dirsForSchema.publicationFigures);
  const presentationDir = joinInsideProject(projectPath, dirsForSchema.presentation || 'Promotion');
  const searchDir = assertInsideProject(projectPath, path.join(searchDedupeDir, 'search'));
  const pubmedRunsDir = assertInsideProject(projectPath, path.join(searchDir, 'pubmed_runs'));
  const importedRecordsDir = assertInsideProject(projectPath, path.join(searchDir, 'imported_records'));
  const titleAbstractPreScreenDir = titleAbstractScreeningDir
    ? assertInsideProject(projectPath, path.join(titleAbstractScreeningDir, '01_ai_pre_screen'))
    : null;
  const titleAbstractRescreenDir = titleAbstractScreeningDir
    ? assertInsideProject(projectPath, path.join(titleAbstractScreeningDir, '02_agent_rescreen'))
    : null;
  const fulltextDir = assertInsideProject(projectPath, path.join(fullTextReviewDir, 'fulltext'));
  const extractionDir = assertInsideProject(projectPath, path.join(dataExtractionDir, 'extraction'));
  const analysisRunsDir = assertInsideProject(projectPath, path.join(experimentAnalysisDir, 'runs'));

  const dirs = [
    ...(numberedSchema ? META_NUMBERED_WORKFLOW_DIRS.map((dir) => joinInsideProject(projectPath, dir)) : []),
    literatureReportsDir,
    literatureReferencesDir,
    ideationIdeasDir,
    scopingReviewDir,
    protocolDir,
    searchDedupeDir,
    titleAbstractScreeningDir,
    titleAbstractPreScreenDir,
    titleAbstractRescreenDir,
    fullTextReviewDir,
    dataExtractionDir,
    searchDir,
    pubmedRunsDir,
    importedRecordsDir,
    experimentAnalysisDir,
    fulltextDir,
    extractionDir,
    qualityDir,
    resultsFiguresDir,
    datasetPaths.datasetsDir,
    analysisRunsDir,
    manuscriptPaths.manuscriptDir,
    manuscriptPaths.sectionsDir,
    publicationPaths.figuresDir,
    publicationPaths.tablesDir,
    publicationPaths.supplementaryDir,
    presentationDir,
    ...(
      numberedSchema
        ? []
        : [
            joinInsideProject(projectPath, dirsForSchema.promotionHomepage),
            joinInsideProject(projectPath, dirsForSchema.promotionSlides),
            joinInsideProject(projectPath, dirsForSchema.promotionAudio),
            joinInsideProject(projectPath, dirsForSchema.promotionVideo),
          ]
    ),
  ].filter(Boolean);

  for (const dir of dirs) {
    fs.mkdirSync(assertInsideProject(projectPath, dir), { recursive: true });
  }

  return {
    root: experimentAnalysisDir,
    folderSchemaVersion: getMetaFolderSchemaVersion(projectPath, options),
    workflowDirs: numberedSchema ? META_NUMBERED_WORKFLOW_DIRS : [],
    literatureReportsDir,
    referencesDir: literatureReferencesDir,
    literatureReferencesDir,
    topicSelectionDir: ideationIdeasDir,
    scopingReviewDir,
    protocolDir,
    searchDedupeDir,
    titleAbstractScreeningDir,
    titleAbstractPreScreenDir,
    titleAbstractRescreenDir,
    fullTextReviewDir,
    dataExtractionDir,
    searchDir,
    pubmedRunsDir,
    importedRecordsDir,
    fulltextDir,
    extractionDir,
    qualityDir,
    ...datasetPaths,
    analysisRunsDir,
    ...manuscriptPaths,
    ...publicationPaths,
  };
}

export function toProjectRelativePath(projectPath, targetPath) {
  return path.relative(normalizeProjectPath(projectPath), assertInsideProject(projectPath, targetPath)).split(path.sep).join('/');
}

export function resolveMetaProjectPath(projectPath, relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) {
    return null;
  }
  const candidate = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(normalizeProjectPath(projectPath), relativeOrAbsolutePath);
  return assertInsideProject(projectPath, candidate);
}
