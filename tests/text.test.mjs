import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as text from '../src/text.js';

describe('caret editing', () => {
  it('inserts text at the caret and advances it', () => {
    assert.deepEqual(text.insertText('hello', 2, 'XY'), { text: 'heXYllo', caret: 4 });
    assert.deepEqual(text.insertText('', 0, 'a'), { text: 'a', caret: 1 });
    assert.deepEqual(text.insertText('abc', 99, '!'), { text: 'abc!', caret: 4 });
    assert.deepEqual(text.insertText('abc', 1, '\n'), { text: 'a\nbc', caret: 2 });
  });

  it('deletes backwards and forwards without corrupting the caret', () => {
    assert.deepEqual(text.deleteText('hello', 3, false), { text: 'helo', caret: 2 });
    assert.deepEqual(text.deleteText('hello', 1, true), { text: 'hllo', caret: 1 });
    assert.deepEqual(text.deleteText('hello', 5, true), { text: 'hello', caret: 5 });
    assert.deepEqual(text.deleteText('hello', 0, false), { text: 'hello', caret: 0 });
    assert.deepEqual(text.deleteText('', 4, false), { text: '', caret: 0 });
  });

  it('clamps the caret into the text', () => {
    assert.equal(text.clampCaret('abc', -5), 0);
    assert.equal(text.clampCaret('abc', 99), 3);
    assert.equal(text.clampCaret('abc', NaN), 0);
  });

  it('moves the caret left, right, up and down', () => {
    const value = 'ab\ncde\nf';
    assert.equal(text.moveCaret(value, 2, 'right'), 3);
    assert.equal(text.moveCaret(value, 2, 'left'), 1);
    assert.equal(text.moveCaret(value, 5, 'up'), 2);
    assert.equal(text.moveCaret(value, 2, 'down'), 5);
    assert.equal(text.moveCaret(value, 5, 'up'), 2);
    assert.equal(text.moveCaret(value, 0, 'up'), 0);
    assert.equal(text.moveCaret(value, 9, 'down'), 8);
  });

  it('reports line and column', () => {
    assert.deepEqual(text.caretLineColumn('ab\ncde\nf', 5), { line: 1, column: 2 });
    assert.deepEqual(text.caretLineColumn('ab\ncde', 0), { line: 0, column: 0 });
    assert.deepEqual(text.caretLineColumn('ab\ncde', 99), { line: 1, column: 3 });
  });

  it('recognises blank labels', () => {
    assert.equal(text.isBlankText('   '), true);
    assert.equal(text.isBlankText('x'), false);
    assert.equal(text.isBlankText(null), true);
  });
});

describe('labels bound to containers', () => {
  const container = { id: 'box', type: 'rect', x: 100, y: 50, width: 200, height: 100 };

  it('creates a centred empty label once', () => {
    const elements = [container];
    const first = text.ensureLabel(elements, container, { fontSize: 20, strokeColor: 'red' });
    assert.equal(first.created, true);
    assert.equal(elements.length, 2);
    assert.equal(first.element.containerId, 'box');
    assert.equal(first.element.fontSize, 20);
    assert.equal(first.element.strokeColor, 'red');
    assert.equal(first.element.x, 200);
    assert.equal(first.element.y, 50 + (100 - 25) / 2);
    const again = text.ensureLabel(elements, container);
    assert.equal(again.created, false);
    assert.equal(again.element.id, first.element.id);
  });

  it('returns null for a missing container', () => {
    assert.deepEqual(text.ensureLabel([], null), { element: null, created: false });
  });

  it('finds and re-centres labels after a container move', () => {
    const elements = [
      { ...container },
      { id: 't', type: 'text', x: 0, y: 0, width: 60, height: 20, text: 'hi', containerId: 'box' },
      { id: 'free', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'x', containerId: null },
    ];
    assert.equal(text.findLabel(elements, 'box').id, 't');
    elements[0].x = 300;
    const moved = text.repositionLabels(elements);
    assert.deepEqual(moved, ['t']);
    assert.equal(elements[1].x, 300 + (200 - 60) / 2);
    assert.equal(elements[1].y, 50 + (100 - 20) / 2);
    assert.equal(elements[2].x, 0);
  });

  it('drops a container reference that no longer exists', () => {
    const elements = [{ id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'x', containerId: 'gone' }];
    text.repositionLabels(elements);
    assert.equal(elements[0].containerId, null);
  });
});
