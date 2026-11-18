/**
 * Fault-tolerant persistence: debounced autosave, atomic-ish writes, a ring of
 * good snapshots, quota handling, unavailable storage and multi-tab detection.
 *
 * DOM-free: inject `storage`, timers and a revision factory in tests.
 */
import { describeIssues, validateScene } from './schema.js';

export const DEFAULT_KEY = 'sketch-studio:v2';
export const LEGACY_KEYS = Object.freeze(['sketch-studio:v1']);
export const DEFAULT_OPTIONS = Object.freeze({
  key: DEFAULT_KEY,
  legacyKeys: LEGACY_KEYS,
  debounceMs: 350,
  maxSnapshots: 5,
});

export function isQuotaError(error) {
  if (!error) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22 ||
    error.code === 1014 ||
    /quota/i.test(String(error.message ?? ''))
  );
}

export function resolveStorage(scope = globalThis) {
  try {
    const storage = scope?.localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

/** Minimal in-memory storage with the Web Storage surface, used by tests. */
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(String(key), String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    _map: map,
  };
}

export function createPersistence(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  // An explicitly injected null means "no storage"; do not re-read the global
  // getter (which may itself throw in a sandboxed/private browser).
  const storage = Object.prototype.hasOwnProperty.call(options, 'storage')
    ? (options.storage ?? null)
    : resolveStorage();
  const setTimeoutFn = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn = options.clearTimeout ?? ((id) => clearTimeout(id));
  const now = options.now ?? (() => Date.now());
  let revisionCounter = 0;
  const revisionFactory =
    options.revisionFactory ??
    ((at) => {
      revisionCounter += 1;
      return `${at.toString(36)}-${revisionCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    });

  const keys = {
    current: config.key,
    pending: `${config.key}:pending`,
    backup: `${config.key}:backup`,
    ring: `${config.key}:ring`,
    probe: `${config.key}:probe`,
  };

  let lastRevision = null;
  let lastSavedRevision = null;
  let lastSavedRaw = null;
  let pendingData = null;
  let timer = null;
  let status = 'unknown';
  let unavailableReason = null;
  const listeners = new Set();

  function notify(event) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A subscriber must never break persistence.
      }
    }
  }

  function probe() {
    if (!storage) {
      status = 'unavailable';
      unavailableReason = 'no storage';
      return false;
    }
    // Reads must work even when the quota is full: an existing drawing is
    // still recoverable. Only a read failure means storage is truly unusable.
    try {
      storage.getItem(keys.probe);
    } catch (error) {
      status = 'unavailable';
      unavailableReason = error.message ?? 'storage unavailable';
      return false;
    }
    try {
      storage.setItem(keys.probe, '1');
      storage.removeItem(keys.probe);
      if (status !== 'quota') status = 'ok';
      unavailableReason = null;
      return true;
    } catch (error) {
      if (isQuotaError(error)) {
        status = 'quota';
        unavailableReason = 'storage quota exceeded';
        return true;
      }
      status = 'unavailable';
      unavailableReason = error.message ?? 'storage unavailable';
      return false;
    }
  }

  function parseCandidate(raw, source, issues) {
    if (!raw) return null;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      issues.push({
        code: 'parse-error',
        message: `${source} could not be parsed: ${error.message}`,
        severity: 'error',
      });
      return null;
    }
    const result = (() => {
      try {
        return validateScene(data);
      } catch (error) {
        issues.push({
          code: 'validation-error',
          message: `${source} could not be validated: ${error?.message ?? error}`,
          severity: 'error',
        });
        return { ok: false, scene: null, issues: [], stats: { total: 0, kept: 0, dropped: 0, repaired: 0 } };
      }
    })();
    if (!result.ok || (result.stats.total > 0 && result.stats.kept === 0)) {
      issues.push({
        code: 'invalid-scene',
        message: `${source} did not contain a usable scene`,
        severity: 'error',
      });
      return null;
    }
    issues.push(...result.issues);
    return {
      scene: result.scene,
      issues: result.issues,
      stats: result.stats,
      source,
      revision: typeof data.revision === 'string' ? data.revision : null,
      savedAt: Number.isFinite(data.savedAt) ? data.savedAt : null,
    };
  }

  function readRing(issues) {
    const raw = safeGet(keys.ring);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry) => entry && typeof entry.raw === 'string');
    } catch (error) {
      issues.push({
        code: 'ring-corrupt',
        message: `snapshot ring was corrupt: ${error.message}`,
        severity: 'warning',
      });
      return [];
    }
  }

  function safeGet(key) {
    try {
      return storage ? storage.getItem(key) : null;
    } catch (error) {
      status = isQuotaError(error) ? 'quota' : 'unavailable';
      return null;
    }
  }

  function safeSet(key, value) {
    if (!storage) throw new Error('storage unavailable');
    storage.setItem(key, value);
  }

  function safeRemove(key) {
    try {
      storage?.removeItem(key);
    } catch {
      // best effort
    }
  }

  /** A raw slot is promotable only if it parses into a usable scene. */
  function isValidSnapshotRaw(raw) {
    if (!raw) return false;
    try {
      const result = validateScene(JSON.parse(raw));
      return result.ok && !(result.stats.total > 0 && result.stats.kept === 0);
    } catch {
      return false;
    }
  }

  /** Copy a recovery slot and verify the read-back before trusting it. */
  function copyVerified(key, raw) {
    try {
      safeSet(key, raw);
      return safeGet(key) === raw;
    } catch {
      return false;
    }
  }

  function load() {
    if (!probe()) {
      return {
        ok: false,
        unavailable: true,
        reason: unavailableReason,
        scene: null,
        issues: [],
        source: null,
        revision: null,
      };
    }
    const issues = [];
    const candidates = [];
    candidates.push({ source: 'current', raw: safeGet(keys.current) });
    candidates.push({ source: 'backup', raw: safeGet(keys.backup) });
    for (const entry of readRing(issues).slice().reverse()) {
      candidates.push({ source: 'snapshot', raw: entry.raw, savedAt: entry.at ?? null });
    }
    for (const legacyKey of config.legacyKeys ?? []) {
      candidates.push({ source: `legacy:${legacyKey}`, raw: safeGet(legacyKey) });
    }
    const seen = new Set();
    for (const candidate of candidates) {
      if (!candidate.raw || seen.has(candidate.raw)) continue;
      seen.add(candidate.raw);
      const parsed = parseCandidate(candidate.raw, candidate.source, issues);
      if (parsed) {
        lastRevision = parsed.revision;
        notify({ type: 'load', source: parsed.source, revision: parsed.revision });
        return {
          ok: true,
          scene: parsed.scene,
          issues,
          stats: parsed.stats,
          source: parsed.source,
          revision: parsed.revision,
          raw: candidate.raw,
          savedAt: parsed.savedAt ?? candidate.savedAt ?? null,
        };
      }
    }
    return {
      ok: false,
      empty: candidates.every((candidate) => !candidate.raw),
      scene: null,
      issues,
      source: null,
      revision: null,
    };
  }

  function currentRaw() {
    return safeGet(keys.current);
  }

  function readCurrentRevision() {
    const raw = safeGet(keys.current);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return typeof data.revision === 'string' ? data.revision : null;
    } catch {
      return null;
    }
  }

  function readSnapshotMeta() {
    return readRing([]).map((entry) => ({
      revision: entry.revision ?? null,
      at: entry.at ?? null,
      bytes: entry.raw.length,
    }));
  }

  function updateRing(raw, revision, at) {
    let ring = readRing([]);
    ring.push({ revision, at, raw });
    if (ring.length > config.maxSnapshots) ring = ring.slice(-config.maxSnapshots);
    try {
      safeSet(keys.ring, JSON.stringify(ring));
    } catch (error) {
      // Ring is a nicety; losing it must not fail the save.
      try {
        safeSet(keys.ring, JSON.stringify(ring.slice(-1)));
      } catch {
        safeRemove(keys.ring);
      }
      notify({
        type: 'warning',
        message: isQuotaError(error) ? 'snapshot history trimmed to stay under quota' : 'snapshot history unavailable',
      });
    }
  }

  function save(data, options = {}) {
    if (!probe()) {
      return { ok: false, unavailable: true, quota: false, reason: unavailableReason };
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'nothing to save' };
    }
    // A queued write must not overwrite a newer revision written by another tab.
    if (Object.prototype.hasOwnProperty.call(options, 'expectRevision')) {
      const currentRevision = readCurrentRevision();
      if (currentRevision !== options.expectRevision) {
        const issues = [];
        const external = parseCandidate(safeGet(keys.current), 'other-tab', issues);
        notify({ type: 'conflict', revision: external?.revision ?? null, scene: external?.scene ?? null });
        return {
          ok: false,
          conflict: true,
          corrupt: !external,
          revision: external?.revision ?? null,
          scene: external?.scene ?? null,
          issues,
        };
      }
    }
    // Never persist a scene that would not survive validation on load.
    try {
      const check = validateScene(data);
      if (!check.ok || (check.stats.total > 0 && check.stats.kept === 0)) {
        return { ok: false, error: 'scene is not valid' };
      }
    } catch (error) {
      return { ok: false, error: `scene could not be validated: ${error?.message ?? error}` };
    }
    const at = now();
    const revision = revisionFactory(at);
    let raw;
    try {
      raw = JSON.stringify({ ...data, version: 2, revision, savedAt: at });
    } catch (error) {
      return { ok: false, error: `scene could not be serialised: ${error.message}` };
    }

    let wrotePending = false;
    try {
      safeSet(keys.pending, raw);
      wrotePending = true;
      if (safeGet(keys.pending) !== raw) throw new Error('pending write could not be verified');
    } catch (error) {
      if (isQuotaError(error)) {
        // Free the expendable copies, then try once more.
        safeRemove(keys.ring);
        safeRemove(keys.pending);
        try {
          safeSet(keys.pending, raw);
          wrotePending = safeGet(keys.pending) === raw;
        } catch (retryError) {
          status = 'quota';
          notify({ type: 'quota', message: 'Storage is full; changes stay in memory' });
          return { ok: false, quota: true, unavailable: false, error: retryError.message };
        }
      } else {
        status = 'unavailable';
        unavailableReason = error.message;
        notify({ type: 'unavailable', message: 'Storage is unavailable; changes stay in memory' });
        return { ok: false, unavailable: true, quota: false, error: error.message };
      }
    }
    if (!wrotePending) {
      return { ok: false, error: 'could not stage the save' };
    }

    // Keep a known-good recovery copy before replacing current. Never copy
    // merely parseable current data: it may be structurally invalid.
    if (options.recoveryRaw && isValidSnapshotRaw(options.recoveryRaw)) {
      copyVerified(keys.backup, options.recoveryRaw);
    } else {
      const previous = safeGet(keys.current);
      if (isValidSnapshotRaw(previous)) copyVerified(keys.backup, previous);
    }
    try {
      safeSet(keys.current, raw);
      if (safeGet(keys.current) !== raw) throw new Error('save could not be verified');
    } catch (error) {
      status = isQuotaError(error) ? 'quota' : 'unavailable';
      notify({
        type: isQuotaError(error) ? 'quota' : 'unavailable',
        message: isQuotaError(error)
          ? 'Storage is full; changes stay in memory'
          : 'Storage is unavailable; changes stay in memory',
      });
      safeRemove(keys.pending);
      return { ok: false, quota: isQuotaError(error), unavailable: !isQuotaError(error), error: error.message };
    }
    safeRemove(keys.pending);
    // Guarantee at least one valid recovery copy exists.
    const backup = safeGet(keys.backup);
    if (!isValidSnapshotRaw(backup)) copyVerified(keys.backup, raw);
    updateRing(raw, revision, at);
    lastRevision = revision;
    lastSavedRevision = revision;
    lastSavedRaw = raw;
    if (status !== 'quota') status = 'ok';
    notify({ type: 'save', revision, at, bytes: raw.length });
    return { ok: true, revision, at, bytes: raw.length };
  }

  function schedule(data) {
    pendingData = data;
    if (timer !== null) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      const toSave = pendingData;
      pendingData = null;
      if (toSave) save(toSave);
    }, config.debounceMs);
  }

  function flush() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    const toSave = pendingData;
    pendingData = null;
    return toSave ? save(toSave) : null;
  }

  function cancel() {
    if (timer !== null) clearTimeoutFn(timer);
    timer = null;
    pendingData = null;
  }

  /**
   * Inspect a storage event. Returns null when the event is unrelated, or a
   * description when another tab wrote a newer revision.
   */
  function inspectExternal(event) {
    if (!event || event.key !== keys.current || !event.newValue) return null;
    if (event.newValue === lastSavedRaw) return null;
    const issues = [];
    const parsed = parseCandidate(event.newValue, 'other-tab', issues);
    if (!parsed) {
      notify({ type: 'conflict', corrupt: true, issues });
      return { external: true, corrupt: true, scene: null, issues, revision: null };
    }
    if (parsed.revision && (parsed.revision === lastRevision || parsed.revision === lastSavedRevision)) {
      return null;
    }
    notify({ type: 'conflict', revision: parsed.revision, scene: parsed.scene });
    return {
      external: true,
      corrupt: false,
      scene: parsed.scene,
      issues: parsed.issues,
      revision: parsed.revision,
      source: 'other-tab',
    };
  }

  function clear() {
    for (const key of Object.values(keys)) safeRemove(key);
    for (const legacyKey of config.legacyKeys ?? []) safeRemove(legacyKey);
    lastRevision = null;
    lastSavedRevision = null;
    lastSavedRaw = null;
    pendingData = null;
  }

  return {
    load,
    save,
    schedule,
    flush,
    cancel,
    inspectExternal,
    clear,
    currentRaw,
    currentRevision: readCurrentRevision,
    snapshots: readSnapshotMeta,
    status: () => ({ status, reason: unavailableReason, available: status === 'ok' || status === 'unknown' }),
    revision: () => lastRevision,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    summary: (issues) => describeIssues(issues),
    keys,
    config,
  };
}
