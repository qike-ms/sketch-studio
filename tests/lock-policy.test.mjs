import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as edit from '../src/edit.js';
import * as props from '../src/properties.js';
import * as arrange from '../src/arrange.js';

const box = { id: 'box', type: 'rect', x: 0, y: 0, width: 100, height: 60, locked: true, groupIds: ['g'] };
const label = { id: 'label', type: 'text', x: 10, y: 10, width: 20, height: 10, containerId: 'box', locked: false, groupIds: ['g'] };
const free = { id: 'free', type: 'rect', x: 200, y: 0, width: 10, height: 10, locked: false, groupIds: ['g'] };

describe('lock policy', () => {
  it('treats a bound label as locked when its container is locked', () => {
    const elements = [box, label, free];
    const find = (id) => elements.find((el) => el.id === id) ?? null;
    assert.equal(edit.isElementLocked(box, find), true);
    assert.equal(edit.isElementLocked(label, find), true);
    assert.equal(edit.isElementLocked(free, find), false);
    assert.equal(edit.canEdit(label, find), false);
  });

  it('filters editable ids with inherited lock semantics', () => {
    const elements = [box, label, free];
    const find = (id) => elements.find((el) => el.id === id) ?? null;
    assert.deepEqual(edit.filterEditable(elements, ['box', 'label', 'free'], find), ['free']);
  });

  it('style patches skip locked labels of locked containers', () => {
    const elements = [box, label, free];
    const find = (id) => elements.find((el) => el.id === id) ?? null;
    const changed = props.applyStyle(elements, ['label', 'free'], { opacity: 30 }, {
      isLocked: (el) => edit.isElementLocked(el, find),
    });
    assert.deepEqual(changed, ['free']);
    assert.equal(label.opacity, undefined);
    assert.equal(free.opacity, 30);
  });

  it('angle changes skip inherited locks', () => {
    const elements = [box, label, free];
    const find = (id) => elements.find((el) => el.id === id) ?? null;
    const changed = props.setAngle(elements, ['label', 'free'], 45, {
      isLocked: (el) => edit.isElementLocked(el, find),
    });
    assert.deepEqual(changed, ['free']);
    assert.equal(label.angle, undefined);
    assert.equal(free.angle, 45);
  });

  it('ungroup does not mutate locked members', () => {
    const elements = [box, label, free];
    arrange.ungroupElements(elements, ['box', 'label', 'free']);
    assert.deepEqual(box.groupIds, ['g'], 'locked container keeps its group');
    assert.deepEqual(label.groupIds, [], 'unlocked label is ungrouped');
    assert.deepEqual(free.groupIds, [], 'unlocked element is ungrouped');
  });
});
