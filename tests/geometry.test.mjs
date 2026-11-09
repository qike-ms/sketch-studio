import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as geo from '../src/geometry.js';

const find = (id) => (id === 'missing' ? null : null);

function rect(id, x, y, width, height, extra = {}) {
  return { id, type: 'rect', x, y, width, height, strokeColor: '#000', strokeWidth: 2, ...extra };
}

describe('rect helpers', () => {
  it('normRect orders corners', () => {
    assert.deepEqual(geo.normRect(50, 40, 10, 20), { x: 10, y: 20, width: 40, height: 20 });
  });

  it('rectContainsRect / rectsIntersect disagree the way marquee needs', () => {
    const big = { x: 0, y: 0, width: 100, height: 100 };
    const small = { x: 40, y: 40, width: 10, height: 10 };
    const edge = { x: 95, y: 95, width: 20, height: 20 };
    assert.ok(geo.rectContainsRect(big, small));
    assert.ok(!geo.rectContainsRect(big, edge));
    assert.ok(geo.rectsIntersect(big, edge));
  });
});

describe('points bookkeeping', () => {
  it('normalizePoints keeps absolute geometry intact', () => {
    const el = { type: 'freehand', x: 100, y: 100, points: [{ x: 0, y: 0 }, { x: -20, y: 30 }] };
    geo.normalizePoints(el);
    assert.equal(el.x, 80);
    assert.equal(el.y, 100);
    assert.deepEqual(geo.absolutePoints(el), [{ x: 100, y: 100 }, { x: 80, y: 130 }]);
    assert.equal(el.width, 20);
    assert.equal(el.height, 30);
  });

  it('setConnectorFromAbsolute round-trips endpoints', () => {
    const el = { type: 'arrow', x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }], strokeWidth: 2 };
    geo.setConnectorFromAbsolute(el, { x: 30, y: 40 }, { x: 90, y: 10 });
    const [start, end] = geo.resolveConnector(el, find);
    assert.deepEqual(start, { x: 30, y: 40 });
    assert.deepEqual(end, { x: 90, y: 10 });
  });
});

describe('boundaryPoint', () => {
  const box = rect('a', 0, 0, 100, 60);
  const ellipse = { id: 'b', type: 'ellipse', x: 0, y: 0, width: 100, height: 60 };
  const diamond = { id: 'c', type: 'diamond', x: 0, y: 0, width: 100, height: 60 };

  it('rect border on each axis and diagonal', () => {
    assert.deepEqual(geo.boundaryPoint(box, { x: 1, y: 0 }), { x: 100, y: 30 });
    assert.deepEqual(geo.boundaryPoint(box, { x: 0, y: -1 }), { x: 50, y: 0 });
    const corner = geo.boundaryPoint(box, { x: 1, y: 1 });
    assert.equal(Math.round(corner.x), 80);
    assert.equal(Math.round(corner.y), 60);
  });

  it('ellipse border respects radii', () => {
    assert.deepEqual(geo.boundaryPoint(ellipse, { x: 1, y: 0 }), { x: 100, y: 30 });
    const point = geo.boundaryPoint(ellipse, { x: 0, y: 1 });
    assert.equal(Math.round(point.y), 60);
  });

  it('diamond border is closer than the box on diagonals', () => {
    const point = geo.boundaryPoint(diamond, { x: 1, y: 1 });
    const boxPoint = geo.boundaryPoint(box, { x: 1, y: 1 });
    assert.ok(geo.distance(point, { x: 50, y: 30 }) < geo.distance(boxPoint, { x: 50, y: 30 }));
  });

  it('gap pushes the tip away from the stroke', () => {
    const withGap = geo.boundaryPoint(box, { x: 1, y: 0 }, 5);
    assert.equal(withGap.x, 105);
  });

  it('degenerate direction returns the centre', () => {
    assert.deepEqual(geo.boundaryPoint(box, { x: 0, y: 0 }), { x: 50, y: 30 });
  });
});

describe('hitTest', () => {
  const box = rect('a', 100, 100, 100, 80);
  const filledBox = { ...box, backgroundColor: '#f00' };
  const ellipse = { id: 'b', type: 'ellipse', x: 100, y: 100, width: 100, height: 80 };
  const text = { id: 'c', type: 'text', x: 100, y: 100, width: 60, height: 24, text: 'hi' };
  const line = { id: 'd', type: 'line', x: 0, y: 0, width: 100, height: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], strokeWidth: 2 };

  it('outline shape: border yes, hollow centre no, outside no', () => {
    assert.ok(geo.hitTest(box, { x: 101, y: 140 }, find));
    assert.ok(!geo.hitTest(box, { x: 150, y: 140 }, find));
    assert.ok(geo.hitTest(box, { x: 99, y: 140 }, find));
    assert.ok(!geo.hitTest(box, { x: 400, y: 400 }, find));
  });

  it('filled shape: interior hit', () => {
    assert.ok(geo.hitTest(filledBox, { x: 150, y: 140 }, find));
  });

  it('ellipse keeps the corners hollow', () => {
    assert.ok(geo.hitTest(ellipse, { x: 150, y: 101 }, find));
    assert.ok(!geo.hitTest(ellipse, { x: 197, y: 103 }, find));
  });

  it('text uses its measured box', () => {
    assert.ok(geo.hitTest(text, { x: 130, y: 110 }, find));
    assert.ok(!geo.hitTest(text, { x: 190, y: 110 }, find));
  });

  it('strokes use distance to segments', () => {
    assert.ok(geo.hitTest(line, { x: 50, y: 3 }, find));
    assert.ok(!geo.hitTest(line, { x: 50, y: 30 }, find));
  });
});

describe('connector bindings', () => {
  const a = rect('a', 0, 0, 100, 60);
  const b = rect('b', 300, 100, 120, 80);
  const arrow = {
    id: 'link',
    type: 'arrow',
    x: 100,
    y: 30,
    width: 200,
    height: 120,
    points: [{ x: 0, y: 0 }, { x: 200, y: 120 }],
    startBinding: { elementId: 'a' },
    endBinding: { elementId: 'b' },
    strokeWidth: 2,
  };
  const map = new Map([[a.id, a], [b.id, b]]);
  const finder = (id) => map.get(id) ?? null;

  it('endpoints sit on the two borders, pointing centre to centre', () => {
    const [start, end] = geo.resolveConnector(arrow, finder);
    assert.ok(start.x > 100 && start.x < 108); // just outside the right edge, plus the gap
    assert.ok(start.y > 30 && start.y < 60);
    assert.ok(end.x > 290 && end.x < 300); // just outside the left edge of b
    assert.ok(end.y > 100 && end.y < 140);
  });

  it('moving a bound object drags the link', () => {
    const before = geo.resolveConnector(arrow, finder);
    a.x = 0;
    a.y = 200;
    const after = geo.resolveConnector(arrow, finder);
    assert.notDeepEqual(before, after);
    assert.ok(after[0].y > 200);
    assert.ok(geo.pointInsideRect(geo.rectOf(a), after[0], geo.BIND_PROXIMITY));
  });

  it('unbound ends fall back to the stored points', () => {
    const free = { ...arrow, startBinding: null, endBinding: null };
    assert.deepEqual(geo.resolveConnector(free, finder), [{ x: 100, y: 30 }, { x: 300, y: 150 }]);
  });

  it('resolvedRect follows bindings', () => {
    const rect = geo.resolvedRect(arrow, finder);
    const [start, end] = geo.resolveConnector(arrow, finder);
    assert.equal(rect.x, Math.min(start.x, end.x));
    assert.equal(rect.width, Math.abs(end.x - start.x));
  });
});

describe('marquee + eraser picking', () => {
  const a = rect('a', 0, 0, 40, 40);
  const b = rect('b', 200, 200, 40, 40);
  const elements = [a, b];

  it('intersect mode vs contained mode', () => {
    assert.deepEqual(geo.elementsInRect(elements, { x: 20, y: 20, width: 40, height: 40 }), ['a']);
    assert.deepEqual(geo.elementsInRect(elements, { x: 30, y: 30, width: 5, height: 5 }, { containedOnly: true }), []);
    assert.deepEqual(geo.elementsInRect(elements, { x: -10, y: -10, width: 300, height: 300 }, { containedOnly: true }), ['a', 'b']);
  });

  it('segment eraser only removes what the stroke crosses', () => {
    const crossing = geo.elementsAlongSegment(elements, { x: -20, y: -20 }, { x: 20, y: 20 }, find);
    assert.deepEqual(crossing, ['a']);
    const insideOnly = geo.elementsAlongSegment(elements, { x: 10, y: 10 }, { x: 30, y: 30 }, find);
    assert.deepEqual(insideOnly, [], 'hollow outline untouched by a stroke that stays inside');
    const elsewhere = geo.elementsAlongSegment(elements, { x: 0, y: 500 }, { x: 60, y: 500 }, find);
    assert.deepEqual(elsewhere, []);
  });

  it('containerAt returns the closed shape under a point, topmost first', () => {
    const nested = rect('outer', 0, 0, 400, 400);
    const stack = [nested, a];
    assert.equal(geo.containerAt(stack, { x: 20, y: 20 }).id, 'a');
    assert.equal(geo.containerAt(stack, { x: 300, y: 300 }).id, 'outer');
    assert.equal(geo.containerAt(stack, { x: 900, y: 900 }), null);
  });
});
