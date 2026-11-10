import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** How a person appears, as `/me`, `/me/profile` and the staff list return it. */
export type Look = {
  avatar?: unknown;
  avatar_icon?: unknown;
  avatar_tone?: unknown;
  photo?: { sha256: string; thumb: string } | null | undefined;
};

export const avatarTones = [['slate', 'Slate'], ['blue', 'Blue'], ['green', 'Green'], ['ochre', 'Ochre'], ['plum', 'Plum'], ['teal', 'Teal']] as const;

// Drawn, like every icon here: the content policy loads no image file.
const glyphs: Record<string, ReactNode> = {
  book: <><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M8 7h7" /></>,
  pencil: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" /></>,
  leaf: <><path d="M5 19c0-8 6-14 15-14c0 9-6 15-14 15" /><path d="m5 19 8-8" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  star: <><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" /></>,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  flask: <><path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7 15h10" /></>,
  ball: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8" /></>,
  heart: <><path d="M12 20s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7.3 4.5 4.5 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5Z" /></>,
  palette: <><path d="M12 3a9 9 0 0 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7.5" r="1" /><circle cx="14.5" cy="7.5" r="1" /></>,
};
export const avatarIcons = Object.keys(glyphs);

export function Glyph({ name, size }: { name: string; size: number }) {
  return (
    <svg className="ico" aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {glyphs[name] ?? glyphs.star}
    </svg>
  );
}

/** Two letters is enough to tell 33 people apart. */
export const initials = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('') || '?';

// A decoded picture is kept for the life of the page, keyed by what it is, so a
// re-render or a second avatar of the same person does not decode it again.
const decoded = new Map<string, Promise<ImageBitmap | null>>();

/** A stored picture, as base64 JPEG, decoded without ever becoming an image the page loads. */
export function decodePicture(key: string, base64: string) {
  let found = decoded.get(key);
  if (!found) {
    found = (async () => {
      if (typeof createImageBitmap !== 'function') return null;
      try {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        return await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      } catch { return null; }
    })();
    decoded.set(key, found);
  }
  return found;
}

/**
 * Draws a picture onto a canvas at the screen's pixel density. A canvas, not an
 * <img>: the workspace's img-src admits only its own favicon, and a canvas
 * drawn from bytes read through the API is not an image load at all.
 */
export function PictureCanvas({ bitmap, className, label }: { bitmap: ImageBitmap; className?: string; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext('2d');
    if (!target || !context) return;
    const box = target.getBoundingClientRect();
    const side = Math.max(1, Math.round((box.width || 96) * (globalThis.devicePixelRatio || 1)));
    target.width = side;
    target.height = side;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, side, side);
  }, [bitmap]);
  return <canvas ref={canvas} className={className} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} />;
}

/**
 * A person's face in the workspace: their photo, a drawn icon or their
 * initials, on the colour they chose. While a photo is still being decoded, or
 * where it cannot be, the initials stand in, so nobody is ever shown as blank.
 * `image` is the full picture when the place is large enough to need it; the
 * thumbnail serves everywhere else.
 */
export function Avatar({ name, look, size = 'md', image, label }: {
  name: string;
  look?: Look | null | undefined;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  image?: { sha256: string; base64: string } | null | undefined;
  /** Given only where the avatar is the thing being shown, such as the profile page; elsewhere a name sits beside it. */
  label?: string;
}) {
  const tone = typeof look?.avatar_tone === 'string' ? look.avatar_tone : 'slate';
  const source = look?.avatar === 'photo' ? (image ? { key: `${image.sha256}:full`, data: image.base64 } : look.photo ? { key: `${look.photo.sha256}:thumb`, data: look.photo.thumb } : null) : null;
  const [bitmap, setBitmap] = useState<{ key: string; bitmap: ImageBitmap } | null>(null);
  useEffect(() => {
    if (!source) return;
    let live = true;
    void decodePicture(source.key, source.data).then(found => { if (live && found) setBitmap({ key: source.key, bitmap: found }); });
    return () => { live = false; };
  }, [source?.key]);
  const drawn = source && bitmap?.key === source.key ? bitmap.bitmap : null;
  const icon = look?.avatar === 'icon' && typeof look.avatar_icon === 'string' ? look.avatar_icon : null;
  const glyphSize = { sm: 14, md: 16, lg: 40, xl: 56 }[size];
  return (
    <span className={`avatar ${size} tone-${tone}${drawn ? ' has-photo' : ''}`} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      {drawn ? <PictureCanvas bitmap={drawn} className="avatar-photo" /> : icon ? <Glyph name={icon} size={glyphSize} /> : initials(name)}
    </span>
  );
}
