/**
 * Lock policy shared by every edit entry point.
 *
 * A label inherits its container's lock: if the shape is locked, its bound
 * text cannot be edited, moved or restyled either.
 */

export function isElementLocked(el, find = null) {
  if (!el) return true;
  if (el.locked) return true;
  if (find && el.containerId) {
    const container = find(el.containerId);
    if (container?.locked) return true;
  }
  return false;
}

export function canEdit(el, find = null) {
  return Boolean(el) && !isElementLocked(el, find);
}

export function filterEditable(elements, ids, find = null) {
  const byId = new Map(elements.map((el) => [el.id, el]));
  return ids.filter((id) => {
    const el = find ? find(id) : byId.get(id);
    return canEdit(el, find);
  });
}
