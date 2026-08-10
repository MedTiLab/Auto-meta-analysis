import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getReferenceArtifactPaths,
  removeReferenceArtifactsFromProject,
  syncReferencesToProjectArtifacts,
} from '../utils/reference-project-artifacts.js';
import { buildKnowledgeBaseManifest } from '../utils/project-knowledge-base.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-reference-artifacts-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('reference project artifacts', () => {
  it('creates canonical reference artifacts without duplicating them into the materials index', async () => {
    const projectPath = await createTempProject();
    const reference = {
      id: 'zotero://ABCD-1234',
      title: 'Speech Biomarkers for Pediatric Assessment',
      authors: [{ family: 'Doe', given: 'Jane' }],
      year: 2025,
      abstract: 'A project-ready reference artifact should stay in the literature workflow without duplicating into the workspace materials index.',
      journal: 'Journal of Clinical AI',
      item_type: 'journalArticle',
      source: 'zotero',
      source_id: 'ABCD1234',
      keywords: ['speech', 'pediatrics'],
      citation_key: 'Doe2025Speech',
    };

    const result = await syncReferencesToProjectArtifacts({
      projectPath,
      projectName: 'DemoProject',
      references: [reference],
    });

    const artifactPaths = getReferenceArtifactPaths(projectPath, reference.id);
    const [metadataRaw, noteRaw, extractRaw, manifestRaw] = await Promise.all([
      fs.readFile(artifactPaths.metadataPath, 'utf8'),
      fs.readFile(artifactPaths.notePath, 'utf8'),
      fs.readFile(artifactPaths.extractPath, 'utf8'),
      fs.readFile(result.kbPaths.manifestFile, 'utf8'),
    ]);

    const metadata = JSON.parse(metadataRaw);
    const manifest = JSON.parse(manifestRaw);

    expect(metadata.referenceId).toBe(reference.id);
    expect(metadata.artifactDir).toBe(artifactPaths.relativeArtifactDir);
    expect(metadata.files.note).toBe('note.md');
    expect(metadata.files.extract).toBe('extract.txt');
    expect(metadata.files.pdf).toBeNull();

    expect(noteRaw).toContain('# Speech Biomarkers for Pediatric Assessment');
    expect(noteRaw).toContain(`- Artifact directory: ${artifactPaths.relativeArtifactDir}`);
    expect(extractRaw).toContain('Title: Speech Biomarkers for Pediatric Assessment');
    expect(extractRaw).toContain('Abstract:');

    const relativeMetadataPath = `${artifactPaths.relativeArtifactDir}/metadata.json`;
    const relativeNotePath = `${artifactPaths.relativeArtifactDir}/note.md`;
    const relativeExtractPath = `${artifactPaths.relativeArtifactDir}/extract.txt`;

    expect(manifest.entryCount).toBe(0);
    expect(manifest.entries.some((entry) => entry.relativePath === relativeMetadataPath)).toBe(false);
    expect(manifest.entries.some((entry) => entry.relativePath === relativeNotePath)).toBe(false);
    expect(manifest.entries.some((entry) => entry.relativePath === relativeExtractPath)).toBe(false);
  });

  it('keeps reference artifacts out of the materials index even when extract.txt is present', async () => {
    const projectPath = await createTempProject();
    const artifactPaths = getReferenceArtifactPaths(projectPath, 'zotero://PDF-REF');
    await fs.mkdir(artifactPaths.artifactDir, { recursive: true });

    await Promise.all([
      fs.writeFile(
        artifactPaths.metadataPath,
        `${JSON.stringify({
          referenceId: 'zotero://PDF-REF',
          title: 'Visible Extract Only',
          abstract: 'Prefer the extracted text entry over the binary PDF entry.',
          keywords: ['retrieval'],
          source: 'zotero',
          item_type: 'journalArticle',
        }, null, 2)}\n`,
        'utf8',
      ),
      fs.writeFile(artifactPaths.notePath, '# Visible Extract Only\n', 'utf8'),
      fs.writeFile(artifactPaths.extractPath, 'Extracted body text', 'utf8'),
      fs.writeFile(artifactPaths.pdfPath, '%PDF-1.4\n', 'utf8'),
    ]);

    const manifest = await buildKnowledgeBaseManifest(projectPath, 'DemoProject');
    const relativePdfPath = `${artifactPaths.relativeArtifactDir}/paper.pdf`;
    const relativeExtractPath = `${artifactPaths.relativeArtifactDir}/extract.txt`;

    expect(manifest.entries.some((entry) => entry.relativePath === relativePdfPath)).toBe(false);
    expect(manifest.entries.some((entry) => entry.relativePath === relativeExtractPath)).toBe(false);
  });

  it('indexes seed reference notes from Meta 00_literature references', async () => {
    const projectPath = await createTempProject();
    const seedReferencePath = path.join(projectPath, '00_literature', 'references', 'seed-reference.md');
    await fs.mkdir(path.dirname(seedReferencePath), { recursive: true });
    await fs.writeFile(
      seedReferencePath,
      '# Seed Reference\n\nThis note should be searchable from the Meta literature workspace materials index.\n',
      'utf8',
    );

    const manifest = await buildKnowledgeBaseManifest(projectPath, 'MetaDemoProject');
    const entry = manifest.entries.find((item) => item.relativePath === '00_literature/references/seed-reference.md');

    expect(entry).toBeTruthy();
    expect(entry.sourceType).toBe('literature_reference');
    expect(entry.tags).toEqual(expect.arrayContaining(['literature', 'reference', 'meta', 'md']));
    expect(entry.summary).toContain('Meta literature workspace materials index');
  });

  it('removes artifact directories and refreshes the knowledge base manifest', async () => {
    const projectPath = await createTempProject();
    const reference = {
      id: 'zotero://TO-REMOVE',
      title: 'Disposable Reference',
      abstract: 'This artifact should disappear cleanly from the workspace materials index.',
      authors: [],
      keywords: [],
    };

    await syncReferencesToProjectArtifacts({
      projectPath,
      projectName: 'DemoProject',
      references: [reference],
    });

    const artifactPaths = getReferenceArtifactPaths(projectPath, reference.id);
    expect(await fs.stat(artifactPaths.artifactDir)).toBeTruthy();

    const removal = await removeReferenceArtifactsFromProject({
      projectPath,
      projectName: 'DemoProject',
      referenceIds: [reference.id],
    });

    await expect(fs.stat(artifactPaths.artifactDir)).rejects.toThrow();
    expect(removal.removed).toContain(artifactPaths.relativeArtifactDir);
    expect(removal.manifest.entryCount).toBe(0);
  });
});
