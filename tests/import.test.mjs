import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import * as importer from '../src/import.js';

const v1 = readFileSync(new URL('./fixtures/v1-scene.json', import.meta.url), 'utf8');

describe('JSON import guards', () => {
  it('parses a valid scene', () => {
    const result = importer.parseSceneText(v1);
    assert.equal(result.ok, true);
    assert.equal(result.scene.elements.length, 3);
    assert.equal(result.error, null);
  });

  it('reports parse errors instead of throwing', () => {
    const result = importer.parseSceneText('{"version":2,"elements":[');
    assert.equal(result.ok, false);
    assert.match(result.error, /Could not parse JSON/);
  });

  it('rejects empty and non-string input', () => {
    assert.equal(importer.parseSceneText('').ok, false);
    assert.equal(importer.parseSceneText(null).ok, false);
    assert.equal(importer.parseSceneText('null').ok, false);
  });

  it('rejects oversized text before parsing', () => {
    const result = importer.parseSceneText('x'.repeat(200), { limits: { maxBytes: 100 } });
    assert.equal(result.ok, false);
    assert.match(result.error, /too large/);
  });

  it('checks File.size before reading', () => {
    assert.equal(importer.checkFile({ size: 20 }).ok, true);
    const huge = importer.checkFile({ size: 20 * 1024 * 1024 });
    assert.equal(huge.ok, false);
    assert.match(huge.error, /too large/);
    assert.equal(importer.checkFile(null).ok, false);
  });

  it('truncates huge element counts with a reported issue', () => {
    const elements = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, type: 'rect', width: 1, height: 1 }));
    const result = importer.parseSceneText(JSON.stringify({ version: 2, elements }), { limits: { maxElements: 5 } });
    assert.equal(result.ok, true);
    assert.equal(result.scene.elements.length, 5);
    assert.ok(result.issues.some((item) => item.code === 'too-many-elements'));
  });

  it('flags markup-like text but keeps it as data', () => {
    const text = JSON.stringify({
      version: 2,
      elements: [{ id: 't', type: 'text', text: '<img src=x onerror=alert(1)>', width: 10, height: 10 }],
    });
    const result = importer.parseSceneText(text);
    assert.equal(result.ok, true);
    assert.equal(result.scene.elements[0].text, '<img src=x onerror=alert(1)>');
    assert.ok(result.issues.some((item) => item.code === 'markup-in-text'));
  });

  it('escapes HTML for any string interpolation', () => {
    assert.equal(
      importer.escapeHtml('<b title="x">&\'</b>'),
      '&lt;b title=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;',
    );
    assert.equal(importer.containsUnsafeMarkup('<SCRIPT>'), true);
    assert.equal(importer.containsUnsafeMarkup('a < b'), false);
  });

  it('parses our clipboard payload and rejects foreign JSON', () => {
    const payload = JSON.stringify({
      type: 'sketch-studio/clipboard',
      version: 2,
      elements: [{ id: 'a', type: 'rect', width: 10, height: 10 }],
    });
    const parsed = importer.parseClipboardText(payload);
    assert.ok(parsed);
    assert.equal(parsed.scene.elements.length, 1);
    assert.equal(importer.parseClipboardText('{"hello":1}'), null);
    assert.equal(importer.parseClipboardText('not json'), null);
  });

  it('measures UTF-8 bytes, not UTF-16 code units', () => {
    assert.equal(importer.byteLength('abc'), 3);
    assert.ok(importer.byteLength('é') >= 2);
  });
});
