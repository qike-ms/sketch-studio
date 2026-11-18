import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { installDomStub } from './helpers/dom-stub.mjs';
import { memoryStorage } from '../src/persistence.js';
import { makeElement } from '../src/scene.js';

const timers = new Map();
let timerId = 0;
globalThis.setTimeout = (fn) => {
  timerId += 1;
  timers.set(timerId, fn);
  return timerId;
};
globalThis.clearTimeout = (id) => timers.delete(id);
const runTimers = () => {
  const batch = [...timers.values()];
  timers.clear();
  for (const fn of batch) fn();
};

const dom = installDomStub();
const storage = memoryStorage();
dom.window.localStorage = storage;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'node-stub', clipboard: { readText: async () => '', writeText: async () => {} } },
});

let app;
let board;
before(async () => {
  await import('../assets/app.js');
  app = dom.window.sketchStudio;
  board = dom.get('board');
});

function keydown(key, extra = {}) {
  dom.dispatch(dom.document, 'keydown', { key, ...extra });
}

function rect(id, x = 0, extra = {}) {
  return makeElement({ id, type: 'rect', x, y: 0, width: 100, height: 100, ...extra });
}

function text(id, value, extra = {}) {
  return makeElement({ id, type: 'text', text: value, x: 0, y: 0, width: 80, height: 24, ...extra });
}

function arrow(id, extra = {}) {
  return makeElement({
    id, type: 'arrow', x: 0, y: 0, width: 100, height: 100,
    points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], ...extra,
  });
}

function reset(elements = []) {
  app.scene.loadFrom({ elements });
  app.viewport.reset();
  app.setTool('select');
  keydown('Escape');
  timers.clear();
}

describe('locked elements cannot be edited through UI entry points', () => {
  it('double-clicking a locked shape does not create a label', () => {
    reset([rect('locked', 0, { locked: true, backgroundColor: '#ff0000' })]);
    dom.dispatch(board, 'dblclick', { clientX: 50, clientY: 50 });
    keydown('X');
    assert.equal(app.scene.elements.length, 1);
    assert.equal(app.scene.elements[0].id, 'locked');
    assert.ok(app.toasts().some((toast) => /locked/i.test(toast.message)));
  });

  it('double-clicking locked text does not change it', () => {
    reset([text('locked-text', 'abc', { locked: true })]);
    dom.dispatch(board, 'dblclick', { clientX: 10, clientY: 10 });
    keydown('Y');
    assert.equal(app.scene.elements[0].text, 'abc');
  });

  it('double-clicking a locked connector does not insert a bend', () => {
    reset([arrow('locked-arrow', { locked: true })]);
    dom.dispatch(board, 'dblclick', { clientX: 50, clientY: 50 });
    assert.equal(app.scene.elements[0].points.length, 2);
  });

  it('the text tool cannot start on a locked shape', () => {
    reset([rect('locked', 0, { locked: true, backgroundColor: '#ff0000' })]);
    app.setTool('text');
    dom.dispatch(board, 'pointerdown', { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
    assert.equal(app.scene.elements.length, 1);
  });

  it('a label inherits its locked container lock', () => {
    reset([
      rect('box', 0, { locked: true }),
      text('label', 'hello', { containerId: 'box', x: 10, y: 40, width: 40, height: 24 }),
    ]);
    dom.dispatch(board, 'dblclick', { clientX: 20, clientY: 50 });
    keydown('Z');
    assert.equal(app.scene.elements.find((el) => el.id === 'label').text, 'hello');
  });
});

describe('selection controls reflect the current selection', () => {
  it('updates opacity and stroke controls on a plain selection', () => {
    reset([
      rect('red', 0, { strokeColor: '#ff0000', opacity: 25 }),
      rect('blue', 200, { strokeColor: '#0000ff', opacity: 80 }),
    ]);
    dom.dispatch(board, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 50 });
    dom.dispatch(board, 'pointerup', { pointerId: 1 });
    assert.deepEqual(app.selectionOf(), ['red']);
    assert.equal(dom.get('opacityRange').value, '25');
    assert.equal(dom.get('strokeWidth').value, '2');

    dom.dispatch(board, 'pointerdown', { button: 0, pointerId: 2, clientX: 200, clientY: 50 });
    dom.dispatch(board, 'pointerup', { pointerId: 2 });
    assert.deepEqual(app.selectionOf(), ['blue']);
    assert.equal(dom.get('opacityRange').value, '80');
  });

  it('marks mixed style values explicitly', () => {
    reset([
      rect('red', 0, { strokeColor: '#ff0000', opacity: 25 }),
      rect('blue', 200, { strokeColor: '#0000ff', opacity: 80 }),
    ]);
    dom.dispatch(board, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 50 });
    dom.dispatch(board, 'pointerup', { pointerId: 1 });
    dom.dispatch(board, 'pointerdown', { button: 0, pointerId: 2, shiftKey: true, clientX: 200, clientY: 50 });
    dom.dispatch(board, 'pointerup', { pointerId: 2 });
    assert.equal(app.selectionOf().length, 2);
    assert.equal(dom.get('opacityRange').dataset.mixed, 'true');
    assert.equal(dom.get('strokeWidth').dataset.mixed, undefined, 'common value is not mixed');
  });
});
