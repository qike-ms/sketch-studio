/**
 * Image insert helpers: MIME/size guards, data-URL checks and fitting.
 * The browser side owns FileReader / Image decoding; this module is pure.
 */
import { makeElement } from './scene.js';

export const IMAGE_MIMES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 4096;

export function isImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value);
}

export function checkImageFile(file, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  if (!file) return { ok: false, error: 'No image selected.' };
  if (!IMAGE_MIMES.includes(file.type)) {
    return { ok: false, error: `Unsupported image type: ${file.type || 'unknown'}.` };
  }
  if (Number.isFinite(file.size) && file.size > maxBytes) {
    return { ok: false, error: `Image is too large (${Math.round(file.size / 1024)} KB; limit ${Math.round(maxBytes / 1024)} KB).` };
  }
  return { ok: true, error: null };
}

/** Fit natural dimensions into a maximum box without changing the aspect ratio. */
export function fitImageSize(width, height, maxWidth = 600, maxHeight = 600) {
  const w = Number.isFinite(width) && width > 0 ? width : maxWidth;
  const h = Number.isFinite(height) && height > 0 ? height : maxHeight;
  const ratio = Math.min(maxWidth / w, maxHeight / h, 1);
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
  };
}

export function createImageElement(props) {
  if (!isImageDataUrl(props.imageSrc)) return null;
  const size = fitImageSize(props.width, props.height, props.maxWidth ?? 600, props.maxHeight ?? 600);
  return makeElement({
    type: 'image',
    x: props.x ?? 0,
    y: props.y ?? 0,
    width: size.width,
    height: size.height,
    imageSrc: props.imageSrc,
    opacity: props.opacity ?? 100,
    angle: props.angle ?? 0,
    groupIds: props.groupIds ?? [],
    locked: false,
    strokeColor: props.strokeColor ?? '#1e1e1e',
  });
}

/** Drop point for a pasted image: centre it on the cursor. */
export function imageDropPosition(point, width, height) {
  return { x: point.x - width / 2, y: point.y - height / 2 };
}
