/**
 * Export helpers: content bounds, PNG geometry and escaped SVG.
 * No DOM access; the app turns the returned string into a Blob.
 */
import {
  CONNECTOR_TYPES,
  CLOSED_SHAPES,
  elementBounds,
  resolveConnectorPath,
  resolvedFreehand,
} from './geometry.js';
import { arrowheadGeometry, roughEllipse, roughFreehand, roughPolygon, roughSegment } from './rough.js';
import { escapeHtml } from './import.js';
import { isSafeColor } from './schema.js';

export const FONT_STACKS = Object.freeze({
  hand: '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Bradley Hand", "Trebuchet MS", sans-serif',
  normal: 'Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
});

export const THEME_BACKGROUNDS = Object.freeze({ light: '#ffffff', dark: '#121212' });

function num(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function xml(value) {
  return escapeHtml(value);
}

function attr(name, value) {
  return `${name}="${xml(value)}"`;
}

/** Bounding box for every element (or a selection), including rotation. */
export function contentBounds(elements, find = null, ids = null) {
  const selected = ids ? new Set(ids) : null;
  let box = null;
  for (const el of elements) {
    if (selected && !selected.has(el.id)) continue;
    const rect = elementBounds(el, find);
    if (!box) {
      box = { ...rect };
      continue;
    }
    const left = Math.min(box.x, rect.x);
    const top = Math.min(box.y, rect.y);
    const right = Math.max(box.x + box.width, rect.x + rect.width);
    const bottom = Math.max(box.y + box.height, rect.y + rect.height);
    box = { x: left, y: top, width: right - left, height: bottom - top };
  }
  return box;
}

/** Padded export bounds; never degenerate enough to divide by zero. */
export function exportBounds(elements, ids = null, find = null, padding = 16) {
  const box = contentBounds(elements, find, ids);
  if (!box) return { x: 0, y: 0, width: padding * 2 || 1, height: padding * 2 || 1 };
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: Math.max(box.width + padding * 2, 1),
    height: Math.max(box.height + padding * 2, 1),
  };
}

function selectedWithLabels(elements, ids) {
  if (!ids) return elements;
  const selected = new Set(ids);
  for (const el of elements) {
    if (el.type === 'text' && el.containerId && selected.has(el.containerId)) selected.add(el.id);
  }
  return elements.filter((el) => selected.has(el.id));
}

function dashArray(el) {
  const width = Math.max(num(el.strokeWidth, 2), 0.5);
  if (el.strokeStyle === 'dashed') return `${width * 5} ${width * 3.5}`;
  if (el.strokeStyle === 'dotted') return `0.1 ${width * 2.6}`;
  return null;
}

function pathData(points, closed = false) {
  if (!points || !points.length) return '';
  const commands = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${num(point.x).toFixed(2)} ${num(point.y).toFixed(2)}`);
  return `${commands.join(' ')}${closed ? ' Z' : ''}`;
}

function strokeAttrs(el) {
  const parts = [
    attr('fill', 'none'),
    attr('stroke', isSafeColor(el.strokeColor) ? el.strokeColor : '#1e1e1e'),
    attr('stroke-width', Math.max(num(el.strokeWidth, 2), 0.5)),
    attr('stroke-linecap', 'round'),
    attr('stroke-linejoin', el.edgeStyle === 'round' ? 'round' : 'miter'),
  ];
  const dash = dashArray(el);
  if (dash) parts.push(attr('stroke-dasharray', dash));
  return parts.join(' ');
}

function shapeFillPath(el) {
  const x = num(el.x);
  const y = num(el.y);
  const w = Math.max(num(el.width), 0);
  const h = Math.max(num(el.height), 0);
  if (el.type === 'ellipse') {
    return `M${x + w / 2} ${y}A${w / 2} ${h / 2} 0 1 0 ${x + w / 2} ${y + h}A${w / 2} ${h / 2} 0 1 0 ${x + w / 2} ${y}Z`;
  }
  if (el.type === 'diamond') {
    return `M${x + w / 2} ${y}L${x + w} ${y + h / 2}L${x + w / 2} ${y + h}L${x} ${y + h / 2}Z`;
  }
  if (el.edgeStyle === 'round') {
    const radius = Math.min(12, w / 2, h / 2);
    return `M${x + radius} ${y}H${x + w - radius}Q${x + w} ${y} ${x + w} ${y + radius}V${y + h - radius}Q${x + w} ${y + h} ${x + w - radius} ${y + h}H${x + radius}Q${x} ${y + h} ${x} ${y + h - radius}V${y + radius}Q${x} ${y} ${x + radius} ${y}Z`;
  }
  return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
}

function rotationTransform(el) {
  if (!el.angle) return null;
  const cx = num(el.x) + num(el.width) / 2;
  const cy = num(el.y) + num(el.height) / 2;
  return `rotate(${num(el.angle).toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)})`;
}

function groupOpen(el) {
  const parts = [];
  const opacity = Math.max(0, Math.min(100, num(el.opacity, 100))) / 100;
  if (opacity < 1) parts.push(attr('opacity', opacity));
  const transform = rotationTransform(el);
  if (transform) parts.push(attr('transform', transform));
  return `<g${parts.length ? ` ${parts.join(' ')}` : ''}>`;
}

function textMarkup(el) {
  const lines = String(el.text ?? '').split('\n');
  const lineHeight = num(el.fontSize, 24) * num(el.lineHeight, 1.25);
  const tspans = lines.map((line, index) => {
    const dy = index === 0 ? 0 : lineHeight;
    return `<tspan x="${num(el.x).toFixed(2)}" dy="${dy.toFixed(2)}">${xml(line)}</tspan>`;
  }).join('');
  const font = FONT_STACKS[el.fontFamily] ?? FONT_STACKS.hand;
  return `<text ${attr('x', num(el.x).toFixed(2))} ${attr('y', num(el.y).toFixed(2))} ${attr('font-family', font)} ${attr('font-size', num(el.fontSize, 24))} ${attr('fill', isSafeColor(el.strokeColor) ? el.strokeColor : '#1e1e1e')} ${attr('dominant-baseline', 'text-before-edge')} xml:space="preserve">${tspans}</text>`;
}

function imageMarkup(el) {
  const src = String(el.imageSrc ?? '');
  if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) return '';
  return `<image ${attr('href', src)} ${attr('x', num(el.x))} ${attr('y', num(el.y))} ${attr('width', Math.max(num(el.width), 1))} ${attr('height', Math.max(num(el.height), 1))} ${attr('preserveAspectRatio', 'none')} />`;
}

function connectorMarkup(el, find) {
  const points = resolveConnectorPath(el, find);
  if (points.length < 2) return '';
  const parts = [];
  for (let i = 1; i < points.length; i += 1) {
    for (const path of roughSegment(points[i - 1], points[i], el)) {
      parts.push(`<path d="${pathData(path)}" ${strokeAttrs(el)} />`);
    }
  }
  const ends = [
    [el.startArrowhead ?? 'none', points[0], points[1]],
    [el.endArrowhead ?? 'none', points[points.length - 1], points[points.length - 2]],
  ];
  for (const [style, tip, tail] of ends) {
    const geometry = arrowheadGeometry(style, tip, tail, el);
    for (const path of geometry.strokes) parts.push(`<path d="${pathData(path)}" ${strokeAttrs(el)} />`);
    if (geometry.triangle) {
      parts.push(`<path d="${pathData(geometry.triangle, true)}" fill="${xml(isSafeColor(el.strokeColor) ? el.strokeColor : '#1e1e1e')}" stroke="none" />`);
    }
    if (geometry.dot) {
      parts.push(`<circle cx="${geometry.dot.center.x.toFixed(2)}" cy="${geometry.dot.center.y.toFixed(2)}" r="${geometry.dot.radius.toFixed(2)}" fill="${xml(isSafeColor(el.strokeColor) ? el.strokeColor : '#1e1e1e')}" />`);
    }
  }
  return parts.join('');
}

function closedShapeMarkup(el) {
  const parts = [];
  if (el.backgroundColor && el.backgroundColor !== 'transparent') {
    const alpha = Math.max(0, Math.min(1, num(el.backgroundAlpha, 0.35)));
    parts.push(`<path d="${shapeFillPath(el)}" fill="${xml(isSafeColor(el.backgroundColor) ? el.backgroundColor : 'transparent')}" fill-opacity="${alpha}" stroke="none" />`);
  }
  const paths = el.type === 'ellipse' ? roughEllipse(el) : roughPolygon(el);
  for (const path of paths) parts.push(`<path d="${pathData(path, true)}" ${strokeAttrs(el)} />`);
  return parts.join('');
}

function freehandMarkup(el) {
  const paths = roughFreehand(resolvedFreehand(el), el);
  return paths.map((path) => `<path d="${pathData(path)}" ${strokeAttrs(el)} />`).join('');
}

export function elementToSVG(el, find = null) {
  let inner = '';
  if (el.type === 'text') inner = textMarkup(el);
  else if (el.type === 'image') inner = imageMarkup(el);
  else if (CLOSED_SHAPES.includes(el.type)) inner = closedShapeMarkup(el);
  else if (el.type === 'freehand') inner = freehandMarkup(el);
  else if (CONNECTOR_TYPES.includes(el.type)) inner = connectorMarkup(el, find);
  if (!inner) return '';
  return `${groupOpen(el)}${inner}</g>`;
}

/**
 * Render the scene (or a selection) as a standalone SVG document.
 * Text is escaped, images must be inline raster data URLs, and no external
 * resources are referenced.
 */
export function sceneToSVG(elements, options = {}) {
  const find = options.find ?? null;
  const ids = options.ids ?? null;
  const padding = options.padding ?? 16;
  const theme = options.theme === 'dark' ? 'dark' : 'light';
  const background = options.background ?? THEME_BACKGROUNDS[theme];
  const chosen = selectedWithLabels(elements, ids);
  const bounds = exportBounds(chosen, null, find, padding);
  const width = Math.max(Math.round(bounds.width), 1);
  const height = Math.max(Math.round(bounds.height), 1);
  const title = options.title ?? 'Sketch Studio';
  const body = chosen.map((el) => elementToSVG(el, find)).filter(Boolean).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.x.toFixed(2)} ${bounds.y.toFixed(2)} ${bounds.width.toFixed(2)} ${bounds.height.toFixed(2)}">`,
    `<title>${xml(title)}</title>`,
    `<rect x="${bounds.x.toFixed(2)}" y="${bounds.y.toFixed(2)}" width="${bounds.width.toFixed(2)}" height="${bounds.height.toFixed(2)}" fill="${xml(background)}" />`,
    body,
    '</svg>',
    '',
  ].join('\n');
}

export function exportFileName(kind, at = Date.now()) {
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `sketch-studio-${kind}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.${kind}`;
}
