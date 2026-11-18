import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as exporter from '../src/export.js';
import * as geo from '../src/geometry.js';

const find = () => null;

function rect(id, x, y, w, h, extra = {}) {
  return { id, type: 'rect', x, y, width: w, height: h, strokeColor: '#1e1e1e', strokeWidth: 2, opacity: 100, roughness: 1, angle: 0, ...extra };
}

describe('content bounds', () => {
  it('covers all elements and a selection', () => {
    const elements = [rect('a', 0, 0, 10, 10), rect('b', 100, 50, 20, 20)];
    assert.deepEqual(exporter.contentBounds(elements), { x: 0, y: 0, width: 120, height: 70 });
    assert.deepEqual(exporter.contentBounds(elements, null, ['b']), { x: 100, y: 50, width: 20, height: 20 });
    assert.deepEqual(exporter.exportBounds(elements, null, null, 10), { x: -10, y: -10, width: 140, height: 90 });
  });

  it('returns a sane box for an empty scene', () => {
    assert.equal(exporter.contentBounds([]), null);
    const bounds = exporter.exportBounds([], null, null, 16);
    assert.ok(bounds.width >= 1 && bounds.height >= 1);
  });

  it('includes rotation in bounds', () => {
    const bounds = exporter.contentBounds([rect('a', 0, 0, 100, 20, { angle: 90 })]);
    assert.ok(Math.abs(bounds.width - 20) < 1e-9);
    assert.ok(Math.abs(bounds.height - 100) < 1e-9);
  });
});

describe('SVG export', () => {
  it('wraps the scene in a standalone SVG with a background', () => {
    const svg = exporter.sceneToSVG([rect('a', 10, 20, 40, 30)]);
    assert.match(svg, /^<\?xml/);
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<rect[^>]+fill="#ffffff"/);
    assert.match(svg, /<path/);
    assert.match(svg, /<\/svg>/);
  });

  it('uses a dark background for the dark theme', () => {
    const svg = exporter.sceneToSVG([rect('a', 0, 0, 10, 10)], { theme: 'dark' });
    assert.match(svg, /fill="#121212"/);
  });

  it('escapes text and never emits raw markup', () => {
    const text = { id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '<script>alert(1)</script>', fontSize: 20, lineHeight: 1.25, strokeColor: '#111', opacity: 100, fontFamily: 'hand', angle: 0 };
    const svg = exporter.sceneToSVG([text]);
    assert.ok(!svg.includes('<script>'));
    assert.match(svg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it('exports a selection and adds its bound label', () => {
    const box = rect('box', 0, 0, 100, 60);
    const label = { id: 'label', type: 'text', x: 20, y: 20, width: 40, height: 20, text: 'hi', fontSize: 20, lineHeight: 1.25, strokeColor: '#111', opacity: 100, fontFamily: 'hand', angle: 0, containerId: 'box' };
    const other = rect('other', 500, 500, 10, 10);
    const svg = exporter.sceneToSVG([box, label, other], { ids: ['box'] });
    assert.match(svg, />hi</);
    assert.ok(!svg.includes('x="500'));
  });

  it('rotates elements around their centre', () => {
    const svg = exporter.sceneToSVG([rect('a', 0, 0, 100, 20, { angle: 45 })]);
    assert.match(svg, /transform="rotate\(45\.00 50\.00 10\.00\)"/);
  });

  it('draws multi-point connectors and arrowheads', () => {
    const arrow = {
      id: 'a', type: 'arrow', x: 0, y: 0, width: 100, height: 100,
      points: [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 }],
      strokeColor: '#111', strokeWidth: 2, opacity: 100, roughness: 1, angle: 0,
      startArrowhead: 'dot', endArrowhead: 'triangle', elbow: false,
    };
    const svg = exporter.sceneToSVG([arrow]);
    assert.match(svg, /<circle/);
    assert.ok((svg.match(/<path/g) ?? []).length >= 3);
  });

  it('embeds inline images and refuses external URLs', () => {
    const good = exporter.sceneToSVG([{
      id: 'img', type: 'image', x: 0, y: 0, width: 20, height: 20,
      imageSrc: 'data:image/png;base64,iVBORw0KGgo=', opacity: 100, angle: 0,
    }]);
    assert.match(good, /<image/);
    const bad = exporter.sceneToSVG([{
      id: 'img', type: 'image', x: 0, y: 0, width: 20, height: 20,
      imageSrc: 'https://example.com/x.png', opacity: 100, angle: 0,
    }]);
    assert.ok(!bad.includes('<image'));
  });

  it('exports text at its absolute scene position', () => {
    const text = { id: 't', type: 'text', x: 200, y: 500, width: 80, height: 30, text: 'hi', fontSize: 20, lineHeight: 1.25, strokeColor: '#111', opacity: 100, fontFamily: 'hand', angle: 0 };
    const svg = exporter.sceneToSVG([text]);
    assert.match(svg, /<text[^>]*x="200\.00"[^>]*y="500\.00"/);
    assert.match(svg, /<tspan x="200\.00" dy="0\.00">hi<\/tspan>/);
  });

  it('keeps multiline text offsets and negative y', () => {
    const text = { id: 't', type: 'text', x: -40, y: -120, width: 80, height: 60, text: 'one\ntwo', fontSize: 20, lineHeight: 1.5, strokeColor: '#111', opacity: 100, fontFamily: 'hand', angle: 0 };
    const svg = exporter.sceneToSVG([text]);
    assert.match(svg, /<text[^>]*x="-40\.00"[^>]*y="-120\.00"/);
    assert.match(svg, /<tspan x="-40\.00" dy="0\.00">one<\/tspan>/);
    assert.match(svg, /<tspan x="-40\.00" dy="30\.00">two<\/tspan>/);
  });

  it('exports rotated text with its position and rotation transform', () => {
    const text = { id: 't', type: 'text', x: 100, y: 200, width: 80, height: 20, text: 'rotated', fontSize: 20, lineHeight: 1.25, strokeColor: '#111', opacity: 100, fontFamily: 'hand', angle: 45 };
    const svg = exporter.sceneToSVG([text]);
    assert.match(svg, /transform="rotate\(45\.00 140\.00 210\.00\)"/);
    assert.match(svg, /<text[^>]*y="200\.00"/);
  });

  it('exports a selected bound label with the container position', () => {
    const box = rect('box', 0, 0, 100, 60);
    const label = { id: 'label', type: 'text', x: 20, y: 20, width: 40, height: 20, text: 'hi', fontSize: 20, lineHeight: 1.25, strokeColor: '#111', opacity: 100, fontFamily: 'hand', angle: 0, containerId: 'box' };
    const svg = exporter.sceneToSVG([box, label], { ids: ['box'] });
    assert.match(svg, /<text[^>]*x="20\.00"[^>]*y="20\.00"/);
  });

  it('handles an empty scene without throwing', () => {
    const svg = exporter.sceneToSVG([]);
    assert.match(svg, /<svg/);
  });

  it('makes timestamped filenames', () => {
    assert.match(exporter.exportFileName('svg', 0), /^sketch-studio-svg-\d{8}-\d{6}\.svg$/);
  });

  it('uses connector bindings when exporting', () => {
    const box = rect('box', 100, 0, 50, 50);
    const arrow = {
      id: 'a', type: 'arrow', x: 0, y: 25, width: 100, height: 50,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      startBinding: { elementId: 'box' },
      strokeColor: '#111', strokeWidth: 2, opacity: 100, roughness: 1, angle: 0,
      startArrowhead: 'none', endArrowhead: 'arrow',
    };
    const svg = exporter.sceneToSVG([box, arrow], { find: (id) => (id === 'box' ? box : null) });
    const [start] = geo.resolveConnector(arrow, (id) => (id === 'box' ? box : null));
    const points = [...svg.matchAll(/[ML](-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)]
      .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
    assert.ok(points.some((point) => geo.distance(point, start) < 10), 'a path starts near the bound end');
  });
});
