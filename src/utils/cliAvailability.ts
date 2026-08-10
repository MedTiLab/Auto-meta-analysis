import type { SessionProvider } from '../types/app';

export type CliAvailabilityState = {
  cliAvailable: boolean;
  cliCommand: string | null;
  installHint: string | null;
  checkedAt: number;
};

const STORAGE_KEY = 'cli-availability-status';

type CliAvailabilityMap = Record<SessionProvider, CliAvailabilityState>;

export const readCliAvailability = (): Partial<CliAvailabilityMap> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as Partial<CliAvailabilityMap>;
  } catch {
    return {};
  }
};

export const writeCliAvailability = (
  provider: SessionProvider,
  state: Omit<CliAvailabilityState, 'checkedAt'>,
) => {
  const current = readCliAvailability();
  current[provider] = {
    ...state,
    checkedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
};

