import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from '../services/meta-analysis/surveillance/eligibility.js';

const predicates = {
  yearMin: 2015,
  includeKeywordsAny: ['network meta-analysis', 'nma'],
  excludeKeywords: ['protocol only', 'retracted'],
  studyTypesExclude: ['animal study'],
};

describe('evaluateEligibility', () => {
  it('excludes out-of-range years with high confidence', () => {
    const r = evaluateEligibility({ title: 'An NMA', year: 2010 }, predicates);
    expect(r.decision).toBe('exclude');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('excludes on exclude keyword', () => {
    const r = evaluateEligibility({ title: 'A retracted network meta-analysis', year: 2020 }, predicates);
    expect(r.decision).toBe('exclude');
  });

  it('includes when an include keyword matches and nothing excludes', () => {
    const r = evaluateEligibility({ title: 'A network meta-analysis of anticoagulants', abstract: '', year: 2024 }, predicates);
    expect(r.decision).toBe('include');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('returns maybe with low confidence when nothing clearly matches', () => {
    const r = evaluateEligibility({ title: 'A narrative review of clotting', year: 2024 }, predicates);
    expect(r.decision).toBe('maybe');
    expect(r.confidence).toBeLessThan(0.8);
  });
});
