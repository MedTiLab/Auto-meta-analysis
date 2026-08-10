import { surveillanceDb, referencesDb, metaAnalysisDb, evidenceLedgerDb } from '../../../database/db.js';
import { recordArtifact } from '../evidence-ledger.js';
import { runSurveillanceCycle } from './surveillance-engine.js';
import { createPubmedSearchSource, createReferencesCorpus, createScreeningRecorder } from './surveillance-adapters.js';

export async function runProjectSurveillance({ userId, metaProject, searchSource = null, classifier = null }) {
  const subscription = surveillanceDb.getSubscriptionByProject(metaProject.id);
  if (!subscription) {
    throw new Error('No surveillance subscription for this project');
  }

  const deps = {
    searchSource: searchSource || createPubmedSearchSource(),
    classifier,
    corpus: createReferencesCorpus({ userId, metaProject, referencesDb }),
    screening: createScreeningRecorder({ metaAnalysisDb }),
    ledger: {
      recordArtifact,
      getLatestArtifact: evidenceLedgerDb.getLatestArtifact,
      collectTransitiveDependents: evidenceLedgerDb.collectTransitiveDependents,
    },
    surveillanceDb,
    clock: { now: () => new Date().toISOString() },
  };

  return runSurveillanceCycle({ userId, subscription, deps });
}
