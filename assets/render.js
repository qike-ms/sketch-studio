/**
 * Canvas painting layer: grid, sketchy strokes, fills, text, caret,
 * selection handles and link dots.
 */
import { CLOSED_SHAPES, HANDLE_SIZE, isFilled, resolveConnector, resolvedRect } from '../src/geometry.js';
import { arrowHeadPoints, roughEllipse, roughFreehand, roughPolygon, roughSegment } from '../src/rough.js';
import { handlePosition } from '../src/tools.js';

export const HAND_FONT =
  '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Bradley Hand", "Trebuchet MS", sans-serif';

const GRID_SIZE = 24;
const CARET_COLOR = '#e8553d';

let measureContext = null;

function fontString(el) {
  return `${el.fontSize}px ${HAND_FONT}`;
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
  const lineHeight = el.fontSize * el.lineHeight;
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
  context.lineJoin = 'round';
  context.globalAlpha = (el.opacity ?? 100) / 100;
  const width = context.lineWidth;
  if (el.strokeStyle === 'dashed') context.setLineDash([width * 5, width * 3.5]);
  else if (el.strokeStyle === 'dotted') context.setLineDash([0.1, width * 2.6]);
  else context.setLineDash([]);
}

function fillShape(context, el) {
  if (!el.backgroundColor || el.backgroundColor === 'transparent') return;
  context.save();
  context.fillStyle = el.backgroundColor;
  context.globalAlpha = ((el.opacity ?? 100) / 100) * el.backgroundAlpha;
  context.beginPath();
  if (el.type === 'ellipse') {
    context.ellipse(el.x + el.width / 2, el.y + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
  } else if (el.type === 'diamond') {
    context.moveTo(el.x + el.width / 2, el.y);
    context.lineTo(el.x + el.width, el.y + el.height / 2);
    context.lineTo(el.x + el.width / 2, el.y + el.height);
    context.lineTo(el.x, el.y + el.height / 2);
    context.closePath();
  } else {
    context.rect(el.x, el.y, el.width, el.height);
  }
  context.fill();
  context.restore();
}

function drawText(context, el, caret) {
  const lines = String(el.text ?? '').split('\n');
  const widths = measureText(el);
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

export function drawElement(context, el, find, caret = null) {
  context.save();
  if (el.type === 'text') {
    drawText(context, el, caret);
    context.restore();
    return;
  }

  applyStrokeStyle(context, el);

  if (CLOSED_SHAPES.includes(el.type)) {
    if (isFilled(el)) fillShape(context, el);
    if (el.type === 'ellipse') {
      for (const path of roughEllipse(el)) strokeSmooth(context, path);
    } else {
      // corners jitter, edges stay straight: rects and diamonds must not round off
      for (const path of roughPolygon(el)) strokeRigid(context, path);
    }
  } else if (el.type === 'freehand') {
    const absolute = el.points.map((point) => ({ x: el.x + point.x, y: el.y + point.y }));
    for (const path of roughFreehand(absolute, el)) strokeSmooth(context, path);
  } else {
    const [start, end] = resolveConnector(el, find);
    for (const path of roughSegment(start, end, el)) strokeSmooth(context, path);
    if (el.type === 'arrow') {
      for (const path of arrowHeadPoints(end, start, el)) strokeSmooth(context, path);
    }
  }
  context.restore();
}

export function drawGrid(context, width, height) {
  context.save();
  context.fillStyle = '#dfe1e6';
  for (let x = GRID_SIZE; x < width; x += GRID_SIZE) {
    for (let y = GRID_SIZE; y < height; y += GRID_SIZE) {
      context.fillRect(x, y, 1.5, 1.5);
    }
  }
  context.restore();
}

export function drawSelection(context, elements, find) {
  context.save();
  context.strokeStyle = '#1f6feb';
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  for (const el of elements) {
    const rect = resolvedRect(el, find);
    context.strokeRect(rect.x - 3, rect.y - 3, rect.width + 6, rect.height + 6);
  }
  context.restore();
}

export function drawHandles(context, elements, find) {
  context.save();
  context.setLineDash([]);
  for (const el of elements) {
    const isConnector = el.type === 'line' || el.type === 'arrow';
    const positions = isConnector
      ? resolveConnector(el, find)
      : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) =>
        handlePosition(resolvedRect(el, find), handle),
      );
    for (const point of positions) {
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#1f6feb';
      context.lineWidth = 1.5;
      context.beginPath();
      context.rect(point.x - HANDLE_SIZE / 2, point.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      context.fill();
      context.stroke();
    }
  }
  context.restore();
}

/** Faint dot where a connector end is glued to an object. */
export function drawLinkDots(context, elements, find) {
  context.save();
  context.setLineDash([]);
  for (const el of elements) {
    if (!el.startBinding && !el.endBinding) continue;
    const [start, end] = resolveConnector(el, find);
    context.fillStyle = '#1f6feb';
    for (const [point, binding] of [[start, el.startBinding], [end, el.endBinding]]) {
      if (!binding || !find(binding.elementId)) continue;
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

export function drawMarquee(context, rect) {
  context.save();
  context.fillStyle = 'rgba(31, 111, 235, 0.08)';
  context.strokeStyle = 'rgba(31, 111, 235, 0.6)';
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.restore();
}
