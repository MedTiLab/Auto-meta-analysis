export function resolveInactivityTimeoutMs(value, fallbackMs) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallbackMs;
}

export async function nextWithInactivityTimeout(iterator, options = {}) {
  const {
    timeoutMs = 0,
    errorCode = 'STREAM_IDLE_TIMEOUT',
    message = `Agent stream produced no events for ${timeoutMs}ms.`,
    onTimeout,
    signal,
  } = options;

  if (signal?.aborted) {
    const error = new Error('Agent stream was interrupted.');
    error.name = 'AbortError';
    error.code = 'STREAM_ABORTED';
    throw error;
  }

  const nextPromise = Promise.resolve().then(() => iterator.next());
  if (!(timeoutMs > 0) && !signal) {
    return nextPromise;
  }

  let timeoutId = null;
  let abortHandler = null;
  const pending = [nextPromise];

  if (timeoutMs > 0) {
    pending.push(new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        try {
          Promise.resolve(onTimeout?.()).catch(() => {});
        } catch {}
        const error = new Error(message);
        error.name = 'TimeoutError';
        error.code = errorCode;
        reject(error);
      }, timeoutMs);
      timeoutId.unref?.();
    }));
  }

  if (signal) {
    pending.push(new Promise((resolve, reject) => {
      abortHandler = () => {
        const error = new Error('Agent stream was interrupted.');
        error.name = 'AbortError';
        error.code = 'STREAM_ABORTED';
        reject(error);
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }));
  }

  try {
    return await Promise.race(pending);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (abortHandler && signal) signal.removeEventListener('abort', abortHandler);
  }
}
