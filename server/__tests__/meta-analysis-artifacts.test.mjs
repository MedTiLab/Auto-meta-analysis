import { access, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  META_NUMBERED_FOLDER_SCHEMA_VERSION,
  META_NUMBERED_WORKFLOW_DIRS,
  ensureMetaAnalysisProjectDirs,
  getMetaAnalysisRunDir,
  getMetaDatasetPaths,
  getMetaManuscriptPaths,
  getMetaPublicationPaths,
  getMetaReferencePaths,
  getMetaStageDirs,
  normalizeMetaFolderSchemaVersion,
  toProjectRelativePath,
} from '../utils/meta-analysis-artifacts.js';

let tempProjectDir = null;

async function createTempProject() {
  tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-meta-artifacts-'));
  return tempProjectDir;
}

async function expectDirectories(projectDir, relativePaths) {
  for (const relativePath of relativePaths) {
    await expect(access(path.join(projectDir, relativePath))).resolves.toBeUndefined();
  }
}

async function expectMissingDirectories(projectDir, relativePaths) {
  for (const relativePath of relativePaths) {
    await expect(access(path.join(projectDir, relativePath))).rejects.toThrow();
  }
}

afterEach(async () => {
  if (tempProjectDir) {
    await rm(tempProjectDir, { recursive: true, force: true });
    tempProjectDir = null;
  }
});

describe('meta-analysis artifact paths', () => {
  it('normalizes the legacy clinical-meta-v2 schema alias to meta-v2', () => {
    expect(normalizeMetaFolderSchemaVersion('clinical-meta-v2')).toBe(META_NUMBERED_FOLDER_SCHEMA_VERSION);
  });

  it('materializes meta-v2 numbered workflow roots and routes artifacts to Meta steps', async () => {
    const projectDir = await createTempProject();
    const options = { folderSchemaVersion: META_NUMBERED_FOLDER_SCHEMA_VERSION };

    const dirs = ensureMetaAnalysisProjectDirs(projectDir, options);
    const datasetPaths = getMetaDatasetPaths(projectDir, options);
    const referencePaths = getMetaReferencePaths(projectDir, 'reference:alpha', {
      ...options,
      referenceTitle: 'Diagnostic Biomarker Accuracy in Lung Cancer',
    });
    const manuscriptPaths = getMetaManuscriptPaths(projectDir, options);
    const publicationPaths = getMetaPublicationPaths(projectDir, options);
    const runDir = getMetaAnalysisRunDir(projectDir, 'run:alpha', options);

    await expectDirectories(projectDir, META_NUMBERED_WORKFLOW_DIRS);
    await expectDirectories(projectDir, [
      '00_literature/reports',
      '00_literature/references',
      '00_literature/topic_selection',
      '00_literature/scoping_review',
      '02_search_dedupe/search/imported_records',
      '02_search_dedupe/search/pubmed_runs',
      '03_title_abstract_screening/01_ai_pre_screen',
      '03_title_abstract_screening/02_agent_rescreen',
      '04_full_text_review/fulltext',
    ]);
    await expectMissingDirectories(projectDir, [
      '04_full_text_review/01_ai_pre_screen',
      '04_full_text_review/02_agent_rescreen',
    ]);
    expect(dirs.folderSchemaVersion).toBe(META_NUMBERED_FOLDER_SCHEMA_VERSION);
    expect(toProjectRelativePath(projectDir, dirs.literatureReportsDir)).toBe('00_literature/reports');
    expect(toProjectRelativePath(projectDir, dirs.protocolDir)).toBe('01_protocol');
    expect(toProjectRelativePath(projectDir, dirs.searchDir)).toBe('02_search_dedupe/search');
    expect(toProjectRelativePath(projectDir, dirs.titleAbstractPreScreenDir)).toBe('03_title_abstract_screening/01_ai_pre_screen');
    expect(toProjectRelativePath(projectDir, dirs.titleAbstractRescreenDir)).toBe('03_title_abstract_screening/02_agent_rescreen');
    expect(toProjectRelativePath(projectDir, datasetPaths.diagnosticDatasetPath)).toBe('05_data_extraction/diagnostic_dataset.csv');
    expect(toProjectRelativePath(projectDir, referencePaths.pdfPath)).toMatch(/^04_full_text_review\/fulltext\/reference_alpha-[a-f0-9]{10}\/Diagnostic Biomarker Accuracy in Lung Cancer\.pdf$/);
    expect(toProjectRelativePath(projectDir, referencePaths.markdownPath)).toMatch(/^04_full_text_review\/fulltext\/reference_alpha-[a-f0-9]{10}\/mineru\/Diagnostic Biomarker Accuracy in Lung Cancer\.md$/);
    expect(toProjectRelativePath(projectDir, referencePaths.diagnosticConfirmedPath)).toMatch(/^05_data_extraction\/extraction\/reference_alpha-[a-f0-9]{10}\/diagnostic_confirmed\.json$/);
    expect(toProjectRelativePath(projectDir, runDir)).toMatch(/^07_data_analysis\/runs\/run_alpha-[a-f0-9]{10}$/);
    expect(toProjectRelativePath(projectDir, manuscriptPaths.manuscriptMarkdownPath)).toBe('09_manuscript_submission/manuscript.md');
    expect(toProjectRelativePath(projectDir, publicationPaths.figuresDir)).toBe('08_results_figures');
    expect(getMetaStageDirs(projectDir, options).qualityAssessment).toBe('06_quality_assessment');
  });

  it('keeps legacy Meta artifact roots when no numbered schema is present', async () => {
    const projectDir = await createTempProject();

    const dirs = ensureMetaAnalysisProjectDirs(projectDir);
    const datasetPaths = getMetaDatasetPaths(projectDir);
    const referencePaths = getMetaReferencePaths(projectDir, 'reference:legacy');
    const manuscriptPaths = getMetaManuscriptPaths(projectDir);
    const publicationPaths = getMetaPublicationPaths(projectDir);
    const runDir = getMetaAnalysisRunDir(projectDir, 'run:legacy');

    await expectDirectories(projectDir, [
      'Literature/references/search/pubmed_runs',
      'Experiment/datasets',
      'Experiment/analysis/runs',
      'Publication/manuscript/sections',
      'Publication/figures',
      'Publication/tables',
      'Publication/supplementary',
    ]);
    expect(dirs.folderSchemaVersion).toBeNull();
    expect(toProjectRelativePath(projectDir, datasetPaths.diagnosticDatasetPath)).toBe('Experiment/datasets/diagnostic_dataset.csv');
    expect(toProjectRelativePath(projectDir, referencePaths.pdfPath)).toMatch(/^Experiment\/analysis\/fulltext\/reference_legacy-[a-f0-9]{10}\/paper\.pdf$/);
    expect(toProjectRelativePath(projectDir, runDir)).toMatch(/^Experiment\/analysis\/runs\/run_legacy-[a-f0-9]{10}$/);
    expect(toProjectRelativePath(projectDir, manuscriptPaths.manuscriptMarkdownPath)).toBe('Publication/manuscript/manuscript.md');
    expect(toProjectRelativePath(projectDir, publicationPaths.figuresDir)).toBe('Publication/figures');
  });

  it('detects meta-v2 from instance.json for callers without explicit options', async () => {
    const projectDir = await createTempProject();
    await writeFile(path.join(projectDir, 'instance.json'), `${JSON.stringify({
      MetaAnalysis: {
        folderSchemaVersion: META_NUMBERED_FOLDER_SCHEMA_VERSION,
      },
    }, null, 2)}\n`, 'utf8');

    const dirs = ensureMetaAnalysisProjectDirs(projectDir);
    const instance = JSON.parse(await readFile(path.join(projectDir, 'instance.json'), 'utf8'));

    expect(instance.MetaAnalysis.folderSchemaVersion).toBe(META_NUMBERED_FOLDER_SCHEMA_VERSION);
    expect(dirs.folderSchemaVersion).toBe(META_NUMBERED_FOLDER_SCHEMA_VERSION);
    expect(toProjectRelativePath(projectDir, getMetaDatasetPaths(projectDir).diagnosticDatasetPath)).toBe('05_data_extraction/diagnostic_dataset.csv');
  });
});
