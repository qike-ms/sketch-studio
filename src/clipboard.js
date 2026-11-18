/**
 * Copy / cut / paste payloads.
 *
 * The same payload goes to the in-app clipboard and the system clipboard as
 * JSON, and is re-validated on paste so corrupt clipboard data cannot inject
 * bad elements into the scene.
 */
import { SCHEMA_VERSION } from './scene.js';
import { validateScene } from './schema.js';

export const CLIPBOARD_TYPE = 'sketch-studio/clipboard';

export function buildClipboardPayload(elements, ids, version = SCHEMA_VERSION) {
  const selected = new Set(ids);
  const picked = elements.filter((el) => selected.has(el.id));
  return {
    type: CLIPBOARD_TYPE,
    version,
    elements: JSON.parse(JSON.stringify(picked)),
  };
}

export function serializeClipboard(payload) {
  return JSON.stringify(payload);
}

export function parseClipboardPayload(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (data.type !== CLIPBOARD_TYPE && !Array.isArray(data.elements)) return null;
  let result;
  try {
    result = validateScene({ version: data.version, elements: data.elements });
  } catch {
    return null;
  }
  if (!result.ok || !result.scene.elements.length) return null;
  return { elements: result.scene.elements, issues: result.issues, stats: result.stats };
}

/**
 * Paste validated elements into an existing element array.
 * Ids, group ids, containers and bindings are remapped together; references
 * that point outside the copied set are dropped rather than left dangling.
 */
export function pasteElements(existing, payloadElements, options = {}) {
  const dx = options.dx ?? 20;
  const dy = options.dy ?? 20;
  const idFactory = options.idFactory ?? ((n) => `el_paste_${n.toString(36)}`);
  const groupFactory = options.groupFactory ?? ((n) => `group_paste_${n.toString(36)}`);
  const taken = new Set(existing.map((el) => el.id));
  let counter = 0;
  const nextId = () => {
    let candidate;
    do {
      counter += 1;
      candidate = idFactory(counter);
    } while (taken.has(candidate));
    taken.add(candidate);
    return candidate;
  };

  const idMap = new Map();
  for (const el of payloadElements) idMap.set(el.id, nextId());

  // Reserve every group id already in the scene (including earlier generated
  // paste groups) so repeated pastes never merge independent copies.
  const takenGroups = new Set();
  for (const el of existing) {
    for (const groupId of el.groupIds ?? []) takenGroups.add(groupId);
  }
  const groupMap = new Map();
  let groupCounter = 0;
  const mapGroup = (groupId) => {
    if (!groupMap.has(groupId)) {
      let candidate;
      do {
        groupCounter += 1;
        candidate = groupFactory(groupCounter);
      } while (takenGroups.has(candidate));
      takenGroups.add(candidate);
      groupMap.set(groupId, candidate);
    }
    return groupMap.get(groupId);
  };

  const pasted = payloadElements.map((source) => {
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = idMap.get(source.id);
    copy.x += dx;
    copy.y += dy;
    copy.groupIds = (copy.groupIds ?? []).map(mapGroup);
    copy.containerId = copy.containerId && idMap.has(copy.containerId)
      ? idMap.get(copy.containerId)
      : null;
    for (const key of ['startBinding', 'endBinding']) {
      const binding = copy[key];
      copy[key] = binding && idMap.has(binding.elementId)
        ? { elementId: idMap.get(binding.elementId) }
        : null;
    }
    return copy;
  });

  return {
    elements: pasted,
    ids: pasted.map((el) => el.id),
    issues: [],
  };
}

/** Small fallback clipboard used when navigator.clipboard is unavailable. */
export function createMemoryClipboard() {
  let text = null;
  return {
    write: (value) => {
      text = value;
      return true;
    },
    read: () => text,
    clear: () => {
      text = null;
    },
  };
}

export function cutPayload(elements, ids) {
  return buildClipboardPayload(elements, ids);
}
