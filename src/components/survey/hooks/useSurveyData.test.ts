import { describe, expect, it } from 'vitest';

import { flattenStageFiles, flattenSurveyFiles } from './useSurveyData';

describe('flattenSurveyFiles', () => {
  it('keeps Zotero-generated reference internals out of literature notes', () => {
    const projectRoot = '/workspace/demo';
    const tree: Parameters<typeof flattenSurveyFiles>[0] = [
      {
        name: '04_full_text_review',
        type: 'directory',
        children: [
          {
            name: 'fulltext',
            type: 'directory',
            children: [
              {
                name: 'zotero-ref',
                type: 'directory',
                children: [
                  {
                    name: 'metadata.json',
                    type: 'file',
                    path: `${projectRoot}/04_full_text_review/fulltext/zotero-ref/metadata.json`,
                  },
                  {
                    name: 'note.md',
                    type: 'file',
                    path: `${projectRoot}/04_full_text_review/fulltext/zotero-ref/note.md`,
                  },
                  {
                    name: 'extract.txt',
                    type: 'file',
                    path: `${projectRoot}/04_full_text_review/fulltext/zotero-ref/extract.txt`,
                  },
                  {
                    name: 'paper.pdf',
                    type: 'file',
                    path: `${projectRoot}/04_full_text_review/fulltext/zotero-ref/paper.pdf`,
                  },
                  {
                    name: 'reading-summary.md',
                    type: 'file',
                    path: `${projectRoot}/04_full_text_review/fulltext/zotero-ref/reading-summary.md`,
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const files = flattenSurveyFiles(tree, projectRoot);
    const relativePaths = files.map((file) => file.relativePath);

    expect(relativePaths).not.toContain('04_full_text_review/fulltext/zotero-ref/metadata.json');
    expect(relativePaths).not.toContain('04_full_text_review/fulltext/zotero-ref/note.md');
    expect(relativePaths).not.toContain('04_full_text_review/fulltext/zotero-ref/extract.txt');
    expect(relativePaths).not.toContain('04_full_text_review/fulltext/zotero-ref/paper.pdf');
    expect(relativePaths).toContain('04_full_text_review/fulltext/zotero-ref/reading-summary.md');
    expect(files.find((file) => file.name === 'reading-summary.md')?.category).toBe('notes');
  });

  it('scans stage pdf/html/markdown files from numbered Meta folders', () => {
    const projectRoot = '/workspace/demo';
    const tree: Parameters<typeof flattenStageFiles>[0] = [
      {
        name: '04_full_text_review',
        type: 'directory',
        children: [
          {
            name: 'fulltext',
            type: 'directory',
            children: [
              { name: 'paper.pdf', type: 'file', path: `${projectRoot}/04_full_text_review/fulltext/ref/paper.pdf` },
              { name: 'paper.md', type: 'file', path: `${projectRoot}/04_full_text_review/fulltext/ref/paper.md` },
              { name: 'paper.html', type: 'file', path: `${projectRoot}/04_full_text_review/fulltext/ref/paper.html` },
              { name: 'screening.csv', type: 'file', path: `${projectRoot}/04_full_text_review/fulltext/ref/screening.csv` },
              { name: 'extraction.xlsx', type: 'file', path: `${projectRoot}/04_full_text_review/fulltext/ref/extraction.xlsx` },
              { name: 'review.docx', type: 'file', path: `${projectRoot}/04_full_text_review/fulltext/ref/review.docx` },
              { name: 'metadata.json', type: 'file', path: `${projectRoot}/04_full_text_review/fulltext/ref/metadata.json` },
              { name: 'run.log', type: 'file', path: `${projectRoot}/04_full_text_review/fulltext/ref/run.log` },
              { name: 'config.yaml', type: 'file', path: `${projectRoot}/04_full_text_review/fulltext/ref/config.yaml` },
            ],
          },
        ],
      },
    ];

    const relativePaths = flattenStageFiles(tree, projectRoot).map((file) => file.relativePath);

    expect(relativePaths).toEqual([
      '04_full_text_review/fulltext/ref/extraction.xlsx',
      '04_full_text_review/fulltext/ref/paper.html',
      '04_full_text_review/fulltext/ref/paper.md',
      '04_full_text_review/fulltext/ref/paper.pdf',
      '04_full_text_review/fulltext/ref/review.docx',
      '04_full_text_review/fulltext/ref/screening.csv',
    ]);
  });

  it('keeps machine-readable artifacts out of literature library sections', () => {
    const projectRoot = '/workspace/demo';
    const tree: Parameters<typeof flattenSurveyFiles>[0] = [
      {
        name: '00_literature',
        type: 'directory',
        children: [
          {
            name: 'reports',
            type: 'directory',
            children: [
              { name: 'summary.md', type: 'file', path: `${projectRoot}/00_literature/reports/summary.md` },
              { name: 'included-table.csv', type: 'file', path: `${projectRoot}/00_literature/reports/included-table.csv` },
              { name: 'evidence.xlsx', type: 'file', path: `${projectRoot}/00_literature/reports/evidence.xlsx` },
              { name: 'protocol.docx', type: 'file', path: `${projectRoot}/00_literature/reports/protocol.docx` },
              { name: 'raw-records.json', type: 'file', path: `${projectRoot}/00_literature/reports/raw-records.json` },
              { name: 'events.jsonl', type: 'file', path: `${projectRoot}/00_literature/reports/events.jsonl` },
              { name: 'run.log', type: 'file', path: `${projectRoot}/00_literature/reports/run.log` },
              { name: 'config.yaml', type: 'file', path: `${projectRoot}/00_literature/reports/config.yaml` },
            ],
          },
        ],
      },
    ];

    const relativePaths = flattenSurveyFiles(tree, projectRoot).map((file) => file.relativePath);

    expect(relativePaths).toEqual([
      '00_literature/reports/evidence.xlsx',
      '00_literature/reports/included-table.csv',
      '00_literature/reports/protocol.docx',
      '00_literature/reports/summary.md',
    ]);
  });
});
