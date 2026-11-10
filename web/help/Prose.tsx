import type { ReactNode } from 'react';
import { routes } from '../routes';

/** The three marks help text carries; see web/help/types.ts. */
const MARK = /(\*\*[^*]+\*\*|\*[^*]+\*|\{[a-z0-9-]+\})/g;

/** Every control label a piece of help text names, for the test that finds each one in the screens. */
export const labelsIn = (text: string) => [...text.matchAll(/\*\*([^*]+)\*\*/g)].map(m => m[1]!);
/** Every screen a piece of help text links to. */
export const linksIn = (text: string) => [...text.matchAll(/\{([a-z0-9-]+)\}/g)].map(m => m[1]!);

const nameOf = (id: string) => routes.find(r => r.id === id)?.nav ?? id;

/**
 * One sentence or paragraph of help. A link is an ordinary address in the
 * workspace, so following one is the same as choosing the screen in the rail;
 * a screen the reader cannot open is named without a link.
 */
export function Prose({ text, opens }: { text: string; opens: Set<string> }) {
  const parts: ReactNode[] = text.split(MARK).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <b key={i} className="ui-label">{part.slice(2, -2)}</b>;
    if (part.startsWith('{') && part.endsWith('}')) {
      const id = part.slice(1, -1);
      return opens.has(id) ? <a key={i} href={`#/${id}`}>{nameOf(id)}</a> : <span key={i}>{nameOf(id)}</span>;
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
  return <>{parts}</>;
}
