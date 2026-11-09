/**
 * Tool behaviour: shortcut mapping, draft creation/resizing while dragging,
 * selection toggles, marquee selection, resize handles, eraser hits.
 * DOM-free.
 */
import {
  BIND_PROXIMITY,
  HANDLE_SIZE,
  CLOSED_SHAPES,
  distance,
  hitTest,
  normRect,
  normalizePoints,
  rectOf,
  rectsIntersect,
  rectContainsRect,
  resolveConnector,
  setConnectorFromAbsolute,
  elementsInRect,
} from './geometry.js';
import { ELEMENT_DEFAULTS, makeElement } from './scene.js';

export const TOOLS = Object.freeze([
  { tool: 'select', label: 'Select', shortcut: 'v' },
  { tool: 'rect', label: 'Rect', shortcut: 'r' },
  { tool: 'ellipse', label: 'Ellipse', shortcut: 'o' },
  { tool: 'diamond', label: 'Diamond', shortcut: 'd' },
  { tool: 'line', label: 'Line', shortcut: 'l' },
  { tool: 'arrow', label: 'Arrow', shortcut: 'a' },
  { tool: 'freehand', label: 'Pen', shortcut: 'p' },
  { tool: 'eraser', label: 'Eraser', shortcut: 'e' },
  { tool: 'text', label: 'Text', shortcut: 't' },
]);

export const PALETTE = Object.freeze([
  '#1e1e1e',
  '#e03131',
  '#f2711e',
  '#e3b341',
  '#2f855a',
  '#1971c2',
  '#6b46c1',
  '#c2255e',
  '#000000',
  '#adb5bd',
]);

export const STROKE_STYLES = Object.freeze(['solid', 'dashed', 'dotted']);
export const HANDLES = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
export const CORNER_HANDLES = Object.freeze(['nw', 'ne', 'se', 'sw']);
export const TEXT_SIZES = Object.freeze([16, 24, 36, 52]);
export const ANGLE_SNAP = Math.PI / 12; // 15 degrees

export function toolFromShortcut(key) {
  const match = TOOLS.find((entry) => entry.shortcut === key.toLowerCase());
  return match ? match.tool : null;
}

export function styleFromState(state) {
  const keys = ['strokeColor', 'backgroundColor', 'strokeWidth', 'strokeStyle', 'opacity', 'roughness', 'fontSize'];
  const picked = {};
  for (const key of keys) {
    if (state[key] !== undefined) picked[key] = state[key];
  }
  return picked;
}

export function createDraft(tool, start, style) {
  const base = { ...ELEMENT_DEFAULTS, ...styleFromState(style), type: tool };
  if (tool === 'line' || tool === 'arrow') {
    base.points = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  } else if (tool === 'freehand') {
    base.points = [{ x: 0, y: 0 }];
  }
  base.x = start.x;
  base.y = start.y;
  return makeElement(base);
}

/** Shift held: square/round shapes, 15-degree connectors. */
export function constrainRect(rect, shiftDown) {
  if (!shiftDown) return rect;
  const size = Math.max(rect.width, rect.height);
  return { x: rect.x, y: rect.y, width: size, height: size };
}

export function snapAngle(start, end, shiftDown) {
  if (!shiftDown) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return end;
  const angle = Math.round(Math.atan2(dy, dx) / ANGLE_SNAP) * ANGLE_SNAP;
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
}

export function updateDraft(el, tool, start, current, shiftDown) {
  if (tool === 'freehand') {
    const last = el.points[el.points.length - 1];
    const absolute = { x: el.x + last.x, y: el.y + last.y };
    if (distance(absolute, current) < 2) return el;
    el.points.push({ x: current.x - el.x, y: current.y - el.y });
    return normalizePoints(el);
  }

  if (tool === 'line' || tool === 'arrow') {
    const end = snapAngle(start, current, shiftDown);
    setConnectorFromAbsolute(el, { x: start.x, y: start.y }, end);
    return el;
  }

  const rect = constrainRect(normRect(start.x, start.y, current.x, current.y), shiftDown);
  Object.assign(el, rect);
  return el;
}

export function toggleSelection(ids, hitId, shiftDown) {
  if (!hitId) return shiftDown ? ids.slice() : [];
  if (shiftDown) {
    return ids.includes(hitId) ? ids.filter((id) => id !== hitId) : [...ids, hitId];
  }
  return ids.includes(hitId) ? ids : [hitId];
}

export function marqueeSelection(ids, elements, rect, shiftDown, find = null) {
  const hits = elementsInRect(elements, rect, { containedOnly: shiftDown, find });
  if (shiftDown) {
    return [...new Set([...ids, ...hits])];
  }
  return hits;
}

export function handlePosition(rect, handle) {
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  const positions = {
    nw: { x: rect.x, y: rect.y },
    n: { x: midX, y: rect.y },
    ne: { x: rect.x + rect.width, y: rect.y },
    e: { x: rect.x + rect.width, y: midY },
    se: { x: rect.x + rect.width, y: rect.y + rect.height },
    s: { x: midX, y: rect.y + rect.height },
    sw: { x: rect.x, y: rect.y + rect.height },
    w: { x: rect.x, y: midY },
  };
  return positions[handle];
}

export function handleAt(rect, point, size = HANDLE_SIZE) {
  for (const handle of HANDLES) {
    if (distance(point, handlePosition(rect, handle)) <= size) return handle;
  }
  return null;
}

/** Endpoint handles for connectors (2 instead of 8). */
export function connectorHandleAt(el, find, point, size = HANDLE_SIZE) {
  const [start, end] = resolveConnector(el, find);
  if (distance(point, start) <= size) return 'start';
  if (distance(point, end) <= size) return 'end';
  return null;
}

export function resizeRect(rect, handle, dx, dy, lockAspect = false) {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  if (handle === 'nw' || handle === 'w' || handle === 'sw') left += dx;
  if (handle === 'ne' || handle === 'e' || handle === 'se') right += dx;
  if (handle === 'nw' || handle === 'n' || handle === 'ne') top += dy;
  if (handle === 'sw' || handle === 's' || handle === 'se') bottom += dy;

  if (lockAspect && CORNER_HANDLES.includes(handle)) {
    const ratio = (rect.width || 1) / (rect.height || 1);
    const dirX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
    const dirY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
    const anchorX = dirX > 0 ? rect.x : rect.x + rect.width;
    const anchorY = dirY > 0 ? rect.y : rect.y + rect.height;
    const growthX = dirX > 0 ? dx : -dx;
    const growthY = dirY > 0 ? dy : -dy;
    const dominant = Math.abs(growthX) >= Math.abs(growthY * ratio) ? growthX : growthY * ratio;
    const width = Math.max(rect.width + dominant, 1);
    const height = width / ratio;
    left = dirX > 0 ? anchorX : anchorX - width;
    right = dirX > 0 ? anchorX + width : anchorX;
    top = dirY > 0 ? anchorY : anchorY - height;
    bottom = dirY > 0 ? anchorY + height : anchorY;
  }

  return normRect(left, top, right, bottom);
}

export function scalePoints(points, ratioX, ratioY) {
  return points.map((point) => ({ x: point.x * ratioX, y: point.y * ratioY }));
}

/** Connector end dragged to a free point: binding drops until it lands on an object. */
export function moveConnectorEnd(el, find, end, target) {
  const [start, tail] = resolveConnector(el, find);
  const next = end === 'start' ? setConnectorFromAbsolute(el, target, tail) : setConnectorFromAbsolute(el, start, target);
  if (end === 'start') el.startBinding = null;
  else el.endBinding = null;
  return next;
}

/** Suggested binding for a connector end: the closed shape under it. */
export function bindingTargetAt(elements, point, excludeIds = []) {
  const skip = new Set(excludeIds);
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const el = elements[i];
    if (skip.has(el.id) || !CLOSED_SHAPES.includes(el.type)) continue;
    const rect = rectOf(el);
    if (rect.x - BIND_PROXIMITY <= point.x && point.x <= rect.x + rect.width + BIND_PROXIMITY) {
      if (rect.y - BIND_PROXIMITY <= point.y && point.y <= rect.y + rect.height + BIND_PROXIMITY) {
        return el.id;
      }
    }
  }
  return null;
}

export function eraseHits(elements, from, to, find) {
  const step = 6;
  const length = distance(from, to);
  const samples = Math.max(1, Math.ceil(length / step));
  const hits = new Set();
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    for (const el of elements) {
      if (hitTest(el, point, find)) hits.add(el.id);
    }
  }
  return [...hits];
}
