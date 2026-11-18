/**
 * Selection arrangement: z-order, groups, lock, align, distribute, nudge.
 * Pure array/object manipulation; DOM-free.
 */
import { elementBounds, rectCenter } from './geometry.js';

export function expandGroups(elements, ids) {
  const selected = new Set(ids);
  const groups = new Set();
  for (const el of elements) {
    if (!selected.has(el.id)) continue;
    for (const groupId of el.groupIds ?? []) groups.add(groupId);
  }
  if (!groups.size) return [...selected];
  const expanded = new Set(selected);
  for (const el of elements) {
    if ((el.groupIds ?? []).some((groupId) => groups.has(groupId))) expanded.add(el.id);
  }
  return [...expanded];
}

export function reorder(elements, ids, mode) {
  const selected = new Set(ids);
  if (!selected.size) return elements.slice();
  if (mode === 'front') {
    return [
      ...elements.filter((el) => !selected.has(el.id)),
      ...elements.filter((el) => selected.has(el.id)),
    ];
  }
  if (mode === 'back') {
    return [
      ...elements.filter((el) => selected.has(el.id)),
      ...elements.filter((el) => !selected.has(el.id)),
    ];
  }
  const next = elements.slice();
  if (mode === 'forward') {
    for (let i = next.length - 2; i >= 0; i -= 1) {
      if (selected.has(next[i].id) && !selected.has(next[i + 1].id)) {
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
      }
    }
    return next;
  }
  if (mode === 'backward') {
    for (let i = 1; i < next.length; i += 1) {
      if (selected.has(next[i].id) && !selected.has(next[i - 1].id)) {
        [next[i], next[i - 1]] = [next[i - 1], next[i]];
      }
    }
    return next;
  }
  return next;
}

export function groupElements(elements, ids, groupId) {
  const selected = new Set(ids);
  for (const el of elements) {
    if (!selected.has(el.id)) continue;
    if (!Array.isArray(el.groupIds)) el.groupIds = [];
    if (!el.groupIds.includes(groupId)) el.groupIds.push(groupId);
  }
  return groupId;
}

export function ungroupElements(elements, ids) {
  const selected = new Set(ids);
  const groups = new Set();
  for (const el of elements) {
    if (!selected.has(el.id)) continue;
    for (const groupId of el.groupIds ?? []) groups.add(groupId);
  }
  for (const el of elements) {
    if (!Array.isArray(el.groupIds)) continue;
    el.groupIds = el.groupIds.filter((groupId) => !groups.has(groupId));
  }
  return [...groups];
}

export function setLocked(elements, ids, locked) {
  const selected = new Set(ids);
  for (const el of elements) {
    if (selected.has(el.id)) el.locked = Boolean(locked);
  }
  return elements;
}

export function toggleLocked(elements, ids) {
  const selected = elements.filter((el) => ids.includes(el.id));
  if (!selected.length) return false;
  const next = !selected.every((el) => el.locked);
  setLocked(elements, ids, next);
  return next;
}

export function canTransform(el) {
  return !el.locked;
}

export function selectedBounds(elements, ids, find = null) {
  const chosen = elements.filter((el) => ids.includes(el.id));
  if (!chosen.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of chosen) {
    const box = elementBounds(el, find);
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const ALIGN_MODES = Object.freeze(['left', 'centerX', 'right', 'top', 'centerY', 'bottom']);

/** Align selected elements to the selection's outer edge (locked ones stay put). */
export function alignElements(elements, ids, mode, find = null) {
  if (!ALIGN_MODES.includes(mode)) return [];
  const chosen = elements.filter((el) => ids.includes(el.id) && canTransform(el));
  if (chosen.length < 2) return [];
  const boxes = chosen.map((el) => ({ el, box: elementBounds(el, find) }));
  const left = Math.min(...boxes.map(({ box }) => box.x));
  const right = Math.max(...boxes.map(({ box }) => box.x + box.width));
  const top = Math.min(...boxes.map(({ box }) => box.y));
  const bottom = Math.max(...boxes.map(({ box }) => box.y + box.height));
  const moved = [];
  for (const { el, box } of boxes) {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = left - box.x;
    else if (mode === 'centerX') dx = (left + right) / 2 - (box.x + box.width / 2);
    else if (mode === 'right') dx = right - (box.x + box.width);
    else if (mode === 'top') dy = top - box.y;
    else if (mode === 'centerY') dy = (top + bottom) / 2 - (box.y + box.height / 2);
    else if (mode === 'bottom') dy = bottom - (box.y + box.height);
    if (dx || dy) {
      el.x += dx;
      el.y += dy;
      moved.push(el.id);
    }
  }
  return moved;
}

/** Distribute >=3 elements so the gaps between them are equal. */
export function distributeElements(elements, ids, axis = 'x', find = null) {
  if (axis !== 'x' && axis !== 'y') return [];
  const chosen = elements.filter((el) => ids.includes(el.id) && canTransform(el));
  if (chosen.length < 3) return [];
  const entries = chosen
    .map((el) => ({ el, box: elementBounds(el, find) }))
    .sort((a, b) => (axis === 'x' ? a.box.x - b.box.x : a.box.y - b.box.y));
  const first = entries[0].box;
  const last = entries[entries.length - 1].box;
  const span = axis === 'x'
    ? last.x + last.width - first.x
    : last.y + last.height - first.y;
  const used = entries.reduce((sum, { box }) => sum + (axis === 'x' ? box.width : box.height), 0);
  const gap = (span - used) / (entries.length - 1);
  const moved = [];
  let cursor = axis === 'x' ? first.x : first.y;
  for (const { el, box } of entries) {
    const current = axis === 'x' ? box.x : box.y;
    const size = axis === 'x' ? box.width : box.height;
    const delta = cursor - current;
    if (delta) {
      if (axis === 'x') el.x += delta;
      else el.y += delta;
      moved.push(el.id);
    }
    cursor += size + gap;
  }
  return moved;
}

/** Move unlocked selected elements by a delta. */
export function nudgeElements(elements, ids, dx, dy) {
  const moved = [];
  for (const el of elements) {
    if (!ids.includes(el.id) || !canTransform(el)) continue;
    el.x += dx;
    el.y += dy;
    moved.push(el.id);
  }
  return moved;
}

export function selectionCenter(elements, ids, find = null) {
  const bounds = selectedBounds(elements, ids, find);
  return bounds ? rectCenter(bounds) : null;
}
