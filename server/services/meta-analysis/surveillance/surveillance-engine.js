import { evaluateEligibility } from './eligibility.js';
import { dedupAgainstCorpus } from './dedup.js';
import { buildChangeSet } from './change-set.js';

export const AUTO_DECISION_CONFIDENCE_THRESHOLD = 0.8;
const SURVEILLANCE_AGENT_REVIEWER = 'surveillance-agent';

export async function runSurveillanceCycle({ userId, subscription, deps }) {
  const { searchSource, classifier = null, corpus, screening, ledger, surveillanceDb, clock = null } = deps;
  const now = () => (clock && clock.now ? clock.now() : new Date().toISOString());
  const metaProjectId = subscription.metaProjectId;
  const startedAt = now();

  const candidates = await searchSource.search(subscription.searchStrategy, { since: subscription.lastRunAt || null });

  const corpusRefs = await corpus.list(metaProjectId);
  const { novel, duplicates } = dedupAgainstCorpus(candidates, corpusRefs);

  const includedStudies = [];
  let autoIncluded = 0;
  let autoExcluded = 0;
  let toReview = 0;

  for (const candidate of novel) {
    const verdict = classifier
      ? await classifier.classify(candidate, subscription.eligibility)
      : evaluateEligibility(candidate, subscription.eligibility);

    const added = await corpus.add(userId, metaProjectId, candidate);
    const referenceId = added.id;
    const confident = Number(verdict.confidence) >= AUTO_DECISION_CONFIDENCE_THRESHOLD;

    let decision;
    if (confident && verdict.decision === 'include') {
      decision = 'include';
      autoIncluded += 1;
      includedStudies.push({ referenceId, title: candidate.title, confidence: verdict.confidence });
    } else if (confident && verdict.decision === 'exclude') {
      decision = 'exclude';
      autoExcluded += 1;
    } else {
      decision = 'maybe';
      toReview += 1;
    }

    await screening.record({
      userId, metaProjectId, referenceId,
      decision, confidence: verdict.confidence,
      reviewer: SURVEILLANCE_AGENT_REVIEWER,
      reason: (verdict.reasons || []).join('; '),
    });
  }

  let referenceSet = null;
  let staleArtifactIds = [];
  if (includedStudies.length > 0) {
    const prior = ledger.getLatestArtifact(metaProjectId, 'ReferenceSet');
    staleArtifactIds = prior ? ledger.collectTransitiveDependents(prior.id) : [];
    const { artifact } = ledger.recordArtifact(userId, {
      metaProjectId, type: 'ReferenceSet', producedBy: 'surveillance',
      inputs: [],
      payload: { surveillance: true, addedReferenceIds: includedStudies.map((s) => s.referenceId) },
    });
    referenceSet = { priorVersion: prior ? prior.version : null, newVersion: artifact.version };
  }

  const changeSet = buildChangeSet({
    subscription,
    search: { found: candidates.length, since: subscription.lastRunAt || null },
    dedup: { novel: novel.length, duplicates: duplicates.length },
    autoScreen: { autoIncluded, autoExcluded, toReview },
    includedStudies,
    referenceSet,
    staleArtifactIds,
    generatedAt: now(),
  });

  const finishedAt = now();
  const run = surveillanceDb.recordRun(userId, {
    subscriptionId: subscription.id,
    metaProjectId,
    status: 'completed',
    stats: { found: candidates.length, novel: novel.length, duplicates: duplicates.length, autoIncluded, autoExcluded, toReview },
    changeSet,
    startedAt,
    finishedAt,
  });
  surveillanceDb.touchLastRun(subscription.id, finishedAt);

  return { run, changeSet };
}
