/**
 * Selection → toolbar/properties projection.
 *
 * A single selection shows its real values; an empty selection shows the
 * creation defaults; a mixed selection exposes `mixed: true` instead of
 * pretending every element has the creation default.
 */
import { selectionStyle } from './properties.js';

export const CONTROL_KEYS = Object.freeze([
  'strokeStyle',
  'strokeColor',
  'backgroundColor',
  'fontSize',
  'strokeWidth',
  'opacity',
  'roughness',
  'edgeStyle',
  'fontFamily',
  'startArrowhead',
  'endArrowhead',
  'elbow',
]);

export function selectionControls(elements, ids, state) {
  const style = selectionStyle(elements, ids);
  const controls = {};
  const mixed = {};
  for (const key of CONTROL_KEYS) {
    if (style.count === 0) {
      controls[key] = state[key];
      mixed[key] = false;
    } else if (style[key] !== undefined) {
      controls[key] = style[key];
      mixed[key] = false;
    } else {
      controls[key] = undefined;
      mixed[key] = true;
    }
  }
  return { style, controls, mixed };
}
