import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { Role } from '../routes';
import { opens } from '../help';
import { Prose } from '../help/Prose';
import { useTrap } from './overlay';

/**
 * A guided tour over the live interface.
 *
 * It points; it never acts. A step names a control and says what it does, and
 * the person presses it once the tour is over. A tour that pressed Confirm
 * would write a journalled record under someone's name that they did not
 * decide to make, so the shade over the page takes every click and nothing
 * beneath it can be used while a tour is open.
 *
 * The content policy drops inline styles, so nothing here is positioned by a
 * `style` attribute. The spotlight is an SVG the size of the window whose
 * rectangles are geometry attributes, the way the charts are drawn, and the
 * words sit in a panel docked by the stylesheet rather than floated beside the
 * control.
 */
export type TourStep = {
  /** A `data-tour` name. Alternatives are separated by `|`; the first one on screen is used,
   *  so a step can point at the rail on a laptop and at the menu button on a phone. */
  target?: string;
  /** The screen the step is on, when it is not the tour's own. */
  route?: string;
  title: string;
  body: string;
  /** Said instead of pointing when the control is not on screen, in the step's own words. */
  absent?: string;
};

export type Tour = {
  id: string;
  title: string;
  summary: string;
  /** Omitted: every role. */
  roles?: Role[];
  /** The screen the tour starts on; omitted for the shell's own furniture. */
  route?: string;
  steps: TourStep[];
};

type Box = { x: number; y: number; w: number; h: number };

const PAD = 6;
const routeInHash = () => location.hash.replace(/^#\/?/, '').replace(/\?.*$/, '') || 'overview';

/** The first of a step's targets that is drawn inside the window. */
export function findTarget(target: string | undefined, root: ParentNode = document): HTMLElement | null {
  if (!target) return null;
  for (const name of target.split('|')) {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      const r = element.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth) return element;
    }
  }
  return null;
}

export function TourOverlay({ tour, role, onNavigate, onClose }: {
  tour: Tour;
  role: unknown;
  onNavigate: (route: string) => void;
  onClose: () => void;
}) {
  const panel = useTrap(onClose);
  // The trap focuses the first control, End tour; a tour opens on Next, so Enter goes on rather than stopping.
  useEffect(() => { panel.current?.querySelector<HTMLElement>('.btn.primary')?.focus(); }, []);
  const [at, setAt] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [looking, setLooking] = useState(true);
  const [view, setView] = useState(() => ({ w: innerWidth, h: innerHeight }));
  const step = tour.steps[at]!;
  const last = at === tour.steps.length - 1;
  // A step that points at nothing stays where the reader is: a closing word should not send them back to the start.
  const where = step.route ?? (step.target ? tour.route : undefined);

  const measure = useCallback(() => {
    setView({ w: innerWidth, h: innerHeight });
    const element = findTarget(step.target);
    if (!element) { setBox(null); return false; }
    const r = element.getBoundingClientRect();
    setBox({ x: Math.max(0, r.left - PAD), y: Math.max(0, r.top - PAD), w: r.width + PAD * 2, h: r.height + PAD * 2 });
    return true;
  }, [step.target]);

  // Go to the step's screen, then wait for its control to be drawn: a screen
  // fetches before it renders, so the control may arrive a moment after it.
  useLayoutEffect(() => {
    if (where && routeInHash() !== where) onNavigate(where);
    setBox(null);
    setLooking(Boolean(step.target));
    if (!step.target) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const element = findTarget(step.target);
      if (element) {
        element.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        requestAnimationFrame(() => { measure(); setLooking(false); });
        return;
      }
      // A control the screen drew but hid (the year on a phone) will not appear by waiting; say so at once.
      const hidden = step.target!.split('|').some(name => document.querySelector(`[data-tour="${name}"]`));
      if (!hidden && ++tries < 25) timer = setTimeout(look, 100); else setLooking(false);
    };
    look();
    return () => { if (timer) clearTimeout(timer); };
  }, [at]);

  useEffect(() => {
    let frame = 0;
    const again = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { measure(); }); };
    addEventListener('resize', again);
    addEventListener('scroll', again, true);
    // A turned phone slides the rail away after the resize; measuring only then would ring where it was.
    addEventListener('transitionend', again, true);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', again); removeEventListener('scroll', again, true); removeEventListener('transitionend', again, true);
    };
  }, [measure]);

  // Arrow keys move through the steps, as they do through a slideshow, unless a button is being used.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' && !last) setAt(n => n + 1);
      if (event.key === 'ArrowLeft' && at > 0) setAt(n => n - 1);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [at, last]);

  const missing = Boolean(step.target) && !looking && !box;

  return (
    <div className="tour">
      <svg className="tour-shade" width={view.w} height={view.h} viewBox={`0 0 ${view.w} ${view.h}`} aria-hidden="true" focusable="false">
        <defs>
          <mask id="tour-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={view.w} height={view.h}>
            <rect x="0" y="0" width={view.w} height={view.h} fill="white" />
            {box ? <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="black" /> : null}
          </mask>
        </defs>
        <rect className="tour-dim" x="0" y="0" width={view.w} height={view.h} mask="url(#tour-mask)" />
        {box ? <rect className="tour-ring" x={box.x} y={box.y} width={box.w} height={box.h} /> : null}
      </svg>
      <div className="tour-panel" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabIndex={-1} ref={panel}>
        <p className="tour-count" aria-live="polite">{tour.title} · Step {at + 1} of {tour.steps.length}</p>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body"><Prose text={step.body} opens={opens(role)} /></p>
        {missing ? <p className="tour-missing">{step.absent ?? 'What this step points at is not on screen right now, so it is described here instead.'}</p> : null}
        <div className="tour-actions">
          <button type="button" className="btn ghost" onClick={onClose}>End tour</button>
          <span className="tour-gap" />
          <button type="button" className="btn secondary" disabled={at === 0} onClick={() => setAt(n => n - 1)}>Back</button>
          <button type="button" className="btn primary" onClick={() => (last ? onClose() : setAt(n => n + 1))}>{last ? 'Finish' : 'Next'}</button>
        </div>
        <p className="tour-note">A tour only points. Nothing changes until you do it yourself.</p>
      </div>
    </div>
  );
}
