import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icons';

/**
 * The two overlays the workspace needs, and the keyboard behaviour they share.
 *
 * Neither existed before. Creating a record meant a second full-width form
 * parked permanently under the list it added to, and confirming a destructive
 * change meant `window.confirm` — a dialog that cannot say what closing a
 * school year does, cannot be read by anyone using the interface's own
 * vocabulary, and which a browser may suppress outright, turning an
 * irreversible change into a silent yes.
 *
 * Both render nothing at all when closed. That matters beyond tidiness: the
 * shell is asserted in `tests/web-shell.test.ts` against its own rendered
 * markup, and an overlay that merely hid itself with CSS would put its
 * contents — including the text of a destructive action — into the page for
 * anything reading the DOM.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Every overlay open now, innermost last: a review over a form's own view must not close the view on its Escape. */
const opened: object[] = [];

/**
 * Holds the keyboard inside an open overlay, closes on Escape, and hands focus
 * back to whatever opened it. The page behind is locked with a class rather
 * than by setting `document.body.style`, because an inline style attribute is
 * the one thing this content policy silently drops.
 */
export function useTrap(onClose: () => void) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    const self = {};
    opened.push(self);
    const returnTo = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add('locked');
    const panel = box.current;
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();

    const key = (event: KeyboardEvent) => {
      // Only the innermost overlay answers the keyboard.
      if (opened[opened.length - 1] !== self) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return; }
      if (event.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      // Only the two edges are intercepted; everything between them tabs as
      // normal, so a long form still reads in source order.
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    };
    addEventListener('keydown', key, true);
    return () => {
      removeEventListener('keydown', key, true);
      opened.splice(opened.indexOf(self), 1);
      // The page stays locked while an outer overlay is still open.
      if (!opened.length) document.documentElement.classList.remove('locked');
      returnTo?.focus?.();
    };
  }, []);

  return box;
}

/** Dismiss when the press starts on the backdrop, not when it merely ends there —
 *  a drag that begins inside a field and releases outside must not close the form. */
const backdrop = (onClose: () => void) => (event: React.MouseEvent) => {
  if (event.target === event.currentTarget) onClose();
};

/**
 * A side panel for one task: register a learner, add a section, request an
 * invitation. It arrives when asked for and leaves when it is done, so a
 * screen stays the register it is named after.
 *
 * `full` is for a document rather than a task, such as an SF9: it takes the
 * whole working area beside the rail instead of sliding in at the side, and
 * follows the rail as it collapses or becomes a drawer (the group leader's
 * note of 12 October). Its `actions` ride in the head, so they stay in reach
 * however long the document is.
 */
export function Sheet({ title, note, wide, full, actions, onClose, children }: {
  title: string;
  note?: string | undefined;
  wide?: boolean | undefined;
  full?: boolean | undefined;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useTrap(onClose);
  const heading = useId();
  return (
    <div className={`sheet${full ? ' full' : ''}`} onMouseDown={full ? undefined : backdrop(onClose)}>
      <div className={`sheet-panel${wide ? ' wide' : ''}${full ? ' full' : ''}`} role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1} ref={box}>
        <div className="sheet-head">
          <div>
            <h2 id={heading}>{title}</h2>
            {note ? <p>{note}</p> : null}
          </div>
          {actions ? <div className="sheet-actions">{actions}</div> : null}
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}><Icon name="close" size={17} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * The confirmation before something that cannot be undone from the interface.
 * It states the consequence in the same words the screen used, because the
 * decision is the point and "Are you sure?" says nothing.
 */
export function Confirm({ title, body, confirmLabel, tone = 'danger', busy, onConfirm, onClose }: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'plain' | undefined;
  busy?: boolean | undefined;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const box = useTrap(onClose);
  const heading = useId();
  return (
    <div className="dialog" onMouseDown={backdrop(onClose)}>
      <div className={`dialog-box${tone === 'plain' ? ' plain' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1} ref={box}>
        <div className="dialog-body">
          <h2 id={heading}>{title}</h2>
          <p>{body}</p>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>Keep as it is</button>
          <button type="button" className={tone === 'danger' ? 'btn danger' : 'btn'} onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {busy ? <><span className="btn-mark" aria-hidden="true" />Working…</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
