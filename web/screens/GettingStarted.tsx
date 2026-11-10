import { useEffect, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { query } from '../api';
import { Icon } from '../components/icons';
import { opens, toursFor } from '../help';
import { useHelp } from '../help/context';
import { checklist, stillToDo, type Facts } from '../help/getting-started';
import { routes } from '../routes';
import { TourButton } from './Help';

const HIDDEN = 'edunexus-ui-getting-started';
const hiddenNow = () => { try { return sessionStorage.getItem(HIDDEN) === 'hidden'; } catch { return false; } };

/**
 * The Overview's getting-started list, which is also the welcome: it offers the
 * role's tours, and it stays up only while something it can see is still to do.
 * Hiding it lasts as long as the tab, as the rail's own preferences do, so a
 * shared staffroom machine does not keep one person's choice for the next.
 */
export function GettingStarted({ api, me, token, facts }: {
  api: Api;
  me: Row;
  token: number;
  /** What the Overview has already read; the rest is read here. */
  facts: Omit<Facts, 'school' | 'subjects'>;
}) {
  const [hidden, setHidden] = useState(hiddenNow);
  const help = useHelp();
  const [school, setSchool] = useState<boolean | null>(null);
  const [subjects, setSubjects] = useState<number | null>(null);

  // Two reads, neither writing to the privacy log: the profile and one row of the catalog.
  useEffect(() => {
    void api<Row>('/school').then(s => setSchool(Boolean(s.school_code && s.school_head_name))).catch(() => setSchool(null));
    void api<Page>(`/subjects${query({ limit: 1 })}`).then(r => setSubjects(r.items.length)).catch(() => setSubjects(null));
  }, [api, token]);

  const role = me.role;
  const items = checklist(role, { ...facts, school, subjects });
  if (hidden || !stillToDo(items)) return null;

  const can = opens(role);
  const done = items.filter(item => item.done).length;
  const tours = ['workspace', role === 'teacher' ? 'register' : 'setup-year']
    .map(id => toursFor(role).find(t => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  const hide = () => { setHidden(true); try { sessionStorage.setItem(HIDDEN, 'hidden'); } catch { /* a private window keeps no preference */ } };

  return (
    <section className="card getting-started" aria-labelledby="getting-started-title">
      <div className="card-head">
        <div>
          <h2 id="getting-started-title">Getting started</h2>
          <p className="card-note">{done} of {items.length} done. This list is worked out from what is recorded, so it is never out of date, and it goes away once everything on it is done.</p>
        </div>
        <div className="card-head-actions"><button type="button" className="btn ghost small" onClick={hide}>Hide for now</button></div>
      </div>
      <div className="card-body">
        {tours.length ? (
          <div className="gs-tours">
            {tours.map(t => <TourButton key={t.id} id={t.id} label={t.id === 'workspace' ? 'Take the tour of the workspace' : `Take the tour: ${t.title}`} />)}
          </div>
        ) : null}
        <ol className="gs-list">
          {items.map((item, i) => {
            const route = routes.find(r => r.id === item.route);
            const state = item.done ? 'done' : item.done === null ? 'unknown' : 'todo';
            return (
              <li key={item.id} className={`gs-item ${state}`}>
                <span className="gs-mark" aria-hidden="true">{item.done ? <Icon name="check" size={14} /> : i + 1}</span>
                <div className="gs-text">
                  <p className="gs-title"><b>{item.title}</b><span className="gs-state">{item.done ? 'Done' : item.done === null ? 'Could not be read' : 'Not yet'}</span></p>
                  {item.done ? null : <p className="gs-note">{item.note}</p>}
                  {item.done || !route ? null : (
                    <p className="gs-links">
                      {can.has(route.id) ? <a href={`#/${route.id}`}>Open {route.nav}</a> : null}
                      {can.has(route.id) ? <a href={`#/help?topic=${route.id}`}>How it is done</a> : null}
                      {item.tour && help.tour && !tours.some(t => t.id === item.tour) && toursFor(role).some(t => t.id === item.tour)
                        ? <button type="button" className="gs-tour" onClick={() => help.tour!(item.tour!)}>Show me</button> : null}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
