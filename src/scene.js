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

export const SCHEMA_VERSION = 2;

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
  angle: 0,
  groupIds: [],
  locked: false,
  edgeStyle: 'sharp',
  fontFamily: 'hand',
  startArrowhead: 'none',
  endArrowhead: 'none',
  elbow: false,
  imageSrc: null,
});

export function makeElement(props = {}) {
  const el = { ...ELEMENT_DEFAULTS };
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) el[key] = value;
  }
  if (props.points) el.points = props.points.map((p) => ({ x: p.x, y: p.y }));
  if (props.startBinding) el.startBinding = { ...props.startBinding };
  if (props.endBinding) el.endBinding = { ...props.endBinding };
  el.groupIds = Array.isArray(props.groupIds) ? [...props.groupIds] : [];
  el.id = props.id || uid();
  return normalizePoints(el);
}

export function cloneElement(el) {
  const copy = JSON.parse(JSON.stringify(el));
  copy.id = uid();
  return copy;
}

export const DEFAULT_HISTORY_LIMIT = 100;

function parseSnapshot(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export class Scene {
  constructor(elements = [], options = {}) {
    this.elements = elements.map((el) => makeElement(el));
    this.undoStack = [];
    this.redoStack = [];
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.historyIssues = [];
  }

  setHistoryLimit(limit) {
    this.historyLimit = Math.max(1, Math.floor(limit));
    while (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    while (this.redoStack.length > this.historyLimit) this.redoStack.shift();
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
    try {
      return JSON.stringify(this.elements);
    } catch {
      return null;
    }
  }

  pushHistory() {
    const snapshot = this.snapshot();
    if (!snapshot) return false;
    this.undoStack.push(snapshot);
    while (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }

  /** Skip corrupt history entries; never replace the scene with garbage. */
  popValid(stack, label) {
    while (stack.length) {
      const raw = stack.pop();
      const parsed = parseSnapshot(raw);
      if (parsed) return parsed;
      this.historyIssues.push({ stack: label, code: 'corrupt-history', message: 'corrupt history entry skipped' });
      if (this.historyIssues.length > 20) this.historyIssues.shift();
    }
    return null;
  }

  undo() {
    const current = this.snapshot();
    if (!current) return false;
    const next = this.popValid(this.undoStack, 'undo');
    if (!next) return false;
    this.redoStack.push(current);
    while (this.redoStack.length > this.historyLimit) this.redoStack.shift();
    this.elements = next;
    return true;
  }

  redo() {
    const current = this.snapshot();
    if (!current) return false;
    const next = this.popValid(this.redoStack, 'redo');
    if (!next) return false;
    this.undoStack.push(current);
    while (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.elements = next;
    return true;
  }

  historySize() {
    return { undo: this.undoStack.length, redo: this.redoStack.length, limit: this.historyLimit };
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
    if (!el) return false;
    const key = end === 'start' ? 'startBinding' : 'endBinding';
    el[key] = elementId ? { elementId } : null;
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
