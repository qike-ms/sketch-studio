import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSceneText } from '../src/import.js';
import { parseClipboardPayload } from '../src/clipboard.js';
import { createPersistence, memoryStorage } from '../src/persistence.js';
import { validateScene } from '../src/schema.js';

const HOSTILE = [
  '{"version":3}',
  '{"version":99,"elements":null}',
  '{"elements":[{"id":"a","type":{"toString":null}}]}',
  '{"elements":[{"id":"a","type":"rect","strokeColor":{"toString":null}}]}',
  '{"elements":[{"id":"a","type":"rect","x":{"toString":null},"width":10,"height":10}]}',
  '{"elements":[null,{"id":"b","type":"rect","width":10,"height":10}]}',
];

const BACKUP = JSON.stringify({
  version: 2,
  elements: [{ id: 'good', type: 'rect', width: 10, height: 10 }],
});

describe('validation is total over JSON values', () => {
  for (const text of HOSTILE) {
    it(`does not throw for ${text.slice(0, 40)}`, () => {
      assert.doesNotThrow(() => parseSceneText(text));
      assert.doesNotThrow(() => parseClipboardPayload(text));
      assert.doesNotThrow(() => createPersistence({ storage: memoryStorage({ 'sketch-studio:v2': text }) }).load());
    });
  }

  it('falls back to a valid backup when the current slot has no usable elements', () => {
    for (const text of [HOSTILE[0], HOSTILE[1], HOSTILE[2]]) {
      const storage = memoryStorage({ 'sketch-studio:v2': text, 'sketch-studio:v2:backup': BACKUP });
      const loaded = createPersistence({ storage }).load();
      assert.equal(loaded.ok, true);
      assert.equal(loaded.source, 'backup');
      assert.equal(loaded.scene.elements[0].id, 'good');
    }
  });

  it('rejects a file whose elements were all unrecoverable', () => {
    const opened = parseSceneText(HOSTILE[2]);
    assert.equal(opened.ok, false);
    assert.match(opened.error, /no usable elements/);
    assert.equal(parseClipboardPayload(HOSTILE[2]), null);
  });

  it('repairs a hostile field instead of aborting the whole scene', () => {
    const opened = parseSceneText(HOSTILE[3]);
    assert.equal(opened.ok, true);
    assert.equal(opened.scene.elements.length, 1);
    assert.equal(opened.scene.elements[0].strokeColor, '#1e1e1e');
    assert.ok(opened.issues.some((item) => item.code === 'bad-colour'));
  });

  it('keeps good elements beside a dropped null entry', () => {
    const opened = parseSceneText(HOSTILE[5]);
    assert.equal(opened.ok, true);
    assert.deepEqual(opened.scene.elements.map((el) => el.id), ['b']);
    assert.ok(opened.issues.some((item) => item.code === 'not-an-element'));
  });

  it('validateScene never throws for every JSON root type', () => {
    for (const value of [null, true, false, 0, 'text', [], {}, { version: 3 }, { elements: 'no' }]) {
      assert.doesNotThrow(() => validateScene(value));
    }
  });

  it('formats hostile values without invoking their coercions', () => {
    const result = validateScene({ elements: [{ id: 'a', type: { toString: null } }] });
    assert.equal(result.ok, true);
    assert.equal(result.scene.elements.length, 0);
    assert.ok(result.issues.some((item) => item.code === 'unknown-type'));
  });
});
