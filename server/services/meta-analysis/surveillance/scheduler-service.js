import { surveillanceDb, metaAnalysisDb } from '../../../database/db.js';
import { runProjectSurveillance } from './surveillance-service.js';
import { runDueSurveillance } from './scheduler.js';

export async function runSurveillanceTick(now = new Date().toISOString()) {
  return runDueSurveillance({
    now,
    listActive: () => surveillanceDb.listActiveSubscriptions(),
    runOne: async (sub) => {
      const metaProject = metaAnalysisDb.getMetaProject(sub.userId, sub.metaProjectId);
      if (!metaProject) throw new Error(`meta project ${sub.metaProjectId} not found`);
      return runProjectSurveillance({ userId: sub.userId, metaProject });
    },
  });
}

export function startSurveillanceScheduler({ intervalMs = 60 * 60 * 1000 } = {}) {
  const timer = setInterval(() => {
    runSurveillanceTick().catch((error) => {
      console.error('[surveillance] scheduler tick failed:', error.message || error);
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
