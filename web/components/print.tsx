import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Prints something that lives inside the app, such as a sheet or a report
 * card, on a page of its own. The print stylesheet hides the app, so while
 * `printing` is set the content is drawn once more into a root beside it, the
 * body is marked, the browser prints, and both are taken away again. `landscape`
 * puts the copy on a wide page, for forms like SF4 that are printed that way;
 * `long` on long bond paper upright, as the SF10 is.
 *
 * `page` names a @page rule instead, for a form whose sheet is neither of those
 * two: the SF9 is three cards on three different papers, and each has to be
 * laid out on its own or the print dialog shrinks it to fit the tray.
 */
export function PrintCopy({ printing, onPrinted, landscape, long, page, children }: {
  printing: boolean; onPrinted: () => void; landscape?: boolean; long?: boolean; page?: string | undefined; children: ReactNode;
}) {
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add('printing-sheet');
    try { window.print?.(); } finally {
      document.body.classList.remove('printing-sheet');
      onPrinted();
    }
  }, [printing]);
  return printing ? createPortal(<div className={`print-root${page ? ` ${page}` : landscape ? ' landscape' : long ? ' long' : ''}`}>{children}</div>, document.body) : null;
}
