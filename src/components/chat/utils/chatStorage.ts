import type { ProviderSettings } from '../types/types';

export const CLAUDE_SETTINGS_KEY = 'claude-settings';
const SESSION_TIMER_PREFIX = 'session_timer_start_';
const ABORT_REQUESTED_SESSION_KEY = 'chat_abort_requested_session_id';
const ABORT_REQUESTED_AT_KEY = 'chat_abort_requested_at';

const safeSessionStorage = {
  setItem: (key: string, value: string) => {
    try {
      sessionStorage.setItem(key, value);
    } catch (error) {
      console.error('sessionStorage setItem error:', error);
    }
  },
  getItem: (key: string): string | null => {
    try {
      return sessionStorage.getItem(key);
    } catch (error) {
      console.error('sessionStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key: string) => {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error('sessionStorage removeItem error:', error);
    }
  },
};

const isTemporarySessionId = (sessionId: string): boolean => (
  sessionId.startsWith('new-session-') || sessionId.startsWith('temp-')
);

export function getProviderSettingsKey(provider?: string) {
  return CLAUDE_SETTINGS_KEY;
}

export const safeLocalStorage = {
  setItem: (key: string, value: string) => {
    try {
      if (key.startsWith('chat_messages_') && typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed) && parsed.length > 50) {
            const truncated = parsed.slice(-50);
            value = JSON.stringify(truncated);
          }
        } catch (parseError) {
          console.warn('Could not parse chat messages for truncation:', parseError);
        }
      }

      localStorage.setItem(key, value);
    } catch (error: any) {
      if (error?.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');

        const keys = Object.keys(localStorage);
        const chatKeys = keys.filter((k) => k.startsWith('chat_messages_')).sort();

        if (chatKeys.length > 3) {
          chatKeys.slice(0, chatKeys.length - 3).forEach((k) => {
            localStorage.removeItem(k);
          });
        }

        const draftKeys = keys.filter((k) => k.startsWith('draft_input_'));
        draftKeys.forEach((k) => {
          localStorage.removeItem(k);
        });

        try {
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error('Failed to save to localStorage even after cleanup:', retryError);
          if (key.startsWith('chat_messages_') && typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              if (Array.isArray(parsed) && parsed.length > 10) {
                const minimal = parsed.slice(-10);
                localStorage.setItem(key, JSON.stringify(minimal));
              }
            } catch (finalError) {
              console.error('Final save attempt failed:', finalError);
            }
          }
        }
      } else {
        console.error('localStorage error:', error);
      }
    }
  },
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('localStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('localStorage removeItem error:', error);
    }
  },
};

export function persistSessionTimerStart(sessionId: string | null | undefined, startTime: number | null | undefined) {
  if (!sessionId || !Number.isFinite(startTime)) {
    return;
  }

  safeSessionStorage.setItem(`${SESSION_TIMER_PREFIX}${sessionId}`, String(startTime));
}

export function readSessionTimerStart(sessionId: string | null | undefined): number | null {
  if (!sessionId) {
    return null;
  }

  const raw = safeSessionStorage.getItem(`${SESSION_TIMER_PREFIX}${sessionId}`);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clearSessionTimerStart(sessionId: string | null | undefined) {
  if (!sessionId) {
    return;
  }

  safeSessionStorage.removeItem(`${SESSION_TIMER_PREFIX}${sessionId}`);
}

export function clearTemporarySessionTimerStarts() {
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(SESSION_TIMER_PREFIX)) {
        continue;
      }

      const sessionId = key.slice(SESSION_TIMER_PREFIX.length);
      if (isTemporarySessionId(sessionId)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
  } catch (error) {
    console.error('sessionStorage clear temporary timers error:', error);
  }
}

export function moveSessionTimerStart(fromSessionId: string | null | undefined, toSessionId: string | null | undefined) {
  if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) {
    return;
  }

  const startTime = readSessionTimerStart(fromSessionId);
  if (!Number.isFinite(startTime)) {
    return;
  }

  persistSessionTimerStart(toSessionId, startTime);
  clearSessionTimerStart(fromSessionId);
}

export function markSessionAbortRequested(sessionId: string | null | undefined) {
  if (!sessionId) {
    return;
  }

  safeSessionStorage.setItem(ABORT_REQUESTED_SESSION_KEY, sessionId);
  safeSessionStorage.setItem(ABORT_REQUESTED_AT_KEY, String(Date.now()));
}

export function readSessionAbortRequested(): string | null {
  return safeSessionStorage.getItem(ABORT_REQUESTED_SESSION_KEY);
}

export function isSessionAbortRequested(sessionId: string | null | undefined): boolean {
  if (!sessionId) {
    return false;
  }

  return readSessionAbortRequested() === sessionId;
}

export function clearSessionAbortRequested(sessionId?: string | null) {
  const current = readSessionAbortRequested();
  if (sessionId && current && current !== sessionId) {
    return;
  }

  safeSessionStorage.removeItem(ABORT_REQUESTED_SESSION_KEY);
  safeSessionStorage.removeItem(ABORT_REQUESTED_AT_KEY);
}

export function getProviderSettings(provider?: string): ProviderSettings {
  const raw = safeLocalStorage.getItem(getProviderSettingsKey(provider));
  if (!raw) {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'date',
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      allowedTools: Array.isArray(parsed.allowedTools) ? parsed.allowedTools : [],
      disallowedTools: Array.isArray(parsed.disallowedTools) ? parsed.disallowedTools : [],
      skipPermissions: false,
      projectSortOrder: parsed.projectSortOrder || 'date',
    };
  } catch {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'date',
    };
  }
}
