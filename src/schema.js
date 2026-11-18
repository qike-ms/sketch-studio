/**
 * Scene schema, migrations, validation and repair.
 *
 * Every load path (localStorage, opened file, clipboard) passes through here.
 * A bad element is repaired when the intent is clear, dropped when it is not,
 * and always reported. The rest of the drawing survives.
 *
 * DOM-free and dependency-free.
 */
import { ELEMENT_DEFAULTS, SCHEMA_VERSION } from './scene.js';
import { normalizePoints } from './geometry.js';

export { SCHEMA_VERSION };

export const ELEMENT_TYPES = Object.freeze([
  'rect',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'freehand',
  'text',
  'image',
]);

export const CLOSED_TYPES = Object.freeze(['rect', 'ellipse', 'diamond']);
export const CONNECTOR_TYPES = Object.freeze(['line', 'arrow']);
export const ARROWHEADS = Object.freeze(['none', 'arrow', 'triangle', 'dot']);
export const EDGE_STYLES = Object.freeze(['sharp', 'round']);
export const FONT_FAMILIES = Object.freeze(['hand', 'normal', 'mono']);
export const STROKE_STYLES = Object.freeze(['solid', 'dashed', 'dotted']);

export const DEFAULT_LIMITS = Object.freeze({
  maxElements: 5000,
  maxPoints: 10000,
  maxScenePoints: 100000,
  maxTextLength: 10000,
  maxSceneTextChars: 1000000,
  maxImageChars: 8 * 1024 * 1024,
  maxIdLength: 128,
  maxCoordinate: 1e7,
});

/** Format an arbitrary JSON value for an issue message without coercing it. */
export function safeText(value, maxLength = 40) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const type = typeof value;
  if (type === 'string') return value.slice(0, maxLength);
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value).slice(0, maxLength);
  if (Array.isArray(value)) return `[array ${value.length}]`;
  if (type === 'object') return '[object]';
  return `[${type}]`;
}

const ELEMENT_KEYS = new Set([
  ...Object.keys(ELEMENT_DEFAULTS),
  'id',
  'type',
  'angle',
  'groupIds',
  'locked',
  'edgeStyle',
  'fontFamily',
  'startArrowhead',
  'endArrowhead',
  'elbow',
  'imageSrc',
]);

const COLOR_PATTERNS = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgba?\(\s*[\d.%\s,/]+\)$/i,
  /^hsla?\(\s*[\d.%\s,/a-z]+\)$/i,
  /^transparent$/i,
  /^[a-z]{3,24}$/i,
];

export function isSafeColor(value) {
  return typeof value === 'string' && COLOR_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function issue(list, code, message, extra = {}) {
  list.push({ code, message, severity: extra.severity ?? 'warning', ...extra });
}

function coerceNumber(raw, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { value: fallback, repaired: raw !== undefined && raw !== fallback };
  }
  let value = integer ? Math.round(raw) : raw;
  if (value < min) value = min;
  if (value > max) value = max;
  return { value, repaired: value !== raw };
}
function coerceBoolean(raw, fallback) {
  if (typeof raw === 'boolean') return { value: raw, repaired: false };
  if (raw === 'true') return { value: true, repaired: true };
  if (raw === 'false') return { value: false, repaired: true };
  return { value: fallback, repaired: raw !== undefined };
}

function coerceEnum(raw, allowed, fallback) {
  return allowed.includes(raw)
    ? { value: raw, repaired: false }
    : { value: fallback, repaired: raw !== undefined };
}

function coerceColor(raw, fallback, issues, code) {
  if (raw === undefined || raw === null) return { value: fallback, repaired: false };
  if (isSafeColor(raw)) return { value: raw.trim(), repaired: false };
  issue(issues, code, `invalid colour ${safeText(raw)} replaced with ${fallback}`);
  return { value: fallback, repaired: true };
}

function coerceId(raw, fallback, issues, code) {
  if (typeof raw === 'string' && raw.length > 0 && raw.length <= DEFAULT_LIMITS.maxIdLength) {
    return { value: raw, repaired: false };
  }
  issue(issues, code, 'missing or invalid element id was regenerated');
  return { value: fallback, repaired: true };
}

function coerceString(raw, fallback, maxLength = 10000) {
  if (typeof raw === 'string') {
    return { value: raw, repaired: false, overLimit: raw.length > maxLength };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: String(raw), repaired: true, overLimit: false };
  return { value: fallback, repaired: raw !== undefined && raw !== fallback, overLimit: false };
}

function validatePoints(raw, type, issues, index, limits) {
  if (!Array.isArray(raw)) {
    if (CONNECTOR_TYPES.includes(type) || type === 'freehand') {
      issue(issues, 'missing-points', `${type} had no points; a degenerate stroke was created`, { index });
    }
    if (CONNECTOR_TYPES.includes(type)) return [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    if (type === 'freehand') return [{ x: 0, y: 0 }];
    return null;
  }
  const points = [];
  const capped = raw.slice(0, limits.maxPoints);
  if (raw.length > limits.maxPoints) {
    issue(issues, 'too-many-points', `point list truncated to ${limits.maxPoints}`, { index });
  }
  for (const point of capped) {
    const px = coerceNumber(point && point.x, 0, { min: -limits.maxCoordinate, max: limits.maxCoordinate }).value;
    const py = coerceNumber(point && point.y, 0, { min: -limits.maxCoordinate, max: limits.maxCoordinate }).value;
    if (!point || typeof point !== 'object' || point.x !== px || point.y !== py) {
      issue(issues, 'bad-point', 'invalid point coordinate repaired', { index });
    }
    points.push({ x: px, y: py });
  }
  if (CONNECTOR_TYPES.includes(type) && points.length < 2) {
    while (points.length < 2) points.push({ x: 0, y: 0 });
    issue(issues, 'short-connector', 'connector padded to two points', { index });
  }
  if (type === 'freehand' && points.length < 1) {
    points.push({ x: 0, y: 0 });
    issue(issues, 'empty-freehand', 'empty freehand stroke repaired', { index });
  }
  return points;
}

function boundGeometry(el, issues, index, limits) {
  const max = limits.maxCoordinate;
  normalizePoints(el);
  let width = el.width;
  let height = el.height;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    el.points = [{ x: 0, y: 0 }];
    el.width = 0;
    el.height = 0;
    issue(issues, 'bad-geometry', 'non-finite derived geometry reset', { index });
    return;
  }
  if (width > max || height > max) {
    const scale = max / Math.max(width, height);
    el.points = el.points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
    normalizePoints(el);
    issue(issues, 'oversize-geometry', `derived geometry scaled to fit ${max}`, { index });
    width = el.width;
    height = el.height;
  }
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    el.points = [{ x: 0, y: 0 }];
    el.width = 0;
    el.height = 0;
    issue(issues, 'bad-geometry', 'non-finite derived geometry reset', { index });
    return;
  }
  el.x = Math.min(max, Math.max(-max, el.x));
  el.y = Math.min(max, Math.max(-max, el.y));
  for (const point of el.points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      point.x = 0;
      point.y = 0;
      issue(issues, 'bad-point', 'non-finite point reset to 0', { index });
    }
  }
}

function validateImage(raw, issues, index, limits) {
  if (typeof raw !== 'string' || raw.length === 0) {
    issue(issues, 'missing-image', 'image element has no data URL', { index, severity: 'error' });
    return null;
  }
  if (raw.length > limits.maxImageChars) {
    issue(issues, 'image-too-large', 'image data URL exceeds the size limit', { index, severity: 'error' });
    return null;
  }
  // Only raster data URLs: no external network fetches, no script-bearing SVG.
  if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(raw)) {
    issue(issues, 'bad-image-url', 'image must be an inline PNG/JPEG/GIF/WebP data URL', { index, severity: 'error' });
    return null;
  }
  return raw;
}

/**
 * Validate one element. Returns null when the element cannot be repaired.
 * `idFactory` lets the caller make deterministic ids in tests.
 */
export function validateElement(raw, context = {}) {
  const issues = [];
  const index = context.index ?? 0;
  const limits = { ...DEFAULT_LIMITS, ...(context.limits ?? {}) };
  const idFactory = context.idFactory ?? ((n) => `el_repair_${n}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    issue(issues, 'not-an-element', 'element is not an object', { index, severity: 'error' });
    return { element: null, issues };
  }
  if (!ELEMENT_TYPES.includes(raw.type)) {
    issue(issues, 'unknown-type', `unknown element type ${safeText(raw.type)} dropped`, {
      index,
      severity: 'error',
    });
    return { element: null, issues };
  }

  for (const key of Object.keys(raw)) {
    if (!ELEMENT_KEYS.has(key)) {
      issue(issues, 'unknown-field', `unknown field ${key.slice(0, 40)} ignored`, { index });
    }
  }

  const el = { ...ELEMENT_DEFAULTS };
  el.type = raw.type;
  el.id = coerceId(raw.id, idFactory(context.idSeed ?? index), issues, 'bad-id').value;

  const x = coerceNumber(raw.x, 0, { min: -limits.maxCoordinate, max: limits.maxCoordinate });
  const y = coerceNumber(raw.y, 0, { min: -limits.maxCoordinate, max: limits.maxCoordinate });
  el.x = x.value;
  el.y = y.value;
  if (x.repaired || y.repaired) issue(issues, 'bad-position', 'invalid or out-of-range position repaired', { index });

  // Negative sizes are almost always a bad import, never a deliberate drawing.
  let width = coerceNumber(raw.width, 0, { min: 0, max: limits.maxCoordinate }).value;
  let height = coerceNumber(raw.height, 0, { min: 0, max: limits.maxCoordinate }).value;
  if (typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width < 0) {
    width = Math.min(Math.abs(raw.width), limits.maxCoordinate);
    issue(issues, 'negative-size', 'negative width flipped to positive', { index });
  }
  if (typeof raw.height === 'number' && Number.isFinite(raw.height) && raw.height < 0) {
    height = Math.min(Math.abs(raw.height), limits.maxCoordinate);
    issue(issues, 'negative-size', 'negative height flipped to positive', { index });
  }
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    width = 0;
    height = 0;
    issue(issues, 'bad-size', 'non-finite size reset to 0', { index });
  }
  el.width = width;
  el.height = height;

  el.angle = coerceNumber(raw.angle, 0).value % 360;
  if (el.angle < 0) el.angle += 360;
  el.opacity = coerceNumber(raw.opacity, 100, { min: 0, max: 100 }).value;
  el.roughness = coerceNumber(raw.roughness, 1, { min: 0, max: 2 }).value;
  el.strokeWidth = coerceNumber(raw.strokeWidth, 2, { min: 1, max: 100 }).value;
  el.fontSize = coerceNumber(raw.fontSize, 24, { min: 4, max: 400 }).value;
  el.lineHeight = coerceNumber(raw.lineHeight, 1.25, { min: 0.5, max: 4 }).value;
  el.backgroundAlpha = coerceNumber(raw.backgroundAlpha, 0.35, { min: 0, max: 1 }).value;

  el.strokeColor = coerceColor(raw.strokeColor, ELEMENT_DEFAULTS.strokeColor, issues, 'bad-colour').value;
  el.backgroundColor = coerceColor(raw.backgroundColor, 'transparent', issues, 'bad-colour').value;
  el.strokeStyle = coerceEnum(raw.strokeStyle, STROKE_STYLES, 'solid').value;
  el.edgeStyle = coerceEnum(raw.edgeStyle, EDGE_STYLES, 'sharp').value;
  el.fontFamily = coerceEnum(raw.fontFamily, FONT_FAMILIES, 'hand').value;
  el.startArrowhead = coerceEnum(raw.startArrowhead, ARROWHEADS, 'none').value;
  el.endArrowhead = coerceEnum(raw.endArrowhead, ARROWHEADS, raw.type === 'arrow' ? 'arrow' : 'none').value;
  el.locked = coerceBoolean(raw.locked, false).value;
  el.elbow = coerceBoolean(raw.elbow, false).value;

  let groupIds = [];
  if (Array.isArray(raw.groupIds)) {
    for (const groupId of raw.groupIds.slice(0, 20)) {
      if (typeof groupId === 'string' && groupId.length > 0 && groupId.length <= limits.maxIdLength) {
        if (!groupIds.includes(groupId)) groupIds.push(groupId);
      } else {
        issue(issues, 'bad-group', 'invalid group id dropped', { index });
      }
    }
  } else if (raw.groupIds !== undefined) {
    issue(issues, 'bad-group', 'groupIds was not an array', { index });
  }
  el.groupIds = groupIds;

  el.points = validatePoints(raw.points, el.type, issues, index, limits);
  if (el.points) {
    boundGeometry(el, issues, index, limits);
  }

  el.containerId =
    typeof raw.containerId === 'string' && raw.containerId.length > 0 ? raw.containerId : null;
  el.startBinding = normalizeBinding(raw.startBinding);
  el.endBinding = normalizeBinding(raw.endBinding);
  if (raw.startBinding && !el.startBinding) issue(issues, 'bad-binding', 'start binding was malformed', { index });
  if (raw.endBinding && !el.endBinding) issue(issues, 'bad-binding', 'end binding was malformed', { index });

  if (el.type === 'text') {
    const text = coerceString(raw.text, '', limits.maxTextLength);
    el.text = text.value;
    if (text.overLimit) {
      issue(
        issues,
        'text-over-limit',
        `text kept at ${text.value.length} characters (editor typing limit ${limits.maxTextLength}); no content was removed`,
        { index, length: text.value.length, limit: limits.maxTextLength },
      );
    }
  } else {
    el.text = null;
  }
  el.imageSrc = null;
  if (el.type === 'image') {
    el.imageSrc = validateImage(raw.imageSrc, issues, index, limits);
    if (!el.imageSrc) return { element: null, issues };
  }

  return { element: el, issues };
}

function normalizeBinding(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const elementId = raw.elementId;
  if (typeof elementId !== 'string' || !elementId.length || elementId.length > DEFAULT_LIMITS.maxIdLength) {
    return null;
  }
  return { elementId };
}

/** Migration registry: each entry upgrades version N to N+1. */
export const MIGRATIONS = Object.freeze({
  1: migrateV1ToV2,
});

function migrateV1ToV2(element) {
  if (!element || typeof element !== 'object') return element;
  const next = { ...element };
  if (next.angle === undefined) next.angle = 0;
  if (!Array.isArray(next.groupIds)) next.groupIds = [];
  if (next.locked === undefined) next.locked = false;
  if (next.edgeStyle === undefined) next.edgeStyle = 'sharp';
  if (next.fontFamily === undefined) next.fontFamily = 'hand';
  if (next.startArrowhead === undefined) next.startArrowhead = 'none';
  if (next.endArrowhead === undefined) next.endArrowhead = next.type === 'arrow' ? 'arrow' : 'none';
  if (next.elbow === undefined) next.elbow = false;
  if (next.imageSrc === undefined) next.imageSrc = null;
  return next;
}

/**
 * Run migrations up to SCHEMA_VERSION. Input may be a bare element array
 * (the oldest save format), {version, elements}, or a corrupt value.
 * Element arrays are capped before migration so hostile data cannot make the
 * migration pass allocate an unbounded result.
 */
export function migrateScene(input, issues = [], limits = DEFAULT_LIMITS) {
  let data = input;
  if (Array.isArray(data)) data = { version: 1, elements: data };
  if (!data || typeof data !== 'object') {
    issue(issues, 'not-a-scene', 'scene is not an object', { severity: 'error' });
    return null;
  }
  const declared = Number.isFinite(data.version) ? data.version : 1;
  if (!Array.isArray(data.elements)) {
    issue(issues, 'no-elements', 'scene has no elements array', { severity: 'error' });
    return null;
  }
  const totalElements = data.elements.length;
  let elements = data.elements;
  if (elements.length > limits.maxElements) {
    issue(issues, 'too-many-elements', `scene truncated to ${limits.maxElements} elements`, {
      severity: 'error',
    });
    elements = elements.slice(0, limits.maxElements);
  }
  if (declared > SCHEMA_VERSION) {
    issue(issues, 'newer-schema', `scene version ${declared} is newer than ${SCHEMA_VERSION}; attempting repair`);
    return { ...data, version: SCHEMA_VERSION, elements, totalElements };
  }
  let version = Math.max(1, Math.floor(declared));
  while (version < SCHEMA_VERSION) {
    const migration = MIGRATIONS[version];
    if (!migration) {
      issue(issues, 'missing-migration', `no migration from schema ${version}`, { severity: 'error' });
      break;
    }
    elements = elements.map((element) => migration(element));
    version += 1;
  }
  return { ...data, version, elements, totalElements };
}

/** Validate the app-state style blob; never let it crash the editor. */
export function validateStyle(raw, issues = []) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined) issue(issues, 'bad-style', 'style blob was not an object');
    return {};
  }
  const style = {};
  const numberKeys = {
    strokeWidth: [2, 1, 100],
    opacity: [100, 0, 100],
    roughness: [1, 0, 2],
    fontSize: [24, 4, 400],
  };
  for (const [key, [fallback, min, max]] of Object.entries(numberKeys)) {
    if (raw[key] !== undefined) style[key] = coerceNumber(raw[key], fallback, { min, max }).value;
  }
  if (raw.strokeColor !== undefined) style.strokeColor = coerceColor(raw.strokeColor, '#1e1e1e', issues, 'bad-style-colour').value;
  if (raw.backgroundColor !== undefined) style.backgroundColor = coerceColor(raw.backgroundColor, 'transparent', issues, 'bad-style-colour').value;
  if (raw.strokeStyle !== undefined) style.strokeStyle = coerceEnum(raw.strokeStyle, STROKE_STYLES, 'solid').value;
  if (raw.edgeStyle !== undefined) style.edgeStyle = coerceEnum(raw.edgeStyle, EDGE_STYLES, 'sharp').value;
  if (raw.fontFamily !== undefined) style.fontFamily = coerceEnum(raw.fontFamily, FONT_FAMILIES, 'hand').value;
  if (raw.startArrowhead !== undefined) style.startArrowhead = coerceEnum(raw.startArrowhead, ARROWHEADS, 'none').value;
  if (raw.endArrowhead !== undefined) style.endArrowhead = coerceEnum(raw.endArrowhead, ARROWHEADS, 'arrow').value;
  if (raw.elbow !== undefined) style.elbow = Boolean(raw.elbow);
  if (raw.theme !== undefined) style.theme = raw.theme === 'dark' ? 'dark' : 'light';
  if (raw.grid !== undefined) style.grid = Boolean(raw.grid);
  if (raw.snap !== undefined) style.snap = Boolean(raw.snap);
  return style;
}

function repairReferences(elements, issues) {
  const byId = new Map(elements.map((el) => [el.id, el]));
  for (let index = 0; index < elements.length; index += 1) {
    const el = elements[index];
    if (el.containerId) {
      const container = byId.get(el.containerId);
      if (!container) {
        issue(issues, 'dangling-container', `text ${el.id} pointed at a missing container`, { index, elementId: el.id });
        el.containerId = null;
      } else if (!CLOSED_TYPES.includes(container.type) || container.id === el.id) {
        issue(issues, 'bad-container', `text ${el.id} container was not a closed shape`, { index, elementId: el.id });
        el.containerId = null;
      }
    }
    for (const key of ['startBinding', 'endBinding']) {
      const binding = el[key];
      if (!binding) continue;
      const target = byId.get(binding.elementId);
      if (!target) {
        issue(issues, 'dangling-binding', `${el.type} ${el.id} binding pointed at a missing element`, {
          index,
          elementId: el.id,
        });
        el[key] = null;
      } else if (!CLOSED_TYPES.includes(target.type) || target.id === el.id) {
        issue(issues, 'bad-binding-target', `${el.type} ${el.id} bound to a non-shape`, { index, elementId: el.id });
        el[key] = null;
      }
    }
  }
}

function dedupeIds(elements, issues, idFactory) {
  const seen = new Set();
  let counter = 0;
  for (let index = 0; index < elements.length; index += 1) {
    const el = elements[index];
    if (!seen.has(el.id)) {
      seen.add(el.id);
      continue;
    }
    let next;
    do {
      counter += 1;
      next = idFactory(counter);
    } while (seen.has(next));
    issue(issues, 'duplicate-id', `duplicate id ${el.id} renamed to ${next}`, {
      index,
      elementId: el.id,
      severity: 'warning',
    });
    el.id = next;
    seen.add(next);
  }
}

/**
 * Validate + repair a complete scene.
 * Returns { ok, scene, issues, stats } — `ok` means a usable scene exists,
 * not that nothing was repaired. `scene` is null only for unusable input.
 */
export function validateScene(input, options = {}) {
  const issues = [];
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const migrated = migrateScene(input, issues, limits);
  if (!migrated) {
    return { ok: false, scene: null, issues, stats: { total: 0, kept: 0, dropped: 0, repaired: 0 } };
  }
  const rawElements = migrated.elements;
  const totalElements = migrated.totalElements ?? rawElements.length;
  let sceneTextChars = 0;
  for (const raw of rawElements) {
    if (raw && typeof raw === 'object' && typeof raw.text === 'string') sceneTextChars += raw.text.length;
  }
  if (sceneTextChars > limits.maxSceneTextChars) {
    issue(
      issues,
      'scene-text-too-large',
      `scene contains ${sceneTextChars} text characters; limit is ${limits.maxSceneTextChars}`,
      { severity: 'error', length: sceneTextChars, limit: limits.maxSceneTextChars },
    );
    return { ok: false, scene: null, issues, stats: { total: totalElements, kept: 0, dropped: 0, repaired: 0 } };
  }
  const elements = [];
  let dropped = 0;
  let remainingPoints = limits.maxScenePoints;
  const idFactory = options.idFactory ?? ((n) => `el_repair_${n.toString(36)}`);
  for (let index = 0; index < Math.min(rawElements.length, limits.maxElements); index += 1) {
    try {
      const raw = rawElements[index];
      let elementLimits = limits;
      if (raw && typeof raw === 'object' && Array.isArray(raw.points)) {
        const allowed = Math.max(0, Math.min(limits.maxPoints, remainingPoints));
        remainingPoints = Math.max(0, remainingPoints - Math.min(raw.points.length, allowed));
        if (raw.points.length > allowed) {
          issue(issues, 'scene-point-budget', `point budget reached; element ${index} points capped at ${allowed}`, {
            index,
            severity: 'warning',
          });
        }
        elementLimits = { ...limits, maxPoints: allowed };
      }
      const { element, issues: elementIssues } = validateElement(raw, {
        index,
        limits: elementLimits,
        idFactory,
        idSeed: index,
      });
      issues.push(...elementIssues);
      if (element) elements.push(element);
      else dropped += 1;
    } catch (error) {
      issue(issues, 'element-validation-failed', `element ${index} could not be validated and was dropped`, {
        index,
        severity: 'error',
        detail: safeText(error?.message ?? error),
      });
      dropped += 1;
    }
  }
  dedupeIds(elements, issues, idFactory);
  repairReferences(elements, issues);

  // A second repair pass: dropping a duplicate/unknown element can leave a
  // group of one, which is harmless but should not pretend to be a group.
  for (const el of elements) {
    if (el.groupIds.length === 1) {
      const members = elements.filter((other) => other.groupIds.includes(el.groupIds[0]));
      if (members.length < 2) el.groupIds = [];
    }
  }

  const style = validateStyle(migrated.style, issues);
  const scene = {
    version: SCHEMA_VERSION,
    elements,
    style,
    theme: migrated.theme === 'dark' ? 'dark' : 'light',
  };
  const repaired = issues.filter((item) => item.severity !== 'error' || item.code !== 'too-many-elements').length;
  return {
    ok: true,
    scene,
    issues,
    stats: { total: totalElements, kept: elements.length, dropped, repaired },
  };
}

/** One-line human summary used by toasts. */
export function describeIssues(issues) {
  if (!issues.length) return '';
  const dropped = issues.filter((item) => item.severity === 'error').length;
  const repaired = issues.length - dropped;
  const parts = [];
  if (repaired) parts.push(`${repaired} repaired`);
  if (dropped) parts.push(`${dropped} dropped`);
  return `${issues.length} scene issue${issues.length === 1 ? '' : 's'} (${parts.join(', ')})`;
}
