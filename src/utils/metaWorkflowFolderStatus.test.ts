import { describe, expect, it } from 'vitest';

import { collectMetaWorkflowFolderStatuses } from './metaWorkflowFolderStatus';

describe('Meta workflow folder status', () => {
  it('orders numbered folders and recursively counts visible files', () => {
    expect(collectMetaWorkflowFolderStatuses([
      {
        name: '03_title_abstract_screening',
        type: 'directory',
        path: '/project/03_title_abstract_screening',
        children: [
          {
            name: 'decisions',
            type: 'directory',
            children: [
              { name: 'screening.csv', type: 'file' },
              { name: '.DS_Store', type: 'file' },
            ],
          },
        ],
      },
      {
        name: '00_literature',
        type: 'directory',
        relativePath: '00_literature',
        children: [{ name: 'topic.md', type: 'file' }],
      },
      {
        name: '01_protocol',
        type: 'directory',
        relativePath: '01_protocol',
        children: [],
      },
      {
        name: 'Experiment',
        type: 'directory',
        children: [{ name: 'legacy.csv', type: 'file' }],
      },
    ])).toEqual([
      { name: '00_literature', path: '00_literature', fileCount: 1 },
      { name: '01_protocol', path: '01_protocol', fileCount: 0 },
      { name: '03_title_abstract_screening', path: '/project/03_title_abstract_screening', fileCount: 1 },
    ]);
  });
});
