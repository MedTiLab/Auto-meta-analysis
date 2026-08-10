export const FREQUENCY_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export function frequencyToMs(frequency) {
  return FREQUENCY_MS[frequency] || FREQUENCY_MS.weekly;
}

export function isDue(subscription, now) {
  if (!subscription.lastRunAt) return true;
  const elapsed = new Date(now).getTime() - new Date(subscription.lastRunAt).getTime();
  return elapsed >= frequencyToMs(subscription.frequency);
}

export function selectDueSubscriptions(subscriptions, now) {
  return (subscriptions || []).filter((s) => s.status === 'active' && isDue(s, now));
}

export async function runDueSurveillance({ now, listActive, runOne }) {
  const due = selectDueSubscriptions(listActive(), now);
  const results = [];
  for (const sub of due) {
    try {
      const result = await runOne(sub);
      results.push({ subscriptionId: sub.id, ok: true, result });
    } catch (error) {
      results.push({ subscriptionId: sub.id, ok: false, error: error.message || String(error) });
    }
  }
  return { dueCount: due.length, results };
}
