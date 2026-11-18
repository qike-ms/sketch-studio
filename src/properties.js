/**
 * Properties panel maths: what a mixed selection shows, and how a style patch
 * applies to every selected (unlocked) element.
 */
import { validateStyle } from './schema.js';

export const STYLE_KEYS = Object.freeze([
  'strokeColor',
  'backgroundColor',
  'strokeWidth',
  'strokeStyle',
  'opacity',
  'roughness',
  'edgeStyle',
  'fontFamily',
  'fontSize',
  'startArrowhead',
  'endArrowhead',
]);

export function commonValue(values) {
  if (!values.length) return undefined;
  const first = values[0];
  return values.every((value) => value === first) ? first : undefined;
}

/** Common style values for a selection; undefined means "mixed". */
export function selectionStyle(elements, ids) {
  const chosen = elements.filter((el) => ids.includes(el.id));
  const result = {};
  for (const key of STYLE_KEYS) {
    result[key] = commonValue(chosen.map((el) => el[key]));
  }
  result.count = chosen.length;
  result.locked = chosen.length > 0 && chosen.every((el) => el.locked);
  result.angle = commonValue(chosen.map((el) => el.angle ?? 0));
  result.grouped = chosen.some((el) => (el.groupIds ?? []).length > 0);
  result.types = [...new Set(chosen.map((el) => el.type))];
  return result;
}

/** Validate a style patch, dropping keys the schema does not know. */
export function cleanStylePatch(patch) {
  const cleaned = validateStyle(patch);
  const style = {};
  for (const key of STYLE_KEYS) {
    if (cleaned[key] !== undefined) style[key] = cleaned[key];
  }
  return style;
}

/** Apply a style patch to unlocked selected elements. Returns changed ids. */
export function applyStyle(elements, ids, patch) {
  const cleaned = cleanStylePatch(patch);
  const chosen = new Set(ids);
  const changed = [];
  for (const el of elements) {
    if (!chosen.has(el.id) || el.locked) continue;
    let touched = false;
    for (const [key, value] of Object.entries(cleaned)) {
      if (key === 'theme' || key === 'grid' || key === 'snap') continue;
      if (el[key] !== value) {
        el[key] = value;
        touched = true;
      }
    }
    if (touched) changed.push(el.id);
  }
  return changed;
}

export function setAngle(elements, ids, angle) {
  if (!Number.isFinite(angle)) return [];
  const chosen = new Set(ids);
  const changed = [];
  const value = ((angle % 360) + 360) % 360;
  for (const el of elements) {
    if (!chosen.has(el.id) || el.locked) continue;
    if (el.angle !== value) {
      el.angle = value;
      changed.push(el.id);
    }
  }
  return changed;
}

export function selectionLabel(style) {
  if (!style || !style.count) return 'Nothing selected';
  if (style.count === 1) return `1 ${style.types[0] ?? 'element'}`;
  return `${style.count} elements`;
}
