import { describe, expect, it } from 'vitest';
import { frequencyToMs, isDue, selectDueSubscriptions } from '../services/meta-analysis/surveillance/scheduler.js';

const NOW = '2026-05-30T00:00:00.000Z';

describe('frequencyToMs', () => {
  it('maps known frequencies and defaults to weekly', () => {
    expect(frequencyToMs('daily')).toBe(86400000);
    expect(frequencyToMs('weekly')).toBe(604800000);
    expect(frequencyToMs('monthly')).toBe(2592000000);
    expect(frequencyToMs('nonsense')).toBe(604800000);
  });
});

describe('isDue', () => {
  it('is due when never run', () => {
    expect(isDue({ frequency: 'weekly', lastRunAt: null }, NOW)).toBe(true);
  });
  it('is not due within the interval', () => {
    expect(isDue({ frequency: 'weekly', lastRunAt: '2026-05-29T00:00:00.000Z' }, NOW)).toBe(false);
  });
  it('is due once the interval has elapsed', () => {
    expect(isDue({ frequency: 'daily', lastRunAt: '2026-05-28T00:00:00.000Z' }, NOW)).toBe(true);
  });
});

describe('selectDueSubscriptions', () => {
  it('returns only active and due subscriptions', () => {
    const subs = [
      { id: '1', status: 'active', frequency: 'daily', lastRunAt: null },
      { id: '2', status: 'active', frequency: 'weekly', lastRunAt: '2026-05-29T00:00:00.000Z' },
      { id: '3', status: 'paused', frequency: 'daily', lastRunAt: null },
    ];
    expect(selectDueSubscriptions(subs, NOW).map((s) => s.id)).toEqual(['1']);
  });
});

describe('runDueSurveillance', () => {
  const NOW2 = '2026-05-30T00:00:00.000Z';

  it('runs each due subscription and isolates per-subscription failures', async () => {
    const { runDueSurveillance } = await import('../services/meta-analysis/surveillance/scheduler.js');
    const listActive = () => ([
      { id: 'a', status: 'active', frequency: 'daily', lastRunAt: null },
      { id: 'b', status: 'active', frequency: 'daily', lastRunAt: null },
      { id: 'c', status: 'paused', frequency: 'daily', lastRunAt: null },
    ]);
    const ran = [];
    const runOne = async (sub) => {
      if (sub.id === 'b') throw new Error('boom');
      ran.push(sub.id);
      return { ok: sub.id };
    };

    const summary = await runDueSurveillance({ now: NOW2, listActive, runOne });

    expect(summary.dueCount).toBe(2);
    expect(ran).toEqual(['a']);
    expect(summary.results.find((r) => r.subscriptionId === 'b').ok).toBe(false);
    expect(summary.results.find((r) => r.subscriptionId === 'b').error).toContain('boom');
    expect(summary.results.find((r) => r.subscriptionId === 'a').ok).toBe(true);
  });
});
