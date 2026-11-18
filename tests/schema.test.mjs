import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import * as schema from '../src/schema.js';
import { SCHEMA_VERSION } from '../src/scene.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('schema migration', () => {
  it('migrates an unversioned / v1 scene to the current version', () => {
    const result = schema.validateScene(fixture('v1-scene.json'));
    assert.equal(result.ok, true);
    assert.equal(result.scene.version, SCHEMA_VERSION);
    assert.equal(result.scene.elements.length, 3);
    for (const el of result.scene.elements) {
      assert.equal(typeof el.angle, 'number');
      assert.ok(Array.isArray(el.groupIds));
      assert.equal(typeof el.locked, 'boolean');
      assert.ok(schema.EDGE_STYLES.includes(el.edgeStyle));
    }
    const arrow = result.scene.elements.find((el) => el.type === 'arrow');
    assert.equal(arrow.endArrowhead, 'arrow');
  });

  it('accepts a bare element array and rejects unusable input', () => {
    const bare = schema.validateScene([{ id: 'a', type: 'rect', width: 10, height: 10 }]);
    assert.equal(bare.ok, true);
    assert.equal(bare.scene.elements.length, 1);
    assert.equal(schema.validateScene(null).ok, false);
    assert.equal(schema.validateScene({ version: 1 }).ok, false);
    assert.equal(schema.validateScene('nope').ok, false);
  });

  it('warns about a newer schema but still attempts repair', () => {
    const result = schema.validateScene({ version: 99, elements: [{ id: 'a', type: 'rect', width: 5, height: 5 }] });
    assert.equal(result.ok, true);
    assert.equal(result.scene.version, SCHEMA_VERSION);
    assert.ok(result.issues.some((item) => item.code === 'newer-schema'));
  });
});

describe('element repair', () => {
  it('keeps every recoverable element from the corrupt fixture', () => {
    const result = schema.validateScene(fixture('corrupt-scene.json'));
    assert.equal(result.ok, true);
    const ids = result.scene.elements.map((el) => el.id);
    assert.ok(ids.includes('good'), 'first duplicate id survives');
    assert.ok(ids.includes('nan'), 'NaN coordinates are repaired, not dropped');
    assert.ok(ids.includes('bad-points'));
    assert.ok(!ids.includes('weird'), 'unknown type dropped');
    assert.ok(!ids.includes('image'), 'external image URL dropped');
    assert.ok(result.stats.dropped >= 2);
  });

  it('repairs NaN, Infinity, negative sizes and bad types', () => {
    const result = schema.validateScene(fixture('corrupt-scene.json'));
    const nan = result.scene.elements.find((el) => el.id === 'nan');
    assert.equal(nan.x, 0);
    assert.equal(nan.y, 0);
    assert.equal(nan.width, 0);
    assert.equal(nan.height, 0);
    assert.equal(nan.strokeWidth, 2);
    const ellipse = result.scene.elements.filter((el) => el.type === 'ellipse')[0];
    assert.equal(ellipse.width, 40);
    assert.equal(ellipse.height, 20);
  });

  it('renames duplicate ids and reports them', () => {
    const result = schema.validateScene(fixture('corrupt-scene.json'));
    const ids = result.scene.elements.map((el) => el.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(result.issues.some((item) => item.code === 'duplicate-id'));
  });

  it('drops dangling bindings and container ids', () => {
    const result = schema.validateScene(fixture('corrupt-scene.json'));
    const arrow = result.scene.elements.find((el) => el.id === 'dangling');
    assert.equal(arrow.startBinding, null);
    assert.equal(arrow.endBinding, null);
    const orphan = result.scene.elements.find((el) => el.id === 'orphan-text');
    assert.equal(orphan.containerId, null);
    assert.ok(result.issues.some((item) => item.code === 'dangling-binding'));
    assert.ok(result.issues.some((item) => item.code === 'dangling-container'));
  });

  it('replaces dangerous colour strings and clamps opacity', () => {
    const result = schema.validateScene(fixture('corrupt-scene.json'));
    const bad = result.scene.elements.find((el) => el.id === 'bad-color');
    assert.equal(bad.strokeColor, '#1e1e1e');
    assert.equal(bad.backgroundColor, '#ff0000');
    assert.equal(bad.opacity, 100);
  });

  it('keeps text verbatim (escaping happens at export time)', () => {
    const result = schema.validateScene({
      elements: [{ id: 't', type: 'text', text: '<img src=x onerror=alert(1)>', width: 10, height: 10 }],
    });
    assert.equal(result.scene.elements[0].text, '<img src=x onerror=alert(1)>');
  });

  it('accepts inline raster images only', () => {
    const good = schema.validateScene({
      elements: [{
        id: 'img', type: 'image', width: 10, height: 10,
        imageSrc: 'data:image/png;base64,iVBORw0KGgo=',
      }],
    });
    assert.equal(good.scene.elements.length, 1);
    const svg = schema.validateScene({
      elements: [{ id: 'img', type: 'image', width: 10, height: 10, imageSrc: 'data:image/svg+xml;base64,PHN2Zz4=' }],
    });
    assert.equal(svg.scene.elements.length, 0);
  });

  it('truncates huge scenes instead of freezing', () => {
    const elements = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, type: 'rect', width: 5, height: 5 }));
    const result = schema.validateScene({ elements }, { limits: { maxElements: 10 } });
    assert.equal(result.scene.elements.length, 10);
    assert.ok(result.issues.some((item) => item.code === 'too-many-elements'));
  });

  it('reports unknown fields without losing the element', () => {
    const result = schema.validateScene({ elements: [{ id: 'a', type: 'rect', width: 1, height: 1, wat: true }] });
    assert.equal(result.scene.elements.length, 1);
    assert.ok(result.issues.some((item) => item.code === 'unknown-field'));
  });

  it('validates style and theme blobs', () => {
    const style = schema.validateStyle({
      strokeColor: 'red', backgroundColor: 'nope(', strokeWidth: -4, opacity: 900,
      strokeStyle: 'zigzag', theme: 'dark', grid: true,
    });
    assert.equal(style.strokeColor, 'red');
    assert.equal(style.backgroundColor, 'transparent');
    assert.equal(style.strokeWidth, 1);
    assert.equal(style.opacity, 100);
    assert.equal(style.strokeStyle, 'solid');
    assert.equal(style.theme, 'dark');
    assert.equal(style.grid, true);
    assert.deepEqual(schema.validateStyle(null), {});
  });
});

describe('issue reporting', () => {
  it('summarises repaired and dropped issues', () => {
    const text = schema.describeIssues([
      { code: 'a', severity: 'warning' },
      { code: 'b', severity: 'error' },
    ]);
    assert.match(text, /2 scene issues/);
    assert.match(text, /1 repaired/);
    assert.match(text, /1 dropped/);
    assert.equal(schema.describeIssues([]), '');
  });
});
