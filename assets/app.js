/**
 * Sketch Studio — app layer.
 *
 * Interaction math lives in src/ (DOM-free, unit-tested); this file owns the
 * canvas, the pointer gestures, the toolbar and persistence.
 */
import { Scene, makeElement } from '../src/scene.js';
import * as geo from '../src/geometry.js';
import * as tools from '../src/tools.js';
import * as paint from './render.js';

const STORE_KEY = 'sketch-studio:v1';
const MIN_STROKE = 2;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const state = {
  tool: 'select',
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 100,
  roughness: 1,
  fontSize: 24,
};

const scene = new Scene();
let dpr = 1;
let cssWidth = 0;
let cssHeight = 0;

let selection = [];
let draft = null;
let editing = null; // { id, caret }
let gesture = null; // active pointer gesture
let marquee = null;
let colorPicker = null;

const find = (id) => scene.findById(id);

/* --------------------------------------------------------------- viewport */

function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  cssWidth = Math.max(1, Math.round(rect.width));
  cssHeight = Math.max(1, Math.round(rect.height));
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint.drawGrid(ctx, cssWidth, cssHeight);

  for (const el of scene.elements) {
    if (editing && el.id === editing.id) {
      paint.drawElement(ctx, el, find, { index: editing.caret });
    } else {
      paint.drawElement(ctx, el, find);
    }
  }
  if (draft) paint.drawElement(ctx, draft, find);

  const selected = selection.map((id) => find(id)).filter(Boolean);
  paint.drawSelection(ctx, selected, find);
  paint.drawLinkDots(ctx, scene.elements, find);
  if (gesture && gesture.mode === 'marquee') paint.drawMarquee(ctx, marquee);
  if (selected.length) paint.drawHandles(ctx, selected, find);
}

/* ------------------------------------------------------------- selection */

function setSelection(ids) {
  selection = ids.filter((id) => Boolean(find(id)));
}

function selectedElements() {
  return selection.map((id) => find(id)).filter(Boolean);
}

function pruneSelection() {
  selection = selection.filter((id) => Boolean(find(id)));
}

/* --------------------------------------------------------------- status */

function toolLabel() {
  const entry = tools.TOOLS.find((item) => item.tool === state.tool);
  return entry ? entry.label : state.tool;
}

function setStatusHint(text) {
  document.getElementById('statusTool').textContent = toolLabel();
  document.getElementById('statusHint').textContent = text;
}

const HINTS = {
  select: 'drag to move · shift = multi-select · handles resize',
  rect: 'drag a box · shift = square',
  ellipse: 'drag an oval · shift = circle',
  diamond: 'drag a diamond · shift = even',
  line: 'drag a line · shift = snap 15°',
  arrow: 'start/end on a shape to link the two objects',
  freehand: 'draw freehand · shift held does nothing',
  eraser: 'drag over strokes to delete them',
  text: 'type · Enter = newline · Esc = commit',
};

/* ------------------------------------------------------------ persistence */

function save() {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({ version: 1, elements: scene.elements, style: state }),
  );
}

function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.style) Object.assign(state, data.style);
    if (data.elements) scene.loadFrom({ elements: data.elements });
  } catch (error) {
    console.warn('sketch-studio: could not restore session', error.message);
  }
}

/* ------------------------------------------------------------ gestures */

function pointAt(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function isTrivial(el) {
  if (el.type === 'freehand') return el.points.length < 2;
  if (el.type === 'line' || el.type === 'arrow') {
    const [start, end] = geo.resolveConnector(el, find);
    return geo.distance(start, end) < MIN_STROKE;
  }
  if (el.type === 'text') return !el.text;
  return el.width < 2 && el.height < 2;
}

function commitDraft() {
  const el = draft;
  draft = null;
  if (isTrivial(el)) {
    render();
    return;
  }
  const id = scene.add(el);
  if (el.type === 'text') {
    paint.measureText(el);
  }
  setSelection([id]);
  rebindFreeConnectorEnds();
  scene.syncLabels();
  save();
}

/** Connector ends dropped on top of a shape become real links. */
function rebindFreeConnectorEnds() {
  for (const el of scene.elements) {
    if (el.type !== 'line' && el.type !== 'arrow') continue;
    const [start, end] = geo.resolveConnector(el, find);
    const startTarget = el.startBinding
      ? el.startBinding.elementId
      : tools.bindingTargetAt(scene.elements, start, [el.id]);
    const endTarget = el.endBinding
      ? el.endBinding.elementId
      : tools.bindingTargetAt(scene.elements, end, [el.id]);
    if (startTarget && startTarget === endTarget) {
      scene.bindConnectorEnd(el.id, 'start', startTarget);
      scene.bindConnectorEnd(el.id, 'end', null);
    } else {
      if (startTarget) scene.bindConnectorEnd(el.id, 'start', startTarget);
      if (endTarget) scene.bindConnectorEnd(el.id, 'end', endTarget);
    }
  }
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  if (editing) finishEditing();
  const point = pointAt(event);
  canvas.setPointerCapture(event.pointerId);

  if (state.tool === 'text') {
    startText(point, geo.elementAt(scene.elements, point, find));
    render();
    return;
  }

  if (state.tool === 'eraser') {
    scene.pushHistory();
    gesture = { mode: 'erase', last: point };
    const hits = tools.eraseHits(scene.elements, point, point, find);
    if (hits.length) scene.removeElements(hits);
    gesture.last = point;
    render();
    return;
  }

  if (state.tool !== 'select') {
    scene.pushHistory();
    gesture = { mode: 'draw', tool: state.tool, start: point };
    draft = tools.createDraft(state.tool, point, state);
    render();
    return;
  }

  // select tool -------------------------------------------------------------
  if (selection.length === 1) {
    const only = find(selection[0]);
    if (only && (only.type === 'line' || only.type === 'arrow')) {
      const handle = tools.connectorHandleAt(only, find, point);
      if (handle) {
        scene.pushHistory();
        gesture = { mode: 'endpoint', id: only.id, end: handle };
        render();
        return;
      }
    }
    if (only) {
      const handle = tools.handleAt(geo.resolvedRect(only, find), point);
      if (handle) {
        scene.pushHistory();
        gesture = {
          mode: 'resize',
          id: only.id,
          handle,
          start: point,
          rect: geo.resolvedRect(only, find),
          points: only.points ? only.points.map((p) => ({ ...p })) : null,
        };
        render();
        return;
      }
    }
  }

  const hit = geo.elementAt(scene.elements, point, find);
  if (hit) {
    scene.pushHistory();
    setSelection(tools.toggleSelection(selection, hit.id, event.shiftKey));
    // a label dragged away from an unselected container is unbound
    for (const el of selectedElements()) {
      if (el.type === 'text' && el.containerId && !selection.includes(el.containerId)) {
        el.containerId = null;
      }
    }
    gesture = {
      mode: 'move',
      origin: point,
      start: selectedElements().map((el) => ({ id: el.id, x: el.x, y: el.y })),
    };
    render();
    return;
  }

  scene.pushHistory();
  if (!event.shiftKey) setSelection([]);
  gesture = { mode: 'marquee', start: point, base: event.shiftKey ? selection.slice() : [] };
  marquee = { x: point.x, y: point.y, width: 0, height: 0 };
  render();
}

function onPointerMove(event) {
  if (!gesture) return;
  const point = pointAt(event);

  switch (gesture.mode) {
    case 'draw':
      draft = tools.updateDraft(draft, gesture.tool, gesture.start, point, event.shiftKey);
      break;

    case 'erase': {
      const hits = tools.eraseHits(scene.elements, gesture.last, point, find);
      if (hits.length) scene.removeElements(hits);
      gesture.last = point;
      break;
    }

    case 'move': {
      const dx = point.x - gesture.origin.x;
      const dy = point.y - gesture.origin.y;
      if (dx || dy) {
        scene.applyPositions(
          gesture.start.map((move) => ({ id: move.id, x: move.x + dx, y: move.y + dy })),
        );
      }
      break;
    }

    case 'resize': {
      const el = find(gesture.id);
      if (!el) return;
      const next = tools.resizeRect(
        gesture.rect,
        gesture.handle,
        point.x - gesture.start.x,
        point.y - gesture.start.y,
        event.shiftKey,
      );
      if (gesture.points) {
        const ratioX = next.width / (gesture.rect.width || 1);
        const ratioY = next.height / (gesture.rect.height || 1);
        el.points = tools.scalePoints(gesture.points, ratioX, ratioY);
      }
      Object.assign(el, { x: next.x, y: next.y, width: next.width, height: next.height });
      break;
    }

    case 'endpoint': {
      const el = find(gesture.id);
      if (!el) return;
      tools.moveConnectorEnd(el, find, gesture.end, point);
      break;
    }

    case 'marquee':
      marquee = geo.normRect(gesture.start.x, gesture.start.y, point.x, point.y);
      setSelection(tools.marqueeSelection(gesture.base, scene.elements, marquee, event.shiftKey));
      break;

    default:
      return;
  }
  render();
}

function onPointerUp() {
  if (!gesture) return;
  const mode = gesture.mode;
  if (mode === 'draw') commitDraft();
  gesture = null;
  marquee = null;
  scene.syncLabels();
  if (mode === 'move' || mode === 'endpoint') rebindFreeConnectorEnds();
  pruneSelection();
  save();
  render();
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', () => {
  gesture = null;
  draft = null;
  marquee = null;
  render();
});

/* ----------------------------------------------------------- text entry */

function startText(point, hit) {
  scene.pushHistory();
  if (hit && hit.type === 'text') {
    editing = { id: hit.id, caret: String(hit.text ?? '').length };
    setSelection([hit.id]);
    return;
  }
  const container = hit && geo.isContainer(hit) ? hit : null;
  const el = makeElement({
    type: 'text',
    text: '',
    x: point.x,
    y: point.y - (state.fontSize * 1.25) / 2,
    fontSize: state.fontSize,
    strokeColor: state.strokeColor,
  });
  const id = scene.add(el);
  if (container) scene.bindLabelTo(id, container.id);
  editing = { id, caret: 0 };
  setSelection([id]);
}

function typeAtCaret(character) {
  const el = find(editing.id);
  if (!el) return;
  const text = String(el.text ?? '');
  el.text = text.slice(0, editing.caret) + character + text.slice(editing.caret);
  editing.caret += character.length;
  paint.measureText(el);
}

function deleteAtCaret(forward = false) {
  const el = find(editing.id);
  if (!el) return;
  const text = String(el.text ?? '');
  if (!text.length) return;
  const index = forward ? editing.caret : Math.max(0, editing.caret - 1);
  if (forward && index >= text.length) return;
  el.text = text.slice(0, index) + text.slice(index + 1);
  if (!forward) editing.caret = index;
  paint.measureText(el);
}

function finishEditing() {
  if (!editing) return;
  const el = find(editing.id);
  editing = null;
  if (!el) return;
  paint.measureText(el);
  if (!String(el.text).trim()) {
    scene.removeElements([el.id]);
    setSelection([]);
  } else if (!el.containerId) {
    const centre = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    const container = geo.containerAt(scene.elements, centre);
    if (container) scene.bindLabelTo(el.id, container.id);
  }
  save();
}

/* ------------------------------------------------------------- commands */

function undoAction() {
  if (!scene.undo()) return;
  pruneSelection();
  save();
  render();
}

function redoAction() {
  if (!scene.redo()) return;
  pruneSelection();
  save();
  render();
}

function deleteSelection() {
  if (!selection.length) return;
  scene.pushHistory();
  scene.removeElements(selection.slice());
  setSelection([]);
  save();
  render();
}

function duplicateSelection() {
  if (!selection.length) return;
  scene.pushHistory();
  const ids = scene.duplicate(selection.slice());
  setSelection(ids);
  save();
  render();
}

function bringToFront() {
  if (!selection.length) return;
  scene.pushHistory();
  const chosen = selectedElements();
  scene.elements = scene.elements.filter((el) => !selection.includes(el.id));
  scene.elements.push(...chosen);
  save();
  render();
}

function clearCanvas() {
  if (!scene.elements.length) return;
  scene.pushHistory();
  scene.elements = [];
  setSelection([]);
  save();
  render();
}

function contentBounds() {
  let box = null;
  for (const el of scene.elements) {
    const rect = geo.resolvedRect(el, find);
    if (!box) {
      box = { ...rect };
      continue;
    }
    const left = Math.min(box.x, rect.x);
    const top = Math.min(box.y, rect.y);
    const right = Math.max(box.x + box.width, rect.x + rect.width);
    const bottom = Math.max(box.y + box.height, rect.y + rect.height);
    box = { x: left, y: top, width: right - left, height: bottom - top };
  }
  return box;
}

function download(name, blobUrl) {
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = name;
  link.click();
}

function exportPNG() {
  if (!scene.elements.length) return;
  const bounds = contentBounds();
  const pad = 32;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = Math.ceil((bounds.width + pad * 2) * dpr);
  exportCanvas.height = Math.ceil((bounds.height + pad * 2) * dpr);
  const ex = exportCanvas.getContext('2d');
  ex.setTransform(dpr, 0, 0, dpr, 0, 0);
  ex.fillStyle = '#ffffff';
  ex.fillRect(0, 0, bounds.width + pad * 2, bounds.height + pad * 2);
  ex.setTransform(dpr, 0, 0, dpr, (pad - bounds.x) * dpr, (pad - bounds.y) * dpr);
  for (const el of scene.elements) paint.drawElement(ex, el, find);
  download('sketch-studio.png', exportCanvas.toDataURL('image/png'));
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(scene.toJSON(), null, 2)], {
    type: 'application/json',
  });
  download('sketch-studio.json', URL.createObjectURL(blob));
}

function openJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.className = 'filepicker';
  const label = document.createElement('label');
  label.className = 'filelabel';
  label.textContent = 'Pick a sketch-studio.json file';
  const holder = document.createElement('div');
  holder.className = 'filedialog';
  holder.append(label, input);
  document.querySelector('.stage').append(holder);
  input.addEventListener('change', () => {
    const file = input.files[input.files.length - 1];
    if (!file) return;
    file.text().then((text) => {
      try {
        scene.loadFrom(JSON.parse(text));
      } catch (error) {
        console.warn('sketch-studio: bad scene file', error.message);
      }
      setSelection([]);
      save();
      render();
      holder.remove();
    });
  });
}

/* ------------------------------------------------------------ shortcuts */

function onKeyDown(event) {
  if (editing) {
    if (!find(editing.id)) {
      editing = null;
      return;
    }
    if (event.metaKey || event.ctrlKey) return;
    if (event.key === 'Escape') {
      finishEditing();
      render();
      return;
    }
    if (event.key === 'Enter') typeAtCaret('\n');
    else if (event.key === 'Backspace') deleteAtCaret(false);
    else if (event.key === 'Delete') deleteAtCaret(true);
    else if (event.key === 'ArrowLeft') editing.caret = Math.max(0, editing.caret - 1);
    else if (event.key === 'ArrowRight') {
      editing.caret = Math.min(String(find(editing.id).text ?? '').length, editing.caret + 1);
    } else if (event.key.length === 1) typeAtCaret(event.key);
    else return;
    event.preventDefault();
    render();
    return;
  }

  const meta = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (meta && key === 'z') {
    event.shiftKey ? redoAction() : undoAction();
    return;
  }
  if (meta && key === 'y') return redoAction();
  if (meta && key === 'a') {
    setSelection(scene.elements.map((el) => el.id));
    render();
    return;
  }
  if (meta && key === 'd') return duplicateSelection();
  if (key === 'delete' || key === 'backspace') return deleteSelection();
  if (key === 'escape') {
    if (draft) {
      draft = null;
      gesture = null;
    }
    setSelection([]);
    render();
    return;
  }
  const tool = tools.toolFromShortcut(key);
  if (tool) setTool(tool);
}

function syncToolButtons() {
  for (const button of document.querySelectorAll('[data-tool]')) {
    button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
  }
}

/** Reflect current state in every toolbar group (tools, stroke, ink, fill, text). */
function syncPressed(gridId, key, value) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  for (const button of grid.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset[key] === value));
  }
}

function syncToolbar() {
  syncToolButtons();
  syncPressed('strokeStyleGrid', 'style', state.strokeStyle);
  syncPressed('colorGrid', 'color', state.strokeColor);
  syncPressed('fillGrid', 'fill', state.backgroundColor);
  syncPressed('fontSizeGrid', 'size', String(state.fontSize));
  if (colorPicker) {
    colorPicker.setAttribute(
      'aria-pressed',
      String(!tools.PALETTE.includes(state.strokeColor)),
    );
  }
}

function setTool(tool) {
  if (!tools.TOOLS.some((entry) => entry.tool === tool)) return;
  if (editing) finishEditing();
  state.tool = tool;
  syncToolbar();
  setStatusHint(HINTS[tool] ?? '');
  render();
}

document.addEventListener('keydown', onKeyDown);

/* ------------------------------------------------------------- toolbar */

function buildSwatchGrid(containerId, colors, key, apply) {
  const container = document.getElementById(containerId);
  for (const color of colors) {
    const button = document.createElement('button');
    button.className = 'cell swatch';
    button.dataset[key] = color;
    button.title = color;
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--swatch', color);
    button.style.background = color === 'transparent' ? '#fff' : color;
    if (color === 'transparent') {
      const span = document.createElement('span');
      span.textContent = 'none';
      button.append(span);
    }
    button.addEventListener('click', () => {
      apply(color);
      syncToolbar();
      save();
    });
    container.append(button);
  }
}

buildSwatchGrid('colorGrid', tools.PALETTE, 'color', (color) => {
  state.strokeColor = color;
});

buildSwatchGrid(
  'fillGrid',
  ['transparent', ...tools.PALETTE.slice(0, 8)],
  'fill',
  (color) => {
    state.backgroundColor = color;
  },
);

const sizeGrid = document.getElementById('fontSizeGrid');
for (const size of tools.TEXT_SIZES) {
  const button = document.createElement('button');
  button.className = 'cell';
  button.dataset.size = String(size);
  button.title = `${size}px text`;
  button.setAttribute('aria-pressed', 'false');
  const label = document.createElement('span');
  label.className = 'hint';
  label.textContent = `${size}px`;
  button.append(label);
  button.addEventListener('click', () => {
    state.fontSize = size;
    syncToolbar();
    save();
  });
  sizeGrid.append(button);
}

for (const button of document.querySelectorAll('[data-style]')) {
  button.addEventListener('click', () => {
    state.strokeStyle = button.dataset.style;
    syncToolbar();
    save();
  });
}

/* tool cells: clicking one selects that drawing tool */
for (const button of document.querySelectorAll('[data-tool]')) {
  button.addEventListener('click', () => setTool(button.dataset.tool));
}

document.getElementById('strokeWidth').addEventListener('input', (event) => {
  state.strokeWidth = Number(event.target.value);
  save();
});

colorPicker = document.createElement('input');
colorPicker.type = 'color';
colorPicker.className = 'picker';
colorPicker.value = state.strokeColor;
colorPicker.title = 'Pick any ink colour';
colorPicker.addEventListener('change', () => {
  state.strokeColor = colorPicker.value;
  syncToolbar();
  save();
});
document.getElementById('colorGrid').append(colorPicker);

document.getElementById('undoBtn').addEventListener('click', undoAction);
document.getElementById('redoBtn').addEventListener('click', redoAction);
document.getElementById('dupBtn').addEventListener('click', duplicateSelection);
document.getElementById('frontBtn').addEventListener('click', bringToFront);
document.getElementById('pngBtn').addEventListener('click', exportPNG);
document.getElementById('jsonBtn').addEventListener('click', exportJSON);
document.getElementById('openBtn').addEventListener('click', openJSON);
document.getElementById('clearBtn').addEventListener('click', clearCanvas);

/* ---------------------------------------------------------------- boot */

window.addEventListener('resize', () => {
  fitCanvas();
  render();
});

fitCanvas();
restore();
syncToolbar();
setStatusHint(HINTS[state.tool] ?? '');
render();

// Exposed for automation and debugging; nothing on the page depends on it.
window.sketchStudio = {
  scene,
  state,
  setTool,
  selectionOf: () => selection.slice(),
  bounds: contentBounds,
  linkEnds: () =>
    scene.elements
      .filter((el) => el.type === 'arrow' || el.type === 'line')
      .map((el) => ({
        id: el.id,
        ends: geo.resolveConnector(el, find),
        bound: [el.startBinding?.elementId ?? null, el.endBinding?.elementId ?? null],
      })),
  texts: () =>
    scene.elements
      .filter((el) => el.type === 'text')
      .map((el) => ({ id: el.id, text: el.text, containerId: el.containerId })),
};
