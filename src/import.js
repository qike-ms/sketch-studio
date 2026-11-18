/**
 * Import guards for scene files and pasted JSON.
 *
 * Everything is parsed as data, never injected as HTML. The app renders text
 * through canvas / textContent, so user strings cannot become markup.
 */
import { describeIssues, validateScene } from './schema.js';

export const IMPORT_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxTextChars: 10 * 1024 * 1024,
  maxElements: 5000,
});

export function byteLength(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return String(text).length * 2;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Detection only; imported text is kept verbatim and rendered as text. */
export function containsUnsafeMarkup(value) {
  if (typeof value !== 'string') return false;
  return /<\s*\/?\s*(script|img|svg|iframe|object|embed|style|link|meta)\b/i.test(value);
}

export function scanForMarkup(scene) {
  const hits = [];
  for (const el of scene?.elements ?? []) {
    if (typeof el.text === 'string' && containsUnsafeMarkup(el.text)) hits.push(el.id);
  }
  return hits;
}

function issue(list, code, message, extra = {}) {
  list.push({ code, message, severity: extra.severity ?? 'warning', ...extra });
}

/**
 * Parse scene JSON text with size and element-count guards.
 * Returns { ok, scene, issues, stats, error } and never throws on bad input.
 */
export function parseSceneText(text, options = {}) {
  const limits = { ...IMPORT_LIMITS, ...(options.limits ?? {}) };
  const issues = [];
  if (typeof text !== 'string') {
    return { ok: false, scene: null, issues, stats: null, error: 'Not a text file.' };
  }
  if (text.length === 0) {
    return { ok: false, scene: null, issues, stats: null, error: 'The file is empty.' };
  }
  const bytes = byteLength(text);
  if (bytes > limits.maxBytes) {
    return {
      ok: false,
      scene: null,
      issues,
      stats: null,
      error: `File is too large (${Math.round(bytes / 1024)} KB; limit ${Math.round(limits.maxBytes / 1024)} KB).`,
    };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      scene: null,
      issues,
      stats: null,
      error: `Could not parse JSON: ${error.message}`,
    };
  }
  const result = validateScene(data, { limits });
  if (!result.ok) {
    return {
      ok: false,
      scene: null,
      issues: result.issues,
      stats: result.stats,
      error: 'The file does not contain a usable scene.',
    };
  }
  issues.push(...result.issues);
  const markup = scanForMarkup(result.scene);
  if (markup.length) {
    issue(issues, 'markup-in-text', `${markup.length} text element(s) contain markup-like characters; they are rendered as plain text`);
  }
  return {
    ok: true,
    scene: result.scene,
    issues,
    stats: result.stats,
    error: null,
    summary: describeIssues(issues),
  };
}

/**
 * Validate a browser File-like object before reading it.
 * `file.size` is used when available; `text` is checked as a fallback.
 */
export function checkFile(file, options = {}) {
  const limits = { ...IMPORT_LIMITS, ...(options.limits ?? {}) };
  if (!file) return { ok: false, error: 'No file selected.' };
  if (Number.isFinite(file.size) && file.size > limits.maxBytes) {
    return {
      ok: false,
      error: `File is too large (${Math.round(file.size / 1024)} KB; limit ${Math.round(limits.maxBytes / 1024)} KB).`,
    };
  }
  return { ok: true, error: null };
}

/** Parse a pasted clipboard payload. Returns null when it is not our format. */
export function parseClipboardText(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (data.type !== 'sketch-studio/clipboard' && !Array.isArray(data.elements)) return null;
  const result = validateScene({ version: data.version, elements: data.elements }, options);
  if (!result.ok) return null;
  return { scene: result.scene, issues: result.issues, stats: result.stats };
}
