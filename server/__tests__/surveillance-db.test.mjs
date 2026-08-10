import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadDatabaseModule() {
  vi.resetModules();
  return import('../database/db.js');
}

describe('surveillanceDb', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-surveillance-db-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('creates surveillance tables on initialize', async () => {
    const { db, initializeDatabase } = await loadDatabaseModule();
    await initializeDatabase();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'meta_surveillance_%'")
      .all().map((r) => r.name);
    expect(tables).toContain('meta_surveillance_subscriptions');
    expect(tables).toContain('meta_surveillance_runs');
  });

  it('creates a subscription and records runs', async () => {
    const { surveillanceDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('surv-user', 'hashed-password');

    const sub = surveillanceDb.createSubscription(user.id, {
      metaProjectId: 'mp-1',
      searchStrategy: { pubmed: '("network meta-analysis"[tiab])' },
      eligibility: { includeKeywordsAny: ['network meta-analysis'] },
      frequency: 'weekly',
    });
    expect(sub.id).toBeTruthy();
    expect(sub.searchStrategy.pubmed).toContain('network meta-analysis');
    expect(sub.status).toBe('active');
    expect(surveillanceDb.getSubscriptionByProject('mp-1').id).toBe(sub.id);

    surveillanceDb.touchLastRun(sub.id, '2026-05-30T00:00:00.000Z');
    expect(surveillanceDb.getSubscription(sub.id).lastRunAt).toBe('2026-05-30T00:00:00.000Z');

    const run = surveillanceDb.recordRun(user.id, {
      subscriptionId: sub.id, metaProjectId: 'mp-1', status: 'completed',
      stats: { found: 3, novel: 2 }, changeSet: { autoScreen: { autoIncluded: 1 } },
      startedAt: '2026-05-30T00:00:00.000Z', finishedAt: '2026-05-30T00:01:00.000Z',
    });
    expect(run.stats.found).toBe(3);
    expect(run.changeSet.autoScreen.autoIncluded).toBe(1);
    expect(surveillanceDb.listRuns('mp-1')).toHaveLength(1);
  });

  it('lists only active subscriptions across projects', async () => {
    const { db, surveillanceDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('surv-active-user', 'hashed-password');

    const a = surveillanceDb.createSubscription(user.id, { metaProjectId: 'mp-1', searchStrategy: {}, eligibility: {} });
    const b = surveillanceDb.createSubscription(user.id, { metaProjectId: 'mp-2', searchStrategy: {}, eligibility: {} });
    db.prepare("UPDATE meta_surveillance_subscriptions SET status = 'paused' WHERE id = ?").run(b.id);

    const active = surveillanceDb.listActiveSubscriptions();
    expect(active.map((s) => s.metaProjectId)).toEqual(['mp-1']);
    expect(active.every((s) => s.status === 'active')).toBe(true);
    expect(active.find((s) => s.id === a.id)).toBeTruthy();
    expect(active.find((s) => s.id === b.id)).toBeUndefined();
  });
});
