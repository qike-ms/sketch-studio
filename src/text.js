/**
 * Text-editing and label helpers. DOM-free; measurement stays in render.js.
 */
export function textLines(text) {
  return String(text ?? '').split('\n');
}

export function clampCaret(text, caret) {
  const value = Number.isFinite(caret) ? Math.floor(caret) : 0;
  return Math.min(Math.max(value, 0), String(text ?? '').length);
}

export function caretLineColumn(text, caret) {
  const value = String(text ?? '');
  const index = clampCaret(value, caret);
  const before = value.slice(0, index);
  const line = before.split('\n').length - 1;
  const column = before.length - (before.lastIndexOf('\n') + 1);
  return { line, column };
}

export function insertText(text, caret, insert, options = {}) {
  const value = String(text ?? '');
  const index = clampCaret(value, caret);
  const addition = String(insert ?? '');
  const maxLength = options.maxLength;
  if (Number.isFinite(maxLength) && value.length + addition.length > maxLength) {
    return { text: value, caret: index, limited: true };
  }
  return {
    text: value.slice(0, index) + addition + value.slice(index),
    caret: index + addition.length,
    limited: false,
  };
}

export function deleteText(text, caret, forward = false) {
  const value = String(text ?? '');
  if (!value.length) return { text: value, caret: 0 };
  let index = clampCaret(value, caret);
  if (forward) {
    if (index >= value.length) return { text: value, caret: index };
  } else {
    if (index === 0) return { text: value, caret: 0 };
    index -= 1;
  }
  return {
    text: value.slice(0, index) + value.slice(index + 1),
    caret: index,
  };
}

/** Arrow-key caret movement, including up/down within wrapped lines. */
export function moveCaret(text, caret, direction) {
  const value = String(text ?? '');
  const index = clampCaret(value, caret);
  if (direction === 'left') return Math.max(0, index - 1);
  if (direction === 'right') return Math.min(value.length, index + 1);
  if (direction === 'up' || direction === 'down') {
    const { line, column } = caretLineColumn(value, index);
    const lines = textLines(value);
    const targetLine = direction === 'up' ? line - 1 : line + 1;
    if (targetLine < 0 || targetLine >= lines.length) return index;
    let offset = 0;
    for (let i = 0; i < targetLine; i += 1) offset += lines[i].length + 1;
    return offset + Math.min(column, lines[targetLine].length);
  }
  return index;
}

export function findLabel(elements, containerId) {
  return elements.find((el) => el.type === 'text' && el.containerId === containerId) ?? null;
}

export function labelPosition(container, width, height) {
  return {
    x: container.x + (container.width - width) / 2,
    y: container.y + (container.height - height) / 2,
  };
}

/**
 * Ensure a shape has an editable text label. Returns { element, created }.
 * The caller measures the text after the first keystroke.
 */
export function ensureLabel(elements, container, style = {}, idFactory = null) {
  if (!container) return { element: null, created: false };
  const existing = findLabel(elements, container.id);
  if (existing) return { element: existing, created: false };
  const fontSize = style.fontSize ?? 24;
  const lineHeight = style.lineHeight ?? 1.25;
  const position = labelPosition(container, 0, fontSize * lineHeight);
  const element = {
    id: idFactory ? idFactory() : `label_${container.id}`,
    type: 'text',
    x: position.x,
    y: position.y,
    width: 0,
    height: fontSize * lineHeight,
    text: '',
    fontSize,
    lineHeight,
    strokeColor: style.strokeColor ?? '#1e1e1e',
    opacity: 100,
    containerId: container.id,
    groupIds: [],
    locked: false,
    angle: 0,
    edgeStyle: 'sharp',
    fontFamily: style.fontFamily ?? 'hand',
    points: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: 'none',
    endArrowhead: 'none',
    elbow: false,
    imageSrc: null,
    strokeWidth: 2,
    strokeStyle: 'solid',
    backgroundColor: 'transparent',
    backgroundAlpha: 0.35,
    roughness: 1,
  };
  elements.push(element);
  return { element, created: true };
}

/** Re-centre every bound label after a container moves or resizes. */
export function repositionLabels(elements, measure = null) {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const moved = [];
  for (const el of elements) {
    if (el.type !== 'text' || !el.containerId) continue;
    const container = byId.get(el.containerId);
    if (!container) {
      el.containerId = null;
      continue;
    }
    if (measure) measure(el);
    const position = labelPosition(container, el.width, el.height);
    if (position.x !== el.x || position.y !== el.y) {
      el.x = position.x;
      el.y = position.y;
      moved.push(el.id);
    }
  }
  return moved;
}

export function isBlankText(text) {
  return !String(text ?? '').trim();
}
