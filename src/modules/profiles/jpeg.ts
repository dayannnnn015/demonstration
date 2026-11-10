import { createHash } from 'node:crypto';

export type CheckedJpeg = { bytes: Buffer; width: number; height: number; sha256: string };

// Segments a decoder needs. Everything else a camera or an editor writes
// (EXIF with its GPS position and device serial, XMP, ICC, comments, thumbnails)
// is dropped, whatever the browser did before sending it.
const kept = new Set([0xc0, 0xc1, 0xc2, 0xc4, 0xdb, 0xdd, 0xe0, 0xee]);
const frames = new Set([0xc0, 0xc1, 0xc2]);

/**
 * A baseline or progressive JPEG, rebuilt from its decoding segments only, or
 * null if it is not one. The browser already re-encodes the picture through a
 * canvas, which carries no metadata; this is the check that does not depend on
 * the browser being the one sending it.
 */
export function checkJpeg(input: Buffer, limits: { min: number; max: number; square?: boolean }): CheckedJpeg | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let at = 2, width = 0, height = 0;
  for (;;) {
    if (at + 4 > input.length || input[at] !== 0xff) return null;
    const marker = input[at + 1]!;
    if (marker === 0xff) { at++; continue; }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) return null;
    const length = input.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > input.length) return null;
    const segment = input.subarray(at, at + 2 + length);
    if (frames.has(marker)) {
      if (width || length < 8) return null;
      height = input.readUInt16BE(at + 5);
      width = input.readUInt16BE(at + 7);
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return null;
    if (marker === 0xda) {
      if (!width) return null;
      // The scan runs to the end of the image; a file whose last two bytes are not the end marker is cut off or carries a payload.
      const tail = input.subarray(at);
      if (tail.length < 4 || tail[tail.length - 2] !== 0xff || tail[tail.length - 1] !== 0xd9) return null;
      out.push(tail);
      break;
    }
    // A JFIF header longer than its 16 bytes is carrying an embedded thumbnail, which is a second picture nobody checked.
    if (kept.has(marker) && !(marker === 0xe0 && length > 16)) out.push(segment);
    at += 2 + length;
  }
  if (width < limits.min || height < limits.min || width > limits.max || height > limits.max) return null;
  if (limits.square && width !== height) return null;
  const bytes = Buffer.concat(out);
  return { bytes, width, height, sha256: createHash('sha256').update(bytes).digest('hex') };
}
