import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSceneText } from '../src/import.js';
import { parseClipboardPayload } from '../src/clipboard.js';
import { createPersistence, memoryStorage } from '../src/persistence.js';
import { DEFAULT_LIMITS, validateScene } from '../src/schema.js';
import * as textLib from '../src/text.js';

const longText = (length) => JSON.stringify({
  version: 2,
  elements: [{ id: 't', type: 'text', text: 'x'.repeat(length), width: 10, height: 10 }],
});

describe('long text is never silently truncated', () => {
  it('keeps text above the typing limit and reports the exact length', () => {
    const length = DEFAULT_LIMITS.maxTextLength + 1;
    const opened = parseSceneText(longText(length));
    assert.equal(opened.ok, true);
    assert.equal(opened.scene.elements[0].text.length, length);
    assert.ok(opened.issues.some((item) => item.code === 'text-over-limit' && item.length === length));
  });

  it('keeps long text through paste and storage load', () => {
    const length = DEFAULT_LIMITS.maxTextLength + 500;
    const pasted = parseClipboardPayload(longText(length));
    assert.ok(pasted);
    assert.equal(pasted.elements[0].text.length, length);
    assert.ok(pasted.issues.some((item) => item.code === 'text-over-limit'));

    const loaded = createPersistence({ storage: memoryStorage({ 'sketch-studio:v2': longText(length) }) }).load();
    assert.equal(loaded.ok, true);
    assert.equal(loaded.scene.elements[0].text.length, length);
    assert.ok(loaded.issues.some((item) => item.code === 'text-over-limit'));
  });

  it('round-trips Unicode, surrogate pairs and newlines exactly', () => {
    const text = 'héllo 🌍\nline two\r\nthird';
    const result = validateScene({ elements: [{ id: 't', type: 'text', text }] });
    assert.equal(result.scene.elements[0].text, text);
  });

  it('rejects a whole scene above the text budget instead of trimming it', () => {
    const text = 'y'.repeat(DEFAULT_LIMITS.maxSceneTextChars + 1);
    const result = validateScene({ elements: [{ id: 't', type: 'text', text }] });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((item) => item.code === 'scene-text-too-large'));
  });

  it('caps live typing at the same limit and reports that it was limited', () => {
    const atLimit = 'z'.repeat(DEFAULT_LIMITS.maxTextLength);
    const blocked = textLib.insertText(atLimit, atLimit.length, 'q', { maxLength: DEFAULT_LIMITS.maxTextLength });
    assert.equal(blocked.limited, true);
    assert.equal(blocked.text.length, DEFAULT_LIMITS.maxTextLength);
    const allowed = textLib.insertText('abc', 3, 'd', { maxLength: DEFAULT_LIMITS.maxTextLength });
    assert.equal(allowed.limited, false);
    assert.equal(allowed.text, 'abcd');
  });
});
