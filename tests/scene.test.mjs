import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Scene, makeElement } from '../src/scene.js';
import * as geo from '../src/geometry.js';

describe('element factory', () => {
  it('fills defaults, unique ids, ignores undefined overrides', () => {
    const a = makeElement({ type: 'rect', x: 1, y: 2, width: 3, height: 4 });
    const b = makeElement({ type: 'rect', x: 1, y: 2, width: 3, height: 4, strokeWidth: undefined });
    assert.notEqual(a.id, b.id);
    assert.equal(a.strokeWidth, 2);
    assert.equal(b.strokeWidth, 2);
    assert.equal(b.backgroundColor, 'transparent');
  });

  it('keeps point-based elements positionally consistent', () => {
    const el = makeElement({ type: 'freehand', x: 0, y: 0, points: [{ x: 40, y: 10 }, { x: 10, y: 60 }] });
    geo.normalizePoints(el);
    assert.equal(el.x, 10);
    assert.equal(el.y, 10);
    assert.equal(el.width, 30);
    assert.equal(el.height, 50);
    assert.ok(geo.hitTest(el, { x: 40, y: 10 }), 'absolute vertex survives normalisation');
    assert.ok(!geo.hitTest(el, { x: 10, y: 10 }), 'the un-shifted corner is not part of the shape');
  });
});

describe('scene bookkeeping', () => {
  it('add / findById / serialize round-trip', () => {
    const scene = new Scene();
    const id = scene.add({ type: 'rect', x: 10, y: 10, width: 50, height: 40 });
    scene.add({ type: 'text', x: 0, y: 0, text: 'hello', width: 40, height: 20 });
    const json = JSON.parse(JSON.stringify(scene.toJSON()));
    const revived = new Scene();
    revived.loadFrom(json);
    assert.equal(revived.elements.length, 2);
    assert.ok(revived.findById(id));
    assert.throws(() => revived.loadFrom({ elements: 5 }));
  });

  it('undo / redo restores snapshots', () => {
    const scene = new Scene();
    const id = scene.add({ type: 'rect', x: 0, y: 0, width: 10, height: 10 });
    scene.pushHistory();
    scene.removeElements([id]);
    assert.equal(scene.elements.length, 0);
    assert.ok(scene.undo());
    assert.equal(scene.elements.length, 1);
    assert.equal(scene.findById(id).x, 0);
    assert.ok(scene.redo());
    assert.equal(scene.elements.length, 0);
    assert.ok(!scene.redo());
  });

  it('removeElements cascades: bound label goes, arrows survive unbound', () => {
    const scene = new Scene();
    const box = scene.add({ type: 'rect', x: 100, y: 100, width: 100, height: 60 });
    const label = scene.add({ type: 'text', x: 120, y: 120, text: 'hi', width: 20, height: 16, containerId: box });
    const other = scene.add({ type: 'rect', x: 400, y: 100, width: 80, height: 60 });
    const link = scene.add({
      type: 'arrow',
      x: 200,
      y: 130,
      points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      startBinding: { elementId: box },
      endBinding: { elementId: other },
    });
    scene.syncLabels();
    scene.removeElements([box]);
    assert.ok(!scene.findById(box));
    assert.ok(!scene.findById(label), 'bound label is deleted with its container');
    const survivor = scene.findById(link);
    assert.ok(survivor);
    assert.equal(survivor.startBinding, null);
    assert.equal(survivor.endBinding.elementId, other, 'the surviving end keeps its link');
    const [start] = geo.resolveConnector(survivor, scene.find);
    assert.ok(start.x >= 200 && start.x <= 208, 'frozen where the link used to be');
    assert.equal(Math.round(start.y), 130);
  });

  it('applyPositions keeps bound text glued to its container', () => {
    const scene = new Scene();
    const box = scene.add({ type: 'rect', x: 0, y: 0, width: 100, height: 60 });
    const label = scene.add({ type: 'text', x: 0, y: 0, width: 20, height: 10, text: 'x', containerId: box });
    const centre = (el) => geo.rectCenter(geo.rectOf(el));
    scene.syncLabels();
    assert.deepEqual(centre(scene.findById(label)), { x: 50, y: 30 });
    scene.applyPositions([{ id: box, x: 120, y: 40 }]);
    assert.deepEqual(centre(scene.findById(label)), { x: 170, y: 70 });
  });

  it('duplicate remaps container and binding ids', () => {
    const scene = new Scene();
    const box = scene.add({ type: 'rect', x: 0, y: 0, width: 100, height: 60 });
    const label = scene.add({ type: 'text', x: 10, y: 10, width: 20, height: 10, text: 'x', containerId: box });
    const other = scene.add({ type: 'rect', x: 300, y: 0, width: 60, height: 60 });
    const link = scene.add({
      type: 'arrow',
      x: 100,
      y: 30,
      points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      startBinding: { elementId: box },
      endBinding: { elementId: other },
    });
    const copies = scene.duplicate([box, label, other, link], 16, 8);
    assert.equal(copies.length, 4);
    const copyBox = scene.findById(copies[0]);
    const copyLabel = scene.findById(copies[1]);
    const copyOther = scene.findById(copies[2]);
    const copyLink = scene.findById(copies[3]);
    assert.equal(copyLabel.containerId, copyBox.id);
    assert.equal(copyLink.startBinding.elementId, copyBox.id);
    assert.equal(copyLink.endBinding.elementId, copyOther.id);
    assert.ok(copyLink.endBinding.elementId !== other, 'never points back at the original');
    assert.equal(copyBox.x, 16);
    assert.equal(copyBox.y, 8);
  });

  it('bindLabelTo glues text to a shape and unbinds on demand', () => {
    const scene = new Scene();
    const box = scene.add({ type: 'rect', x: 0, y: 0, width: 100, height: 60 });
    const first = scene.add({ type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'a' });
    scene.bindLabelTo(first, box);
    assert.equal(scene.findById(first).containerId, box);
    assert.deepEqual(geo.rectCenter(geo.rectOf(scene.findById(first))), { x: 50, y: 30 });
    scene.bindLabelTo(first, null);
    assert.equal(scene.findById(first).containerId, null);
    assert.equal(scene.bindLabelTo(box, box), false, 'only text can be a label');
  });
});
