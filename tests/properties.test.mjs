import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as props from '../src/properties.js';

function rect(id, extra = {}) {
  return {
    id, type: 'rect', x: 0, y: 0, width: 10, height: 10,
    strokeColor: '#111', backgroundColor: 'transparent', strokeWidth: 2,
    strokeStyle: 'solid', opacity: 100, roughness: 1, edgeStyle: 'sharp',
    fontFamily: 'hand', fontSize: 24, startArrowhead: 'none', endArrowhead: 'none',
    elbow: false, angle: 0, groupIds: [], locked: false, ...extra,
  };
}

describe('selection reflection', () => {
  it('reports common values and marks mixed ones undefined', () => {
    const elements = [rect('a', { strokeColor: '#111' }), rect('b', { strokeColor: '#111' })];
    const style = props.selectionStyle(elements, ['a', 'b']);
    assert.equal(style.strokeColor, '#111');
    assert.equal(style.count, 2);
    assert.deepEqual(style.types, ['rect']);
    const mixed = props.selectionStyle([rect('a', { strokeColor: '#111' }), rect('b', { strokeColor: '#222' })], ['a', 'b']);
    assert.equal(mixed.strokeColor, undefined);
  });

  it('reports lock, grouping and angle', () => {
    const elements = [
      rect('a', { locked: true, angle: 30, groupIds: ['g'] }),
      rect('b', { locked: true, angle: 30, groupIds: ['g'] }),
    ];
    const style = props.selectionStyle(elements, ['a', 'b']);
    assert.equal(style.locked, true);
    assert.equal(style.angle, 30);
    assert.equal(style.grouped, true);
    assert.equal(props.selectionLabel(style), '2 elements');
    assert.equal(props.selectionLabel(props.selectionStyle(elements, ['a'])), '1 rect');
    assert.equal(props.selectionLabel(null), 'Nothing selected');
  });
});

describe('style patches', () => {
  it('validates and applies only known keys', () => {
    const elements = [rect('a'), rect('b', { locked: true })];
    const changed = props.applyStyle(elements, ['a', 'b'], {
      strokeColor: 'red', opacity: 500, strokeStyle: 'zigzag', unknown: 'x',
    });
    assert.deepEqual(changed, ['a']);
    assert.equal(elements[0].strokeColor, 'red');
    assert.equal(elements[0].opacity, 100);
    assert.equal(elements[0].strokeStyle, 'solid');
    assert.equal(elements[0].unknown, undefined);
    assert.equal(elements[1].strokeColor, '#111', 'locked element untouched');
    assert.deepEqual(props.applyStyle(elements, ['a'], { elbow: true }), ['a']);
    assert.equal(elements[0].elbow, true);
  });

  it('sets a normalised angle', () => {
    const elements = [rect('a'), rect('b', { locked: true })];
    assert.deepEqual(props.setAngle(elements, ['a', 'b'], -90), ['a']);
    assert.equal(elements[0].angle, 270);
    assert.equal(elements[1].angle, 0);
    assert.deepEqual(props.setAngle(elements, ['a'], NaN), []);
    assert.equal(elements[0].angle, 270);
  });

  it('cleanStylePatch strips non-style keys', () => {
    assert.deepEqual(props.cleanStylePatch({ strokeColor: 'blue', theme: 'dark', grid: true }), { strokeColor: 'blue' });
  });
});
