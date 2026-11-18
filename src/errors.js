/**
 * Error boundary, toast state and the recovery-JSON escape hatch.
 *
 * Handlers and render passes run through `guard`, so one failure becomes a
 * toast instead of a blank page. The scene stays in memory and can always be
 * exported as recovery JSON.
 */
import { SCHEMA_VERSION } from './scene.js';

export function describeError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return String(error.message || error.name || error);
}

export function createToastStore(options = {}) {
  const max = options.max ?? 5;
  let counter = 0;
  let toasts = [];
  const listeners = new Set();

  function notify() {
    for (const listener of listeners) {
      try {
        listener(toasts.slice());
      } catch {
        // listeners are UI-only
      }
    }
  }

  function push(message, extra = {}) {
    counter += 1;
    const toast = {
      id: `toast_${counter}`,
      message: String(message),
      kind: extra.kind ?? 'info',
      detail: extra.detail ?? null,
      action: extra.action ?? null,
      createdAt: extra.now ?? Date.now(),
    };
    toasts = [...toasts, toast];
    if (toasts.length > max) toasts = toasts.slice(-max);
    notify();
    return toast.id;
  }

  function dismiss(id) {
    const before = toasts.length;
    toasts = toasts.filter((toast) => toast.id !== id);
    if (toasts.length !== before) notify();
  }

  function clear() {
    if (!toasts.length) return;
    toasts = [];
    notify();
  }

  return {
    push,
    dismiss,
    clear,
    list: () => toasts.slice(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createErrorBoundary(options = {}) {
  const onError = options.onError ?? (() => {});
  const logger = options.logger ?? console;
  const context = options.context ?? 'sketch-studio';

  function report(error, label = 'unknown') {
    const message = describeError(error);
    try {
      logger.error(`[${context}] ${label}: ${message}`, error);
    } catch {
      // logging must not throw
    }
    try {
      onError({ label, error, message });
    } catch {
      // toast handler must not throw
    }
    return { ok: false, error, message, label };
  }

  function guard(fn, label = 'handler', fallback = undefined) {
    try {
      return { ok: true, value: fn(), error: null };
    } catch (error) {
      const failure = report(error, label);
      return { ...failure, value: fallback };
    }
  }

  async function guardAsync(fn, label = 'handler', fallback = undefined) {
    try {
      return { ok: true, value: await fn(), error: null };
    } catch (error) {
      const failure = report(error, label);
      return { ...failure, value: fallback };
    }
  }

  return { guard, guardAsync, report };
}

/** Snapshot the live scene plus error context into a downloadable payload. */
export function buildRecoveryPayload(scene, errorInfo = {}, at = Date.now()) {
  const elements = Array.isArray(scene?.elements)
    ? JSON.parse(JSON.stringify(scene.elements))
    : [];
  return {
    version: SCHEMA_VERSION,
    recovery: {
      at,
      label: errorInfo.label ?? 'manual',
      message: errorInfo.message ?? describeError(errorInfo.error),
      userAgent: errorInfo.userAgent ?? null,
    },
    style: errorInfo.style ? { ...errorInfo.style } : {},
    theme: errorInfo.theme === 'dark' ? 'dark' : 'light',
    elements,
  };
}

export function recoveryFilename(at = Date.now()) {
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `sketch-studio-recovery-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
}
