import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as tools from '../src/tools.js';
import * as geo from '../src/geometry.js';

const style = { strokeColor: '#111', strokeWidth: 3, strokeStyle: 'solid', opacity: 100, roughness: 1 };
const find = (id) => null;

describe('tool + style routing', () => {
  it('keyboard shortcuts map to tools', () => {
    assert.equal(tools.toolFromShortcut('v'), 'select');
    assert.equal(tools.toolFromShortcut('a'), 'arrow');
    assert.equal(tools.toolFromShortcut('t'), 'text');
    assert.equal(tools.toolFromShortcut('q'), null);
  });

  it('every tool has a label and shortcut', () => {
    for (const entry of tools.TOOLS) {
      assert.ok(entry.tool && entry.label && entry.shortcut);
    }
  });
});

describe('drafting shapes', () => {
  it('dragging a rect keeps the origin pinned', () => {
    const draft = tools.createDraft('rect', { x: 100, y: 100 }, style);
    const grown = tools.updateDraft(draft, 'rect', { x: 100, y: 100 }, { x: 160, y: 140 }, false);
    assert.deepEqual(geo.rectOf(grown), { x: 100, y: 100, width: 60, height: 40 });
    assert.equal(grown.strokeColor, '#111');
    assert.equal(grown.strokeWidth, 3);
  });

  it('dragging the other way normalises the box', () => {
    const grown = tools.updateDraft(tools.createDraft('rect', { x: 100, y: 100 }, style), 'rect', { x: 100, y: 100 }, { x: 60, y: 70 }, false);
    assert.deepEqual(geo.rectOf(grown), { x: 60, y: 70, width: 40, height: 30 });
  });

  it('shift constrains a rect to a square, keeping the origin', () => {
    const grown = tools.updateDraft(tools.createDraft('rect', { x: 100, y: 100 }, style), 'rect', { x: 100, y: 100 }, { x: 160, y: 110 }, true);
    assert.equal(grown.width, grown.height);
    assert.equal(grown.width, 60);
  });

  it('shift snaps a line to the nearest 15 degrees', () => {
    const draft = tools.createDraft('line', { x: 0, y: 0 }, style);
    const snapped = tools.updateDraft(draft, 'line', { x: 0, y: 0 }, { x: 100, y: 8 }, true);
    const [start, end] = snapped.points;
    const angle = Math.atan2(end.y, end.x);
    assert.ok(Math.abs(angle % tools.ANGLE_SNAP) < 1e-9 || Math.abs(Math.abs(angle) - Math.PI) < 1e-9);
    assert.ok(Math.hypot(end.x, end.y) > 99);
  });

  it('freehand appends points and keeps them relative', () => {
    let draft = tools.createDraft('freehand', { x: 50, y: 50 }, style);
    draft = tools.updateDraft(draft, 'freehand', { x: 50, y: 50 }, { x: 80, y: 70 }, false);
    draft = tools.updateDraft(draft, 'freehand', { x: 50, y: 50 }, { x: 20, y: 30 }, false);
    assert.equal(draft.points.length, 3);
    assert.ok(draft.x <= 20 && draft.y <= 30, 'bbox origin moved with the negative excursion');
    assert.deepEqual(geo.absolutePoints(draft), [{ x: 50, y: 50 }, { x: 80, y: 70 }, { x: 20, y: 30 }]);
  });

  it('an arrow draft carries two endpoints', () => {
    const draft = tools.updateDraft(tools.createDraft('arrow', { x: 10, y: 10 }, style), 'arrow', { x: 10, y: 10 }, { x: 90, y: 40 }, false);
    assert.equal(draft.type, 'arrow');
    assert.equal(draft.points.length, 2);
  });

  it('every drawing tool produces a draft', () => {
    for (const entry of tools.TOOLS) {
      if (entry.tool === 'select' || entry.tool === 'eraser') continue;
      const draft = tools.createDraft(entry.tool, { x: 5, y: 5 }, style);
      assert.equal(draft.type, entry.tool);
    }
  });
});

describe('resize handles', () => {
  const rect = { x: 100, y: 100, width: 200, height: 100 };

  it('each handle moves its own edge', () => {
    const e = tools.resizeRect(rect, 'e', 20, 0);
    assert.deepEqual(e, { x: 100, y: 100, width: 220, height: 100 });
    const w = tools.resizeRect(rect, 'w', 20, 0);
    assert.deepEqual(w, { x: 120, y: 100, width: 180, height: 100 });
    const s = tools.resizeRect(rect, 's', 0, -30);
    assert.deepEqual(s, { x: 100, y: 100, width: 200, height: 70 });
    const n = tools.resizeRect(rect, 'n', 0, 30);
    assert.deepEqual(n, { x: 100, y: 130, width: 200, height: 70 });
    const ne = tools.resizeRect(rect, 'ne', 10, -10);
    assert.deepEqual(ne, { x: 100, y: 90, width: 210, height: 110 });
    const sw = tools.resizeRect(rect, 'sw', -10, 10);
    assert.deepEqual(sw, { x: 90, y: 100, width: 210, height: 110 });
  });

  it('the opposite corner stays anchored', () => {
    const se = tools.resizeRect(rect, 'se', 40, 40);
    assert.equal(se.x, rect.x);
    assert.equal(se.y, rect.y);
    assert.equal(se.width, 240);
    assert.equal(se.height, 140);
  });

  it('shift locks the aspect ratio from a corner', () => {
    const scaled = tools.resizeRect(rect, 'se', 100, 10, true);
    assert.ok(Math.abs(scaled.width / scaled.height - rect.width / rect.height) < 0.01);
    assert.ok(scaled.width > rect.width);
  });

  it('minimum size never inverts the box', () => {
    const shrunk = tools.resizeRect(rect, 'se', -400, -400);
    assert.ok(shrunk.width >= 1 && shrunk.height >= 1);
  });

  it('handle lookup finds the nearest grab point', () => {
    const handle = tools.handleAt(rect, { x: 101, y: 101 });
    assert.equal(handle, 'nw');
    assert.equal(tools.handleAt(rect, { x: 200, y: 150 }), null, 'dead centre is not a handle');
    assert.equal(tools.handleAt(rect, { x: 300, y: 150 }), 'e');
  });
});

describe('selection maths', () => {
  it('shift toggles membership, plain click replaces', () => {
    assert.deepEqual(tools.toggleSelection([], 'x', false), ['x']);
    assert.deepEqual(tools.toggleSelection(['x'], 'x', true), []);
    assert.deepEqual(tools.toggleSelection(['x'], 'y', true).sort(), ['x', 'y']);
    assert.deepEqual(tools.toggleSelection(['x'], 'y', false), ['y']);
  });

  it('marquee intersects by default, contains with shift', () => {
    const a = { id: 'a', type: 'rect', x: 0, y: 0, width: 40, height: 40, strokeWidth: 2 };
    const b = { id: 'b', type: 'rect', x: 90, y: 90, width: 40, height: 40, strokeWidth: 2 };
    const rect = { x: 20, y: 20, width: 100, height: 100 };
    assert.deepEqual(tools.marqueeSelection([], [a, b], rect, false), ['a', 'b']);
    assert.deepEqual(tools.marqueeSelection([], [a, b], rect, true), []);
    assert.deepEqual(tools.marqueeSelection(['b'], [a, b], { x: 0, y: 0, width: 10, height: 10 }, true), ['b']);
  });
});

describe('linking', () => {
  const a = { id: 'a', type: 'rect', x: 0, y: 0, width: 100, height: 60, strokeWidth: 2 };
  const b = { id: 'b', type: 'ellipse', x: 300, y: 100, width: 100, height: 60, strokeWidth: 2 };
  const text = { id: 't', type: 'text', x: 600, y: 600, width: 20, height: 10 };

  it('binding target only accepts closed shapes under the endpoint', () => {
    assert.equal(tools.bindingTargetAt([a, b, text], { x: 50, y: 30 }), 'a');
    assert.equal(tools.bindingTargetAt([a, b, text], { x: 350, y: 130 }), 'b');
    assert.equal(tools.bindingTargetAt([a, b, text], { x: 610, y: 605 }), null, 'text is not a link target');
    assert.equal(tools.bindingTargetAt([a], { x: 50, y: 30 }, ['a']), null, 'cannot bind to itself');
  });

  it('dragging an endpoint re-anchors the tip and frees the binding', () => {
    const arrow = {
      id: 'link',
      type: 'arrow',
      x: 100,
      y: 30,
      width: 200,
      height: 120,
      points: [{ x: 0, y: 0 }, { x: 200, y: 120 }],
      startBinding: { elementId: 'a' },
      strokeWidth: 2,
    };
    tools.moveConnectorEnd(arrow, (id) => (id === 'a' ? a : id === 'b' ? b : null), 'end', { x: 300, y: 130 });
    const [, end] = geo.resolveConnector(arrow, (id) => (id === 'a' ? a : null));
    assert.ok(Math.abs(end.x - 300) < 1e-9 && Math.abs(end.y - 130) < 1e-9);
    assert.equal(arrow.endBinding, null);
    assert.equal(arrow.startBinding.elementId, 'a', 'the untouched end stays linked');
  });

  it('eraser removes what the stroke crosses', () => {
    const hits = tools.eraseHits([a, b], { x: -10, y: -10 }, { x: 60, y: 40 }, find);
    assert.deepEqual(hits, ['a']);
  });
});
