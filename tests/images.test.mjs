import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as images from '../src/images.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('image guards', () => {
  it('accepts supported raster types and sizes', () => {
    assert.deepEqual(images.checkImageFile({ type: 'image/png', size: 100 }), { ok: true, error: null });
    assert.equal(images.checkImageFile({ type: 'image/svg+xml', size: 100 }).ok, false);
    assert.equal(images.checkImageFile({ type: 'image/png', size: 10 * 1024 * 1024 }).ok, false);
    assert.equal(images.checkImageFile(null).ok, false);
  });

  it('recognises inline raster data URLs only', () => {
    assert.equal(images.isImageDataUrl(PNG), true);
    assert.equal(images.isImageDataUrl('data:image/jpeg;base64,abc'), true);
    assert.equal(images.isImageDataUrl('https://example.com/x.png'), false);
    assert.equal(images.isImageDataUrl('data:image/svg+xml;base64,abc'), false);
    assert.equal(images.isImageDataUrl(null), false);
  });
});

describe('image sizing', () => {
  it('fits large images while preserving aspect ratio', () => {
    assert.deepEqual(images.fitImageSize(1200, 600, 600, 600), { width: 600, height: 300 });
    assert.deepEqual(images.fitImageSize(300, 300, 600, 600), { width: 300, height: 300 });
    assert.deepEqual(images.fitImageSize(100, 1000, 600, 600), { width: 60, height: 600 });
  });

  it('handles missing or degenerate dimensions', () => {
    assert.deepEqual(images.fitImageSize(0, 0, 100, 100), { width: 100, height: 100 });
    assert.deepEqual(images.fitImageSize(NaN, 50, 100, 100), { width: 100, height: 50 });
  });

  it('creates an image element with defaults', () => {
    const el = images.createImageElement({ imageSrc: PNG, x: 10, y: 20, width: 1200, height: 600 });
    assert.equal(el.type, 'image');
    assert.equal(el.imageSrc, PNG);
    assert.equal(el.width, 600);
    assert.equal(el.height, 300);
    assert.equal(el.x, 10);
    assert.equal(el.locked, false);
    assert.deepEqual(el.groupIds, []);
    assert.equal(images.createImageElement({ imageSrc: 'https://x/y.png', width: 1, height: 1 }), null);
  });

  it('centres a dropped image on the cursor', () => {
    assert.deepEqual(images.imageDropPosition({ x: 100, y: 100 }, 40, 20), { x: 80, y: 90 });
  });
});
