import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHAT_PROMPT_DRAFT_EVENT,
  consumeChatPromptDraft,
  queueChatPromptDraftDeferred,
} from './chatPromptDraft';
import {
  REFERENCE_CHAT_DRAFT_EVENT,
  consumeReferenceChatDraft,
  queueReferenceChatDraftDeferred,
} from './referenceChatDraft';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');

const installWindow = () => {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const windowMock = {
    sessionStorage: new MemoryStorage(),
    setTimeout,
    dispatchEvent: vi.fn((event: Event) => {
      listeners.get(event.type)?.forEach((listener) => listener(event));
      return true;
    }),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      const handlers = listeners.get(type) ?? new Set();
      handlers.add(listener);
      listeners.set(type, handlers);
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: windowMock,
  });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    writable: true,
    value: class<T> extends Event {
      detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail as T;
      }
    },
  });

  return windowMock;
};

afterEach(() => {
  vi.useRealTimers();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalCustomEvent) Object.defineProperty(globalThis, 'CustomEvent', originalCustomEvent);
  else Reflect.deleteProperty(globalThis, 'CustomEvent');
});

describe('deferred chat draft delivery', () => {
  it('delivers a skill command after the chat listener mounts', () => {
    vi.useFakeTimers();
    const windowMock = installWindow();
    const delivered: unknown[] = [];

    queueChatPromptDraftDeferred('project-a', '/literature-review');
    windowMock.addEventListener(CHAT_PROMPT_DRAFT_EVENT, () => {
      delivered.push(consumeChatPromptDraft('project-a'));
    });

    expect(delivered).toEqual([]);
    vi.runAllTimers();
    expect(delivered).toEqual([expect.objectContaining({ input: '/literature-review' })]);
  });

  it('delivers a reference after the chat listener mounts', () => {
    vi.useFakeTimers();
    const windowMock = installWindow();
    const delivered: unknown[] = [];
    const draft = {
      text: '请分析这篇文献',
      referenceId: 'ref-1',
      pdfCached: true,
    };

    queueReferenceChatDraftDeferred('project-a', draft);
    windowMock.addEventListener(REFERENCE_CHAT_DRAFT_EVENT, () => {
      delivered.push(consumeReferenceChatDraft('project-a'));
    });

    expect(delivered).toEqual([]);
    vi.runAllTimers();
    expect(delivered).toEqual([draft]);
  });
});
