import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPersistence, memoryStorage } from '../src/persistence.js';
import { createSaveController } from '../src/autosave.js';

function fakeTimers() {
  const queue = [];
  return {
    setTimeout: (fn) => { queue.push(fn); return queue.length - 1; },
    clearTimeout: (id) => { queue[id] = null; },
    run: () => { const copy = queue.splice(0); for (const fn of copy) fn?.(); },
    size: () => queue.filter(Boolean).length,
  };
}

const scene = (id) => ({ version: 2, elements: [{ id, type: 'rect', x: 0, y: 0, width: 10, height: 10 }] });

function setup() {
  const storage = memoryStorage();
  const timers = fakeTimers();
  const persistence = createPersistence({
    storage,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  let current = scene('local');
  const events = [];
  const controller = createSaveController({
    persistence,
    snapshot: () => current,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onEvent: (event) => events.push(event.type),
  });
  controller.noteLoaded({ revision: null });
  return { storage, timers, persistence, controller, events, setScene: (value) => { current = value; }, current: () => current };
}

describe('autosave conflict controller', () => {
  it('cancels a queued save when another tab wins', () => {
    const ctx = setup();
    ctx.controller.saveNow();
    const localRevision = ctx.persistence.revision();
    assert.ok(localRevision);

    ctx.setScene(scene('local-edit'));
    ctx.controller.schedule();
    assert.equal(ctx.timers.size(), 1);

    const foreign = { ...scene('foreign'), revision: 'foreign-1' };
    ctx.storage.setItem(ctx.persistence.keys.current, JSON.stringify(foreign));
    const external = ctx.persistence.inspectExternal({
      key: ctx.persistence.keys.current,
      newValue: ctx.storage.getItem(ctx.persistence.keys.current),
    });
    assert.equal(external.revision, 'foreign-1');

    ctx.controller.inspect({ key: ctx.persistence.keys.current, newValue: ctx.storage.getItem(ctx.persistence.keys.current) });
    assert.equal(ctx.timers.size(), 0, 'queued save was cancelled');
    ctx.timers.run();
    assert.equal(JSON.parse(ctx.storage.getItem(ctx.persistence.keys.current)).elements[0].id, 'foreign');
    assert.equal(ctx.controller.dirty, true);
    assert.equal(ctx.controller.conflict.revision, 'foreign-1');
  });

  it('Load other tab adopts the external revision and clears dirty state', () => {
    const ctx = setup();
    ctx.controller.saveNow();
    ctx.setScene(scene('local-edit'));
    ctx.controller.schedule();
    ctx.storage.setItem(ctx.persistence.keys.current, JSON.stringify({ ...scene('foreign'), revision: 'foreign-1' }));
    ctx.controller.inspect({ key: ctx.persistence.keys.current, newValue: ctx.storage.getItem(ctx.persistence.keys.current) });
    const loaded = ctx.controller.resolveLoad();
    assert.equal(loaded.revision, 'foreign-1');
    assert.equal(ctx.controller.dirty, false);
    assert.equal(ctx.controller.conflict, null);
    assert.equal(ctx.controller.expectedRevision, 'foreign-1');
    assert.equal(JSON.parse(ctx.storage.getItem(ctx.persistence.keys.current)).elements[0].id, 'foreign');
  });

  it('Keep mine writes the local scene after the user decides', () => {
    const ctx = setup();
    ctx.controller.saveNow();
    ctx.setScene(scene('local-edit'));
    ctx.controller.schedule();
    ctx.storage.setItem(ctx.persistence.keys.current, JSON.stringify({ ...scene('foreign'), revision: 'foreign-1' }));
    ctx.controller.inspect({ key: ctx.persistence.keys.current, newValue: ctx.storage.getItem(ctx.persistence.keys.current) });
    const result = ctx.controller.resolveKeep();
    assert.equal(result.ok, true);
    assert.equal(JSON.parse(ctx.storage.getItem(ctx.persistence.keys.current)).elements[0].id, 'local-edit');
    assert.equal(ctx.controller.dirty, false);
    assert.equal(ctx.controller.conflict, null);
  });

  it('tracks the latest external revision while the prompt is open', () => {
    const ctx = setup();
    ctx.controller.saveNow();
    ctx.setScene(scene('local-edit'));
    ctx.controller.schedule();
    for (const [id, revision] of [['foreign-1', 'foreign-1'], ['foreign-2', 'foreign-2']]) {
      ctx.storage.setItem(ctx.persistence.keys.current, JSON.stringify({ ...scene(id), revision }));
      ctx.controller.inspect({ key: ctx.persistence.keys.current, newValue: ctx.storage.getItem(ctx.persistence.keys.current) });
    }
    assert.equal(ctx.controller.conflict.revision, 'foreign-2');
    assert.equal(JSON.parse(ctx.storage.getItem(ctx.persistence.keys.current)).elements[0].id, 'foreign-2');
    ctx.controller.resolveKeep();
    assert.equal(JSON.parse(ctx.storage.getItem(ctx.persistence.keys.current)).elements[0].id, 'local-edit');
  });

  it('a stale queued write becomes a conflict instead of overwriting', () => {
    const ctx = setup();
    ctx.controller.saveNow();
    ctx.setScene(scene('local-edit'));
    ctx.controller.schedule();
    // No storage event is delivered; the current slot changes underneath us.
    ctx.storage.setItem(ctx.persistence.keys.current, JSON.stringify({ ...scene('foreign'), revision: 'foreign-1' }));
    ctx.timers.run();
    assert.equal(JSON.parse(ctx.storage.getItem(ctx.persistence.keys.current)).elements[0].id, 'foreign');
    assert.equal(ctx.controller.dirty, true);
    assert.equal(ctx.controller.conflict.revision, 'foreign-1');
  });

  it('does not flush over an unresolved conflict on unload', () => {
    const ctx = setup();
    ctx.controller.saveNow();
    ctx.setScene(scene('local-edit'));
    ctx.controller.schedule();
    ctx.storage.setItem(ctx.persistence.keys.current, JSON.stringify({ ...scene('foreign'), revision: 'foreign-1' }));
    ctx.controller.inspect({ key: ctx.persistence.keys.current, newValue: ctx.storage.getItem(ctx.persistence.keys.current) });
    assert.equal(ctx.controller.flush(), null);
    assert.equal(JSON.parse(ctx.storage.getItem(ctx.persistence.keys.current)).elements[0].id, 'foreign');
  });

  it('adopts an external scene when there are no local changes', () => {
    const ctx = setup();
    ctx.controller.saveNow();
    ctx.storage.setItem(ctx.persistence.keys.current, JSON.stringify({ ...scene('foreign'), revision: 'foreign-1' }));
    const decision = ctx.controller.inspect({ key: ctx.persistence.keys.current, newValue: ctx.storage.getItem(ctx.persistence.keys.current) });
    assert.equal(decision.adopt, true);
    assert.equal(ctx.controller.dirty, false);
    assert.equal(ctx.controller.conflict, null);
    assert.ok(ctx.events.includes('adopt-external'));
  });

  it('saves normally after loading a revision', () => {
    const ctx = setup();
    ctx.controller.saveNow();
    const loaded = ctx.persistence.load();
    ctx.controller.noteLoaded(loaded);
    ctx.setScene(scene('next'));
    const result = ctx.controller.saveNow();
    assert.equal(result.ok, true);
    assert.equal(JSON.parse(ctx.storage.getItem(ctx.persistence.keys.current)).elements[0].id, 'next');
  });
});
