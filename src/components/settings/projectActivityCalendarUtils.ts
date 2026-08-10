export type ProjectActivityDay = {
  date: string;
  open_count?: number;
  project_count?: number;
};

export type ProjectActivityCell = {
  date: string;
  open_count: number;
  project_count: number;
  score: number;
  intensity: number;
};

export type ProjectActivitySummary = {
  total_opens: number;
  total_projects: number;
  active_days: number;
};

export type ProjectActivityCalendar = {
  weeks: Array<Array<ProjectActivityCell | null>>;
  monthLabels: Array<{ weekIndex: number; date: string }>;
};

const DEFAULT_WEEK_COUNT = 53;
const DAYS_PER_WEEK = 7;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateKey(dateKey: string): Date | null {
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    return null;
  }

  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function normalizeNumber(value: unknown): number {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? Math.max(0, nextValue) : 0;
}

export function getActivityScore(day: Pick<ProjectActivityDay, 'open_count' | 'project_count'>): number {
  const projectCount = normalizeNumber(day.project_count);
  return projectCount > 0 ? projectCount : normalizeNumber(day.open_count);
}

export function getActivityIntensity(day: Pick<ProjectActivityDay, 'open_count' | 'project_count'>): number {
  const score = getActivityScore(day);
  if (score <= 0) return 0;
  if (score <= 1) return 1;
  if (score <= 3) return 2;
  if (score <= 6) return 3;
  return 4;
}

export function normalizeActivityDay(day: ProjectActivityDay): ProjectActivityCell | null {
  const parsed = parseDateKey(day.date);
  if (!parsed) {
    return null;
  }

  const normalized = {
    date: day.date,
    open_count: normalizeNumber(day.open_count),
    project_count: normalizeNumber(day.project_count),
  };

  return {
    ...normalized,
    score: getActivityScore(normalized),
    intensity: getActivityIntensity(normalized),
  };
}

export function summarizeActivity(days: ProjectActivityDay[] = []): ProjectActivitySummary {
  return days.reduce<ProjectActivitySummary>((summary, day) => {
    const normalized = normalizeActivityDay(day);
    if (!normalized) {
      return summary;
    }

    summary.total_opens += normalized.open_count;
    summary.total_projects += normalized.project_count;
    if (normalized.open_count > 0 || normalized.project_count > 0) {
      summary.active_days += 1;
    }
    return summary;
  }, {
    total_opens: 0,
    total_projects: 0,
    active_days: 0,
  });
}

export function hasActivity(summary: ProjectActivitySummary): boolean {
  return summary.total_opens > 0 || summary.total_projects > 0 || summary.active_days > 0;
}

export function buildActivityCalendar(
  days: ProjectActivityDay[] = [],
  weekCount = DEFAULT_WEEK_COUNT,
): ProjectActivityCalendar {
  const totalWeeks = Math.max(1, Math.floor(weekCount));
  const maxCells = totalWeeks * DAYS_PER_WEEK;
  const orderedDays = days
    .map(normalizeActivityDay)
    .filter((day): day is ProjectActivityCell => Boolean(day))
    .sort((left, right) => left.date.localeCompare(right.date));

  if (orderedDays.length === 0) {
    return {
      weeks: Array.from({ length: totalWeeks }, () => Array.from({ length: DAYS_PER_WEEK }, () => null)),
      monthLabels: [],
    };
  }

  const endDate = parseDateKey(orderedDays[orderedDays.length - 1].date);
  const trailingCells = endDate ? DAYS_PER_WEEK - 1 - endDate.getUTCDay() : 0;
  const visibleDayCapacity = Math.max(1, maxCells - trailingCells);
  const visibleDays = orderedDays.slice(-visibleDayCapacity);
  const leadingCells = Math.max(0, maxCells - visibleDays.length - trailingCells);
  let cells: Array<ProjectActivityCell | null> = [
    ...Array.from({ length: leadingCells }, () => null),
    ...visibleDays,
    ...Array.from({ length: trailingCells }, () => null),
  ];

  if (cells.length > maxCells) {
    cells = cells.slice(cells.length - maxCells);
  }

  while (cells.length < maxCells) {
    cells.unshift(null);
  }

  const weeks = Array.from({ length: totalWeeks }, (_, weekIndex) => (
    cells.slice(weekIndex * DAYS_PER_WEEK, (weekIndex + 1) * DAYS_PER_WEEK)
  ));

  const monthLabels: Array<{ weekIndex: number; date: string }> = [];
  let previousMonthKey = '';
  weeks.forEach((week, weekIndex) => {
    const monthStartCell = week.find((cell) => {
      if (!cell) return false;
      const parsed = parseDateKey(cell.date);
      return parsed ? parsed.getUTCDate() <= DAYS_PER_WEEK : false;
    });
    const fallbackCell = week.find(Boolean);
    const labelCell = monthStartCell || (monthLabels.length === 0 ? fallbackCell : null);
    if (!labelCell) {
      return;
    }

    const parsed = parseDateKey(labelCell.date);
    if (!parsed) {
      return;
    }

    const monthKey = `${parsed.getUTCFullYear()}-${parsed.getUTCMonth()}`;
    if (monthKey === previousMonthKey) {
      return;
    }

    previousMonthKey = monthKey;
    monthLabels.push({ weekIndex, date: labelCell.date });
  });

  return { weeks, monthLabels };
}
