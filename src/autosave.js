/**
 * Autosave + multi-tab conflict controller.
 *
 * Owns the debounce timer and conflict state so a queued local write cannot
 * overwrite another tab while the user is deciding what to do. Writes are
 * guarded with the revision the controller last observed; a changed revision
 * becomes a conflict instead of a silent overwrite.
 */
export const DEFAULT_DEBOUNCE_MS = 350;

export function createSaveController(options = {}) {
  const persistence = options.persistence;
  if (!persistence) throw new Error('createSaveController: persistence is required');
  const snapshot = options.snapshot ?? (() => null);
  const setTimeoutFn = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn = options.clearTimeout ?? ((id) => clearTimeout(id));
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const onEvent = options.onEvent ?? (() => {});

  let timer = null;
  let dirty = false;
  let conflict = null;
  let expectedRevision = null;

  function emit(event) {
    try {
      onEvent(event);
    } catch {
      // presentation must never break saving
    }
  }

  function cancelTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function cancelPending() {
    cancelTimer();
    persistence.cancel?.();
  }

  function noteLoaded(result) {
    cancelPending();
    dirty = false;
    conflict = null;
    expectedRevision = result?.revision ?? persistence.currentRevision?.() ?? null;
    emit({ type: 'loaded', source: result?.source ?? null, revision: expectedRevision });
  }

  /** A scene replaced locally (e.g. an opened file); keep guarding the slot. */
  function noteSceneReplaced(revision) {
    cancelPending();
    dirty = false;
    conflict = null;
    expectedRevision = revision ?? persistence.currentRevision?.() ?? null;
    emit({ type: 'loaded', source: 'replacement', revision: expectedRevision });
  }

  function schedule() {
    dirty = true;
    if (conflict) {
      emit({ type: 'blocked', reason: 'conflict' });
      return { scheduled: false, conflict: true };
    }
    cancelTimer();
    timer = setTimeoutFn(() => {
      timer = null;
      if (!dirty) return;
      runSave(false);
    }, debounceMs);
    emit({ type: 'scheduled' });
    return { scheduled: true };
  }

  function runSave(force, extra = {}) {
    if (conflict && !force) {
      emit({ type: 'blocked', reason: 'conflict' });
      return { ok: false, conflict: true };
    }
    const saveOptions = force ? { ...extra } : { ...extra, expectRevision: expectedRevision };
    const result = persistence.save(snapshot(), saveOptions);
    if (result.ok) {
      dirty = false;
      expectedRevision = result.revision;
      emit({ type: 'saved', result });
      return result;
    }
    if (result.conflict) {
      dirty = true;
      cancelPending();
      conflict = {
        scene: result.scene ?? null,
        revision: result.revision ?? null,
        issues: result.issues ?? [],
        corrupt: Boolean(result.corrupt),
      };
      emit({ type: 'conflict', conflict });
      return result;
    }
    emit({
      type: result.quota ? 'quota' : result.unavailable ? 'unavailable' : 'error',
      result,
    });
    return result;
  }

  function saveNow(extra = {}, force = false) {
    cancelTimer();
    return runSave(force, extra);
  }

  function inspect(event) {
    const external = persistence.inspectExternal(event);
    if (!external) return null;
    if (external.corrupt) {
      emit({ type: 'corrupt-external', external });
      return external;
    }
    expectedRevision = external.revision ?? expectedRevision;
    // Any queued local write is obsolete as soon as another tab wins.
    cancelPending();
    if (conflict) {
      conflict = {
        scene: external.scene,
        revision: external.revision,
        issues: external.issues ?? [],
        corrupt: false,
      };
      emit({ type: 'conflict-updated', conflict });
      return { ...external, updatedConflict: true };
    }
    if (!dirty) {
      emit({ type: 'adopt-external', external });
      return { ...external, adopt: true };
    }
    dirty = true;
    conflict = {
      scene: external.scene,
      revision: external.revision,
      issues: external.issues ?? [],
      corrupt: false,
    };
    emit({ type: 'conflict', conflict });
    return { ...external, needsDecision: true };
  }

  function resolveLoad() {
    const current = conflict;
    cancelPending();
    conflict = null;
    dirty = false;
    expectedRevision = current?.revision ?? persistence.currentRevision?.() ?? expectedRevision;
    emit({ type: 'resolve-load', conflict: current });
    return current;
  }

  function resolveKeep() {
    const current = conflict;
    conflict = null;
    cancelPending();
    const result = runSave(true);
    emit({ type: 'resolve-keep', conflict: current, result });
    return result;
  }

  function flush() {
    if (conflict) {
      emit({ type: 'unload-blocked', conflict });
      return null;
    }
    if (!dirty) return null;
    cancelTimer();
    return runSave(false);
  }

  return {
    noteLoaded,
    noteSceneReplaced,
    schedule,
    saveNow,
    inspect,
    resolveLoad,
    resolveKeep,
    flush,
    cancel: cancelPending,
    get dirty() {
      return dirty;
    },
    get conflict() {
      return conflict;
    },
    get expectedRevision() {
      return expectedRevision;
    },
  };
}
