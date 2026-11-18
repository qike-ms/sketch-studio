/**
 * Infinite-canvas viewport: pan, anchored zoom, zoom-to-fit and grid snap.
 *
 * `pan` is the scene coordinate shown at the top-left of the screen.
 * screen = (scene - pan) * zoom, so all interaction maths stays pure.
 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const DEFAULT_ZOOM = 1;
export const GRID_SIZE = 24;

export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function zoomLabel(zoom) {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}

export function snapValue(value, gridSize = GRID_SIZE, enabled = true) {
  if (!enabled || !Number.isFinite(value) || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

export function snapPoint(point, gridSize = GRID_SIZE, enabled = true) {
  return {
    x: snapValue(point.x, gridSize, enabled),
    y: snapValue(point.y, gridSize, enabled),
  };
}

export class Viewport {
  constructor(options = {}) {
    this.pan = { x: options.x ?? 0, y: options.y ?? 0 };
    this.zoom = clampZoom(options.zoom ?? DEFAULT_ZOOM);
    this.gridSize = options.gridSize ?? GRID_SIZE;
  }

  screenToScene(point) {
    return {
      x: this.pan.x + point.x / this.zoom,
      y: this.pan.y + point.y / this.zoom,
    };
  }

  sceneToScreen(point) {
    return {
      x: (point.x - this.pan.x) * this.zoom,
      y: (point.y - this.pan.y) * this.zoom,
    };
  }

  /** Pan by a screen-space delta (e.g. a drag or wheel scroll). */
  panBy(dx, dy) {
    this.pan.x -= dx / this.zoom;
    this.pan.y -= dy / this.zoom;
    return this.pan;
  }

  /** Move to an absolute scene coordinate at the top-left. */
  setPan(x, y) {
    this.pan = { x, y };
  }

  setZoom(zoom, anchor = null) {
    const next = clampZoom(zoom);
    if (anchor) {
      const before = this.screenToScene(anchor);
      this.zoom = next;
      this.pan = {
        x: before.x - anchor.x / next,
        y: before.y - anchor.y / next,
      };
    } else {
      this.zoom = next;
    }
    return this.zoom;
  }

  /** Zoom around a screen point, keeping the scene point under it fixed. */
  zoomAt(anchor, factor) {
    if (!Number.isFinite(factor) || factor <= 0) return this.zoom;
    return this.setZoom(this.zoom * factor, anchor);
  }

  zoomIn(anchor = null, factor = 1.2) {
    return this.setZoom(this.zoom * factor, anchor);
  }

  zoomOut(anchor = null, factor = 1.2) {
    return this.setZoom(this.zoom / factor, anchor);
  }

  reset() {
    this.pan = { x: 0, y: 0 };
    this.zoom = DEFAULT_ZOOM;
  }

  /** Fit a scene-space rect into a screen-space size, with padding. */
  fit(bounds, viewSize, padding = 48) {
    if (!bounds || !viewSize) return this.zoom;
    const width = Math.max(bounds.width, 1);
    const height = Math.max(bounds.height, 1);
    const availableW = Math.max(viewSize.width - padding * 2, 1);
    const availableH = Math.max(viewSize.height - padding * 2, 1);
    const zoom = clampZoom(Math.min(availableW / width, availableH / height));
    this.zoom = zoom;
    this.pan = {
      x: bounds.x - (viewSize.width / zoom - width) / 2,
      y: bounds.y - (viewSize.height / zoom - height) / 2,
    };
    return zoom;
  }

  /** Scene-space rectangle currently visible on screen. */
  visibleRect(viewSize) {
    return {
      x: this.pan.x,
      y: this.pan.y,
      width: viewSize.width / this.zoom,
      height: viewSize.height / this.zoom,
    };
  }

  snapPoint(point, enabled = true) {
    return snapPoint(point, this.gridSize, enabled);
  }

  snapValue(value, enabled = true) {
    return snapValue(value, this.gridSize, enabled);
  }
}
