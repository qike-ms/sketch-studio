/**
 * Scene model: element defaults, identity, undo/redo, bindings, labels.
 * DOM-free.
 */
import { normalizePoints, resolveConnector, setConnectorFromAbsolute } from './geometry.js';

let idCounter = 0;

export function uid() {
  idCounter += 1;
  return `el_${idCounter.toString(36)}`;
}

export const SCHEMA_VERSION = 1;

export const ELEMENT_DEFAULTS = Object.freeze({
  type: 'rect',
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  strokeColor: '#1e1e1e',
  strokeWidth: 2,
  strokeStyle: 'solid',
  backgroundColor: 'transparent',
  backgroundAlpha: 0.35,
  opacity: 100,
  roughness: 1,
  points: null,
  text: null,
  fontSize: 24,
  lineHeight: 1.25,
  containerId: null,
  startBinding: null,
  endBinding: null,
});

export function makeElement(props = {}) {
  const el = { ...ELEMENT_DEFAULTS };
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) el[key] = value;
  }
  if (props.points) el.points = props.points.map((p) => ({ x: p.x, y: p.y }));
  if (props.startBinding) el.startBinding = { ...props.startBinding };
  if (props.endBinding) el.endBinding = { ...props.endBinding };
  el.id = props.id || uid();
  return normalizePoints(el);
}

export function cloneElement(el) {
  const copy = JSON.parse(JSON.stringify(el));
  copy.id = uid();
  return copy;
}

export class Scene {
  constructor(elements = []) {
    this.elements = elements.map((el) => makeElement(el));
    this.undoStack = [];
    this.redoStack = [];
  }

  findById(id) {
    return this.elements.find((el) => el.id === id) ?? null;
  }

  find = (id) => this.findById(id);

  add(el) {
    const stored = makeElement(el);
    this.elements.push(stored);
    return stored.id;
  }

  idsOf(predicate) {
    return this.elements.filter(predicate).map((el) => el.id);
  }

  /* --- history ---------------------------------------------------------- */

  snapshot() {
    return JSON.stringify(this.elements);
  }

  pushHistory() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.elements = JSON.parse(this.undoStack.pop());
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.elements = JSON.parse(this.redoStack.pop());
    return true;
  }

  /* --- mutations --------------------------------------------------------- */

  applyPositions(moves) {
    for (const move of moves) {
      const el = this.findById(move.id);
      if (!el) continue;
      el.x = move.x;
      el.y = move.y;
    }
    this.syncLabels();
  }

  syncLabels() {
    for (const el of this.elements) {
      if (el.type !== 'text' || !el.containerId) continue;
      const container = this.findById(el.containerId);
      if (!container) {
        el.containerId = null;
        continue;
      }
      el.x = container.x + (container.width - el.width) / 2;
      el.y = container.y + (container.height - el.height) / 2;
    }
  }

  bindLabelTo(textId, containerId) {
    const text = this.findById(textId);
    if (!text || text.type !== 'text') return false;
    text.containerId = containerId ?? null;
    this.syncLabels();
    return true;
  }

  bindConnectorEnd(id, end, elementId) {
    const el = this.findById(id);
    if (!el || !elementId) return false;
    const key = end === 'start' ? 'startBinding' : 'endBinding';
    el[key] = { elementId };
    return true;
  }

  /** Arrow ends follow their objects, so nothing to update on move. */
  refreshConnectors() {
    return this.elements
      .filter((el) => el.startBinding || el.endBinding)
      .map((el) => ({ id: el.id, ends: resolveConnector(el, this.findById.bind(this)) }));
  }

  unbindFrom(elementId) {
    if (!this.findById(elementId)) return;
    for (const el of this.elements) {
      if (!el.startBinding && !el.endBinding) continue;
      const touches =
        el.startBinding?.elementId === elementId || el.endBinding?.elementId === elementId;
      if (!touches) continue;
      // freeze only the doomed end where it currently is; the other end stays linked
      const [start, end] = resolveConnector(el, this.findById.bind(this));
      let touched = false;
      if (el.startBinding?.elementId === elementId) {
        el.startBinding = null;
        touched = true;
      }
      if (el.endBinding?.elementId === elementId) {
        el.endBinding = null;
        touched = true;
      }
      if (touched) setConnectorFromAbsolute(el, start, end);
    }
  }

  removeElements(ids) {
    const doomed = new Set(ids);
    for (const id of ids) this.unbindFrom(id);
    for (const el of this.elements) {
      if (el.containerId && doomed.has(el.containerId)) doomed.add(el.id);
    }
    this.elements = this.elements.filter((el) => !doomed.has(el.id));
    return [...doomed];
  }

  duplicate(ids, dx = 20, dy = 20) {
    const source = this.elements.filter((el) => ids.includes(el.id));
    const copies = source.map((el) => {
      const copy = cloneElement(el);
      copy.x += dx;
      copy.y += dy;
      if (copy.points) copy.points = copy.points.map((p) => ({ ...p }));
      return { from: el, copy };
    });
    const idMap = new Map(copies.map(({ from, copy }) => [from.id, copy.id]));
    for (const { from, copy } of copies) {
      if (copy.containerId) {
        copy.containerId = idMap.get(from.containerId) ?? null;
      }
      for (const key of ['startBinding', 'endBinding']) {
        const binding = copy[key];
        if (!binding) continue;
        const remapped = idMap.get(binding.elementId);
        copy[key] = remapped ? { elementId: remapped } : null;
      }
    }
    this.elements.push(...copies.map(({ copy }) => copy));
    return copies.map(({ copy }) => copy.id);
  }

  /* --- serialisation ----------------------------------------------------- */

  toJSON() {
    return { version: SCHEMA_VERSION, elements: JSON.parse(this.snapshot()) };
  }

  static fromJSON(data) {
    if (!data || !Array.isArray(data.elements)) throw new Error('scene: expected an elements array');
    return new Scene(data.elements);
  }

  loadFrom(data) {
    const next = Scene.fromJSON(data);
    this.elements = next.elements;
    this.undoStack = [];
    this.redoStack = [];
    this.syncLabels();
    return this.elements.map((el) => el.id);
  }
}
