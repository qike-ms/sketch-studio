/**
 * Deterministic "hand drawn" path generation.
 *
 * Seeds come from the element id, so a shape never wobbles while it is
 * dragged or re-rendered. Pure math: the renderer just strokes the paths.
 */

export function hashSeed(text) {
  let hash = 21645;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash || 1;
}

export function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664522457) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function roughStrokeWidth(strokeWidth) {
  return 0.6 + strokeWidth * 0.25;
}

function jitterPoint(point, amount, rand) {
  return {
    x: point.x + (rand() - 0.5) * amount * 2,
    y: point.y + (rand() - 0.5) * amount * 2,
  };
}

function loopPath(corners, rand, amount) {
  const points = corners.map((corner) => jitterPoint(corner, amount, rand));
  points.push(jitterPoint(corners[0], amount * 0.7, rand));
  return points;
}

function cornersOf(el) {
  const { x, y, width, height } = el;
  const cx = x + width / 2;
  const cy = y + height / 2;
  if (el.type === 'ellipse') {
    return [
      { x: cx + width / 2, y: cy },
      { x: cx, y: cy + height / 2 },
      { x: cx - width / 2, y: cy },
      { x: cx, y: cy - height / 2 },
    ];
  }
  if (el.type === 'diamond') {
    return [
      { x: cx, y },
      { x: x + width, y: cy },
      { x: cx, y: y + height },
      { x, y: cy },
    ];
  }
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

export function roughPolygon(el, passes = 2) {
  const rand = rng(hashSeed(`${el.id}|${el.type}`));
  const amount = roughStrokeWidth(el.strokeWidth) * (el.roughness ?? 1);
  const corners = cornersOf(el);
  const paths = [];
  for (let pass = 0; pass < passes; pass += 1) {
    paths.push(loopPath(corners, rand, amount * (pass === 0 ? 1 : 1.4)));
  }
  return paths;
}

export function roughEllipse(el, passes = 2) {
  const rand = rng(hashSeed(`${el.id}|ellipse`));
  const amount = roughStrokeWidth(el.strokeWidth) * (el.roughness ?? 1);
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const rx = Math.max(el.width / 2, 0.5);
  const ry = Math.max(el.height / 2, 0.5);
  const steps = Math.max(14, Math.min(44, Math.round((rx + ry) / 3)));
  const paths = [];
  for (let pass = 0; pass < passes; pass += 1) {
    const startAngle = rand() * Math.PI * 2;
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const angle = startAngle + (i / steps) * Math.PI * 2;
      const wobble = amount * (pass === 0 ? 1 : 1.5);
      points.push(
        jitterPoint(
          { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry },
          wobble,
          rand,
        ),
      );
    }
    paths.push(points);
  }
  return paths;
}

export function roughSegment(start, end, el) {
  const rand = rng(hashSeed(`${el.id}|${Math.round(start.x)},${Math.round(start.y)}`));
  const amount = roughStrokeWidth(el.strokeWidth) * (el.roughness ?? 1);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.min(12, Math.round(length / 24)));
  const paths = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const base = { x: start.x + dx * t, y: start.y + dy * t };
      const wobble = i === 0 || i === steps ? amount * 1.6 : amount;
      points.push(jitterPoint(base, wobble, rand));
    }
    paths.push(points);
  }
  return paths;
}

export function roughFreehand(points, el) {
  if (points.length < 3) return [points.slice()];
  const rand = rng(hashSeed(`${el.id}|freehand`));
  const amount = roughStrokeWidth(el.strokeWidth) * (el.roughness ?? 1) * 0.35;
  return [points.map((point) => jitterPoint(point, amount, rand))];
}

/** Two short strokes forming an arrow head at `tip`, pointing back at `tail`. */
export function arrowHeadPoints(tip, tail, el) {
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const spread = Math.PI / 7;
  const size = Math.max(10, 8 + el.strokeWidth * 2.5);
  const head = (offset) => {
    const a = angle + Math.PI - offset;
    return { x: tip.x + Math.cos(a) * size, y: tip.y + Math.sin(a) * size };
  };
  return [[head(spread), tip], [head(-spread), tip]];
}
