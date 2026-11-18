/**
 * Canvas painting layer: grid, sketchy strokes, fills, text, images, caret,
 * selection handles, rotation handles and link dots.
 *
 * All coordinates are scene coordinates; the app installs the viewport
 * transform before calling these functions.
 */
import {
  CLOSED_SHAPES,
  HANDLE_SIZE,
  isFilled,
  resolveConnectorPath,
  resolvedFreehand,
  resolvedRect,
  rectCenter,
  rectOf,
  rotatePoint,
  rotationHandleDistance,
  rotationHandlePosition,
} from '../src/geometry.js';
import {
  arrowheadGeometry,
  roughEllipse,
  roughFreehand,
  roughPolygon,
  roughSegment,
} from '../src/rough.js';
import { handlePosition, connectorHandlePoints } from '../src/tools.js';
import { FONT_STACKS } from '../src/export.js';

export const HAND_FONT = FONT_STACKS.hand;
const CARET_COLOR = '#e8553d';

let measureContext = null;
const imageCache = new Map();
let imageReadyHandler = null;

export function setImageReadyHandler(handler) {
  imageReadyHandler = handler;
}

function fontString(el) {
  const family = FONT_STACKS[el.fontFamily] ?? HAND_FONT;
  return `${el.fontSize ?? 24}px ${family}`;
}

function measureContextFor(el) {
  if (!measureContext) {
    const canvas = document.createElement('canvas');
    measureContext = canvas.getContext('2d');
  }
  measureContext.font = fontString(el);
  return measureContext;
}

/** Text metrics are stored on the element so hit-testing stays geometry-only. */
export function measureText(el) {
  const context = measureContextFor(el);
  const lines = String(el.text ?? '').split('\n');
  const lineHeight = (el.fontSize ?? 24) * (el.lineHeight ?? 1.25);
  let widest = 0;
  const widths = [];
  for (const line of lines) {
    const width = line ? context.measureText(line).width : 0;
    widths.push(width);
    widest = Math.max(widest, width);
  }
  el.width = Math.max(widest, 4);
  el.height = Math.max(lines.length * lineHeight, lineHeight);
  return widths;
}

function getImage(src) {
  if (!src || typeof Image === 'undefined') return null;
  let entry = imageCache.get(src);
  if (!entry) {
    const img = new Image();
    entry = { img, loaded: false, failed: false };
    img.onload = () => {
      entry.loaded = true;
      if (imageReadyHandler) imageReadyHandler();
    };
    img.onerror = () => {
      entry.failed = true;
      if (imageReadyHandler) imageReadyHandler();
    };
    img.src = src;
    imageCache.set(src, entry);
  }
  return entry;
}

/** Wait for every inline image in the scene so exports include them. */
export async function preloadImages(elements) {
  const sources = [...new Set(elements.filter((el) => el.type === 'image').map((el) => el.imageSrc).filter(Boolean))];
  await Promise.all(sources.map((src) => new Promise((resolve) => {
    const entry = getImage(src);
    if (!entry) return resolve();
    if (entry.loaded || entry.failed) return resolve();
    const finish = () => resolve();
    entry.img.addEventListener('load', finish, { once: true });
    entry.img.addEventListener('error', finish, { once: true });
    setTimeout(finish, 3000);
  })));
}

function strokeSmooth(context, points) {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    context.lineTo(points[1].x, points[1].y);
  } else {
    for (let i = 1; i < points.length - 1; i += 1) {
      const mid = {
        x: (points[i].x + points[i + 1].x) / 2,
        y: (points[i].y + points[i + 1].y) / 2,
      };
      context.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
    }
    context.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  }
  context.stroke();
}

function strokeRigid(context, points) {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) context.lineTo(points[i].x, points[i].y);
  context.stroke();
}

function applyStrokeStyle(context, el) {
  context.strokeStyle = el.strokeColor;
  context.fillStyle = el.strokeColor;
  context.lineWidth = Math.max(el.strokeWidth, 0.5);
  context.lineCap = 'round';
  context.lineJoin = el.edgeStyle === 'round' ? 'round' : 'miter';
  context.globalAlpha = (el.opacity ?? 100) / 100;
  const width = context.lineWidth;
  if (el.strokeStyle === 'dashed') context.setLineDash([width * 5, width * 3.5]);
  else if (el.strokeStyle === 'dotted') context.setLineDash([0.1, width * 2.6]);
  else context.setLineDash([]);
}

function roundedRectPath(context, el) {
  const radius = Math.min(12, el.width / 2, el.height / 2);
  const { x, y, width, height } = el;
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function fillShape(context, el) {
  if (!el.backgroundColor || el.backgroundColor === 'transparent') return;
  context.save();
  context.fillStyle = el.backgroundColor;
  context.globalAlpha = ((el.opacity ?? 100) / 100) * el.backgroundAlpha;
  context.beginPath();
  if (el.type === 'ellipse') {
    context.ellipse(el.x + el.width / 2, el.y + el.height / 2, Math.max(el.width / 2, 0.1), Math.max(el.height / 2, 0.1), 0, 0, Math.PI * 2);
  } else if (el.type === 'diamond') {
    context.moveTo(el.x + el.width / 2, el.y);
    context.lineTo(el.x + el.width, el.y + el.height / 2);
    context.lineTo(el.x + el.width / 2, el.y + el.height);
    context.lineTo(el.x, el.y + el.height / 2);
    context.closePath();
  } else if (el.edgeStyle === 'round') {
    roundedRectPath(context, el);
  } else {
    context.rect(el.x, el.y, el.width, el.height);
  }
  context.fill();
  context.restore();
}

function drawText(context, el, caret) {
  const lines = String(el.text ?? '').split('\n');
  measureText(el);
  const lineHeight = el.fontSize * el.lineHeight;
  context.save();
  context.font = fontString(el);
  context.textBaseline = 'top';
  context.fillStyle = el.strokeColor;
  context.globalAlpha = (el.opacity ?? 100) / 100;
  lines.forEach((line, index) => {
    context.fillText(line, el.x, el.y + index * lineHeight);
  });
  if (caret) {
    const before = String(el.text ?? '').slice(0, caret.index);
    const lineIndex = before.split('\n').length - 1;
    const column = before.length - (before.lastIndexOf('\n') + 1);
    const prefix = lines[lineIndex] ?? '';
    const x = el.x + measurePrefixWidth(prefix.slice(0, column), el);
    const y = el.y + lineIndex * lineHeight;
    context.strokeStyle = CARET_COLOR;
    context.lineWidth = Math.max(el.strokeWidth, 1.5);
    context.setLineDash([]);
    context.globalAlpha = 1;
    context.beginPath();
    context.moveTo(x, y + lineHeight * 0.08);
    context.lineTo(x, y + lineHeight * 0.92);
    context.stroke();
  }
  context.restore();
}

function measurePrefixWidth(text, el) {
  if (!text) return 0;
  const context = measureContextFor(el);
  context.font = fontString(el);
  return context.measureText(text).width;
}

function drawArrowheads(context, el, path) {
  if (path.length < 2) return;
  const ends = [
    [el.startArrowhead ?? 'none', path[0], path[1]],
    [el.endArrowhead ?? 'none', path[path.length - 1], path[path.length - 2]],
  ];
  for (const [style, tip, tail] of ends) {
    const geometry = arrowheadGeometry(style, tip, tail, el);
    for (const stroke of geometry.strokes) strokeSmooth(context, stroke);
    if (geometry.triangle) {
      context.save();
      context.setLineDash([]);
      context.globalAlpha = (el.opacity ?? 100) / 100;
      context.fillStyle = el.strokeColor;
      context.beginPath();
      context.moveTo(geometry.triangle[0].x, geometry.triangle[0].y);
      for (let i = 1; i < geometry.triangle.length; i += 1) {
        context.lineTo(geometry.triangle[i].x, geometry.triangle[i].y);
      }
      context.closePath();
      context.fill();
      context.restore();
    }
    if (geometry.dot) {
      context.save();
      context.setLineDash([]);
      context.globalAlpha = (el.opacity ?? 100) / 100;
      context.fillStyle = el.strokeColor;
      context.beginPath();
      context.arc(geometry.dot.center.x, geometry.dot.center.y, geometry.dot.radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }
}

function drawConnector(context, el, find) {
  const path = resolveConnectorPath(el, find);
  if (path.length < 2) return;
  for (let i = 1; i < path.length; i += 1) {
    for (const segment of roughSegment(path[i - 1], path[i], el)) {
      strokeSmooth(context, segment);
    }
  }
  drawArrowheads(context, el, path);
}

function drawImage(context, el) {
  const entry = getImage(el.imageSrc);
  context.save();
  context.globalAlpha = (el.opacity ?? 100) / 100;
  if (entry?.loaded) {
    context.drawImage(entry.img, el.x, el.y, Math.max(el.width, 1), Math.max(el.height, 1));
  } else {
    context.fillStyle = 'rgba(127, 127, 127, 0.12)';
    context.fillRect(el.x, el.y, Math.max(el.width, 1), Math.max(el.height, 1));
    context.strokeStyle = 'rgba(127, 127, 127, 0.5)';
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.strokeRect(el.x, el.y, Math.max(el.width, 1), Math.max(el.height, 1));
    context.setLineDash([]);
    context.fillStyle = 'rgba(127, 127, 127, 0.8)';
    context.font = '12px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(entry?.failed ? 'image failed' : 'loading image…', el.x + el.width / 2, el.y + el.height / 2);
  }
  context.restore();
}

export function drawElement(context, el, find, caret = null) {
  context.save();
  if (el.angle) {
    const centre = rectCenter(rectOf(el));
    context.translate(centre.x, centre.y);
    context.rotate((el.angle * Math.PI) / 180);
    context.translate(-centre.x, -centre.y);
  }
  if (el.type === 'text') {
    drawText(context, el, caret);
    context.restore();
    return;
  }
  if (el.type === 'image') {
    drawImage(context, el);
    context.restore();
    return;
  }

  applyStrokeStyle(context, el);

  if (CLOSED_SHAPES.includes(el.type)) {
    if (isFilled(el)) fillShape(context, el);
    if (el.type === 'ellipse') {
      for (const path of roughEllipse(el)) strokeSmooth(context, path);
    } else {
      const smooth = el.edgeStyle === 'round';
      for (const path of roughPolygon(el)) {
        if (smooth) strokeSmooth(context, path);
        else strokeRigid(context, path);
      }
    }
  } else if (el.type === 'freehand') {
    for (const path of roughFreehand(resolvedFreehand(el), el)) strokeSmooth(context, path);
  } else {
    drawConnector(context, el, find);
  }
  context.restore();
}

/** Dot grid drawn in scene coordinates; spacing adapts to zoom. */
export function drawGrid(context, visibleRect, options = {}) {
  const theme = options.theme === 'dark' ? 'dark' : 'light';
  const zoom = options.zoom ?? 1;
  let step = options.gridSize ?? 24;
  while (step * zoom < 10) step *= 2;
  if (!Number.isFinite(step) || step <= 0) return;
  context.save();
  context.fillStyle = theme === 'dark' ? '#2b2b2b' : '#dfe1e6';
  const size = Math.max(1, 1.4 / Math.max(zoom, 0.2));
  const startX = Math.floor(visibleRect.x / step) * step;
  const startY = Math.floor(visibleRect.y / step) * step;
  const endX = visibleRect.x + visibleRect.width;
  const endY = visibleRect.y + visibleRect.height;
  if (![startX, startY, endX, endY].every(Number.isFinite)) {
    context.restore();
    return;
  }
  // Bound the iteration count and stop when floating point precision means
  // `x += step` no longer advances (very large pan coordinates).
  const maxDots = Math.max(1, options.maxDots ?? 20000);
  const columns = Math.min(Math.max(0, Math.floor((endX - startX) / step) + 1), maxDots);
  const rows = Math.min(Math.max(0, Math.floor((endY - startY) / step) + 1), maxDots);
  let previousX = null;
  for (let column = 0; column < columns; column += 1) {
    const x = startX + column * step;
    if (column > 0 && x === previousX) break;
    previousX = x;
    let previousY = null;
    for (let row = 0; row < rows; row += 1) {
      const y = startY + row * step;
      if (row > 0 && y === previousY) break;
      previousY = y;
      context.fillRect(x, y, size, size);
    }
  }
  context.restore();
}

function selectionColor(theme) {
  return theme === 'dark' ? '#7aa7ff' : '#1f6feb';
}

export function drawSelection(context, elements, find, options = {}) {
  const color = selectionColor(options.theme);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1 / (options.zoom ?? 1);
  context.setLineDash([4 / (options.zoom ?? 1), 4 / (options.zoom ?? 1)]);
  for (const el of elements) {
    if (el.angle) {
      const corners = [
        { x: el.x, y: el.y },
        { x: el.x + el.width, y: el.y },
        { x: el.x + el.width, y: el.y + el.height },
        { x: el.x, y: el.y + el.height },
      ].map((point) => rotatePoint(point, rectCenter(rectOf(el)), el.angle));
      context.beginPath();
      context.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i += 1) context.lineTo(corners[i].x, corners[i].y);
      context.closePath();
      context.stroke();
    } else {
      const rect = resolvedRect(el, find);
      context.strokeRect(rect.x - 3, rect.y - 3, rect.width + 6, rect.height + 6);
    }
  }
  context.restore();
}

function handlePoints(el, find) {
  if (el.type === 'line' || el.type === 'arrow') return connectorHandlePoints(el, find);
  const rect = rectOf(el);
  const centre = rectCenter(rect);
  return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => {
    const point = handlePosition(rect, handle);
    return el.angle ? rotatePoint(point, centre, el.angle) : point;
  });
}

export function drawHandles(context, elements, find, options = {}) {
  const theme = options.theme === 'dark' ? 'dark' : 'light';
  const color = selectionColor(theme);
  const fill = theme === 'dark' ? '#1e1e1e' : '#ffffff';
  const zoom = options.zoom ?? 1;
  const size = HANDLE_SIZE / zoom;
  context.save();
  context.setLineDash([]);
  for (const el of elements) {
    const points = handlePoints(el, find);
    for (const point of points) {
      context.fillStyle = el.locked ? '#9ca3af' : fill;
      context.strokeStyle = el.locked ? '#9ca3af' : color;
      context.lineWidth = 1.5 / zoom;
      context.beginPath();
      context.rect(point.x - size / 2, point.y - size / 2, size, size);
      context.fill();
      context.stroke();
    }
  }
  if (options.showRotation) {
    for (const el of elements) {
      if (el.type === 'line' || el.type === 'arrow' || el.type === 'freehand' || el.locked) continue;
      const rect = rectOf(el);
      const centre = rectCenter(rect);
      const handle = rotationHandlePosition(el, rotationHandleDistance(zoom));
      context.strokeStyle = color;
      context.lineWidth = 1.5 / zoom;
      context.beginPath();
      context.moveTo(rect.x + rect.width / 2, rect.y);
      const anchor = el.angle ? rotatePoint({ x: rect.x + rect.width / 2, y: rect.y }, centre, el.angle) : { x: rect.x + rect.width / 2, y: rect.y };
      context.lineTo(anchor.x, anchor.y);
      context.stroke();
      context.fillStyle = fill;
      context.beginPath();
      context.arc(handle.x, handle.y, size * 0.6, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }
  context.restore();
}

/** Faint dot where a connector end is glued to an object. */
export function drawLinkDots(context, elements, find, options = {}) {
  const color = selectionColor(options.theme);
  const zoom = options.zoom ?? 1;
  context.save();
  context.setLineDash([]);
  for (const el of elements) {
    if (!el.startBinding && !el.endBinding) continue;
    const path = resolveConnectorPath(el, find);
    if (path.length < 2) continue;
    const ends = [[path[0], el.startBinding], [path[path.length - 1], el.endBinding]];
    context.fillStyle = color;
    for (const [point, binding] of ends) {
      if (!binding || !find(binding.elementId)) continue;
      context.beginPath();
      context.arc(point.x, point.y, 3.5 / zoom, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

export function drawMarquee(context, rect, options = {}) {
  const color = selectionColor(options.theme);
  context.save();
  context.fillStyle = options.theme === 'dark' ? 'rgba(122, 167, 255, 0.12)' : 'rgba(31, 111, 235, 0.08)';
  context.strokeStyle = color;
  context.lineWidth = 1 / (options.zoom ?? 1);
  context.setLineDash([4 / (options.zoom ?? 1), 4 / (options.zoom ?? 1)]);
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.restore();
}
