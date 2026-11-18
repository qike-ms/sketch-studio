/**
 * Sketch Studio — app layer.
 *
 * Interaction maths lives in src/ (DOM-free, unit-tested); this file owns the
 * canvas, pointer gestures, toolbar, properties panel, persistence and the
 * global error boundary.
 */
import { Scene, SCHEMA_VERSION, makeElement, uid } from '../src/scene.js';
import * as geo from '../src/geometry.js';
import * as tools from '../src/tools.js';
import * as paint from './render.js';
import * as schema from '../src/schema.js';
import * as persistenceModule from '../src/persistence.js';
import * as importer from '../src/import.js';
import * as errors from '../src/errors.js';
import { Viewport, zoomLabel } from '../src/viewport.js';
import * as arrange from '../src/arrange.js';
import * as clipboard from '../src/clipboard.js';
import * as textLib from '../src/text.js';
import * as exporter from '../src/export.js';
import * as images from '../src/images.js';
import * as props from '../src/properties.js';

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
  edgeStyle: 'sharp',
  fontFamily: 'hand',
  fontSize: 24,
  startArrowhead: 'none',
  endArrowhead: 'arrow',
  elbow: false,
  theme: 'light',
  grid: true,
  snap: false,
};

const scene = new Scene([], { historyLimit: 100 });
const viewport = new Viewport({ gridSize: 24 });

let dpr = 1;
let cssWidth = 0;
let cssHeight = 0;

let selection = [];
let draft = null;
let editing = null; // { id, caret }
let gesture = null;
let marquee = null;
let colorPicker = null;
let spaceDown = false;
let dirty = false;
let conflictPending = false;
let conflictScene = null;
let lastPointerScene = null;
let lastStorageWarning = '';
let textLimitWarned = false;
const touchPoints = new Map();
const reportedRenderErrors = new Set();

const find = (id) => scene.findById(id);

/* ------------------------------------------------------------- storage */

function browserStorage() {
  // The factory also guards this, but resolving here keeps the app boot path
  // inside a try/catch before the toast/error boundary exists.
  return persistenceModule.resolveStorage(window);
}

const persistence = persistenceModule.createPersistence({ storage: browserStorage() });
const toaster = errors.createToastStore({ max: 5 });

function toast(message, kind = 'info', detail = null, action = null) {
  return toaster.push(message, { kind, detail, action });
}

const boundary = errors.createErrorBoundary({
  logger: console,
  onError: ({ label, message }) => {
    toast(`Something went wrong (${label}). Your drawing is safe.`, 'error', message, [
      { label: 'Export recovery JSON', run: exportRecovery },
    ]);
  },
});

/* --------------------------------------------------------------- viewport */

function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  cssWidth = Math.max(1, Math.round(rect.width));
  cssHeight = Math.max(1, Math.round(rect.height));
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
}

function applyTransform(context = ctx) {
  const zoom = viewport.zoom;
  context.setTransform(
    dpr * zoom, 0, 0, dpr * zoom,
    -viewport.pan.x * zoom * dpr,
    -viewport.pan.y * zoom * dpr,
  );
}

function updateZoomIndicator() {
  const indicator = document.getElementById('zoomIndicator');
  if (indicator) indicator.textContent = zoomLabel(viewport.zoom);
}

function contentBounds(ids = null) {
  return exporter.contentBounds(scene.elements, find, ids);
}

function zoomToFit(ids = null) {
  const bounds = contentBounds(ids);
  if (!bounds) {
    toast('Nothing to fit yet.', 'info');
    return;
  }
  viewport.fit(bounds, { width: cssWidth, height: cssHeight }, 80);
  updateZoomIndicator();
  safeRender();
}

function resetZoom() {
  viewport.setZoom(1, { x: cssWidth / 2, y: cssHeight / 2 });
  updateZoomIndicator();
  safeRender();
}

/* --------------------------------------------------------------- render */

function safeRender() {
  boundary.guard(render, 'render');
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  applyTransform(ctx);

  const visible = viewport.visibleRect({ width: cssWidth, height: cssHeight });
  if (state.grid) paint.drawGrid(ctx, visible, { theme: state.theme, zoom: viewport.zoom, gridSize: viewport.gridSize });

  for (const el of scene.elements) {
    try {
      if (editing && el.id === editing.id) {
        paint.drawElement(ctx, el, find, { index: editing.caret });
      } else {
        paint.drawElement(ctx, el, find);
      }
    } catch (error) {
      const key = `${el.id}:${errors.describeError(error)}`;
      if (!reportedRenderErrors.has(key)) {
        reportedRenderErrors.add(key);
        boundary.report(error, `render:${el.id}`);
      }
    }
  }
  if (draft) {
    try {
      paint.drawElement(ctx, draft, find);
    } catch (error) {
      boundary.report(error, 'render:draft');
    }
  }

  const selected = selection.map((id) => find(id)).filter(Boolean);
  paint.drawSelection(ctx, selected, find, { theme: state.theme, zoom: viewport.zoom });
  paint.drawLinkDots(ctx, scene.elements, find, { theme: state.theme, zoom: viewport.zoom });
  if (gesture && gesture.mode === 'marquee' && marquee) {
    paint.drawMarquee(ctx, marquee, { theme: state.theme, zoom: viewport.zoom });
  }
  if (selected.length) {
    paint.drawHandles(ctx, selected, find, {
      theme: state.theme,
      zoom: viewport.zoom,
      showRotation: selected.length === 1,
    });
  }
  updateZoomIndicator();
}

/* ------------------------------------------------------------- selection */

function setSelection(ids) {
  selection = arrange.expandGroups(scene.elements, ids).filter((id) => Boolean(find(id)));
  updateProperties();
}

function selectedElements() {
  return selection.map((id) => find(id)).filter(Boolean);
}

function pruneSelection() {
  selection = selection.filter((id) => Boolean(find(id)));
  updateProperties();
}

function toggleHit(hit, shift) {
  const groupIds = hit.groupIds ?? [];
  const members = groupIds.length
    ? scene.elements.filter((el) => (el.groupIds ?? []).some((groupId) => groupIds.includes(groupId))).map((el) => el.id)
    : [hit.id];
  if (!shift) {
    selection = members;
  } else if (members.every((id) => selection.includes(id))) {
    selection = selection.filter((id) => !members.includes(id));
  } else {
    selection = [...new Set([...selection, ...members])];
  }
  updateProperties();
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
  select: 'drag to move · shift = multi-select · handles resize · space/middle = pan · ctrl-wheel = zoom',
  rect: 'drag a box · shift = square · G = grid · S = snap',
  ellipse: 'drag an oval · shift = circle',
  diamond: 'drag a diamond · shift = even',
  line: 'drag a line · shift = snap 15° · double-click to add a bend',
  arrow: 'start/end on a shape to link the two objects · double-click to add a bend',
  freehand: 'draw freehand · shift held does nothing',
  eraser: 'drag over strokes to delete them',
  text: 'type · Enter = newline · Esc = commit · double-click a shape for its label',
};

/* ------------------------------------------------------------ persistence */

function snapshotStyle() {
  return {
    strokeColor: state.strokeColor,
    backgroundColor: state.backgroundColor,
    strokeWidth: state.strokeWidth,
    strokeStyle: state.strokeStyle,
    opacity: state.opacity,
    roughness: state.roughness,
    edgeStyle: state.edgeStyle,
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    startArrowhead: state.startArrowhead,
    endArrowhead: state.endArrowhead,
    theme: state.theme,
    grid: state.grid,
    snap: state.snap,
  };
}

function snapshotData() {
  return {
    version: SCHEMA_VERSION,
    elements: JSON.parse(JSON.stringify(scene.elements)),
    style: snapshotStyle(),
    theme: state.theme,
  };
}

function setSaveStatus(text) {
  const el = document.getElementById('saveStatus');
  if (el) el.textContent = text;
}

function scheduleSave() {
  dirty = true;
  if (conflictPending) {
    setSaveStatus('Conflict — choose a version');
    return;
  }
  persistence.schedule(snapshotData());
  setSaveStatus('Unsaved…');
}

function saveNow(options = {}) {
  if (conflictPending) return null;
  const result = persistence.save(snapshotData(), options);
  if (result.ok) {
    dirty = false;
    setSaveStatus('Saved');
  } else if (result.quota) {
    setSaveStatus('Storage full — in memory');
    if (lastStorageWarning !== 'quota') {
      lastStorageWarning = 'quota';
      toast('Storage is full. Changes stay in memory; export JSON to be safe.', 'warning');
    }
  } else if (result.unavailable) {
    setSaveStatus('Storage unavailable — in memory');
    if (lastStorageWarning !== 'unavailable') {
      lastStorageWarning = 'unavailable';
      toast('Browser storage is unavailable. Changes stay in memory; export JSON to be safe.', 'warning');
    }
  } else {
    setSaveStatus('Save failed');
    toast(result.error ?? 'Could not save the drawing.', 'error');
  }
  return result;
}

function applyLoadedScene(loaded, source) {
  scene.loadFrom({ version: loaded.version ?? SCHEMA_VERSION, elements: loaded.elements });
  const style = schema.validateStyle(loaded.style ?? {});
  for (const [key, value] of Object.entries(style)) {
    if (key in state) state[key] = value;
  }
  state.theme = loaded.theme === 'dark' ? 'dark' : (style.theme ?? 'light');
  document.body.classList.toggle('dark', state.theme === 'dark');
  selection = [];
  dirty = false;
  refreshTextMetrics();
  syncToolbar();
  updateProperties();
  setSaveStatus(source === 'current' ? 'Restored' : `Recovered (${source})`);
  safeRender();
}

function restore() {
  const result = boundary.guard(() => persistence.load(), 'restore');
  const loaded = result.value;
  if (!loaded) return;
  if (loaded.unavailable) {
    toast('Storage is unavailable; this session will not autosave.', 'warning', loaded.reason);
    return;
  }
  if (!loaded.ok) {
    if (!loaded.empty && loaded.issues?.length) {
      toast('Could not recover the saved drawing.', 'error', errors.describeError(loaded.issues[0]));
    }
    return;
  }
  applyLoadedScene(loaded.scene, loaded.source);
  if (loaded.source !== 'current') {
    toast(`Recovered the drawing from ${loaded.source}.`, 'warning', loaded.issues?.length ? schema.describeIssues(loaded.issues) : null);
    // Heal the primary slot immediately, promoting the exact known-good raw
    // recovery candidate instead of re-copying a rejected current slot.
    saveNow({ recoveryRaw: loaded.raw });
  } else if (loaded.issues?.length) {
    toast('The saved drawing was repaired.', 'warning', schema.describeIssues(loaded.issues));
  }
}

function adoptExternalScene(external) {
  if (!external?.scene) return;
  applyLoadedScene(external.scene, 'another tab');
  toast('Loaded changes from another tab.', 'info');
}

function showConflictToast(external) {
  conflictScene = external.scene;
  toast('Another tab changed the drawing.', 'warning', 'Your unsaved changes would overwrite it.', [
    { label: 'Load other tab', run: () => {
      conflictPending = false;
      adoptExternalScene(external);
    } },
    { label: 'Keep mine', run: () => {
      conflictPending = false;
      saveNow();
      toast('Kept this tab’s version.', 'info');
    } },
  ]);
}

persistence.subscribe((event) => {
  if (event.type === 'save') {
    dirty = false;
    setSaveStatus('Saved');
  } else if (event.type === 'quota') {
    setSaveStatus('Storage full — in memory');
  } else if (event.type === 'unavailable') {
    setSaveStatus('Storage unavailable — in memory');
  }
});

window.addEventListener('storage', (event) => {
  boundary.guard(() => {
    const external = persistence.inspectExternal(event);
    if (!external) return;
    if (external.corrupt) {
      toast('Another tab wrote a corrupt save; it was ignored.', 'error', schema.describeIssues(external.issues ?? []));
      return;
    }
    if (conflictPending) return;
    if (!dirty) {
      adoptExternalScene(external);
      return;
    }
    conflictPending = true;
    showConflictToast(external);
  }, 'storage-event');
});

window.addEventListener('beforeunload', () => {
  if (!conflictPending) persistence.flush();
});

/* ------------------------------------------------------------ gestures */

function pointScreen(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pointAt(event) {
  return viewport.screenToScene(pointScreen(event));
}

function snapped(point) {
  return state.snap ? viewport.snapPoint(point, true) : point;
}

function handleAtElement(el, point, size) {
  const rect = geo.rectOf(el);
  const centre = geo.elementCenter(el);
  for (const handle of tools.HANDLES) {
    let handlePoint = tools.handlePosition(rect, handle);
    if (el.angle) handlePoint = geo.rotatePoint(handlePoint, centre, el.angle);
    if (geo.distance(point, handlePoint) <= size) return handle;
  }
  return null;
}

function isTrivial(el) {
  if (!el) return true;
  if (el.type === 'freehand') return el.points.length < 2;
  if (el.type === 'line' || el.type === 'arrow') {
    const path = geo.resolveConnectorPath(el, find);
    if (path.length < 2) return true;
    let length = 0;
    for (let i = 1; i < path.length; i += 1) length += geo.distance(path[i - 1], path[i]);
    return length < MIN_STROKE;
  }
  if (el.type === 'text') return !el.text;
  if (el.type === 'image') return !el.imageSrc;
  return el.width < 2 && el.height < 2;
}

function refreshTextMetrics() {
  for (const el of scene.elements) {
    if (el.type === 'text') paint.measureText(el);
  }
  textLib.repositionLabels(scene.elements, paint.measureText);
}

function commitDraft() {
  const el = draft;
  draft = null;
  if (isTrivial(el)) {
    if (scene.undoStack.length) scene.undoStack.pop();
    safeRender();
    return;
  }
  const id = scene.add(el);
  if (el.type === 'text') paint.measureText(el);
  setSelection([id]);
  rebindFreeConnectorEnds();
  scene.syncLabels();
  refreshTextMetrics();
  scheduleSave();
}

/** Connector ends dropped on top of a shape become real links. */
function rebindFreeConnectorEnds() {
  for (const el of scene.elements) {
    if (el.type !== 'line' && el.type !== 'arrow') continue;
    const path = geo.resolveConnectorPath(el, find);
    if (path.length < 2) continue;
    const start = path[0];
    const end = path[path.length - 1];
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

function startPan(event) {
  gesture = { mode: 'pan', last: pointScreen(event) };
  canvas.style.cursor = 'grabbing';
}

function onPointerDown(event) {
  boundary.guard(() => {
    const screen = pointScreen(event);
    if (event.pointerType === 'touch') {
      touchPoints.set(event.pointerId, screen);
      if (touchPoints.size === 2) {
        const [a, b] = [...touchPoints.values()];
        gesture = {
          mode: 'pinch',
          startDistance: Math.max(geo.distance(a, b), 1),
          startZoom: viewport.zoom,
          startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
        draft = null;
        marquee = null;
        safeRender();
        return;
      }
    }

    if (event.button === 1 || (event.button === 0 && spaceDown)) {
      event.preventDefault();
      startPan(event);
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (editing) finishEditing();
    hideContextMenu();
    const point = pointAt(event);
    lastPointerScene = point;
    canvas.setPointerCapture(event.pointerId);

    if (state.tool === 'text') {
      startText(point, geo.elementAt(scene.elements, point, find));
      safeRender();
      return;
    }

    if (state.tool === 'eraser') {
      scene.pushHistory();
      gesture = { mode: 'erase', last: point };
      const hits = tools.eraseHits(scene.elements, point, point, find)
        .filter((id) => !find(id)?.locked);
      if (hits.length) scene.removeElements(hits);
      safeRender();
      return;
    }

    if (state.tool !== 'select') {
      scene.pushHistory();
      const start = state.tool === 'freehand' ? point : snapped(point);
      gesture = { mode: 'draw', tool: state.tool, start };
      draft = tools.createDraft(state.tool, start, state);
      safeRender();
      return;
    }

    // select tool -----------------------------------------------------------
    if (selection.length === 1) {
      const only = find(selection[0]);
      if (only && !only.locked) {
        if (only.type === 'line' || only.type === 'arrow') {
          const vertex = tools.connectorVertexAt(only, find, point, geo.HANDLE_SIZE / viewport.zoom);
          if (vertex !== null) {
            scene.pushHistory();
            gesture = {
              mode: vertex === 0 || vertex === only.points.length - 1 ? 'endpoint' : 'vertex',
              id: only.id,
              index: vertex,
            };
            safeRender();
            return;
          }
        } else if (tools.rotationHandleAt(only, point, geo.HANDLE_SIZE / viewport.zoom)) {
          scene.pushHistory();
          gesture = {
            mode: 'rotate',
            id: only.id,
            start: point,
            startAngle: only.angle ?? 0,
            centre: geo.elementCenter(only),
          };
          safeRender();
          return;
        } else {
          const handle = handleAtElement(only, point, geo.HANDLE_SIZE / viewport.zoom);
          if (handle) {
            scene.pushHistory();
            gesture = {
              mode: 'resize',
              id: only.id,
              handle,
              start: point,
              rect: geo.rectOf(only),
              points: only.points ? only.points.map((p) => ({ ...p })) : null,
              angle: only.angle ?? 0,
            };
            safeRender();
            return;
          }
        }
      }
    }

    if (selection.length > 1) {
      const bounds = arrange.selectedBounds(scene.elements, selection, find);
      const handle = bounds ? tools.handleAt(bounds, point, geo.HANDLE_SIZE / viewport.zoom) : null;
      if (handle) {
        scene.pushHistory();
        gesture = {
          mode: 'resize-multi',
          handle,
          start: point,
          rect: bounds,
          elements: selectedElements()
            .filter((el) => !el.locked)
            .map((el) => ({
              id: el.id,
              x: el.x,
              y: el.y,
              width: el.width,
              height: el.height,
              points: el.points ? el.points.map((p) => ({ ...p })) : null,
            })),
        };
        safeRender();
        return;
      }
    }

    const hit = geo.elementAt(scene.elements, point, find);
    if (hit) {
      scene.pushHistory();
      toggleHit(hit, event.shiftKey);
      for (const el of selectedElements()) {
        if (el.type === 'text' && el.containerId && !selection.includes(el.containerId)) {
          el.containerId = null;
        }
      }
      const movable = selectedElements().filter((el) => !el.locked);
      gesture = {
        mode: 'move',
        origin: point,
        start: movable.map((el) => ({ id: el.id, x: el.x, y: el.y })),
      };
      safeRender();
      return;
    }

    scene.pushHistory();
    if (!event.shiftKey) setSelection([]);
    gesture = { mode: 'marquee', start: point, base: event.shiftKey ? selection.slice() : [] };
    marquee = { x: point.x, y: point.y, width: 0, height: 0 };
    safeRender();
  }, 'pointerdown');
}

function onPointerMove(event) {
  boundary.guard(() => {
    if (event.pointerType === 'touch') touchPoints.set(event.pointerId, pointScreen(event));
    if (!gesture) {
      lastPointerScene = pointAt(event);
      return;
    }
    const screen = pointScreen(event);
    const point = viewport.screenToScene(screen);
    lastPointerScene = point;

    switch (gesture.mode) {
      case 'pan': {
        viewport.panBy(screen.x - gesture.last.x, screen.y - gesture.last.y);
        gesture.last = screen;
        break;
      }
      case 'pinch': {
        const points = [...touchPoints.values()];
        if (points.length < 2) break;
        const [a, b] = points;
        const distance = Math.max(geo.distance(a, b), 1);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        viewport.panBy(mid.x - gesture.startMid.x, mid.y - gesture.startMid.y);
        viewport.setZoom(gesture.startZoom * (distance / gesture.startDistance), mid);
        gesture.startMid = mid;
        break;
      }
      case 'draw':
        draft = tools.updateDraft(
          draft,
          gesture.tool,
          gesture.start,
          gesture.tool === 'freehand' ? point : snapped(point),
          event.shiftKey,
        );
        break;
      case 'erase': {
        const hits = tools.eraseHits(scene.elements, gesture.last, point, find)
          .filter((id) => !find(id)?.locked);
        if (hits.length) scene.removeElements(hits);
        gesture.last = point;
        break;
      }
      case 'move': {
        let dx = point.x - gesture.origin.x;
        let dy = point.y - gesture.origin.y;
        if (state.snap && gesture.start.length) {
          const first = gesture.start[0];
          const target = viewport.snapPoint({ x: first.x + dx, y: first.y + dy }, true);
          dx = target.x - first.x;
          dy = target.y - first.y;
        }
        scene.applyPositions(
          gesture.start.map((move) => ({ id: move.id, x: move.x + dx, y: move.y + dy })),
        );
        break;
      }
      case 'resize': {
        const el = find(gesture.id);
        if (!el) return;
        const centre = geo.elementCenter(el);
        const localPoint = gesture.angle ? geo.rotatePoint(point, centre, -gesture.angle) : point;
        const localStart = gesture.angle ? geo.rotatePoint(gesture.start, centre, -gesture.angle) : gesture.start;
        const next = tools.resizeRect(
          gesture.rect,
          gesture.handle,
          localPoint.x - localStart.x,
          localPoint.y - localStart.y,
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
      case 'resize-multi': {
        const next = tools.resizeRect(
          gesture.rect,
          gesture.handle,
          point.x - gesture.start.x,
          point.y - gesture.start.y,
          event.shiftKey,
        );
        const ratioX = next.width / (gesture.rect.width || 1);
        const ratioY = next.height / (gesture.rect.height || 1);
        for (const start of gesture.elements) {
          const el = find(start.id);
          if (!el) continue;
          el.x = next.x + (start.x - gesture.rect.x) * ratioX;
          el.y = next.y + (start.y - gesture.rect.y) * ratioY;
          el.width = Math.max(1, start.width * ratioX);
          el.height = Math.max(1, start.height * ratioY);
          if (start.points) el.points = tools.scalePoints(start.points, ratioX, ratioY);
        }
        break;
      }
      case 'rotate': {
        const el = find(gesture.id);
        if (!el) return;
        let angle = gesture.startAngle + geo.angleFromPoints(gesture.centre, gesture.start, point);
        if (event.shiftKey) angle = Math.round(angle / 15) * 15;
        el.angle = geo.normalizeAngle(angle);
        break;
      }
      case 'endpoint':
      case 'vertex': {
        const el = find(gesture.id);
        if (!el) return;
        tools.moveConnectorPoint(el, find, gesture.index, snapped(point));
        break;
      }
      case 'marquee':
        marquee = geo.normRect(gesture.start.x, gesture.start.y, point.x, point.y);
        setSelection(tools.marqueeSelection(gesture.base, scene.elements, marquee, event.shiftKey, find));
        break;
      default:
        return;
    }
    safeRender();
  }, 'pointermove');
}

function onPointerUp(event) {
  boundary.guard(() => {
    if (event.pointerType === 'touch') touchPoints.delete(event.pointerId);
    if (!gesture) return;
    const mode = gesture.mode;
    if (mode === 'draw') commitDraft();
    gesture = null;
    marquee = null;
    canvas.style.cursor = spaceDown ? 'grab' : 'crosshair';
    scene.syncLabels();
    if (mode === 'move' || mode === 'endpoint' || mode === 'vertex') rebindFreeConnectorEnds();
    if (mode !== 'pan' && mode !== 'pinch' && mode !== 'marquee') refreshTextMetrics();
    pruneSelection();
    if (mode !== 'pan' && mode !== 'pinch') scheduleSave();
    safeRender();
  }, 'pointerup');
}

function cancelGesture() {
  gesture = null;
  draft = null;
  marquee = null;
  touchPoints.clear();
  canvas.style.cursor = spaceDown ? 'grab' : 'crosshair';
  safeRender();
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', cancelGesture);
canvas.addEventListener('pointerleave', () => { if (gesture?.mode === 'pan') cancelGesture(); });

/* ----------------------------------------------------------- text entry */

function startText(point, hit) {
  scene.pushHistory();
  textLimitWarned = false;
  if (hit && hit.type === 'text') {
    editing = { id: hit.id, caret: String(hit.text ?? '').length };
    setSelection([hit.id]);
    return;
  }
  const container = hit && geo.isContainer(hit) ? hit : null;
  let el;
  if (container) {
    const ensured = textLib.ensureLabel(scene.elements, container, state, () => uid());
    el = ensured.element;
    if (ensured.created) {
      paint.measureText(el);
      textLib.repositionLabels(scene.elements, paint.measureText);
    }
  } else {
    el = makeElement({
      type: 'text',
      text: '',
      x: point.x,
      y: point.y - (state.fontSize * 1.25) / 2,
      fontSize: state.fontSize,
      fontFamily: state.fontFamily,
      strokeColor: state.strokeColor,
    });
    scene.add(el);
  }
  editing = { id: el.id, caret: String(el.text ?? '').length };
  setSelection([el.id]);
}

function typeAtCaret(character) {
  const el = find(editing?.id);
  if (!el) return;
  const next = textLib.insertText(el.text, editing.caret, character, {
    maxLength: schema.DEFAULT_LIMITS.maxTextLength,
  });
  if (next.limited) {
    if (!textLimitWarned) {
      textLimitWarned = true;
      toast(`Text is limited to ${schema.DEFAULT_LIMITS.maxTextLength} characters per element.`, 'warning');
    }
    return;
  }
  el.text = next.text;
  editing.caret = next.caret;
  paint.measureText(el);
  if (el.containerId) textLib.repositionLabels(scene.elements, paint.measureText);
  scheduleSave();
}

function deleteAtCaret(forward = false) {
  const el = find(editing?.id);
  if (!el) return;
  const next = textLib.deleteText(el.text, editing.caret, forward);
  el.text = next.text;
  editing.caret = next.caret;
  paint.measureText(el);
  if (el.containerId) textLib.repositionLabels(scene.elements, paint.measureText);
  scheduleSave();
}

function finishEditing() {
  if (!editing) return;
  const el = find(editing.id);
  editing = null;
  if (!el) return;
  paint.measureText(el);
  if (textLib.isBlankText(el.text)) {
    scene.removeElements([el.id]);
    setSelection([]);
  } else if (!el.containerId) {
    const centre = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    const container = geo.containerAt(scene.elements, centre);
    if (container) scene.bindLabelTo(el.id, container.id);
  }
  textLib.repositionLabels(scene.elements, paint.measureText);
  scheduleSave();
  updateProperties();
}

/* ------------------------------------------------------------- commands */

function undoAction() {
  if (!scene.undo()) {
    toast('Nothing to undo.', 'info');
    return;
  }
  pruneSelection();
  refreshTextMetrics();
  scheduleSave();
  safeRender();
}

function redoAction() {
  if (!scene.redo()) {
    toast('Nothing to redo.', 'info');
    return;
  }
  pruneSelection();
  refreshTextMetrics();
  scheduleSave();
  safeRender();
}

function deleteSelection() {
  const ids = selection.filter((id) => !find(id)?.locked);
  if (!ids.length) {
    toast(selection.length ? 'Locked elements cannot be deleted.' : 'Nothing selected.', 'info');
    return;
  }
  scene.pushHistory();
  scene.removeElements(ids.slice());
  setSelection([]);
  scheduleSave();
  safeRender();
}

function duplicateSelection() {
  if (!selection.length) {
    toast('Nothing selected.', 'info');
    return;
  }
  scene.pushHistory();
  const ids = scene.duplicate(selection.slice());
  setSelection(ids);
  scheduleSave();
  safeRender();
}

function bringToFront() {
  if (!selection.length) return;
  scene.pushHistory();
  scene.elements = arrange.reorder(scene.elements, selection, 'front');
  scheduleSave();
  safeRender();
}

function clearCanvas() {
  if (!scene.elements.length) return;
  scene.pushHistory();
  scene.elements = [];
  setSelection([]);
  scheduleSave();
  safeRender();
}

function groupSelection() {
  if (selection.length < 2) {
    toast('Select at least two elements to group.', 'info');
    return;
  }
  scene.pushHistory();
  arrange.groupElements(scene.elements, selection, `group_${Date.now().toString(36)}_${uid()}`);
  scheduleSave();
  updateProperties();
  safeRender();
}

function ungroupSelection() {
  if (!selection.length) return;
  scene.pushHistory();
  const removed = arrange.ungroupElements(scene.elements, selection);
  if (!removed.length) toast('The selection is not grouped.', 'info');
  scheduleSave();
  updateProperties();
  safeRender();
}

function lockSelection() {
  if (!selection.length) return;
  scene.pushHistory();
  const locked = arrange.toggleLocked(scene.elements, selection);
  toast(locked ? 'Selection locked.' : 'Selection unlocked.', 'info');
  scheduleSave();
  updateProperties();
  safeRender();
}

function alignSelection(mode) {
  if (selection.length < 2) {
    toast('Select at least two elements to align.', 'info');
    return;
  }
  scene.pushHistory();
  const moved = arrange.alignElements(scene.elements, selection, mode, find);
  if (!moved.length) {
    toast('Nothing moved (locked elements stay put).', 'info');
  }
  scene.syncLabels();
  scheduleSave();
  safeRender();
}

function distributeSelection(axis) {
  if (selection.length < 3) {
    toast('Select at least three elements to distribute.', 'info');
    return;
  }
  scene.pushHistory();
  arrange.distributeElements(scene.elements, selection, axis, find);
  scene.syncLabels();
  scheduleSave();
  safeRender();
}

function zorder(mode) {
  if (!selection.length) return;
  scene.pushHistory();
  scene.elements = arrange.reorder(scene.elements, selection, mode);
  scheduleSave();
  safeRender();
}

function nudge(dx, dy) {
  if (!selection.length) return;
  scene.pushHistory();
  const moved = arrange.nudgeElements(scene.elements, selection, dx, dy);
  if (!moved.length) return;
  scene.syncLabels();
  scheduleSave();
  safeRender();
}

function selectAll() {
  setSelection(scene.elements.map((el) => el.id));
  safeRender();
}

/* ------------------------------------------------------------ clipboard */

function copySelection() {
  if (!selection.length) {
    toast('Nothing selected.', 'info');
    return false;
  }
  const payload = clipboard.buildClipboardPayload(scene.elements, selection);
  const text = clipboard.serializeClipboard(payload);
  clipboardMemory.write(text);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  toast(`Copied ${payload.elements.length} element${payload.elements.length === 1 ? '' : 's'}.`, 'success');
  return true;
}

function cutSelection() {
  if (!copySelection()) return;
  deleteSelection();
}

async function pasteFromClipboard() {
  let text = clipboardMemory.read();
  try {
    if (navigator.clipboard?.readText) {
      const read = await navigator.clipboard.readText();
      if (read) text = read;
    }
  } catch {
    // permission denied: fall back to the in-app clipboard
  }
  const parsed = clipboard.parseClipboardPayload(text);
  if (!parsed) {
    toast('The clipboard does not contain a Sketch Studio scene.', 'warning');
    return;
  }
  scene.pushHistory();
  const result = clipboard.pasteElements(scene.elements, parsed.elements, { dx: 20, dy: 20 });
  scene.elements.push(...result.elements);
  setSelection(result.ids);
  rebindFreeConnectorEnds();
  scheduleSave();
  safeRender();
  if (parsed.issues.length) toast('Clipboard data was repaired.', 'warning', schema.describeIssues(parsed.issues));
}

const clipboardMemory = clipboard.createMemoryClipboard();

/* --------------------------------------------------------------- images */

function insertImageFile(file, point) {
  const check = images.checkImageFile(file);
  if (!check.ok) {
    toast(check.error, 'warning');
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => toast('Could not read that image.', 'error');
  reader.onload = () => boundary.guard(() => {
    const dataUrl = String(reader.result ?? '');
    const probe = new Image();
    probe.onerror = () => toast('That image could not be decoded.', 'error');
    probe.onload = () => boundary.guard(() => {
      const size = images.fitImageSize(probe.naturalWidth, probe.naturalHeight, 600, 600);
      const position = images.imageDropPosition(point, size.width, size.height);
      const el = images.createImageElement({
        imageSrc: dataUrl,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      });
      if (!el) {
        toast('Unsupported image data.', 'warning');
        return;
      }
      scene.pushHistory();
      scene.add(el);
      setSelection([el.id]);
      scheduleSave();
      safeRender();
      toast('Image inserted.', 'success');
    }, 'image-insert');
    probe.src = dataUrl;
  }, 'image-read');
  reader.readAsDataURL(file);
}

document.addEventListener('paste', (event) => {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        const point = lastPointerScene ?? viewport.screenToScene({ x: cssWidth / 2, y: cssHeight / 2 });
        insertImageFile(file, point);
      }
      return;
    }
  }
});

canvas.addEventListener('dragover', (event) => event.preventDefault());
canvas.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  insertImageFile(file, pointAt(event));
});

/* --------------------------------------------------------------- export */

function downloadUrl(name, url) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  downloadUrl(name, url);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function exportPNG(selectionOnly = false) {
  const ids = selectionOnly ? selection.slice() : null;
  if (!scene.elements.length || (selectionOnly && !ids.length)) {
    toast('Nothing to export.', 'info');
    return;
  }
  const chosen = selectionOnly
    ? scene.elements.filter((el) => ids.includes(el.id) || (el.type === 'text' && el.containerId && ids.includes(el.containerId)))
    : scene.elements;
  await paint.preloadImages(chosen);
  const bounds = exporter.exportBounds(chosen, null, find, 32);
  const scale = Math.min(2, window.devicePixelRatio || 1) || 1;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = Math.max(1, Math.ceil(bounds.width * scale));
  exportCanvas.height = Math.max(1, Math.ceil(bounds.height * scale));
  const ex = exportCanvas.getContext('2d');
  ex.fillStyle = exporter.THEME_BACKGROUNDS[state.theme];
  ex.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ex.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  for (const el of chosen) {
    try {
      paint.drawElement(ex, el, find);
    } catch (error) {
      boundary.report(error, `export:${el.id}`);
    }
  }
  downloadUrl(selectionOnly ? 'sketch-studio-selection.png' : 'sketch-studio.png', exportCanvas.toDataURL('image/png'));
  toast('PNG exported.', 'success');
}

function exportSVG(selectionOnly = false) {
  const ids = selectionOnly ? selection.slice() : null;
  if (selectionOnly && !ids.length) {
    toast('Nothing to export.', 'info');
    return;
  }
  const svg = exporter.sceneToSVG(scene.elements, {
    find,
    ids,
    theme: state.theme,
    title: 'Sketch Studio drawing',
  });
  downloadBlob(selectionOnly ? 'sketch-studio-selection.svg' : 'sketch-studio.svg', new Blob([svg], { type: 'image/svg+xml' }));
  toast('SVG exported.', 'success');
}

function exportJSON() {
  const payload = { ...snapshotData(), style: snapshotStyle() };
  downloadBlob('sketch-studio.json', new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  toast('JSON saved.', 'success');
}

function exportRecovery() {
  const payload = errors.buildRecoveryPayload(scene, {
    label: 'manual',
    userAgent: navigator.userAgent,
    style: snapshotStyle(),
    theme: state.theme,
  });
  downloadBlob(errors.recoveryFilename(), new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  toast('Recovery JSON exported.', 'success');
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
  input.addEventListener('change', () => boundary.guardAsync(async () => {
    const file = input.files[input.files.length - 1];
    if (!file) {
      holder.remove();
      return;
    }
    const check = importer.checkFile(file);
    if (!check.ok) {
      toast(check.error, 'error');
      holder.remove();
      return;
    }
    const text = await file.text();
    const result = importer.parseSceneText(text);
    holder.remove();
    if (!result.ok) {
      toast('Could not open that file.', 'error', result.error);
      return;
    }
    scene.pushHistory();
    applyLoadedScene(result.scene, 'file');
    scheduleSave();
    safeRender();
    toast('Scene opened.', 'success', result.issues.length ? schema.describeIssues(result.issues) : null);
  }, 'open-file'));
}

/* ------------------------------------------------------------- shortcuts */

function toggleHelp(show = null) {
  const overlay = document.getElementById('helpOverlay');
  const next = show === null ? overlay.hidden : show;
  overlay.hidden = !next;
  if (next) document.getElementById('helpCloseBtn').focus();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('dark', state.theme === 'dark');
  syncToolbar();
  scheduleSave();
  safeRender();
}

function toggleGrid() {
  state.grid = !state.grid;
  syncToolbar();
  scheduleSave();
  safeRender();
}

function toggleSnap() {
  state.snap = !state.snap;
  syncToolbar();
  scheduleSave();
  toast(`Snap to grid ${state.snap ? 'on' : 'off'}.`, 'info');
}

function onKeyDown(event) {
  boundary.guard(() => {
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
    if (editing) {
      const el = find(editing.id);
      if (!el) {
        editing = null;
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      if (event.key === 'Escape') {
        finishEditing();
        safeRender();
        event.preventDefault();
        return;
      }
      if (event.key === 'Enter') typeAtCaret('\n');
      else if (event.key === 'Backspace') deleteAtCaret(false);
      else if (event.key === 'Delete') deleteAtCaret(true);
      else if (event.key === 'ArrowLeft') editing.caret = textLib.moveCaret(el.text, editing.caret, 'left');
      else if (event.key === 'ArrowRight') editing.caret = textLib.moveCaret(el.text, editing.caret, 'right');
      else if (event.key === 'ArrowUp') editing.caret = textLib.moveCaret(el.text, editing.caret, 'up');
      else if (event.key === 'ArrowDown') editing.caret = textLib.moveCaret(el.text, editing.caret, 'down');
      else if (event.key.length === 1) typeAtCaret(event.key);
      else return;
      event.preventDefault();
      safeRender();
      return;
    }

    const meta = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (meta && key === 'z') {
      event.preventDefault();
      event.shiftKey ? redoAction() : undoAction();
      return;
    }
    if (meta && key === 'y') {
      event.preventDefault();
      redoAction();
      return;
    }
    if (meta && key === 'a') {
      event.preventDefault();
      selectAll();
      return;
    }
    if (meta && key === 'd') {
      event.preventDefault();
      duplicateSelection();
      return;
    }
    if (meta && key === 'c') {
      event.preventDefault();
      copySelection();
      return;
    }
    if (meta && key === 'x') {
      event.preventDefault();
      cutSelection();
      return;
    }
    if (meta && key === 'v') {
      event.preventDefault();
      pasteFromClipboard();
      return;
    }
    if (meta && key === 'g') {
      event.preventDefault();
      event.shiftKey ? ungroupSelection() : groupSelection();
      return;
    }
    if (meta && event.shiftKey && key === 'l') {
      event.preventDefault();
      lockSelection();
      return;
    }
    if (meta && (key === ']' || key === '}')) {
      event.preventDefault();
      zorder(event.shiftKey ? 'front' : 'forward');
      return;
    }
    if (meta && (key === '[' || key === '{')) {
      event.preventDefault();
      zorder(event.shiftKey ? 'back' : 'backward');
      return;
    }
    if (meta && (key === '=' || key === '+')) {
      event.preventDefault();
      viewport.zoomIn({ x: cssWidth / 2, y: cssHeight / 2 });
      updateZoomIndicator();
      safeRender();
      return;
    }
    if (meta && key === '-') {
      event.preventDefault();
      viewport.zoomOut({ x: cssWidth / 2, y: cssHeight / 2 });
      updateZoomIndicator();
      safeRender();
      return;
    }
    if (meta && key === '0') {
      event.preventDefault();
      resetZoom();
      return;
    }
    if (meta && key === '1') {
      event.preventDefault();
      zoomToFit(selection.length ? selection : null);
      return;
    }
    if (meta && key === '2') {
      event.preventDefault();
      zoomToFit(selection);
      return;
    }

    if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (key === 'escape') {
      hideContextMenu();
      toggleHelp(false);
      if (draft) {
        draft = null;
        gesture = null;
      }
      setSelection([]);
      safeRender();
      return;
    }
    if (key === '?') {
      event.preventDefault();
      toggleHelp();
      return;
    }
    if (key === ' ') {
      spaceDown = true;
      canvas.style.cursor = 'grab';
      event.preventDefault();
      return;
    }
    if (key === 'g' && !meta) {
      toggleGrid();
      return;
    }
    if (key === 's' && !meta) {
      toggleSnap();
      return;
    }
    if (key.startsWith('arrow')) {
      if (!selection.length) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      if (key === 'arrowleft') nudge(-step, 0);
      else if (key === 'arrowright') nudge(step, 0);
      else if (key === 'arrowup') nudge(0, -step);
      else if (key === 'arrowdown') nudge(0, step);
      return;
    }
    if (meta || event.altKey) return;
    const tool = tools.toolFromShortcut(key);
    if (tool) {
      event.preventDefault();
      setTool(tool);
    }
  }, 'keydown');
}

function onKeyUp(event) {
  if (event.key === ' ') {
    spaceDown = false;
    canvas.style.cursor = 'crosshair';
  }
}

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

/* ------------------------------------------------------------- toolbar */

function syncPressed(gridId, key, value) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  for (const button of grid.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset[key] === String(value)));
  }
}

function displayValue(key) {
  const style = props.selectionStyle(scene.elements, selection);
  return style[key] !== undefined ? style[key] : state[key];
}

function syncToolButtons() {
  for (const button of document.querySelectorAll('[data-tool]')) {
    button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
  }
}

function syncToolbar() {
  syncToolButtons();
  const style = props.selectionStyle(scene.elements, selection);
  syncPressed('strokeStyleGrid', 'style', displayValue('strokeStyle'));
  syncPressed('colorGrid', 'color', displayValue('strokeColor'));
  syncPressed('fillGrid', 'fill', displayValue('backgroundColor'));
  syncPressed('fontSizeGrid', 'size', String(displayValue('fontSize')));

  const strokeWidth = document.getElementById('strokeWidth');
  if (strokeWidth) strokeWidth.value = String(displayValue('strokeWidth'));
  const opacity = document.getElementById('opacityRange');
  if (opacity) opacity.value = String(displayValue('opacity'));
  const roughness = document.getElementById('roughnessSelect');
  if (roughness) roughness.value = String(displayValue('roughness'));
  const edge = document.getElementById('edgeStyleSelect');
  if (edge) edge.value = displayValue('edgeStyle');
  const font = document.getElementById('fontFamilySelect');
  if (font) font.value = displayValue('fontFamily');
  const start = document.getElementById('startArrowheadSelect');
  if (start) start.value = displayValue('startArrowhead');
  const end = document.getElementById('endArrowheadSelect');
  if (end) end.value = displayValue('endArrowhead');
  const elbow = document.getElementById('elbowToggle');
  if (elbow) elbow.checked = Boolean(displayValue('elbow'));

  if (colorPicker) {
    colorPicker.value = /^#[0-9a-f]{6}$/i.test(String(displayValue('strokeColor'))) ? displayValue('strokeColor') : '#1e1e1e';
    colorPicker.setAttribute('aria-pressed', String(!tools.PALETTE.includes(displayValue('strokeColor'))));
  }

  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    themeBtn.textContent = state.theme === 'dark' ? 'Light' : 'Dark';
    themeBtn.setAttribute('aria-pressed', String(state.theme === 'dark'));
  }
  const gridBtn = document.getElementById('gridBtn');
  if (gridBtn) gridBtn.setAttribute('aria-pressed', String(state.grid));
  const snapBtn = document.getElementById('snapBtn');
  if (snapBtn) snapBtn.setAttribute('aria-pressed', String(state.snap));

  const lockBtn = document.getElementById('lockBtn');
  if (lockBtn) {
    lockBtn.textContent = style.locked ? 'Locked' : 'Lock';
    lockBtn.setAttribute('aria-pressed', String(style.locked));
  }
  const groupBtn = document.getElementById('groupBtn');
  if (groupBtn) groupBtn.disabled = selection.length < 2;
  const ungroupBtn = document.getElementById('ungroupBtn');
  if (ungroupBtn) ungroupBtn.disabled = !style.grouped;

  updateProperties();
}

function updateProperties() {
  const style = props.selectionStyle(scene.elements, selection);
  const summary = document.getElementById('selectionSummary');
  if (summary) summary.textContent = props.selectionLabel(style);
  const angle = document.getElementById('angleInput');
  if (angle) angle.value = style.angle !== undefined ? String(Math.round(style.angle)) : '';
  const lockBtn = document.getElementById('lockBtn');
  if (lockBtn) {
    lockBtn.textContent = style.locked ? 'Locked' : 'Lock';
    lockBtn.setAttribute('aria-pressed', String(style.locked));
  }
  const groupBtn = document.getElementById('groupBtn');
  if (groupBtn) groupBtn.disabled = selection.length < 2;
  const ungroupBtn = document.getElementById('ungroupBtn');
  if (ungroupBtn) ungroupBtn.disabled = !style.grouped;
}

function applyStylePatch(patch, options = {}) {
  for (const [key, value] of Object.entries(patch)) {
    if (key in state) state[key] = value;
  }
  if (selection.length) {
    if (options.history !== false) scene.pushHistory();
    const changed = props.applyStyle(scene.elements, selection, patch);
    if (changed.length) {
      refreshTextMetrics();
      scheduleSave();
    }
  } else {
    scheduleSave();
  }
  syncToolbar();
  safeRender();
}

function setTool(tool) {
  if (!tools.TOOLS.some((entry) => entry.tool === tool)) return;
  if (editing) finishEditing();
  state.tool = tool;
  syncToolbar();
  setStatusHint(HINTS[tool] ?? '');
  safeRender();
}

function buildSwatchGrid(containerId, colors, key, apply) {
  const container = document.getElementById(containerId);
  for (const color of colors) {
    const button = document.createElement('button');
    button.className = 'cell swatch';
    button.dataset[key] = color;
    button.title = color;
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--swatch', color);
    button.style.background = color === 'transparent' ? 'transparent' : color;
    if (color === 'transparent') {
      const span = document.createElement('span');
      span.textContent = 'none';
      button.append(span);
    }
    button.addEventListener('click', () => apply(color));
    container.append(button);
  }
}

/* ---------------------------------------------------------- context menu */

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.hidden = true;
}

function menuButton(menu, label, shortcut, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  const span = document.createElement('span');
  span.textContent = label;
  button.append(span);
  if (shortcut) {
    const kbd = document.createElement('kbd');
    kbd.textContent = shortcut;
    button.append(kbd);
  }
  button.addEventListener('click', () => {
    hideContextMenu();
    boundary.guard(action, `menu:${label}`);
  });
  menu.append(button);
}

function menuSeparator(menu) {
  menu.append(document.createElement('hr'));
}

function showContextMenu(event) {
  event.preventDefault();
  const point = pointAt(event);
  const hit = geo.elementAt(scene.elements, point, find);
  if (hit && !selection.includes(hit.id)) setSelection([hit.id]);
  if (!hit) setSelection([]);
  const menu = document.getElementById('contextMenu');
  menu.replaceChildren();
  menu.hidden = false;

  if (selection.length) {
    menuButton(menu, 'Copy', 'Ctrl+C', copySelection);
    menuButton(menu, 'Cut', 'Ctrl+X', cutSelection);
    menuButton(menu, 'Paste', 'Ctrl+V', pasteFromClipboard);
    menuButton(menu, 'Duplicate', 'Ctrl+D', duplicateSelection);
    menuButton(menu, 'Delete', 'Del', deleteSelection);
    menuSeparator(menu);
    menuButton(menu, 'Bring to front', ']', () => zorder('front'));
    menuButton(menu, 'Send to back', '[', () => zorder('back'));
    menuSeparator(menu);
    menuButton(menu, 'Group', 'Ctrl+G', groupSelection);
    menuButton(menu, 'Ungroup', 'Ctrl+Shift+G', ungroupSelection);
    menuButton(menu, 'Lock / unlock', 'Ctrl+Shift+L', lockSelection);
    menuSeparator(menu);
    menuButton(menu, 'Export selection PNG', '', () => exportPNG(true));
    menuButton(menu, 'Export selection SVG', '', () => exportSVG(true));
  } else {
    menuButton(menu, 'Paste', 'Ctrl+V', pasteFromClipboard);
    menuButton(menu, 'Select all', 'Ctrl+A', selectAll);
    menuButton(menu, 'Zoom to fit', 'Ctrl+1', () => zoomToFit());
    menuButton(menu, 'Export PNG', '', () => exportPNG(false));
    menuButton(menu, 'Export SVG', '', () => exportSVG(false));
    menuSeparator(menu);
    menuButton(menu, 'Clear canvas', '', clearCanvas);
  }

  const rect = menu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

document.addEventListener('pointerdown', (event) => {
  const menu = document.getElementById('contextMenu');
  if (menu && !menu.hidden && !menu.contains(event.target)) hideContextMenu();
});
canvas.addEventListener('contextmenu', (event) => boundary.guard(() => showContextMenu(event), 'contextmenu'));

/* ------------------------------------------------------------- double-click */

canvas.addEventListener('dblclick', (event) => boundary.guard(() => {
  const point = pointAt(event);
  const hit = geo.elementAt(scene.elements, point, find);
  if (!hit) {
    startText(point, null);
    scheduleSave();
    safeRender();
    return;
  }
  if (hit.type === 'text') {
    startText(point, hit);
    safeRender();
    return;
  }
  if (hit.type === 'line' || hit.type === 'arrow') {
    scene.pushHistory();
    const index = tools.insertConnectorPoint(hit, find, point);
    if (index >= 0) {
      setSelection([hit.id]);
      scheduleSave();
      safeRender();
    }
    return;
  }
  if (geo.isContainer(hit)) {
    scene.pushHistory();
    const ensured = textLib.ensureLabel(scene.elements, hit, state, () => uid());
    if (ensured.element) {
      paint.measureText(ensured.element);
      textLib.repositionLabels(scene.elements, paint.measureText);
      editing = { id: ensured.element.id, caret: String(ensured.element.text ?? '').length };
      setSelection([ensured.element.id]);
      scheduleSave();
      safeRender();
    }
  }
}, 'dblclick'));

/* ------------------------------------------------------------- wheel/zoom */

canvas.addEventListener('wheel', (event) => boundary.guard(() => {
  event.preventDefault();
  const screen = pointScreen(event);
  if (event.ctrlKey || event.metaKey) {
    viewport.zoomAt(screen, Math.exp(-event.deltaY * 0.002));
  } else {
    viewport.panBy(event.deltaX, event.deltaY);
  }
  updateZoomIndicator();
  safeRender();
}, 'wheel'), { passive: false });

/* --------------------------------------------------------------- toasts */

function renderToasts(list) {
  const container = document.getElementById('toasts');
  if (!container) return;
  container.replaceChildren();
  for (const item of list) {
    const toastEl = document.createElement('div');
    toastEl.className = `toast ${item.kind}`;
    const body = document.createElement('div');
    body.className = 'toast-body';
    const message = document.createElement('div');
    message.textContent = item.message;
    body.append(message);
    if (item.detail) {
      const detail = document.createElement('div');
      detail.className = 'toast-detail';
      detail.textContent = item.detail;
      body.append(detail);
    }
    if (Array.isArray(item.action) && item.action.length) {
      const actions = document.createElement('div');
      actions.className = 'toast-actions';
      for (const action of item.action) {
        const button = document.createElement('button');
        button.className = 'chip small';
        button.textContent = action.label;
        button.addEventListener('click', () => boundary.guard(() => {
          toaster.dismiss(item.id);
          action.run();
        }, 'toast-action'));
        actions.append(button);
      }
      body.append(actions);
    }
    toastEl.append(body);
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.textContent = '×';
    close.title = 'Dismiss';
    close.addEventListener('click', () => toaster.dismiss(item.id));
    toastEl.append(close);
    container.append(toastEl);
  }
}

toaster.subscribe(renderToasts);

/* ------------------------------------------------------------- global errors */

window.addEventListener('error', (event) => {
  if (event.error) boundary.report(event.error, 'window-error');
});
window.addEventListener('unhandledrejection', (event) => {
  boundary.report(event.reason, 'unhandled-rejection');
});

/* ------------------------------------------------------------- build UI */

buildSwatchGrid('colorGrid', tools.PALETTE, 'color', (color) => applyStylePatch({ strokeColor: color }));
buildSwatchGrid(
  'fillGrid',
  ['transparent', ...tools.PALETTE.slice(0, 8)],
  'fill',
  (color) => applyStylePatch({ backgroundColor: color }),
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
  button.addEventListener('click', () => applyStylePatch({ fontSize: size }));
  sizeGrid.append(button);
}

for (const button of document.querySelectorAll('[data-style]')) {
  button.addEventListener('click', () => applyStylePatch({ strokeStyle: button.dataset.style }));
}
for (const button of document.querySelectorAll('[data-tool]')) {
  button.addEventListener('click', () => setTool(button.dataset.tool));
}

document.getElementById('strokeWidth').addEventListener('input', (event) => {
  applyStylePatch({ strokeWidth: Number(event.target.value) });
});
document.getElementById('opacityRange').addEventListener('input', (event) => {
  applyStylePatch({ opacity: Number(event.target.value) });
});
document.getElementById('roughnessSelect').addEventListener('change', (event) => {
  applyStylePatch({ roughness: Number(event.target.value) });
});
document.getElementById('edgeStyleSelect').addEventListener('change', (event) => {
  applyStylePatch({ edgeStyle: event.target.value });
});
document.getElementById('fontFamilySelect').addEventListener('change', (event) => {
  applyStylePatch({ fontFamily: event.target.value });
});
document.getElementById('startArrowheadSelect').addEventListener('change', (event) => {
  applyStylePatch({ startArrowhead: event.target.value });
});
document.getElementById('endArrowheadSelect').addEventListener('change', (event) => {
  applyStylePatch({ endArrowhead: event.target.value });
});
document.getElementById('elbowToggle').addEventListener('change', (event) => {
  applyStylePatch({ elbow: event.target.checked });
});

colorPicker = document.createElement('input');
colorPicker.type = 'color';
colorPicker.className = 'picker';
colorPicker.value = state.strokeColor;
colorPicker.title = 'Pick any ink colour';
colorPicker.addEventListener('change', () => applyStylePatch({ strokeColor: colorPicker.value }));
document.getElementById('colorGrid').append(colorPicker);

document.getElementById('undoBtn').addEventListener('click', undoAction);
document.getElementById('redoBtn').addEventListener('click', redoAction);
document.getElementById('dupBtn').addEventListener('click', duplicateSelection);
document.getElementById('pngBtn').addEventListener('click', () => exportPNG(false));
document.getElementById('svgBtn').addEventListener('click', () => exportSVG(false));
document.getElementById('jsonBtn').addEventListener('click', exportJSON);
document.getElementById('openBtn').addEventListener('click', openJSON);
document.getElementById('clearBtn').addEventListener('click', clearCanvas);
document.getElementById('themeBtn').addEventListener('click', toggleTheme);
document.getElementById('gridBtn').addEventListener('click', toggleGrid);
document.getElementById('snapBtn').addEventListener('click', toggleSnap);
document.getElementById('fitBtn').addEventListener('click', () => zoomToFit());
document.getElementById('helpBtn').addEventListener('click', () => toggleHelp());
document.getElementById('recoveryBtn').addEventListener('click', exportRecovery);
document.getElementById('helpCloseBtn').addEventListener('click', () => toggleHelp(false));
document.getElementById('helpOverlay').addEventListener('pointerdown', (event) => {
  if (event.target.id === 'helpOverlay') toggleHelp(false);
});

document.getElementById('zoomOutBtn').addEventListener('click', () => {
  viewport.zoomOut({ x: cssWidth / 2, y: cssHeight / 2 });
  updateZoomIndicator();
  safeRender();
});
document.getElementById('zoomInBtn').addEventListener('click', () => {
  viewport.zoomIn({ x: cssWidth / 2, y: cssHeight / 2 });
  updateZoomIndicator();
  safeRender();
});
document.getElementById('zoomIndicator').addEventListener('click', resetZoom);
document.getElementById('zoomFitBtn').addEventListener('click', () => zoomToFit());

document.getElementById('angleInput').addEventListener('change', (event) => {
  if (!selection.length) return;
  scene.pushHistory();
  props.setAngle(scene.elements, selection, Number(event.target.value));
  scheduleSave();
  updateProperties();
  safeRender();
});
document.getElementById('lockBtn').addEventListener('click', lockSelection);
document.getElementById('groupBtn').addEventListener('click', groupSelection);
document.getElementById('ungroupBtn').addEventListener('click', ungroupSelection);
document.getElementById('copyBtn').addEventListener('click', copySelection);
document.getElementById('cutBtn').addEventListener('click', cutSelection);
document.getElementById('pasteBtn').addEventListener('click', pasteFromClipboard);
document.getElementById('deleteBtn').addEventListener('click', deleteSelection);

for (const button of document.querySelectorAll('[data-align]')) {
  button.addEventListener('click', () => alignSelection(button.dataset.align));
}
for (const button of document.querySelectorAll('[data-distribute]')) {
  button.addEventListener('click', () => distributeSelection(button.dataset.distribute));
}
for (const button of document.querySelectorAll('[data-zorder]')) {
  button.addEventListener('click', () => zorder(button.dataset.zorder));
}

/* ---------------------------------------------------------------- boot */

window.addEventListener('resize', () => {
  fitCanvas();
  safeRender();
});

paint.setImageReadyHandler(safeRender);

fitCanvas();
boundary.guard(restore, 'boot-restore');
syncToolbar();
setStatusHint(HINTS[state.tool] ?? '');
safeRender();

// Exposed for automation and debugging; nothing on the page depends on it.
window.sketchStudio = {
  scene,
  state,
  viewport,
  setTool,
  selectionOf: () => selection.slice(),
  bounds: () => contentBounds(),
  linkEnds: () =>
    scene.elements
      .filter((el) => el.type === 'arrow' || el.type === 'line')
      .map((el) => ({
        id: el.id,
        ends: geo.resolveConnector(el, find),
        path: geo.resolveConnectorPath(el, find),
        bound: [el.startBinding?.elementId ?? null, el.endBinding?.elementId ?? null],
      })),
  texts: () =>
    scene.elements
      .filter((el) => el.type === 'text')
      .map((el) => ({ id: el.id, text: el.text, containerId: el.containerId })),
  save: saveNow,
  undo: undoAction,
  redo: redoAction,
  paste: pasteFromClipboard,
  exportSVG: (ids = null) => exporter.sceneToSVG(scene.elements, { find, ids, theme: state.theme }),
  toasts: () => toaster.list(),
};
