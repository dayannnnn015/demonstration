import type { ReactNode } from 'react';

/**
 * The workspace figures, drawn as inline SVG.
 *
 * Two constraints shape everything here. The content policy is
 * `default-src 'none'`, and its one `img-src 'self'` covers the favicon and
 * nothing else, so a charting library that rasterises to a canvas or injects a
 * background image has nothing to draw into; and
 * `style-src 'self'` drops inline `style` attributes, so a bar cannot be sized
 * with `style={{ width }}`. SVG geometry attributes — `x`, `width`, `r`,
 * `stroke-dasharray` — are not inline styles and are unaffected, so every
 * dimension that depends on data is expressed as one of those.
 *
 * Colour comes from classes (`.slice-1` … `.slice-5`) resolving to the chart
 * ramp in tokens.css, so a figure follows the theme rather than hard-coding it.
 */

const RAMP = 5;
export const sliceClass = (index: number) => `slice-${(index % RAMP) + 1}`;

/** A headline count with the fact it was counted from. Never a computed grade. */
export function StatTile({ label, value, meta, accent = 0 }: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  /** Which step of the chart ramp tints the tile's edge. */
  accent?: number;
}) {
  return (
    <div className={`tile ${sliceClass(accent)}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {meta ? <span className="tile-meta">{meta}</span> : null}
    </div>
  );
}

export type Slice = { label: string; count: number };

/**
 * A ring of counted records. Drawn with `stroke-dasharray` on concentric
 * circles rather than arc paths, which keeps every slice one element and makes
 * a zero-count slice disappear instead of rendering a degenerate wedge.
 */
export function Donut({ slices, centreLabel, centreValue }: {
  slices: Slice[];
  centreLabel: string;
  centreValue: ReactNode;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const R = 46;
  const C = 2 * Math.PI * R;
  let used = 0;
  return (
    <div className="donut">
      <div className="donut-figure">
        <svg viewBox="0 0 120 120" role="img" aria-label={`${centreLabel}: ${slices.map(s => `${s.count} ${s.label}`).join(', ')}`}>
          <circle className="donut-track" cx="60" cy="60" r={R} />
          {total === 0 ? null : slices.map((slice, index) => {
            const length = (slice.count / total) * C;
            const offset = -used;
            used += length;
            if (!slice.count) return null;
            return (
              <circle
                key={slice.label}
                className={`donut-slice ${sliceClass(index)}`}
                cx="60"
                cy="60"
                r={R}
                strokeDasharray={`${length.toFixed(2)} ${(C - length).toFixed(2)}`}
                strokeDashoffset={offset.toFixed(2)}
                transform="rotate(-90 60 60)"
              />
            );
          })}
        </svg>
        <div className="donut-centre" aria-hidden="true">
          <b>{centreValue}</b>
          <span>{centreLabel}</span>
        </div>
      </div>
      <ul className="legend">
        {slices.map((slice, index) => (
          <li key={slice.label}>
            <span className={`swatch ${sliceClass(index)}`} aria-hidden="true" />
            <b>{slice.count}</b>
            <span>{slice.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type Span = { label: string; from: string; to: string };

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * The reporting periods laid across the school year, with today marked.
 *
 * This is a calendar figure, not an academic one: it says which stretch of the
 * year a date falls in, which is a fact the school year rows already state. It
 * computes no progress score and no grade.
 */
export function Timeline({ from, to, spans, today }: {
  from: string;
  to: string;
  spans: Span[];
  today: string;
}) {
  const start = day(from);
  const end = day(to);
  const width = Math.max(end - start, 1);
  const at = (iso: string) => ((day(iso) - start) / width) * 1000;
  const now = day(today);
  const inside = now >= start && now <= end;

  return (
    <div className="timeline">
      <svg viewBox="0 0 1000 48" preserveAspectRatio="none" role="img" aria-label={`School year ${from} to ${to}, ${spans.length} reporting periods`}>
        <rect className="timeline-track" x="0" y="14" width="1000" height="20" />
        {spans.map((span, index) => {
          const x = Math.max(0, at(span.from));
          const right = Math.min(1000, at(span.to));
          return (
            <rect
              key={`${span.label}-${span.from}`}
              className={`timeline-span ${sliceClass(index)}`}
              x={x.toFixed(2)}
              y="14"
              width={Math.max(right - x, 2).toFixed(2)}
              height="20"
            />
          );
        })}
        {inside ? <rect className="timeline-now" x={Math.min(998, Math.max(0, at(today))).toFixed(2)} y="6" width="2" height="36" /> : null}
      </svg>
      <div className="timeline-ends">
        <span>{from}</span>
        {inside ? <span className="timeline-today">Today · {today}</span> : <span className="muted">Today falls outside this year</span>}
        <span>{to}</span>
      </div>
      <ul className="legend rows">
        {spans.map((span, index) => (
          <li key={`${span.label}-${span.from}`}>
            <span className={`swatch ${sliceClass(index)}`} aria-hidden="true" />
            <b>{span.label}</b>
            <span className="mono">{span.from} → {span.to}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
