import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSceneText } from '../src/import.js';
import { parseClipboardPayload } from '../src/clipboard.js';
import { createPersistence, memoryStorage } from '../src/persistence.js';
import { DEFAULT_LIMITS, validateScene } from '../src/schema.js';
import { Viewport } from '../src/viewport.js';
import { drawGrid } from '../assets/render.js';

const MAX = DEFAULT_LIMITS.maxCoordinate;

function boundedRect(text) {
  return JSON.stringify({ elements: [{ id: 'a', type: 'rect', x: 1e20, width: 100, height: 100 }] }).replace('1e20', '1e20');
}

describe('numeric budgets', () => {
  it('clamps accepted positions and sizes instead of producing Infinity', () => {
    const text = JSON.stringify({
      elements: [{
        id: 'a', type: 'line', x: 1e308,
        points: [{ x: -1e308, y: 0 }, { x: 1e308, y: 0 }],
      }],
    });
    const opened = parseSceneText(text);
    assert.equal(opened.ok, true);
    const line = opened.scene.elements[0];
    assert.ok(Number.isFinite(line.x) && Math.abs(line.x) <= MAX);
    assert.ok(Number.isFinite(line.width) && line.width <= MAX);
    for (const point of line.points) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
    assert.ok(opened.issues.some((item) => item.code === 'bad-position' || item.code === 'bad-point'));
  });

  it('applies the same bounds on paste and storage load', () => {
    const text = JSON.stringify({
      elements: [{
        id: 'a', type: 'line', x: 1e308,
        points: [{ x: -1e308, y: 0 }, { x: 1e308, y: 0 }],
      }],
    });
    const pasted = parseClipboardPayload(text);
    assert.ok(pasted);
    assert.ok(Number.isFinite(pasted.elements[0].width));
    const loaded = createPersistence({ storage: memoryStorage({ 'sketch-studio:v2': text }) }).load();
    assert.equal(loaded.ok, true);
    assert.ok(Number.isFinite(loaded.scene.elements[0].width));
  });

  it('caps very large and negative sizes after abs()', () => {
    const result = validateScene({
      elements: [
        { id: 'a', type: 'rect', x: 1e20, width: 1e20, height: 1e20 },
        { id: 'b', type: 'rect', width: -1e20, height: -1e20 },
      ],
    });
    assert.equal(result.ok, true);
    for (const el of result.scene.elements) {
      assert.ok(el.width >= 0 && el.width <= MAX);
      assert.ok(el.height >= 0 && el.height <= MAX);
      assert.ok(Math.abs(el.x) <= MAX && Math.abs(el.y) <= MAX);
    }
    assert.ok(result.issues.some((item) => item.code === 'negative-size'));
  });

  it('rejects NaN and Infinity from a direct validator call', () => {
    const result = validateScene({
      elements: [{
        id: 'a', type: 'arrow', x: NaN, y: Infinity, width: NaN, height: Infinity,
        points: [{ x: NaN, y: Infinity }, { x: -Infinity, y: NaN }],
      }],
    });
    assert.equal(result.ok, true);
    const arrow = result.scene.elements[0];
    assert.ok(Number.isFinite(arrow.x) && Number.isFinite(arrow.y));
    assert.ok(Number.isFinite(arrow.width) && Number.isFinite(arrow.height));
    for (const point of arrow.points) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  });

  it('renders the grid with a bounded number of operations at huge coordinates', () => {
    let calls = 0;
    const context = {
      save() {}, restore() {}, fillRect() { calls += 1; },
    };
    drawGrid(context, { x: 1e20, y: 1e20, width: 8000, height: 6000 }, { zoom: 0.1, gridSize: 24 });
    assert.ok(calls < 1000, `grid drew ${calls} dots`);
  });

  it('does not hang after zoom-to-fit on a large finite element', () => {
    const opened = parseSceneText(boundedRect());
    const viewport = new Viewport();
    viewport.fit(opened.scene.elements[0], { width: 800, height: 600 }, 80);
    let calls = 0;
    drawGrid(
      { save() {}, restore() {}, fillRect() { calls += 1; if (calls > 5000) throw new Error('unbounded grid'); } },
      viewport.visibleRect({ width: 800, height: 600 }),
      { zoom: viewport.zoom, gridSize: 24 },
    );
    assert.ok(calls <= 5000);
  });

  it('skips the grid entirely for non-finite visible rectangles', () => {
    let calls = 0;
    drawGrid({ save() {}, restore() {}, fillRect() { calls += 1; } }, { x: NaN, y: 0, width: Infinity, height: 10 }, { zoom: 1 });
    assert.equal(calls, 0);
  });
});
