import { describe, expect, it } from 'vitest';

import {
  buildActivityCalendar,
  getActivityIntensity,
  hasActivity,
  summarizeActivity,
  type ProjectActivityDay,
} from './projectActivityCalendarUtils';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function buildDays(startDate: string, count: number): ProjectActivityDay[] {
  const startMs = new Date(`${startDate}T00:00:00.000Z`).getTime();
  return Array.from({ length: count }, (_, index) => ({
    date: formatDateKey(new Date(startMs + (index * MS_PER_DAY))),
    open_count: 0,
    project_count: 0,
  }));
}

describe('projectActivityCalendarUtils', () => {
  it('builds a fixed 53 week calendar from 365 activity days', () => {
    const days = buildDays('2025-05-22', 365);
    days[364] = {
      ...days[364],
      open_count: 5,
      project_count: 2,
    };

    const calendar = buildActivityCalendar(days);

    expect(calendar.weeks).toHaveLength(53);
    expect(calendar.weeks.every((week) => week.length === 7)).toBe(true);
    expect(calendar.weeks[52][4]).toMatchObject({
      date: '2026-05-21',
      score: 2,
      intensity: 2,
    });
    expect(calendar.weeks[52][5]).toBeNull();
    expect(calendar.weeks[52][6]).toBeNull();
  });

  it('emits month labels without changing the week grid', () => {
    const calendar = buildActivityCalendar(buildDays('2026-01-01', 365));

    expect(calendar.monthLabels[0]).toMatchObject({
      weekIndex: 0,
      date: '2026-01-01',
    });
    expect(calendar.monthLabels.some((label) => label.date === '2026-02-01')).toBe(true);
  });

  it('summarizes activity and reports empty data separately', () => {
    const emptySummary = summarizeActivity([]);
    expect(emptySummary).toMatchObject({
      total_opens: 0,
      total_projects: 0,
      active_days: 0,
    });
    expect(hasActivity(emptySummary)).toBe(false);

    const summary = summarizeActivity([
      { date: '2026-05-20', open_count: 3, project_count: 2 },
      { date: '2026-05-21', open_count: 1, project_count: 1 },
    ]);

    expect(summary).toMatchObject({
      total_opens: 4,
      total_projects: 3,
      active_days: 2,
    });
    expect(hasActivity(summary)).toBe(true);
  });

  it('maps activity scores to stable intensity levels', () => {
    expect(getActivityIntensity({ open_count: 0, project_count: 0 })).toBe(0);
    expect(getActivityIntensity({ open_count: 1, project_count: 1 })).toBe(1);
    expect(getActivityIntensity({ open_count: 5, project_count: 3 })).toBe(2);
    expect(getActivityIntensity({ open_count: 8, project_count: 6 })).toBe(3);
    expect(getActivityIntensity({ open_count: 12, project_count: 7 })).toBe(4);
  });
});
