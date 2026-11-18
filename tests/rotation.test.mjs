import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as geo from '../src/geometry.js';

const find = () => null;

function rect(id, x, y, w, h, angle = 0) {
  return { id, type: 'rect', x, y, width: w, height: h, strokeWidth: 2, angle };
}

describe('rotation maths', () => {
  it('rotates points around a centre', () => {
    const p = geo.rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    assert.ok(Math.abs(p.x) < 1e-9);
    assert.ok(Math.abs(p.y - 10) < 1e-9);
    assert.deepEqual(geo.rotatePoint({ x: 1, y: 1 }, { x: 1, y: 1 }, 123), { x: 1, y: 1 });
  });

  it('normalises angles into [0, 360)', () => {
    assert.equal(geo.normalizeAngle(-90), 270);
    assert.equal(geo.normalizeAngle(720), 0);
    assert.equal(geo.normalizeAngle(NaN), 0);
  });

  it('computes rotated corners and axis-aligned bounds', () => {
    const el = rect('a', 0, 0, 100, 20, 90);
    const corners = geo.rotatedCorners(el);
    assert.equal(corners.length, 4);
    const bounds = geo.elementBounds(el);
    assert.ok(Math.abs(bounds.width - 20) < 1e-9);
    assert.ok(Math.abs(bounds.height - 100) < 1e-9);
    assert.ok(Math.abs(bounds.x - 40) < 1e-9);
    assert.ok(Math.abs(bounds.y + 40) < 1e-9);
  });

  it('hit-tests in the local frame of a rotated shape', () => {
    const el = rect('a', 0, 0, 100, 20, 90);
    const filled = { ...el, backgroundColor: '#f00' };
    const centre = geo.rectCenter(geo.rectOf(el));
    assert.ok(geo.hitTest(filled, { x: centre.x, y: centre.y + 40 }, find), 'tall side is inside');
    assert.ok(!geo.hitTest(filled, { x: centre.x + 40, y: centre.y }, find), 'wide side is now outside');
  });

  it('boundaryPoint follows the rotated border', () => {
    const el = rect('a', 0, 0, 100, 40, 90);
    const point = geo.boundaryPoint(el, { x: 1, y: 0 });
    assert.ok(Math.abs(point.x - 70) < 1e-9);
    assert.ok(Math.abs(point.y - 20) < 1e-9);
  });

  it('rotated elements still count for marquee selection', () => {
    const el = rect('a', 0, 0, 100, 20, 90);
    const hits = geo.elementsInRect([el], { x: 35, y: -45, width: 30, height: 110 });
    assert.deepEqual(hits, ['a']);
  });

  it('places a rotation handle above the rotated top edge', () => {
    const el = rect('a', 0, 0, 100, 40, 0);
    assert.deepEqual(geo.rotationHandlePosition(el, 20), { x: 50, y: -20 });
    const turned = rect('a', 0, 0, 100, 40, 90);
    const handle = geo.rotationHandlePosition(turned, 20);
    assert.ok(Math.abs(handle.x - 90) < 1e-9);
    assert.ok(Math.abs(handle.y - 20) < 1e-9);
  });

  it('derives an angle from a rotation gesture', () => {
    const centre = { x: 0, y: 0 };
    assert.equal(geo.angleFromPoints(centre, { x: 0, y: -10 }, { x: 10, y: 0 }), 90);
    assert.equal(geo.angleFromPoints(centre, { x: 0, y: -10 }, { x: 0, y: -10 }), 0);
    assert.equal(geo.angleFromPoints(centre, { x: 0, y: -10 }, { x: -10, y: 0 }), 270);
  });
});

describe('multi-point connectors and elbows', () => {
  it('preserves intermediate points', () => {
    const arrow = {
      id: 'a', type: 'arrow', x: 0, y: 0, width: 100, height: 100,
      points: [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 }], strokeWidth: 2,
    };
    assert.deepEqual(geo.resolveConnectorPath(arrow, find), [
      { x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 },
    ]);
  });

  it('replaces bound ends but keeps middle points', () => {
    const box = rect('box', 100, 0, 50, 50);
    const arrow = {
      id: 'a', type: 'arrow', x: 0, y: 25, width: 100, height: 50,
      points: [{ x: 0, y: 0 }, { x: 50, y: 60 }, { x: 100, y: 0 }],
      startBinding: { elementId: 'box' }, strokeWidth: 2,
    };
    const path = geo.resolveConnectorPath(arrow, (id) => (id === 'box' ? box : null));
    assert.equal(path.length, 3);
    assert.equal(path[1].y, 85);
    assert.ok(path[0].x < 100 && path[0].x > 90, 'tip sits just outside the bound left edge');
    assert.equal(path[0].y, 25);
  });

  it('builds an orthogonal elbow route', () => {
    const route = geo.elbowRoute({ x: 0, y: 0 }, { x: 100, y: 60 });
    assert.equal(route.length, 4);
    for (let i = 1; i < route.length; i += 1) {
      const a = route[i - 1];
      const b = route[i];
      assert.ok(a.x === b.x || a.y === b.y, 'each segment is horizontal or vertical');
    }
    const vertical = geo.elbowRoute({ x: 0, y: 0 }, { x: 20, y: 100 });
    assert.ok(vertical[1].x === vertical[0].x);
  });

  it('uses the elbow flag when resolving', () => {
    const arrow = {
      id: 'a', type: 'arrow', x: 0, y: 0, width: 100, height: 60, elbow: true,
      points: [{ x: 0, y: 0 }, { x: 100, y: 60 }], strokeWidth: 2,
    };
    const path = geo.resolveConnectorPath(arrow, find);
    assert.equal(path.length, 4);
    assert.deepEqual(geo.resolvedRect(arrow, find), { x: 0, y: 0, width: 100, height: 60 });
  });

  it('hit-tests the full multi-point path', () => {
    const arrow = {
      id: 'a', type: 'arrow', x: 0, y: 0, width: 100, height: 100,
      points: [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 }], strokeWidth: 2,
    };
    assert.ok(geo.hitTest(arrow, { x: 50, y: 80 }, find));
    assert.ok(!geo.hitTest(arrow, { x: 50, y: 20 }, find));
  });
});
