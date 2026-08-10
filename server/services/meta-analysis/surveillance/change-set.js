export function buildChangeSet({
  subscription, search, dedup, autoScreen,
  includedStudies = [], referenceSet = null, staleArtifactIds = [], generatedAt,
}) {
  const stale = staleArtifactIds || [];
  const hasReanalysis = stale.length > 0;
  return {
    generatedAt,
    subscriptionId: subscription.id,
    metaProjectId: subscription.metaProjectId,
    search,
    dedup,
    autoScreen,
    includedStudies,
    referenceSet,
    pendingReanalysis: {
      staleArtifactIds: stale,
      note: hasReanalysis
        ? 'Downstream artifacts are stale; statistical re-analysis (M1) required to compute effect-size and ranking deltas.'
        : 'No downstream re-analysis required.',
    },
    conclusionsImpact: hasReanalysis ? 'unknown-pending-reanalysis' : 'no-change',
  };
}
