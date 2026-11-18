import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Scene, makeElement } from '../src/scene.js';

describe('bounded undo history', () => {
  it('keeps only the configured number of entries', () => {
    const scene = new Scene([], { historyLimit: 3 });
    for (let i = 0; i < 10; i += 1) {
      scene.pushHistory();
      scene.add({ type: 'rect', x: i, y: 0, width: 10, height: 10 });
    }
    assert.deepEqual(scene.historySize(), { undo: 3, redo: 0, limit: 3 });
    assert.equal(scene.undoStack.length, 3);
  });

  it('setHistoryLimit trims both stacks', () => {
    const scene = new Scene();
    scene.pushHistory();
    scene.pushHistory();
    scene.pushHistory();
    scene.undo();
    scene.setHistoryLimit(1);
    assert.equal(scene.undoStack.length, 1);
    assert.equal(scene.redoStack.length, 1);
  });

  it('undo clears the redo stack on a new edit', () => {
    const scene = new Scene();
    scene.pushHistory();
    scene.add({ type: 'rect', x: 0, y: 0, width: 5, height: 5 });
    scene.undo();
    assert.equal(scene.redoStack.length, 1);
    scene.pushHistory();
    scene.add({ type: 'rect', x: 1, y: 1, width: 5, height: 5 });
    assert.equal(scene.redoStack.length, 0);
  });
});

describe('corrupt history never corrupts the scene', () => {
  it('skips a corrupt undo entry and restores the next good one', () => {
    const scene = new Scene();
    const id = scene.add({ type: 'rect', x: 0, y: 0, width: 10, height: 10 });
    scene.pushHistory();
    scene.add({ type: 'rect', x: 20, y: 20, width: 10, height: 10 });
    const good = scene.snapshot();
    scene.undoStack.push(good);
    scene.undoStack.push('{not json');
    const before = scene.elements.length;
    assert.equal(scene.undo(), true);
    assert.equal(scene.elements.length, before, 'restored to the valid snapshot');
    assert.equal(scene.findById(id).x, 0);
    assert.ok(scene.historyIssues.some((item) => item.code === 'corrupt-history'));
  });

  it('leaves the scene untouched when every entry is corrupt', () => {
    const scene = new Scene();
    scene.add({ type: 'rect', x: 7, y: 7, width: 10, height: 10 });
    scene.undoStack.push('garbage', '{"elements":[]}');
    const snapshot = scene.snapshot();
    assert.equal(scene.undo(), false);
    assert.equal(scene.snapshot(), snapshot);
    assert.equal(scene.elements.length, 1);
  });

  it('skips a corrupt redo entry', () => {
    const scene = new Scene();
    scene.add({ type: 'rect', x: 0, y: 0, width: 10, height: 10 });
    scene.pushHistory();
    scene.add({ type: 'rect', x: 20, y: 20, width: 10, height: 10 });
    scene.undo();
    scene.redoStack.push('not json');
    scene.redoStack.push(JSON.stringify([makeElement({ type: 'rect', x: 99, y: 0, width: 1, height: 1 })]));
    assert.equal(scene.redo(), true);
    assert.equal(scene.elements[0].x, 99);
  });
});

describe('binding and group bookkeeping', () => {
  it('bindConnectorEnd can clear a binding with null', () => {
    const scene = new Scene();
    const box = scene.add({ type: 'rect', width: 10, height: 10 });
    const link = scene.add({ type: 'arrow', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], startBinding: { elementId: box } });
    assert.equal(scene.bindConnectorEnd(link, 'start', box), true);
    assert.equal(scene.findById(link).startBinding.elementId, box);
    assert.equal(scene.bindConnectorEnd(link, 'start', null), true);
    assert.equal(scene.findById(link).startBinding, null);
    assert.equal(scene.bindConnectorEnd('missing', 'end', box), false);
  });

  it('duplicate copies group membership', () => {
    const scene = new Scene();
    const id = scene.add({ type: 'rect', width: 10, height: 10, groupIds: ['g1'] });
    const [copyId] = scene.duplicate([id]);
    assert.deepEqual(scene.findById(copyId).groupIds, ['g1']);
  });

  it('loadFrom resets undo and redo', () => {
    const scene = new Scene();
    scene.pushHistory();
    scene.add({ type: 'rect', width: 1, height: 1 });
    scene.undo();
    scene.loadFrom({ version: 2, elements: [{ id: 'a', type: 'rect', width: 5, height: 5 }] });
    assert.deepEqual(scene.historySize(), { undo: 0, redo: 0, limit: 100 });
  });
});
