import { describe, expect, it } from 'vitest';
import { buildChangeSet } from '../services/meta-analysis/surveillance/change-set.js';

describe('buildChangeSet', () => {
  const base = {
    subscription: { id: 'sub-1', metaProjectId: 'mp-1' },
    search: { found: 5, since: '2026-05-01T00:00:00.000Z' },
    dedup: { novel: 2, duplicates: 3 },
    autoScreen: { autoIncluded: 1, autoExcluded: 0, toReview: 1 },
    includedStudies: [{ referenceId: 'ref-9', title: 'New NMA', confidence: 0.85 }],
    generatedAt: '2026-05-30T00:00:00.000Z',
  };

  it('flags pending reanalysis when downstream artifacts are stale', () => {
    const cs = buildChangeSet({ ...base, referenceSet: { priorVersion: 1, newVersion: 2 }, staleArtifactIds: ['a1', 'a2'] });
    expect(cs.metaProjectId).toBe('mp-1');
    expect(cs.referenceSet.newVersion).toBe(2);
    expect(cs.pendingReanalysis.staleArtifactIds).toEqual(['a1', 'a2']);
    expect(cs.conclusionsImpact).toBe('unknown-pending-reanalysis');
  });

  it('reports no-change when nothing was integrated', () => {
    const cs = buildChangeSet({ ...base, referenceSet: null, staleArtifactIds: [] });
    expect(cs.referenceSet).toBeNull();
    expect(cs.pendingReanalysis.staleArtifactIds).toEqual([]);
    expect(cs.conclusionsImpact).toBe('no-change');
  });
});
