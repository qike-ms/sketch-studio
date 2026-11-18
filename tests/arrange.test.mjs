import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as arrange from '../src/arrange.js';

function rect(id, x, y, w = 10, h = 10, extra = {}) {
  return { id, type: 'rect', x, y, width: w, height: h, strokeWidth: 2, groupIds: [], locked: false, ...extra };
}

const ids = (elements) => elements.map((el) => el.id);

describe('z-order', () => {
  const base = [rect('a', 0, 0), rect('b', 0, 0), rect('c', 0, 0), rect('d', 0, 0)];

  it('brings to front and sends to back', () => {
    assert.deepEqual(ids(arrange.reorder(base, ['b'], 'front')), ['a', 'c', 'd', 'b']);
    assert.deepEqual(ids(arrange.reorder(base, ['b'], 'back')), ['b', 'a', 'c', 'd']);
    assert.deepEqual(ids(arrange.reorder(base, ['b', 'c'], 'front')), ['a', 'd', 'b', 'c']);
  });

  it('moves one step forward or backward', () => {
    assert.deepEqual(ids(arrange.reorder(base, ['a'], 'forward')), ['b', 'a', 'c', 'd']);
    assert.deepEqual(ids(arrange.reorder(base, ['d'], 'backward')), ['a', 'b', 'd', 'c']);
    assert.deepEqual(ids(arrange.reorder(base, ['a', 'b'], 'forward')), ['c', 'a', 'b', 'd']);
    assert.deepEqual(ids(arrange.reorder(base, ['a'], 'forward')), ['b', 'a', 'c', 'd']);
  });

  it('keeps the same array for unknown modes and empty selections', () => {
    assert.deepEqual(ids(arrange.reorder(base, [], 'front')), ['a', 'b', 'c', 'd']);
    assert.deepEqual(ids(arrange.reorder(base, ['a'], 'sideways')), ['a', 'b', 'c', 'd']);
  });
});

describe('groups', () => {
  it('expands a selection to every member of its groups', () => {
    const elements = [rect('a', 0, 0, 10, 10, { groupIds: ['g1'] }), rect('b', 0, 0, 10, 10, { groupIds: ['g1'] }), rect('c', 0, 0)];
    assert.deepEqual(arrange.expandGroups(elements, ['a']).sort(), ['a', 'b']);
    assert.deepEqual(arrange.expandGroups(elements, ['c']), ['c']);
    assert.deepEqual(arrange.expandGroups(elements, ['a', 'c']).sort(), ['a', 'b', 'c']);
  });

  it('groups and ungroups without losing nested ids', () => {
    const elements = [rect('a', 0, 0), rect('b', 0, 0)];
    arrange.groupElements(elements, ['a', 'b'], 'g1');
    assert.deepEqual(elements[0].groupIds, ['g1']);
    arrange.groupElements(elements, ['a'], 'g2');
    assert.deepEqual(elements[0].groupIds, ['g1', 'g2']);
    const removed = arrange.ungroupElements(elements, ['a']);
    assert.deepEqual(removed.sort(), ['g1', 'g2']);
    assert.deepEqual(elements[0].groupIds, []);
    assert.deepEqual(elements[1].groupIds, []);
  });
});

describe('lock', () => {
  it('toggles lock for the selection', () => {
    const elements = [rect('a', 0, 0), rect('b', 0, 0)];
    assert.equal(arrange.toggleLocked(elements, ['a']), true);
    assert.equal(elements[0].locked, true);
    assert.equal(elements[1].locked, false);
    assert.equal(arrange.toggleLocked(elements, ['a']), false);
    assert.equal(elements[0].locked, false);
    assert.equal(arrange.toggleLocked(elements, []), false);
  });

  it('nudge skips locked elements', () => {
    const elements = [rect('a', 0, 0, 10, 10, { locked: true }), rect('b', 0, 0)];
    const moved = arrange.nudgeElements(elements, ['a', 'b'], 5, 7);
    assert.deepEqual(moved, ['b']);
    assert.equal(elements[0].x, 0);
    assert.equal(elements[1].x, 5);
    assert.equal(elements[1].y, 7);
  });
});

describe('align', () => {
  const make = () => [rect('a', 10, 20, 20, 10), rect('b', 100, 50, 40, 30), rect('c', 200, 90, 10, 10)];

  it('aligns all six edges', () => {
    let elements = make();
    arrange.alignElements(elements, ['a', 'b', 'c'], 'left');
    assert.deepEqual(elements.map((el) => el.x), [10, 10, 10]);
    elements = make();
    arrange.alignElements(elements, ['a', 'b', 'c'], 'right');
    assert.deepEqual(elements.map((el) => el.x + el.width), [210, 210, 210]);
    elements = make();
    arrange.alignElements(elements, ['a', 'b', 'c'], 'centerX');
    assert.deepEqual(elements.map((el) => el.x + el.width / 2), [110, 110, 110]);
    elements = make();
    arrange.alignElements(elements, ['a', 'b', 'c'], 'top');
    assert.deepEqual(elements.map((el) => el.y), [20, 20, 20]);
    elements = make();
    arrange.alignElements(elements, ['a', 'b', 'c'], 'bottom');
    assert.deepEqual(elements.map((el) => el.y + el.height), [100, 100, 100]);
    elements = make();
    arrange.alignElements(elements, ['a', 'b', 'c'], 'centerY');
    assert.deepEqual(elements.map((el) => el.y + el.height / 2), [60, 60, 60]);
  });

  it('ignores locked elements and needs at least two', () => {
    const elements = [rect('a', 10, 10, 10, 10, { locked: true }), rect('b', 50, 50, 10, 10)];
    assert.deepEqual(arrange.alignElements(elements, ['a', 'b'], 'left'), []);
    assert.equal(elements[0].x, 10);
    assert.equal(elements[1].x, 50);
    assert.deepEqual(arrange.alignElements(elements, ['a'], 'left'), []);
  });

  it('uses rotated bounds for alignment', () => {
    const elements = [rect('a', 0, 0, 100, 20, { angle: 90 }), rect('b', 200, 0, 10, 10)];
    arrange.alignElements(elements, ['a', 'b'], 'left');
    const bounds = arrange.selectedBounds(elements, ['a', 'b']);
    assert.equal(bounds.x, 40, 'rotated rect starts at x=40');
    assert.equal(elements[1].x, 40);
  });
});

describe('distribute', () => {
  it('equalises gaps on the x axis', () => {
    const elements = [rect('a', 0, 0, 10, 10), rect('b', 15, 0, 10, 10), rect('c', 100, 0, 10, 10)];
    arrange.distributeElements(elements, ['a', 'b', 'c'], 'x');
    const gaps = [
      elements[1].x - (elements[0].x + elements[0].width),
      elements[2].x - (elements[1].x + elements[1].width),
    ];
    assert.ok(Math.abs(gaps[0] - gaps[1]) < 1e-9);
    assert.equal(elements[0].x, 0);
    assert.equal(elements[2].x, 100);
  });

  it('equalises gaps on the y axis and skips locked elements', () => {
    const elements = [rect('a', 0, 0, 10, 10), rect('b', 0, 20, 10, 10), rect('c', 0, 100, 10, 10)];
    arrange.distributeElements(elements, ['a', 'b', 'c'], 'y');
    const gaps = [elements[1].y - 10, elements[2].y - (elements[1].y + 10)];
    assert.ok(Math.abs(gaps[0] - gaps[1]) < 1e-9);
    const locked = [
      rect('a', 0, 0, 10, 10, { locked: true }),
      rect('b', 0, 20, 10, 10),
      rect('c', 0, 100, 10, 10),
      rect('d', 0, 200, 10, 10),
    ];
    assert.deepEqual(arrange.distributeElements(locked, ['a', 'b', 'c', 'd'], 'y'), ['c']);
  });

  it('needs at least three elements', () => {
    const elements = [rect('a', 0, 0), rect('b', 50, 0)];
    assert.deepEqual(arrange.distributeElements(elements, ['a', 'b'], 'x'), []);
  });
});

describe('selection bounds', () => {
  it('computes the outer box and centre', () => {
    const elements = [rect('a', 10, 20, 20, 10), rect('b', 100, 50, 40, 30)];
    assert.deepEqual(arrange.selectedBounds(elements, ['a', 'b']), { x: 10, y: 20, width: 130, height: 60 });
    assert.deepEqual(arrange.selectionCenter(elements, ['a', 'b']), { x: 75, y: 50 });
    assert.equal(arrange.selectedBounds(elements, []), null);
  });
});
