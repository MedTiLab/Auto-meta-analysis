import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildAggregatedProjectReferences } from '../utils/project-reference-aggregate.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-project-refs-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writeJson(targetPath, payload) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('buildAggregatedProjectReferences', () => {
  it('merges linked database references with local artifact directories', async () => {
    const projectPath = await createTempProject();
    const artifactDir = path.join(projectPath, 'Literature', 'references', 'speech-biomarker');

    await fs.mkdir(artifactDir, { recursive: true });
    await Promise.all([
      writeJson(path.join(artifactDir, 'metadata.json'), {
        referenceId: 'zotero://speech-1',
        title: 'Speech Biomarkers for Clinical Assessment',
        authors: [{ family: 'Doe', given: 'Jane' }],
        year: 2025,
        abstract: 'Local project artifact for a linked reference.',
        doi: '10.1000/speech-1',
        citation_key: 'Doe2025Speech',
      }),
      fs.writeFile(path.join(artifactDir, 'note.md'), '# Speech Biomarkers\n', 'utf8'),
      fs.writeFile(path.join(artifactDir, 'extract.txt'), 'Abstract: Local project artifact for a linked reference.', 'utf8'),
      fs.writeFile(path.join(artifactDir, 'paper.pdf'), '%PDF-1.4\n', 'utf8'),
    ]);

    const linkedReferences = [{
      id: 'zotero://speech-1',
      user_id: 7,
      title: 'Speech Biomarkers for Clinical Assessment',
      authors: [{ family: 'Doe', given: 'Jane' }],
      year: 2025,
      abstract: null,
      doi: '10.1000/speech-1',
      url: null,
      journal: 'Clinical AI',
      item_type: 'journalArticle',
      source: 'zotero',
      source_id: 'speech-1',
      keywords: [],
      citation_key: 'Doe2025Speech',
      pdf_cached: 0,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
      linked_at: '2026-04-01T00:00:00.000Z',
    }];

    const aggregated = await buildAggregatedProjectReferences({
      projectPath,
      linkedReferences,
    });

    expect(aggregated.stats.total_count).toBe(1);
    expect(aggregated.stats.linked_count).toBe(1);
    expect(aggregated.stats.local_artifact_count).toBe(1);

    const [reference] = aggregated.references;
    expect(reference.origin).toBe('merged');
    expect(reference.project_linked).toBe(true);
    expect(reference.has_local_artifact).toBe(true);
    expect(reference.local_artifact_dir).toBe('Literature/references/speech-biomarker');
    expect(reference.local_pdf_path).toBe('Literature/references/speech-biomarker/paper.pdf');
    expect(reference.local_files).toContain('Literature/references/speech-biomarker/note.md');
    expect(reference.pdf_cached).toBe(1);
  });

  it('includes standalone local project reference files even when nothing is linked in the database', async () => {
    const projectPath = await createTempProject();
    const looseFile = path.join(projectPath, 'Literature', 'references', 'pilot-literature-note.md');
    await fs.mkdir(path.dirname(looseFile), { recursive: true });
    await fs.writeFile(looseFile, '# Pilot Literature Note\nSummary of three candidate papers.\n', 'utf8');

    const aggregated = await buildAggregatedProjectReferences({
      projectPath,
      linkedReferences: [],
    });

    expect(aggregated.stats.total_count).toBe(1);
    expect(aggregated.stats.linked_count).toBe(0);
    expect(aggregated.stats.local_only_count).toBe(1);

    const [reference] = aggregated.references;
    expect(reference.project_linked).toBe(false);
    expect(reference.has_local_artifact).toBe(true);
    expect(reference.origin).toBe('project_local');
    expect(reference.local_relative_path).toBe('Literature/references/pilot-literature-note.md');
    expect(reference.title).toBe('pilot literature note');
    expect(reference.abstract).toContain('Pilot Literature Note');
  });

  it('keeps Meta project references limited to full-text stage artifacts', async () => {
    const projectPath = await createTempProject();
    await writeJson(path.join(projectPath, 'instance.json'), {
      MetaAnalysis: {
        folderSchemaVersion: 'meta-v2',
      },
    });

    const seedReference = path.join(projectPath, '00_literature', 'references', 'seed-note.md');
    const legacyReference = path.join(projectPath, 'Literature', 'references', 'legacy-note.md');
    const fullTextReferenceDir = path.join(projectPath, '04_full_text_review', 'fulltext', 'searched-ref');
    await Promise.all([
      fs.mkdir(path.dirname(seedReference), { recursive: true }),
      fs.mkdir(path.dirname(legacyReference), { recursive: true }),
      fs.mkdir(fullTextReferenceDir, { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(seedReference, '# Seed Note\nThis belongs to literature reports, not project references.\n', 'utf8'),
      fs.writeFile(legacyReference, '# Legacy Note\nThis should not appear in Meta project literature.\n', 'utf8'),
      writeJson(path.join(fullTextReferenceDir, 'metadata.json'), {
        referenceId: 'pubmed_7_12345',
        title: 'Searched PubMed Record',
        source: 'pubmed',
      }),
    ]);

    const aggregated = await buildAggregatedProjectReferences({
      projectPath,
      linkedReferences: [{
        id: 'pubmed_7_12345',
        user_id: 7,
        title: 'Searched PubMed Record',
        source: 'pubmed',
        source_id: '12345',
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
        linked_at: '2026-04-01T00:00:00.000Z',
      }],
    });

    expect(aggregated.stats.total_count).toBe(1);
    expect(aggregated.stats.linked_count).toBe(0);
    expect(aggregated.stats.local_only_count).toBe(1);
    expect(aggregated.stats.local_artifact_count).toBe(1);

    const [reference] = aggregated.references;
    expect(reference.project_linked).toBe(false);
    expect(reference.origin).toBe('project_local');
    expect(reference.id).toBe('pubmed_7_12345');
    expect(reference.local_relative_path).toBe('04_full_text_review/fulltext/searched-ref');
    expect(aggregated.references.some((item) => item.local_relative_path === '00_literature/references/seed-note.md')).toBe(false);
    expect(aggregated.references.some((item) => item.local_relative_path === 'Literature/references/legacy-note.md')).toBe(false);
  });
});
