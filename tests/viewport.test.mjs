import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as viewport from '../src/viewport.js';

describe('coordinate mapping', () => {
  it('round-trips screen and scene coordinates', () => {
    const v = new viewport.Viewport({ x: 100, y: 50, zoom: 2 });
    const screen = { x: 40, y: 30 };
    const scene = v.screenToScene(screen);
    assert.deepEqual(scene, { x: 120, y: 65 });
    assert.deepEqual(v.sceneToScreen(scene), screen);
  });

  it('panBy moves in screen pixels regardless of zoom', () => {
    const v = new viewport.Viewport({ zoom: 2 });
    v.panBy(40, 20);
    assert.deepEqual(v.pan, { x: -20, y: -10 });
  });

  it('setPan and reset behave predictably', () => {
    const v = new viewport.Viewport();
    v.setPan(10, 20);
    assert.deepEqual(v.pan, { x: 10, y: 20 });
    v.reset();
    assert.deepEqual(v.pan, { x: 0, y: 0 });
    assert.equal(v.zoom, 1);
  });
});

describe('zoom', () => {
  it('keeps the scene point under the cursor fixed', () => {
    const v = new viewport.Viewport({ x: 30, y: 40, zoom: 1.5 });
    const anchor = { x: 200, y: 120 };
    const before = v.screenToScene(anchor);
    v.zoomAt(anchor, 2);
    assert.equal(v.zoom, 3);
    const after = v.screenToScene(anchor);
    assert.ok(Math.abs(after.x - before.x) < 1e-9);
    assert.ok(Math.abs(after.y - before.y) < 1e-9);
  });

  it('clamps zoom to the supported range', () => {
    const v = new viewport.Viewport();
    v.setZoom(1000);
    assert.equal(v.zoom, viewport.MAX_ZOOM);
    v.setZoom(0);
    assert.equal(v.zoom, viewport.MIN_ZOOM);
    v.setZoom(NaN);
    assert.equal(v.zoom, viewport.DEFAULT_ZOOM);
    assert.equal(viewport.clampZoom(-4), viewport.MIN_ZOOM);
  });

  it('zooms in and out around an anchor', () => {
    const v = new viewport.Viewport();
    const anchor = { x: 100, y: 100 };
    v.zoomIn(anchor);
    assert.ok(v.zoom > 1);
    const zoomed = v.zoom;
    v.zoomOut(anchor);
    assert.ok(Math.abs(v.zoom - 1) < 1e-9);
    assert.ok(zoomed > 1);
  });

  it('formats a zoom indicator', () => {
    assert.equal(viewport.zoomLabel(1), '100%');
    assert.equal(viewport.zoomLabel(0.456), '46%');
    assert.equal(viewport.zoomLabel(100), '800%');
  });
});

describe('zoom to fit', () => {
  it('centres content in the viewport', () => {
    const v = new viewport.Viewport();
    const bounds = { x: 100, y: 100, width: 400, height: 200 };
    const view = { width: 1000, height: 600 };
    v.fit(bounds, view, 50);
    assert.ok(v.zoom > 1);
    const topLeft = v.sceneToScreen({ x: bounds.x, y: bounds.y });
    const bottomRight = v.sceneToScreen({ x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    assert.ok(topLeft.x >= 0 && bottomRight.x <= view.width);
    assert.ok(topLeft.y >= 0 && bottomRight.y <= view.height);
    const centre = v.sceneToScreen({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    assert.ok(Math.abs(centre.x - view.width / 2) < 1e-9);
    assert.ok(Math.abs(centre.y - view.height / 2) < 1e-9);
  });

  it('handles a zero-size or missing bounds without exploding', () => {
    const v = new viewport.Viewport();
    assert.equal(v.fit({ x: 0, y: 0, width: 0, height: 0 }, { width: 800, height: 600 }), viewport.MAX_ZOOM);
    assert.equal(v.fit(null, { width: 800, height: 600 }), viewport.MAX_ZOOM);
  });

  it('reports the visible scene rectangle', () => {
    const v = new viewport.Viewport({ x: 100, y: 50, zoom: 2 });
    assert.deepEqual(v.visibleRect({ width: 400, height: 300 }), { x: 100, y: 50, width: 200, height: 150 });
  });
});

describe('grid snapping', () => {
  it('snaps values and points when enabled', () => {
    assert.equal(viewport.snapValue(35, 24, true), 24);
    assert.equal(viewport.snapValue(35, 24, false), 35);
    assert.equal(viewport.snapValue(37, 0, true), 37);
    assert.deepEqual(viewport.snapPoint({ x: 35, y: 50 }, 24, true), { x: 24, y: 48 });
    const v = new viewport.Viewport({ gridSize: 10 });
    assert.deepEqual(v.snapPoint({ x: 6, y: 14 }, true), { x: 10, y: 10 });
    assert.equal(v.snapValue(NaN), NaN);
  });
});
