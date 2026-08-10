import { describe, expect, it } from 'vitest';
import { normalizeDoi, normalizeTitle, dedupAgainstCorpus } from '../services/meta-analysis/surveillance/dedup.js';

describe('dedup helpers', () => {
  it('normalizes DOIs and titles', () => {
    expect(normalizeDoi('https://doi.org/10.1/AbC')).toBe('10.1/abc');
    expect(normalizeTitle('A  Network: Meta-Analysis!')).toBe('a network meta analysis');
  });
});

describe('dedupAgainstCorpus', () => {
  it('filters candidates already in corpus by DOI, PMID, or title', () => {
    const corpus = [
      { doi: '10.1/x', title: 'Existing paper one' },
      { source: 'pubmed', sourceId: '12345', title: 'Existing paper two' },
    ];
    const candidates = [
      { doi: '10.1/X', title: 'totally different title' },
      { pmid: '12345', title: 'another title' },
      { title: 'Existing Paper One' },
      { doi: '10.9/new', title: 'A brand new study' },
    ];
    const { novel, duplicates } = dedupAgainstCorpus(candidates, corpus);
    expect(novel.map((r) => r.title)).toEqual(['A brand new study']);
    expect(duplicates).toHaveLength(3);
  });

  it('also dedups repeats within the same batch', () => {
    const { novel } = dedupAgainstCorpus(
      [{ doi: '10.1/a', title: 'x' }, { doi: '10.1/a', title: 'y' }],
      [],
    );
    expect(novel).toHaveLength(1);
  });
});
