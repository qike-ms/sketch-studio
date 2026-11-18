import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPersistence, memoryStorage } from '../src/persistence.js';

const good = (n = 1) => ({
  version: 2,
  elements: Array.from({ length: n }, (_, i) => ({ id: `el${i}`, type: 'rect', x: i, y: 0, width: 10, height: 10 })),
});

describe('recovery copies only promote validated snapshots', () => {
  it('does not copy a structurally invalid current slot over a good backup', () => {
    const store = memoryStorage();
    const p = createPersistence({ storage: store });
    p.save(good(1));
    store.setItem(p.keys.current, '{"version":2,"elements":null}');
    const loaded = p.load();
    assert.equal(loaded.source, 'backup');
    const healed = p.save(good(2), { recoveryRaw: loaded.raw });
    assert.equal(healed.ok, true);
    const backup = JSON.parse(store.getItem(p.keys.backup));
    assert.equal(backup.elements.length, 1, 'backup still holds the known-good scene');
    assert.ok(Array.isArray(backup.elements));
  });

  it('does not poison the backup even without an explicit recovery candidate', () => {
    const store = memoryStorage();
    const p = createPersistence({ storage: store });
    p.save(good(1));
    store.setItem(p.keys.current, '{"version":2,"elements":null}');
    assert.equal(p.load().source, 'backup');
    p.save(good(2));
    const backup = JSON.parse(store.getItem(p.keys.backup));
    assert.ok(Array.isArray(backup.elements));
    assert.equal(backup.elements.length, 1);
  });

  it('keeps recovery working after the ring is removed and current is corrupt', () => {
    const store = memoryStorage();
    const p = createPersistence({ storage: store });
    p.save(good(1));
    store.setItem(p.keys.current, '{"version":2,"elements":null}');
    const first = p.load();
    p.save(good(2), { recoveryRaw: first.raw });
    store.removeItem(p.keys.ring);
    store.setItem(p.keys.current, 'not json');
    const again = p.load();
    assert.equal(again.ok, true);
    assert.equal(again.source, 'backup');
    assert.equal(again.scene.elements.length, 1);
  });

  it('promotes the recovered ring entry to backup when current and backup are bad', () => {
    const store = memoryStorage();
    const p = createPersistence({ storage: store, maxSnapshots: 3 });
    p.save(good(1));
    p.save(good(2));
    p.save(good(3));
    store.setItem(p.keys.current, '{"version":2,"elements":null}');
    store.setItem(p.keys.backup, '{"version":2,"elements":null}');
    const loaded = p.load();
    assert.equal(loaded.source, 'snapshot');
    p.save(loaded.scene, { recoveryRaw: loaded.raw });
    const backup = JSON.parse(store.getItem(p.keys.backup));
    assert.ok(Array.isArray(backup.elements));
    assert.equal(backup.elements.length, loaded.scene.elements.length);
  });

  it('refuses to write a scene that validation would reject', () => {
    const store = memoryStorage();
    const p = createPersistence({ storage: store });
    const result = p.save({ version: 2, elements: null });
    assert.equal(result.ok, false);
    assert.match(result.error, /not valid/);
    assert.equal(store.getItem(p.keys.current), null);
  });
});
