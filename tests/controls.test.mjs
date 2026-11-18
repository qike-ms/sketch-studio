import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectionControls } from '../src/controls.js';

const state = { strokeColor: '#1e1e1e', backgroundColor: 'transparent', strokeWidth: 2, opacity: 100, fontSize: 24, strokeStyle: 'solid', roughness: 1, edgeStyle: 'sharp', fontFamily: 'hand', startArrowhead: 'none', endArrowhead: 'arrow', elbow: false };
const red = { id: 'red', type: 'rect', strokeColor: '#ff0000', opacity: 25, strokeWidth: 5, fontSize: 24, strokeStyle: 'solid', roughness: 1, edgeStyle: 'sharp', fontFamily: 'hand', startArrowhead: 'none', endArrowhead: 'arrow', elbow: false };
const blue = { id: 'blue', type: 'rect', strokeColor: '#0000ff', opacity: 80, strokeWidth: 5, fontSize: 24, strokeStyle: 'solid', roughness: 1, edgeStyle: 'sharp', fontFamily: 'hand', startArrowhead: 'none', endArrowhead: 'arrow', elbow: false };

describe('selection control projection', () => {
  it('shows the real values for a single selection', () => {
    const view = selectionControls([red, blue], ['red'], state);
    assert.equal(view.controls.opacity, 25);
    assert.equal(view.controls.strokeColor, '#ff0000');
    assert.equal(view.controls.strokeWidth, 5);
    assert.equal(view.mixed.opacity, false);
  });

  it('uses creation defaults only when nothing is selected', () => {
    const view = selectionControls([red, blue], [], state);
    assert.equal(view.controls.opacity, 100);
    assert.equal(view.controls.strokeColor, '#1e1e1e');
    assert.equal(view.mixed.opacity, false);
  });

  it('marks differing values as mixed instead of falling back to defaults', () => {
    const view = selectionControls([red, blue], ['red', 'blue'], state);
    assert.equal(view.mixed.opacity, true);
    assert.equal(view.mixed.strokeColor, true);
    assert.equal(view.controls.opacity, undefined);
    assert.equal(view.controls.strokeColor, undefined);
    assert.equal(view.controls.strokeWidth, 5, 'common values still show');
    assert.equal(view.mixed.strokeWidth, false);
  });
});
