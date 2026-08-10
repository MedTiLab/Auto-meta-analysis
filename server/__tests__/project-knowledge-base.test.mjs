import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildKnowledgeBaseManifest } from '../utils/project-knowledge-base.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-kb-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('project knowledge base manifest', () => {
  it('indexes readable documents and tables while excluding machine artifacts', async () => {
    const projectPath = await createTempProject();
    const reportsDir = path.join(projectPath, 'reports');
    await fs.mkdir(reportsDir, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(reportsDir, 'summary.md'), '# Summary\n\nReadable synthesis.\n', 'utf8'),
      fs.writeFile(path.join(reportsDir, 'included-table.csv'), 'study,effect\nA,1.2\n', 'utf8'),
      fs.writeFile(path.join(reportsDir, 'evidence.xlsx'), 'xlsx placeholder', 'utf8'),
      fs.writeFile(path.join(reportsDir, 'protocol.docx'), 'docx placeholder', 'utf8'),
      fs.writeFile(path.join(reportsDir, 'report.pdf'), '%PDF-1.4\n', 'utf8'),
      fs.writeFile(path.join(reportsDir, 'raw-records.json'), '{"records":[]}\n', 'utf8'),
      fs.writeFile(path.join(reportsDir, 'events.jsonl'), '{"event":"run"}\n', 'utf8'),
      fs.writeFile(path.join(reportsDir, 'run.log'), 'debug log line\n', 'utf8'),
      fs.writeFile(path.join(reportsDir, 'config.yaml'), 'debug: true\n', 'utf8'),
      fs.writeFile(path.join(reportsDir, 'archive.zip'), 'zip placeholder', 'utf8'),
      fs.writeFile(path.join(reportsDir, 'model.pkl'), 'pickle placeholder', 'utf8'),
    ]);

    const manifest = await buildKnowledgeBaseManifest(projectPath, 'KnowledgeProject');
    const relativePaths = new Set(manifest.entries.map((entry) => entry.relativePath));

    expect(relativePaths).toEqual(new Set([
      'reports/evidence.xlsx',
      'reports/included-table.csv',
      'reports/protocol.docx',
      'reports/report.pdf',
      'reports/summary.md',
    ]));

    expect(manifest.entries.find((entry) => entry.relativePath === 'reports/included-table.csv')?.kind).toBe('text');
    expect(manifest.entries.find((entry) => entry.relativePath === 'reports/protocol.docx')?.kind).toBe('metadata');
    expect(manifest.entries.find((entry) => entry.relativePath === 'reports/raw-records.json')).toBeUndefined();
    expect(manifest.entries.find((entry) => entry.relativePath === 'reports/events.jsonl')).toBeUndefined();
    expect(manifest.entries.find((entry) => entry.relativePath === 'reports/run.log')).toBeUndefined();
    expect(manifest.entries.find((entry) => entry.relativePath === 'reports/config.yaml')).toBeUndefined();
  });
});
