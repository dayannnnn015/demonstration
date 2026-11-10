/**
 * The EDUNEXUS mark, drawn as inline SVG.
 *
 * The workspace content policy is `default-src 'none'`; its only `img-src` is
 * `'self'`, added for the favicon and for nothing else. No screen loads an
 * image file, so this is a vector redraw of the supplied artwork, traced to its
 * own measurements and colours, and it renders under the policy exactly as the
 * charts do. The original sits in `docs/brand/` next to an export of this file,
 * and `web/public/favicon.svg` is a third cut of the same geometry; anyone
 * re-cutting the mark should compare all three.
 *
 * The three brand colours are literals rather than tokens on purpose: they
 * belong to the logo and must not drift when the interface palette is retuned.
 *
 * Navy sits at #02264d, so the mark needs a light ground. `.brand-mark` gives
 * it a white tile in the rail; on the sign-in card that tile is invisible.
 */

const NAVY = '#02264d';
const BLUE = '#329df0';
const SUN = '#fcb929';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brandmark"
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
    >
      {/* Horizon arc, open at the foot, closing into the growth arrow. */}
      <path d="M10.5 38.1 A22.9 22.9 0 1 1 52.5 35" stroke={BLUE} strokeWidth={3.3} strokeLinecap="round" />
      <circle cx="41.6" cy="17.1" r="4.4" fill={SUN} />
      {/* The open pages, which occlude the foot of the arc and the mountain base. */}
      <path d="M32 36 C23 37 11 39.4 3.2 41.4 C12.5 41.7 24 44.6 32 50.2 Z" fill="#fff" />
      <path d="M32 36 C41 37 53 39.4 60.8 41.4 C51.5 41.7 40 44.6 32 50.2 Z" fill="#fff" />
      <path d="M8 36 L17 23.5 L21.8 29.2 L31.5 16 L42 28 L45.5 24.5 L51.5 36 Z" fill={NAVY} />
      <path d="M31.5 16 L36.75 22 L34.9 23.6 L33.2 21.6 L31.3 24 L29.4 21.4 L27.7 22.9 L27.1 22 Z" fill="#fff" />
      <path d="M17 23.5 L19.95 27 L18.7 28.3 L17.4 26.9 L16.1 28.5 L14.48 27 Z" fill="#fff" />
      <path
        d="M6 36.9 L23.1 36.3 L26.9 35.9 L31.3 36.5 L39.4 30.6 L49.4 28.1 L55.5 22.5"
        stroke={BLUE}
        strokeWidth={2.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M61.5 16.5 L59.03 26.05 L51.95 18.97 Z" fill={BLUE} />
      <g fill={BLUE}>
        <circle cx="23.1" cy="36.3" r="1.8" />
        <circle cx="26.9" cy="35.9" r="1.8" />
        <circle cx="31.3" cy="36.5" r="1.8" />
        <circle cx="39.4" cy="30.6" r="1.8" />
        <circle cx="49.4" cy="28.1" r="1.8" />
      </g>
      <path
        d="M0.8 42.6 C12.5 41.9 24 44.8 32 50.4 C40 44.8 51.5 41.9 63.2 42.6 L63.2 47.8 C53 47.2 41.5 50.4 32 60.5 C22.5 50.4 11 47.2 0.8 47.8 Z"
        fill={NAVY}
      />
      <path d="M5.5 44.6 C14 45.4 23.5 48 29.8 52.6 L29.8 55.2 C23.5 50.6 14 48 5.5 47.2 Z" fill="#fff" />
      <path d="M58.5 44.6 C50 45.4 40.5 48 34.2 52.6 L34.2 55.2 C40.5 50.6 50 48 58.5 47.2 Z" fill="#fff" />
    </svg>
  );
}
