import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from './clipboard';

const originalGlobals = {
  window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
};

const setGlobal = (name: 'window' | 'navigator' | 'document', value: unknown) => {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
};

const restoreGlobal = (name: 'window' | 'navigator' | 'document') => {
  const descriptor = originalGlobals[name];
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
};

afterEach(() => {
  restoreGlobal('window');
  restoreGlobal('navigator');
  restoreGlobal('document');
  vi.restoreAllMocks();
});

describe('copyTextToClipboard', () => {
  it('uses the desktop bridge when available', async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(true);
    const writeText = vi.fn().mockResolvedValue(undefined);

    setGlobal('window', {
      medautodataDesktop: {
        isDesktop: true,
        platform: 'darwin',
        writeClipboardText,
      },
    });
    setGlobal('navigator', { clipboard: { writeText } });

    await expect(copyTextToClipboard('/tmp/report.md')).resolves.toBe(true);
    expect(writeClipboardText).toHaveBeenCalledWith('/tmp/report.md');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('uses navigator.clipboard when the desktop bridge is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    setGlobal('window', {});
    setGlobal('navigator', { clipboard: { writeText } });

    await expect(copyTextToClipboard('/tmp/report.md')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('/tmp/report.md');
  });

  it('falls back to document.execCommand when clipboard write is rejected', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not allowed'));
    const textarea = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
    const body = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };
    const execCommand = vi.fn().mockReturnValue(true);

    setGlobal('window', {});
    setGlobal('navigator', { clipboard: { writeText } });
    setGlobal('document', {
      body,
      createElement: vi.fn().mockReturnValue(textarea),
      execCommand,
    });

    await expect(copyTextToClipboard('/tmp/report.md')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('/tmp/report.md');
    expect(body.appendChild).toHaveBeenCalledWith(textarea);
    expect(textarea.value).toBe('/tmp/report.md');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(body.removeChild).toHaveBeenCalledWith(textarea);
  });
});
