import { useEffect, useRef } from 'react';
import { authenticatedFetch } from '../utils/api';
import {
  isTelemetryEnabled,
  TELEMETRY_ENABLED_KEY,
  TELEMETRY_SETTINGS_EVENT,
} from '../utils/telemetry';

type UseInteractionTelemetryArgs = {
  selectedProjectName?: string | null;
  selectedSessionId?: string | null;
  activeTab?: string | null;
  routePath?: string | null;
};

type TelemetryEvent = {
  name: string;
  source: string;
  data?: Record<string, unknown>;
  clientAt: string;
};

const FLUSH_INTERVAL_MS = 1200;
const MAX_BATCH_SIZE = 20;
const MAX_QUEUE_SIZE = 500;

const summarizeElement = (element: Element | null) => {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const text = (element.innerText || element.textContent || '').trim().slice(0, 80);
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    role: element.getAttribute('role') || null,
    name: element.getAttribute('name') || null,
    type: (element as HTMLInputElement).type || null,
    testId: element.getAttribute('data-testid') || null,
    telemetryId: element.getAttribute('data-telemetry-id') || null,
    ariaLabel: element.getAttribute('aria-label') || null,
    text: text || null,
  };
};

export function useInteractionTelemetry({
  selectedProjectName,
  selectedSessionId,
  activeTab,
  routePath,
}: UseInteractionTelemetryArgs) {
  const queueRef = useRef<TelemetryEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const isFlushingRef = useRef(false);
  const telemetryEnabledRef = useRef(isTelemetryEnabled());

  const contextRef = useRef({
    selectedProjectName: selectedProjectName || null,
    selectedSessionId: selectedSessionId || null,
    activeTab: activeTab || null,
    routePath: routePath || null,
  });

  useEffect(() => {
    contextRef.current = {
      selectedProjectName: selectedProjectName || null,
      selectedSessionId: selectedSessionId || null,
      activeTab: activeTab || null,
      routePath: routePath || null,
    };
  }, [activeTab, routePath, selectedProjectName, selectedSessionId]);

  useEffect(() => {
    const flush = async () => {
      if (isFlushingRef.current || queueRef.current.length === 0) {
        return;
      }
      if (!telemetryEnabledRef.current) {
        queueRef.current = [];
        return;
      }

      isFlushingRef.current = true;
      const batch = queueRef.current.splice(0, MAX_BATCH_SIZE);
      try {
        await authenticatedFetch('/api/telemetry/events', {
          method: 'POST',
          body: JSON.stringify({ events: batch }),
        });
      } catch (error) {
        // Best-effort only: put events back at the front for later retry.
        queueRef.current = [...batch, ...queueRef.current].slice(0, MAX_QUEUE_SIZE);
      } finally {
        isFlushingRef.current = false;
        if (queueRef.current.length > 0) {
          if (flushTimerRef.current) {
            window.clearTimeout(flushTimerRef.current);
          }
          flushTimerRef.current = window.setTimeout(flush, FLUSH_INTERVAL_MS);
        }
      }
    };

    const enqueue = (event: Omit<TelemetryEvent, 'clientAt'>) => {
      if (!telemetryEnabledRef.current) {
        return;
      }
      queueRef.current.push({
        ...event,
        clientAt: new Date().toISOString(),
      });

      if (queueRef.current.length > MAX_QUEUE_SIZE) {
        queueRef.current = queueRef.current.slice(queueRef.current.length - MAX_QUEUE_SIZE);
      }

      if (queueRef.current.length >= MAX_BATCH_SIZE) {
        void flush();
        return;
      }

      if (flushTimerRef.current) {
        return;
      }
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        void flush();
      }, FLUSH_INTERVAL_MS);
    };

    const pushInteraction = (name: string, data: Record<string, unknown>) => {
      enqueue({
        name,
        source: 'frontend-ui',
        data: {
          ...contextRef.current,
          ...data,
        },
      });
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      pushInteraction('ui_click', {
        target: summarizeElement(target),
      });
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement | null;
      pushInteraction('ui_submit', {
        formId: form?.id || null,
        formName: form?.getAttribute('name') || null,
      });
    };

    const onChange = (event: Event) => {
      const target = event.target as Element | null;
      const summary = summarizeElement(target);
      if (!summary) {
        return;
      }
      pushInteraction('ui_change', {
        target: summary,
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== 'Escape' && event.key !== 'Tab') {
        return;
      }
      pushInteraction('ui_keydown', {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        target: summarizeElement(event.target as Element | null),
      });
    };

    const onVisibilityChange = () => {
      pushInteraction('ui_visibility_change', {
        state: document.visibilityState,
      });
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onVisibilityChange, false);

    const onTelemetrySettingsChanged = () => {
      telemetryEnabledRef.current = isTelemetryEnabled();
      if (!telemetryEnabledRef.current) {
        queueRef.current = [];
      }
    };

    const onStorageChange = (event: StorageEvent) => {
      if (event.key !== TELEMETRY_ENABLED_KEY) {
        return;
      }
      telemetryEnabledRef.current = isTelemetryEnabled();
      if (!telemetryEnabledRef.current) {
        queueRef.current = [];
      }
    };

    window.addEventListener(TELEMETRY_SETTINGS_EVENT, onTelemetrySettingsChanged);
    window.addEventListener('storage', onStorageChange);

    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('visibilitychange', onVisibilityChange, false);
      window.removeEventListener(TELEMETRY_SETTINGS_EVENT, onTelemetrySettingsChanged);
      window.removeEventListener('storage', onStorageChange);

      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      void flush();
    };
  }, []);

  useEffect(() => {
    if (!routePath || !isTelemetryEnabled()) {
      return;
    }
    void authenticatedFetch('/api/telemetry/events', {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            name: 'ui_route_change',
            source: 'frontend-ui',
            data: {
              ...contextRef.current,
              routePath,
            },
            clientAt: new Date().toISOString(),
          },
        ],
      }),
    });
  }, [routePath]);
}
