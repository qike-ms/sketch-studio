/**
 * Pure geometry for sketch-studio.
 *
 * DOM-free on purpose: every interaction rule (hit testing, connector
 * anchoring, resizing, marquee selection) is unit-testable in Node.
 *
 * Element coordinates
 *   Shapes/text : x,y is the top-left of the bounding box.
 *   line/arrow/freehand : points[] are relative to x,y.
 */

export const HIT_TOLERANCE = 8;
export const BIND_PROXIMITY = 14;
export const HANDLE_SIZE = 8;

export const CLOSED_SHAPES = Object.freeze(['rect', 'ellipse', 'diamond']);
export const CONNECTOR_TYPES = Object.freeze(['line', 'arrow']);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

export function rectOf(el) {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

export function rectCenter(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function pointInsideRect(rect, point, pad = 0) {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.width + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.height + pad
  );
}

export function rectContainsRect(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function rectsIntersect(a, b) {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(point, a, b) {
  const segmentLength = distance(a, b);
  if (segmentLength === 0) return distance(point, a);
  const t = clamp(
    ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) /
      (segmentLength * segmentLength),
    0,
    1,
  );
  return distance(point, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

export function pointsBBox(points) {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Keeps points[] relative to x,y with a non-negative bounding box. */
export function normalizePoints(el) {
  if (!el.points || !el.points.length) return el;
  const bbox = pointsBBox(el.points);
  if (bbox.x !== 0 || bbox.y !== 0) {
    for (const point of el.points) {
      point.x -= bbox.x;
      point.y -= bbox.y;
    }
    el.x += bbox.x;
    el.y += bbox.y;
  }
  el.width = bbox.width;
  el.height = bbox.height;
  return el;
}

export function absolutePoints(el) {
  return el.points.map((point) => ({ x: el.x + point.x, y: el.y + point.y }));
}

export function setConnectorFromAbsolute(el, start, end) {
  el.x = start.x;
  el.y = start.y;
  el.points = [{ x: 0, y: 0 }, { x: end.x - start.x, y: end.y - start.y }];
  return normalizePoints(el);
}

/**
 * Point on an element's border along a direction from its centre.
 * `gap` keeps the connector tip clear of the stroke it points at.
 */
export function boundaryPoint(el, direction, gap = 0) {
  const rect = rectOf(el);
  const center = rectCenter(rect);
  const halfW = Math.max(rect.width / 2, 0.5);
  const halfH = Math.max(rect.height / 2, 0.5);
  let { x: dx, y: dy } = direction;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return center;
  dx /= length;
  dy /= length;

  let radius;
  if (el.type === 'ellipse') {
    const q = (dx * dx) / (halfW * halfW) + (dy * dy) / (halfH * halfH);
    radius = 1 / Math.sqrt(Math.max(q, 1e-9));
  } else if (el.type === 'diamond') {
    const q = Math.abs(dx) / halfW + Math.abs(dy) / halfH;
    radius = 1 / Math.max(q, 1e-9);
  } else {
    const q = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
    radius = 1 / Math.max(q, 1e-9);
  }
  return { x: center.x + dx * (radius + gap), y: center.y + dy * (radius + gap) };
}

/**
 * Where a connector really starts/ends once object bindings are applied.
 * Unbound ends fall back to the stored absolute points.
 */
export function resolveConnector(el, find) {
  const points = el.points;
  const startStored = { x: el.x + points[0].x, y: el.y + points[0].y };
  const endStored = {
    x: el.x + points[points.length - 1].x,
    y: el.y + points[points.length - 1].y,
  };
  const startEl = el.startBinding ? find(el.startBinding.elementId) : null;
  const endEl = el.endBinding ? find(el.endBinding.elementId) : null;
  const startRef = startEl ? rectCenter(rectOf(startEl)) : startStored;
  const endRef = endEl ? rectCenter(rectOf(endEl)) : endStored;
  const gap = (el.strokeWidth ?? 1) / 2 + 2;
  const start = startEl
    ? boundaryPoint(startEl, { x: endRef.x - startRef.x, y: endRef.y - startRef.y }, gap)
    : startStored;
  const end = endEl
    ? boundaryPoint(endEl, { x: startRef.x - endRef.x, y: startRef.y - endRef.y }, gap)
    : endStored;
  return [start, end];
}

/** Bounding box that reflects the resolved connector ends. */
export function resolvedRect(el, find) {
  if ((el.type === 'line' || el.type === 'arrow') && (el.startBinding || el.endBinding)) {
    const [start, end] = resolveConnector(el, find);
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }
  return rectOf(el);
}

export function shapeContains(el, point, pad = 0) {
  const rect = rectOf(el);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const halfW = Math.max(rect.width / 2 + pad, 0.5);
  const halfH = Math.max(rect.height / 2 + pad, 0.5);

  if (el.type === 'ellipse') {
    return (dx * dx) / (halfW * halfW) + (dy * dy) / (halfH * halfH) <= 1;
  }
  if (el.type === 'diamond') {
    return Math.abs(dx) / halfW + Math.abs(dy) / halfH <= 1;
  }
  return Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;
}

export function isFilled(el) {
  return Boolean(el.backgroundColor) && el.backgroundColor !== 'transparent';
}

export function hitTest(el, point, find, tolerance = HIT_TOLERANCE) {
  const slop = tolerance + (el.strokeWidth ?? 1) / 2;

  if (el.type === 'text') return pointInsideRect(rectOf(el), point, tolerance);

  if (CONNECTOR_TYPES.includes(el.type) || el.type === 'freehand') {
    const points =
      el.type === 'freehand' ? absolutePoints(el) : resolveConnector(el, find);
    if (points.length === 1) return distance(point, points[0]) <= slop;
    for (let i = 1; i < points.length; i += 1) {
      if (distanceToSegment(point, points[i - 1], points[i]) <= slop) return true;
    }
    return false;
  }

  if (!shapeContains(el, point, slop)) return false;
  if (isFilled(el)) return true;
  return !shapeContains(el, point, -slop);
}

export function isContainer(el) {
  return CLOSED_SHAPES.includes(el.type);
}

/** Element under a point, topmost first, optionally filtered. */
export function elementAt(elements, point, find, { tolerance = HIT_TOLERANCE, predicate = () => true } = {}) {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const el = elements[i];
    if (!predicate(el)) continue;
    if (hitTest(el, point, find, tolerance)) return el;
  }
  return null;
}

/** Element whose bbox contains a point, topmost first (used for binding). */
export function containerAt(elements, point, { predicate = isContainer } = {}) {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const el = elements[i];
    if (!predicate(el)) continue;
    if (pointInsideRect(rectOf(el), point)) return el;
  }
  return null;
}

export function elementsInRect(elements, rect, { containedOnly = false, find = null } = {}) {
  const hits = [];
  for (const el of elements) {
    const elRect = find ? resolvedRect(el, find) : rectOf(el);
    if (containedOnly ? rectContainsRect(rect, elRect) : rectsIntersect(rect, elRect)) {
      hits.push(el.id);
    }
  }
  return hits;
}

/** Ids whose resolved stroke crosses the segment a→b (eraser). */
export function elementsAlongSegment(elements, a, b, find, samples = 8) {
  const hits = new Set();
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    for (const el of elements) {
      if (hitTest(el, point, find, HIT_TOLERANCE)) hits.add(el.id);
    }
  }
  return [...hits];
}
