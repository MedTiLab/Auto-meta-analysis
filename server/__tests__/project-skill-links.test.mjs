import { afterEach, describe, expect, it } from 'vitest';
import { access, lstat, mkdir, mkdtemp, readFile, readlink, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { ensureProjectSkillLinks } from '../projects.js';

let tempProjectDir = null;

const META_NUMBERED_DIRS = [
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

async function expectDirectories(projectDir, relativePaths) {
  for (const relativePath of relativePaths) {
    await expect(access(path.join(projectDir, relativePath))).resolves.toBeUndefined();
  }
}

describe('project skill link bootstrap', () => {
  afterEach(async () => {
    if (tempProjectDir) {
      await rm(tempProjectDir, { recursive: true, force: true });
      tempProjectDir = null;
    }
  });

  it('creates Claude skill directories for Meta projects', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-project-skills-'));

    await ensureProjectSkillLinks(tempProjectDir);

    const claudeSkillsDir = path.join(tempProjectDir, '.claude', 'skills');
    const agentsSkillsDir = path.join(tempProjectDir, '.agents', 'skills');
    const linkedSkillPath = path.join(claudeSkillsDir, 'peer-review');
    const linkedLibrarySkillPath = path.join(agentsSkillsDir, 'library', 'literature-review');
    const tagMappingPath = path.join(claudeSkillsDir, 'skill-tag-mapping.json');

    const claudeDirStats = await lstat(claudeSkillsDir);
    const linkedSkillStats = await lstat(linkedSkillPath);
    const linkedLibrarySkillStats = await lstat(linkedLibrarySkillPath);
    const linkedSkillTarget = await readlink(linkedSkillPath);
    const linkedLibrarySkillTarget = await readlink(linkedLibrarySkillPath);
    const tagMappingTarget = await readlink(tagMappingPath);

    expect(claudeDirStats.isDirectory()).toBe(true);
    expect(linkedSkillStats.isSymbolicLink()).toBe(true);
    expect(linkedLibrarySkillStats.isSymbolicLink()).toBe(true);
    expect(path.isAbsolute(linkedSkillTarget)).toBe(false);
    expect(path.isAbsolute(linkedLibrarySkillTarget)).toBe(false);
    expect(path.isAbsolute(tagMappingTarget)).toBe(false);
    expect(path.resolve(path.dirname(linkedSkillPath), linkedSkillTarget)).toContain('/skills/peer-review');
    expect(path.resolve(path.dirname(linkedLibrarySkillPath), linkedLibrarySkillTarget)).toContain('/skills/literature-review');
    expect(path.resolve(path.dirname(tagMappingPath), tagMappingTarget)).toContain('/skills/skill-tag-mapping.json');
    await expectDirectories(tempProjectDir, META_NUMBERED_DIRS);
    const instance = JSON.parse(await readFile(path.join(tempProjectDir, 'instance.json'), 'utf8'));
    expect(instance.category).toBe('meta');
    expect(instance.MetaAnalysis.folderSchemaVersion).toBe('meta-v2');
  });

  it('treats unsupported legacy metadata as Meta-only numbered folders', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-meta-only-project-'));

    await ensureProjectSkillLinks(tempProjectDir, { metadata: { projectKind: 'legacy' } });

    await expectDirectories(tempProjectDir, META_NUMBERED_DIRS);
    await expect(access(path.join(tempProjectDir, 'Literature'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('creates numbered Meta folders and instance paths for new Meta projects', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-meta-v2-'));

    await ensureProjectSkillLinks(tempProjectDir, {
      metadata: {
        projectKind: 'meta',
        metaAnalysis: {
          folderSchemaVersion: 'clinical-meta-v2',
        },
      },
    });

    await expectDirectories(tempProjectDir, META_NUMBERED_DIRS);
    await expectDirectories(tempProjectDir, [
      '00_literature/reports',
      '00_literature/references',
      '00_literature/topic_selection',
      '00_literature/scoping_review',
    ]);
    await expect(access(path.join(tempProjectDir, 'Literature'))).rejects.toMatchObject({ code: 'ENOENT' });

    const instance = JSON.parse(await readFile(path.join(tempProjectDir, 'instance.json'), 'utf8'));
    expect(instance.category).toBe('meta');
    expect(instance.MetaAnalysis.folderSchemaVersion).toBe('meta-v2');
    expect(instance.MetaAnalysis).toMatchObject({
      literature: path.join(tempProjectDir, '00_literature'),
      literatureReports: path.join(tempProjectDir, '00_literature', 'reports'),
      literatureReferences: path.join(tempProjectDir, '00_literature', 'references'),
      topicSelection: path.join(tempProjectDir, '00_literature', 'topic_selection'),
      scopingReview: path.join(tempProjectDir, '00_literature', 'scoping_review'),
      protocol: path.join(tempProjectDir, '01_protocol'),
      searchDedupe: path.join(tempProjectDir, '02_search_dedupe'),
      titleAbstractScreening: path.join(tempProjectDir, '03_title_abstract_screening'),
      fullTextReview: path.join(tempProjectDir, '04_full_text_review'),
      dataExtraction: path.join(tempProjectDir, '05_data_extraction'),
      qualityAssessment: path.join(tempProjectDir, '06_quality_assessment'),
      dataAnalysis: path.join(tempProjectDir, '07_data_analysis'),
      resultsFigures: path.join(tempProjectDir, '08_results_figures'),
      manuscriptSubmission: path.join(tempProjectDir, '09_manuscript_submission'),
      presentation: path.join(tempProjectDir, '10_presentation'),
    });
  });

  it('keeps legacy Meta projects without meta-v2 on existing generic paths', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-meta-legacy-'));
    await mkdir(path.join(tempProjectDir, 'Literature', 'references'), { recursive: true });

    await ensureProjectSkillLinks(tempProjectDir, {
      metadata: {
        projectKind: 'meta',
        metaAnalysis: {
          reviewType: 'diagnostic',
        },
      },
    });

    await expectDirectories(tempProjectDir, [
      'Literature/references',
      'Literature/reports',
      'Ideation/ideas',
      'Experiment/datasets',
      'Experiment/analysis',
      'Publication/manuscript',
      'Publication/figures',
      'Publication/tables',
      'Publication/supplementary',
      'Promotion/slides',
    ]);
    await expect(access(path.join(tempProjectDir, '01_protocol'))).rejects.toMatchObject({ code: 'ENOENT' });

    const instance = JSON.parse(await readFile(path.join(tempProjectDir, 'instance.json'), 'utf8'));
    expect(instance.MetaAnalysis).toBeUndefined();
    expect(instance.Experiment.analysis).toBe(path.join(tempProjectDir, 'Experiment', 'analysis'));
  });
});
