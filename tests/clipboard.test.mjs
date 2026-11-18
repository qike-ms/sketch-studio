import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as clipboard from '../src/clipboard.js';

function rect(id, x = 0, y = 0, extra = {}) {
  return { id, type: 'rect', x, y, width: 10, height: 10, strokeWidth: 2, groupIds: [], ...extra };
}

describe('clipboard payloads', () => {
  it('copies only selected elements and serialises round-trip', () => {
    const elements = [rect('a'), rect('b'), rect('c')];
    const payload = clipboard.buildClipboardPayload(elements, ['a', 'c']);
    assert.equal(payload.type, clipboard.CLIPBOARD_TYPE);
    assert.deepEqual(payload.elements.map((el) => el.id), ['a', 'c']);
    const parsed = clipboard.parseClipboardPayload(clipboard.serializeClipboard(payload));
    assert.ok(parsed);
    assert.deepEqual(parsed.elements.map((el) => el.id), ['a', 'c']);
  });

  it('rejects foreign, malformed and empty clipboard text', () => {
    assert.equal(clipboard.parseClipboardPayload('not json'), null);
    assert.equal(clipboard.parseClipboardPayload('{"hello":1}'), null);
    assert.equal(clipboard.parseClipboardPayload(''), null);
    assert.equal(clipboard.parseClipboardPayload('{"type":"sketch-studio/clipboard","elements":[]}'), null);
  });

  it('validates clipboard elements before pasting', () => {
    const text = JSON.stringify({
      type: clipboard.CLIPBOARD_TYPE,
      version: 2,
      elements: [
        { id: 'ok', type: 'rect', width: 10, height: 10 },
        { id: 'bad', type: 'triangle', width: 10, height: 10 },
      ],
    });
    const parsed = clipboard.parseClipboardPayload(text);
    assert.equal(parsed.elements.length, 1);
    assert.ok(parsed.issues.some((item) => item.code === 'unknown-type'));
  });
});

describe('paste remapping', () => {
  it('remaps ids and offsets positions', () => {
    const existing = [rect('a')];
    const payload = [{ id: 'a', type: 'rect', x: 5, y: 6, width: 10, height: 10, groupIds: [] }];
    const result = clipboard.pasteElements(existing, payload);
    assert.equal(result.elements.length, 1);
    assert.notEqual(result.elements[0].id, 'a');
    assert.equal(result.elements[0].x, 25);
    assert.equal(result.elements[0].y, 26);
    assert.deepEqual(result.ids, [result.elements[0].id]);
  });

  it('remaps container ids and bindings inside the copied set', () => {
    const existing = [];
    const payload = [
      { id: 'box', type: 'rect', x: 0, y: 0, width: 100, height: 60, groupIds: [] },
      { id: 'label', type: 'text', x: 10, y: 10, width: 20, height: 10, text: 'x', containerId: 'box', groupIds: [] },
      { id: 'link', type: 'arrow', x: 0, y: 0, width: 50, height: 10,
        points: [{ x: 0, y: 0 }, { x: 50, y: 10 }],
        startBinding: { elementId: 'box' }, endBinding: { elementId: 'outside' }, groupIds: [] },
    ];
    const result = clipboard.pasteElements(existing, payload);
    const [box, label, link] = result.elements;
    assert.equal(label.containerId, box.id);
    assert.equal(link.startBinding.elementId, box.id);
    assert.equal(link.endBinding, null, 'binding outside the copied set is dropped');
  });

  it('remaps groups so a paste never merges with an existing group', () => {
    const existing = [rect('a', 0, 0, { groupIds: ['g1'] })];
    const payload = [rect('b', 0, 0, { groupIds: ['g1'] }), rect('c', 0, 0, { groupIds: ['g1'] })];
    const result = clipboard.pasteElements(existing, payload);
    assert.equal(result.elements[0].groupIds.length, 1);
    assert.notEqual(result.elements[0].groupIds[0], 'g1');
    assert.equal(result.elements[0].groupIds[0], result.elements[1].groupIds[0]);
  });

  it('never reuses an existing id', () => {
    const existing = [rect('el_paste_1'), rect('el_paste_2')];
    const payload = [rect('x'), rect('y')];
    const result = clipboard.pasteElements(existing, payload);
    const all = [...existing, ...result.elements].map((el) => el.id);
    assert.equal(new Set(all).size, all.length);
  });

  it('keeps a nested group id and supports custom factories', () => {
    const result = clipboard.pasteElements([], [rect('a', 0, 0, { groupIds: ['g1', 'g2'] })], {
      dx: 0, dy: 0,
      idFactory: (n) => `p${n}`,
      groupFactory: (n) => `pg${n}`,
    });
    assert.deepEqual(result.elements[0].groupIds, ['pg1', 'pg2']);
    assert.equal(result.elements[0].id, 'p1');
  });

  it('gives repeated pastes distinct group ids', () => {
    const payload = [
      rect('a', 0, 0, { groupIds: ['g'] }),
      rect('b', 200, 0, { groupIds: ['g'] }),
    ];
    const first = clipboard.pasteElements([], payload, { dx: 0, dy: 0 });
    const second = clipboard.pasteElements(first.elements, payload, { dx: 0, dy: 0 });
    const groups = [...first.elements, ...second.elements].map((el) => el.groupIds[0]);
    assert.equal(new Set(groups).size, 2, 'each paste owns an independent group');
    assert.deepEqual(first.elements[0].groupIds, first.elements[1].groupIds);
    assert.deepEqual(second.elements[0].groupIds, second.elements[1].groupIds);
    assert.notEqual(first.elements[0].groupIds[0], second.elements[0].groupIds[0]);
  });

  it('avoids group ids that already exist in an imported scene', () => {
    const existing = [
      rect('x', 0, 0, { groupIds: ['group_paste_1'] }),
      rect('y', 20, 0, { groupIds: ['group_paste_2'] }),
    ];
    const result = clipboard.pasteElements(existing, [rect('a', 0, 0, { groupIds: ['g'] })], {
      groupFactory: (n) => `group_paste_${n}`,
    });
    assert.equal(result.elements[0].groupIds[0], 'group_paste_3');
  });
});

describe('fallback clipboard', () => {
  it('stores and clears text in memory', () => {
    const board = clipboard.createMemoryClipboard();
    assert.equal(board.read(), null);
    assert.equal(board.write('hello'), true);
    assert.equal(board.read(), 'hello');
    board.clear();
    assert.equal(board.read(), null);
  });

  it('cut uses the same payload builder', () => {
    const payload = clipboard.cutPayload([rect('a'), rect('b')], ['b']);
    assert.deepEqual(payload.elements.map((el) => el.id), ['b']);
  });
});
