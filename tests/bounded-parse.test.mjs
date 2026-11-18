import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSceneText, IMPORT_LIMITS } from '../src/import.js';
import { parseClipboardPayload } from '../src/clipboard.js';
import { validateScene } from '../src/schema.js';

describe('bounded parsing front doors', () => {
  it('rejects oversized clipboard text before parsing', () => {
    const oversized = JSON.stringify({
      type: 'sketch-studio/clipboard',
      elements: [{ id: 'a', type: 'rect' }],
      padding: 'x'.repeat(IMPORT_LIMITS.maxBytes + 1),
    });
    assert.ok(oversized.length > IMPORT_LIMITS.maxBytes);
    assert.equal(parseClipboardPayload(oversized), null);
    assert.equal(parseSceneText(oversized).ok, false);
  });

  it('caps raw element arrays before migrations', () => {
    const elements = Array.from({ length: 6000 }, (_, i) => ({ id: `e${i}`, type: 'rect', width: 1, height: 1 }));
    const text = JSON.stringify({ version: 1, elements });
    const opened = parseSceneText(text, { limits: { maxElements: 5000 } });
    assert.equal(opened.ok, true);
    assert.equal(opened.scene.elements.length, 5000);
    assert.equal(opened.stats.total, 6000);
    assert.ok(opened.issues.some((item) => item.code === 'too-many-elements'));
  });

  it('applies a whole-scene point budget instead of only per-element caps', () => {
    const make = (id) => ({
      id,
      type: 'freehand',
      points: Array.from({ length: 10000 }, (_, i) => ({ x: i, y: i })),
    });
    const result = validateScene(
      { elements: [make('a'), make('b')] },
      { limits: { maxScenePoints: 1000 } },
    );
    assert.equal(result.ok, true);
    const totalPoints = result.scene.elements.reduce((sum, el) => sum + (el.points?.length ?? 0), 0);
    assert.ok(totalPoints <= 1002, `kept ${totalPoints} points`);
    assert.ok(result.issues.some((item) => item.code === 'scene-point-budget'));
  });

  it('still accepts a scene within every budget', () => {
    const result = validateScene({
      elements: [
        { id: 'a', type: 'freehand', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
        { id: 'b', type: 'text', text: 'hello' },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.stats.kept, 2);
  });
});
