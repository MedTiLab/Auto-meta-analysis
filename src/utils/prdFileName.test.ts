import { describe, expect, it } from 'vitest';

import {
  buildDefaultPrdFileName,
  getInitialPrdFileName,
  normalizePrdFileName,
} from './prdFileName';

describe('prdFileName helpers', () => {
  it('preserves existing markdown filenames', () => {
    expect(getInitialPrdFileName('research-brief.md', false)).toBe('research-brief.md');
    expect(normalizePrdFileName('research-brief.md')).toBe('research-brief.md');
  });

  it('keeps supported extensions unchanged', () => {
    expect(normalizePrdFileName('notes.txt')).toBe('notes.txt');
    expect(normalizePrdFileName('research-brief.json')).toBe('research-brief.json');
  });

  it('appends .txt when no extension is provided', () => {
    expect(normalizePrdFileName('weekly-plan')).toBe('weekly-plan.txt');
  });

  it('uses the generated default name for new files', () => {
    const now = new Date('2026-04-23T08:00:00.000Z');
    expect(buildDefaultPrdFileName(now)).toBe('prd-2026-04-23.txt');
    expect(getInitialPrdFileName('research_brief.json', true, now)).toBe('prd-2026-04-23.txt');
  });
});
