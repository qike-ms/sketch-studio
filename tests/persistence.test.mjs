import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as persistence from '../src/persistence.js';

const sceneData = (n = 1, style = {}) => ({
  version: 2,
  elements: Array.from({ length: n }, (_, i) => ({
    id: `el${i}`, type: 'rect', x: i * 10, y: 0, width: 20, height: 20,
  })),
  style,
  theme: 'light',
});

function quotaError() {
  const error = new Error('The quota has been exceeded.');
  error.name = 'QuotaExceededError';
  return error;
}

function quotaStorage(limit, initial = {}) {
  const map = new Map(Object.entries(initial));
  const size = () => [...map.entries()].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      const next = size() - (map.get(key)?.length ?? 0) - (map.has(key) ? key.length : 0) + key.length + String(value).length;
      if (next > limit) throw quotaError();
      map.set(String(key), String(value));
    },
    removeItem: (key) => map.delete(key),
    _map: map,
  };
}

function unavailableStorage() {
  const error = new Error('The operation is insecure.');
  error.name = 'SecurityError';
  return {
    getItem: () => null,
    setItem: () => { throw error; },
    removeItem: () => { throw error; },
  };
}

function fakeTimers() {
  const queue = [];
  return {
    setTimeout: (fn) => { queue.push(fn); return queue.length - 1; },
    clearTimeout: (id) => { queue[id] = null; },
    run: () => { const copy = queue.splice(0); for (const fn of copy) fn?.(); },
    size: () => queue.filter(Boolean).length,
  };
}

describe('autosave round-trip', () => {
  it('saves, verifies, and loads the current snapshot', () => {
    const store = persistence.memoryStorage();
    const p = persistence.createPersistence({ storage: store });
    const saved = p.save(sceneData(2, { strokeColor: 'red' }));
    assert.equal(saved.ok, true);
    assert.match(saved.revision, /-/);
    const loaded = p.load();
    assert.equal(loaded.ok, true);
    assert.equal(loaded.source, 'current');
    assert.equal(loaded.scene.elements.length, 2);
    assert.equal(loaded.scene.style.strokeColor, 'red');
    assert.equal(loaded.revision, saved.revision);
  });

  it('debounces autosave and flushes the pending scene', () => {
    const store = persistence.memoryStorage();
    const timers = fakeTimers();
    const p = persistence.createPersistence({ storage: store, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    p.schedule(sceneData(1));
    p.schedule(sceneData(3));
    assert.equal(store.getItem(p.keys.current), null);
    assert.equal(timers.size(), 1, 'second schedule replaces the first');
    timers.run();
    const loaded = p.load();
    assert.equal(loaded.scene.elements.length, 3);
    assert.equal(p.flush(), null, 'nothing pending after the timer ran');
  });

  it('flush writes immediately and cancel drops pending work', () => {
    const store = persistence.memoryStorage();
    const timers = fakeTimers();
    const p = persistence.createPersistence({ storage: store, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    p.schedule(sceneData(2));
    assert.equal(p.flush().ok, true);
    assert.equal(p.load().scene.elements.length, 2);
    p.schedule(sceneData(4));
    p.cancel();
    timers.run();
    assert.equal(p.load().scene.elements.length, 2);
  });
});

describe('snapshot recovery', () => {
  it('falls back to the backup when current is corrupt', () => {
    const store = persistence.memoryStorage();
    const p = persistence.createPersistence({ storage: store });
    const first = p.save(sceneData(1));
    p.save(sceneData(2));
    store.setItem(p.keys.current, '{broken json');
    const loaded = p.load();
    assert.equal(loaded.ok, true);
    assert.equal(loaded.source, 'backup');
    assert.equal(loaded.scene.elements.length, 1);
    assert.equal(loaded.revision, first.revision);
    assert.ok(loaded.issues.some((item) => item.code === 'parse-error'));
  });

  it('falls back through the ring when current and backup are partial', () => {
    const store = persistence.memoryStorage();
    const p = persistence.createPersistence({ storage: store, maxSnapshots: 3 });
    p.save(sceneData(1));
    p.save(sceneData(2));
    p.save(sceneData(3));
    store.setItem(p.keys.current, '{"version":2,"elements":[');
    store.setItem(p.keys.backup, '{"version":2,"elements":[');
    const loaded = p.load();
    assert.equal(loaded.ok, true);
    assert.equal(loaded.source, 'snapshot');
    assert.equal(loaded.scene.elements.length, 3);
    assert.ok(loaded.issues.some((item) => item.code === 'parse-error'));
  });

  it('keeps only the last N snapshots', () => {
    const store = persistence.memoryStorage();
    const p = persistence.createPersistence({ storage: store, maxSnapshots: 2 });
    p.save(sceneData(1));
    p.save(sceneData(2));
    p.save(sceneData(3));
    assert.equal(p.snapshots().length, 2);
    const loaded = p.load();
    assert.equal(loaded.scene.elements.length, 3);
  });

  it('does not overwrite a good backup with a corrupt current', () => {
    const store = persistence.memoryStorage();
    const p = persistence.createPersistence({ storage: store });
    p.save(sceneData(1));
    store.setItem(p.keys.current, 'not json');
    p.save(sceneData(2));
    const backup = JSON.parse(store.getItem(p.keys.backup));
    assert.equal(backup.elements.length, 1);
  });

  it('migrates the legacy v1 key when the new key is empty', () => {
    const store = persistence.memoryStorage({
      'sketch-studio:v1': JSON.stringify({ version: 1, elements: [{ id: 'a', type: 'rect', width: 10, height: 10 }], style: { strokeColor: 'blue' } }),
    });
    const p = persistence.createPersistence({ storage: store });
    const loaded = p.load();
    assert.equal(loaded.ok, true);
    assert.equal(loaded.source, 'legacy:sketch-studio:v1');
    assert.equal(loaded.scene.elements.length, 1);
    assert.equal(loaded.scene.style.strokeColor, 'blue');
  });

  it('reports empty storage without treating it as corruption', () => {
    const p = persistence.createPersistence({ storage: persistence.memoryStorage() });
    const loaded = p.load();
    assert.equal(loaded.ok, false);
    assert.equal(loaded.empty, true);
    assert.equal(loaded.scene, null);
  });
});

describe('quota and unavailable storage', () => {
  it('detects QuotaExceededError and keeps working', () => {
    const store = quotaStorage(80);
    const p = persistence.createPersistence({ storage: store });
    const result = p.save(sceneData(20));
    assert.equal(result.ok, false);
    assert.equal(result.quota, true);
    assert.equal(p.status().status, 'quota');
    assert.equal(p.status().available, false);
  });

  it('treats a throwing storage as unavailable', () => {
    const p = persistence.createPersistence({ storage: unavailableStorage() });
    const loaded = p.load();
    assert.equal(loaded.ok, false);
    assert.equal(loaded.unavailable, true);
    const saved = p.save(sceneData(1));
    assert.equal(saved.ok, false);
    assert.equal(saved.unavailable, true);
  });

  it('survives serialisation errors', () => {
    const p = persistence.createPersistence({ storage: persistence.memoryStorage() });
    const circular = { version: 2, elements: [] };
    circular.self = circular;
    assert.equal(p.save(circular).ok, false);
  });

  it('isQuotaError recognises the browser error shapes', () => {
    assert.equal(persistence.isQuotaError(quotaError()), true);
    assert.equal(persistence.isQuotaError({ name: 'QuotaExceededError' }), true);
    assert.equal(persistence.isQuotaError({ code: 22 }), true);
    assert.equal(persistence.isQuotaError({ name: 'SecurityError' }), false);
    assert.equal(persistence.isQuotaError(null), false);
  });
});

describe('multi-tab safety', () => {
  it('detects a revision written by another tab', () => {
    const store = persistence.memoryStorage();
    const tabA = persistence.createPersistence({ storage: store });
    const tabB = persistence.createPersistence({ storage: store });
    tabA.save(sceneData(1));
    const b = tabB.save(sceneData(2));
    const external = tabA.inspectExternal({ key: tabA.keys.current, newValue: store.getItem(tabA.keys.current) });
    assert.equal(external.external, true);
    assert.equal(external.revision, b.revision);
    assert.equal(external.scene.elements.length, 2);
  });

  it('ignores unrelated keys and its own writes', () => {
    const store = persistence.memoryStorage();
    const p = persistence.createPersistence({ storage: store });
    p.save(sceneData(1));
    assert.equal(p.inspectExternal({ key: 'other', newValue: 'x' }), null);
    assert.equal(p.inspectExternal({ key: p.keys.current, newValue: store.getItem(p.keys.current) }), null);
    assert.equal(p.inspectExternal(null), null);
  });

  it('reports a corrupt external write instead of applying it', () => {
    const store = persistence.memoryStorage();
    const p = persistence.createPersistence({ storage: store });
    p.save(sceneData(1));
    const external = p.inspectExternal({ key: p.keys.current, newValue: '{bad' });
    assert.equal(external.external, true);
    assert.equal(external.corrupt, true);
    assert.equal(external.scene, null);
  });

  it('notifies subscribers about save, load and conflict events', () => {
    const store = persistence.memoryStorage();
    const p = persistence.createPersistence({ storage: store });
    const events = [];
    const off = p.subscribe((event) => events.push(event.type));
    p.save(sceneData(1));
    p.load();
    p.inspectExternal({ key: p.keys.current, newValue: '{"version":2,"elements":[]}' });
    assert.deepEqual(events, ['save', 'load', 'conflict']);
    off();
    p.save(sceneData(1));
    assert.deepEqual(events, ['save', 'load', 'conflict']);
  });

  it('clear removes current, backup, ring and legacy data', () => {
    const store = persistence.memoryStorage();
    const p = persistence.createPersistence({ storage: store });
    p.save(sceneData(1));
    p.clear();
    assert.equal(store.getItem(p.keys.current), null);
    assert.equal(store.getItem(p.keys.backup), null);
    assert.equal(store.getItem(p.keys.ring), null);
  });
});
