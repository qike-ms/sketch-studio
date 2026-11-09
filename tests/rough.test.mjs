import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as rough from '../src/rough.js';
import * as geo from '../src/geometry.js';

const rect = { id: 'shape-1', type: 'rect', x: 10, y: 20, width: 120, height: 80, strokeWidth: 2, roughness: 1 };

describe('determinism', () => {
  it('same id renders the identical sketch twice', () => {
    assert.deepEqual(JSON.stringify(rough.roughPolygon(rect)), JSON.stringify(rough.roughPolygon(rect)));
    assert.deepEqual(JSON.stringify(rough.roughEllipse(rect)), JSON.stringify(rough.roughEllipse(rect)));
    const seg = rough.roughSegment({ x: 0, y: 0 }, { x: 100, y: 40 }, rect);
    assert.deepEqual(JSON.stringify(seg), JSON.stringify(rough.roughSegment({ x: 0, y: 0 }, { x: 100, y: 40 }, rect)));
  });

  it('a different id redraws a different sketch', () => {
    const other = { ...rect, id: 'shape-2' };
    assert.notDeepEqual(JSON.stringify(rough.roughPolygon(rect)), JSON.stringify(rough.roughPolygon(other)));
  });

  it('seed helpers stay in range', () => {
    assert.ok(rough.hashSeed('') >= 1);
    const rand = rough.rng(rough.hashSeed('abc'));
    for (let i = 0; i < 50; i += 1) {
      const value = rand();
      assert.ok(value >= 0 && value < 1);
    }
  });
});

describe('path shapes', () => {
  it('polygons come back as two wobbly closed loops', () => {
    const paths = rough.roughPolygon(rect);
    assert.equal(paths.length, 2);
    for (const path of paths) {
      assert.equal(path.length, 5);
      const first = path[0];
      const last = path[path.length - 1];
      assert.ok(geo.distance(first, last) < 8, 'loop closes near its start');
    }
  });

  it('rect loops keep the four box corners sharp', () => {
    const expected = [
      { x: 10, y: 20 },
      { x: 130, y: 20 },
      { x: 130, y: 100 },
      { x: 10, y: 100 },
    ];
    for (const path of rough.roughPolygon(rect)) {
      for (let i = 0; i < 4; i += 1) {
        assert.ok(geo.distance(path[i], expected[i]) <= 8, `rect vertex ${i} sits on the box corner`);
      }
    }
  });

  it('diamond loops use the box edge midpoints, not the box corners', () => {
    const diamond = { ...rect, type: 'diamond', id: 'shape-d' };
    const expected = [
      { x: 70, y: 20 },
      { x: 130, y: 60 },
      { x: 70, y: 100 },
      { x: 10, y: 60 },
    ];
    for (const path of rough.roughPolygon(diamond)) {
      for (let i = 0; i < 4; i += 1) {
        assert.ok(geo.distance(path[i], expected[i]) <= 8, `diamond vertex ${i} sits on the rhombus`);
      }
    }
  });

  it('ellipse points hug the ellipse', () => {
    const paths = rough.roughEllipse(rect);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const rx = rect.width / 2;
    const ry = rect.height / 2;
    const tolerance = rough.roughStrokeWidth(rect.strokeWidth) * 1.5 + 1;
    for (const path of paths) {
      assert.ok(path.length >= 15);
      for (const point of path) {
        const normalised = Math.hypot((point.x - cx) / rx, (point.y - cy) / ry);
        assert.ok(Math.abs(normalised - 1) < tolerance / Math.min(rx, ry) + 0.15);
      }
    }
  });

  it('segments stay near the straight line and start/end near the tips', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 400, y: 0 };
    const paths = rough.roughSegment(start, end, rect);
    assert.equal(paths.length, 2);
    for (const path of paths) {
      assert.ok(path.length >= 3);
      for (const point of path) {
        assert.ok(Math.abs(point.y) <= 6, 'stroke stays within the jitter band');
        assert.ok(point.x >= -6 && point.x <= 406);
      }
    }
  });

  it('freehand jitter is gentle and preserves the vertex count', () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ x: i * 10, y: 0 }));
    const [path] = rough.roughFreehand(points, { ...rect, type: 'freehand' });
    assert.equal(path.length, points.length);
    for (let i = 0; i < path.length; i += 1) {
      assert.ok(geo.distance(path[i], points[i]) < 4);
    }
    assert.deepEqual(rough.roughFreehand([{ x: 0, y: 0 }], rect)[0], [{ x: 0, y: 0 }]);
  });

  it('arrow heads point back along the shaft', () => {
    const tip = { x: 100, y: 0 };
    const tail = { x: 0, y: 0 };
    const head = rough.arrowHeadPoints(tip, tail, rect);
    assert.equal(head.length, 2);
    for (const [barb, point] of head) {
      assert.deepEqual(point, tip);
      const back = { x: barb.x - tip.x, y: barb.y - tip.y };
      assert.ok(back.x < 0, 'barb trails behind the tip');
      assert.ok(Math.abs(back.y) > 1, 'barbs spread apart');
    }
    const size = geo.distance(head[0][0], tip);
    assert.ok(size >= 10);
  });

  it('a thicker pen produces a wider jitter band', () => {
    assert.ok(rough.roughStrokeWidth(8) > rough.roughStrokeWidth(1));
  });
});
