import { describe, expect, it } from 'vitest';

import {
  isExternalHref,
  isLikelyChatFilePath,
  normalizeChatFilePath,
  normalizeProjectChatFileReference,
} from '../filePathLinks';

describe('chat file path links', () => {
  it('normalizes local markdown links with file URLs, encoded spaces, fragments, and line suffixes', () => {
    expect(normalizeChatFilePath('file:///Users/demo/project/docs/My%20Report.md#L12')).toBe('/Users/demo/project/docs/My Report.md');
    expect(normalizeChatFilePath('<outputs/table.csv:24>')).toBe('outputs/table.csv');
    expect(normalizeChatFilePath('./docs/result.pdf?page=2')).toBe('./docs/result.pdf');
    expect(normalizeChatFilePath('docs/deleted-report.md:17')).toBe('docs/deleted-report.md');
  });

  it('detects document, data, and archive paths used in chat responses', () => {
    expect(isLikelyChatFilePath('/Users/demo/project/report.docx')).toBe(true);
    expect(isLikelyChatFilePath('outputs/data.csv')).toBe(true);
    expect(isLikelyChatFilePath('artifacts/bundle.zip')).toBe(true);
    expect(isLikelyChatFilePath('docs/summary.md#L4')).toBe(true);
    expect(isLikelyChatFilePath('https://example.com/report.md')).toBe(false);
    expect(isLikelyChatFilePath('sandbox:/mnt/data/report.md')).toBe(false);
    expect(isExternalHref('sandbox:/mnt/data/report.md')).toBe(true);
  });

  it('normalizes generated Meta project references to current project paths', () => {
    const project = {
      name: '-Users-demo-medautodata-Meta-Demo',
      displayName: 'Meta Demo',
      fullPath: '/Users/demo/medautodata/Meta Demo',
      metadata: {
        projectKind: 'meta',
        metaAnalysis: {
          folderSchemaVersion: 'meta-v2',
        },
      },
    };

    expect(normalizeProjectChatFileReference(
      'Meta Demo/00_literature/reports/topic.md',
      project,
    )).toMatchObject({
      relativePath: '00_literature/reports/topic.md',
      absolutePath: '/Users/demo/medautodata/Meta Demo/00_literature/reports/topic.md',
    });

    expect(normalizeProjectChatFileReference(
      '/Users/demo/medhelp/meta-analysis/00_literature/reports/topic.md',
      project,
    )).toMatchObject({
      relativePath: '00_literature/reports/topic.md',
      absolutePath: '/Users/demo/medautodata/Meta Demo/00_literature/reports/topic.md',
    });

    expect(normalizeProjectChatFileReference(
      'Survey/meta-analysis/Literature/reports/topic.md',
      project,
    )).toMatchObject({
      relativePath: '00_literature/reports/topic.md',
      absolutePath: '/Users/demo/medautodata/Meta Demo/00_literature/reports/topic.md',
    });
  });
});
