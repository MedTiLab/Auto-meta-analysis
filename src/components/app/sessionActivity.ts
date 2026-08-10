import type { SessionProvider } from '../../types/app';

type ActiveSessionEntry =
  | string
  | {
      id?: unknown;
      sessionId?: unknown;
      [key: string]: unknown;
    };

type ActiveSessionGroups = Partial<Record<SessionProvider | string, ActiveSessionEntry[]>>;

const normalizeId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

export const getActiveSessionEntryId = (entry: unknown): string | null => {
  const directId = normalizeId(entry);
  if (directId) {
    return directId;
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const activeEntry = entry as { id?: unknown; sessionId?: unknown };
  return normalizeId(activeEntry.id) || normalizeId(activeEntry.sessionId);
};

export const isTemporarySessionId = (sessionId: string): boolean => (
  sessionId.startsWith('new-session-') || sessionId.startsWith('temp-')
);

export const collectActiveSessionIds = (
  sessionGroups: unknown,
  processingSessions: Iterable<string> = [],
): Set<string> => {
  const sessionIds = new Set<string>();
  const groups = sessionGroups && typeof sessionGroups === 'object'
    ? sessionGroups as ActiveSessionGroups
    : {};

  Object.values(groups).forEach((group) => {
    if (!Array.isArray(group)) {
      return;
    }

    group.forEach((entry) => {
      const sessionId = getActiveSessionEntryId(entry);
      if (sessionId) {
        sessionIds.add(sessionId);
      }
    });
  });

  for (const sessionId of processingSessions) {
    if (typeof sessionId === 'string' && isTemporarySessionId(sessionId)) {
      sessionIds.add(sessionId);
    }
  }

  return sessionIds;
};

export const getLifecycleSessionIds = (message: unknown): string[] => {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const source = message as Record<string, unknown>;
  return [source.sessionId, source.actualSessionId, source.previousSessionId]
    .map(normalizeId)
    .filter((sessionId, index, allIds): sessionId is string => (
      Boolean(sessionId) && allIds.indexOf(sessionId) === index
    ));
};
