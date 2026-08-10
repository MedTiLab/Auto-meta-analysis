import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { syncReferencesToMetaFullTextArtifacts } from '../utils/meta-full-text-reference-artifacts.js';

const cleanupTargets = [];

async function createTempMetaProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-meta-zotero-artifacts-'));
  cleanupTargets.push(projectPath);
  await fs.writeFile(
    path.join(projectPath, 'instance.json'),
    `${JSON.stringify({
      metadata: {
        projectKind: 'meta',
        metaAnalysis: {
          folderSchemaVersion: 'meta-v2',
        },
      },
    }, null, 2)}\n`,
    'utf8',
  );
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('meta full-text Zotero reference artifacts', () => {
  it('syncs Zotero reference metadata and PDFs into 04_full_text_review without Literature artifacts', async () => {
    const projectPath = await createTempMetaProject();
    const sourcePdfPath = path.join(projectPath, 'source.pdf');
    await fs.writeFile(sourcePdfPath, '%PDF-1.4\n', 'utf8');

    const reference = {
      id: 'zotero_1_ABCD1234',
      title: 'Diet Quality and Depression',
      authors: [{ family: 'Doe', given: 'Jane' }],
      year: 2025,
      abstract: 'A full-text review candidate.',
      doi: '10.1000/example',
      journal: 'Meta Methods',
      item_type: 'journalArticle',
      source: 'zotero',
      source_id: 'ABCD1234',
      keywords: ['diet'],
      citation_key: 'Doe2025Diet',
      raw_data: { PMID: '12345678' },
    };

    const result = await syncReferencesToMetaFullTextArtifacts({
      userId: 'user-1',
      projectPath,
      references: [reference],
      resolvePdfSource: async () => ({ pdfSourcePath: sourcePdfPath }),
    });

    expect(result.artifactMode).toBe('meta_full_text_review');
    expect(result.downloaded).toBe(1);
    expect(result.rows[0].metadata_path).toMatch(/^04_full_text_review\/fulltext\//);
    expect(result.rows[0].pdf_path).toMatch(/^04_full_text_review\/fulltext\//);

    const metadata = JSON.parse(await fs.readFile(path.join(projectPath, result.rows[0].metadata_path), 'utf8'));
    expect(metadata.referenceId).toBe(reference.id);
    expect(metadata.pmid).toBe('12345678');
    await expect(fs.access(path.join(projectPath, result.rows[0].pdf_path))).resolves.toBeUndefined();
    await expect(fs.access(path.join(projectPath, '04_full_text_review', 'zotero_references.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(projectPath, 'Literature'))).rejects.toThrow();
  });
});
