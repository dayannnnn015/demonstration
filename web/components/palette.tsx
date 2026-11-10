import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../routes';
import { faqAddress, guideFor, searchFaq, unmarked } from '../help';
import { Icon, type IconName } from './icons';
import { useTrap } from './overlay';

/**
 * The keyboard route to every screen, and to the help about each.
 *
 * Seventeen screens behind six collapsible groups is a lot of pointing for
 * someone who opens the same three every morning, and the people using this
 * are advisers taking attendance twice a day on a shared staffroom machine.
 *
 * It searches the route table and the help written about it, and nothing
 * else. That is a privacy property, not a limitation: every list under
 * `/learners` and `/enrollments` writes a `record_access_events` row naming
 * the exact records it returned, so a palette that searched learners would
 * write a row for every keystroke and bury the audit it exists to serve.
 * Help is fixed text that names no record, so searching it costs the audit
 * nothing (decided 2026-10-25). Finding a learner is the registry's job,
 * behind a deliberate search.
 */

/** Match on everything a person might type: the label, the title, the group,
 *  and the one clause explaining the screen. */
const haystack = (route: Route) => `${route.nav} ${route.title} ${route.group} ${route.lede}`.toLowerCase();

type Item = { key: string; group: string; icon: IconName; title: string; sub?: string; tag?: string; go: () => void };

export function CommandPalette({ routes, current, role, onNavigate, onClose }: {
  routes: Route[];
  current: string;
  role?: unknown;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const box = useTrap(onClose);
  const list = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);

  const found = useMemo((): Item[] => {
    const needle = text.trim().toLowerCase();
    const screens = (needle
      ? routes
        .map(route => ({ route, at: haystack(route).indexOf(needle) }))
        .filter(hit => hit.at >= 0)
        // An earlier match is a better one: typing "att" should offer Daily
        // attendance before the screens that merely mention attendance.
        .sort((a, b) => a.at - b.at)
        .map(hit => hit.route)
      : routes
    ).map((route): Item => ({
      key: route.id, group: route.group, icon: route.icon, title: route.nav, sub: route.lede,
      ...(route.id === current ? { tag: 'Here' } : route.built ? {} : { tag: 'Soon' }),
      go: () => onNavigate(route.id),
    }));
    // Groups are kept in the rail's order so the palette and the rail agree.
    const order = [...new Set(routes.map(r => r.group))];
    screens.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    if (!needle) return screens;

    // Help only once something is typed: an empty palette is for moving between screens.
    const guides = routes
      .filter(route => {
        const guide = guideFor(route.id, role);
        return guide && unmarked([guide.summary, ...guide.steps].join(' ')).toLowerCase().includes(needle);
      })
      .slice(0, 4)
      .map((route): Item => ({ key: `guide-${route.id}`, group: 'Help', icon: 'help', title: `How to use ${route.nav}`, go: () => { location.hash = `#/help?topic=${route.id}`; } }));
    const questions = searchFaq(needle, role).slice(0, 5)
      .map((q): Item => ({ key: `faq-${q.id}`, group: 'Questions', icon: 'help', title: unmarked(q.question), go: () => { location.hash = faqAddress(q.id); } }));
    return [...screens, ...guides, ...questions];
  }, [routes, text, role, current, onNavigate]);

  useEffect(() => { setActive(0); }, [text]);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, found]);

  const choose = (item: Item) => { onClose(); item.go(); };

  // Only the groups holding a result are drawn.
  const ordered: { group: string; items: Item[] }[] = [];
  for (const item of found) {
    const last = ordered.find(entry => entry.group === item.group);
    if (last) last.items.push(item); else ordered.push({ group: item.group, items: [item] });
  }
  let index = -1;

  return (
    <div className="cmdk" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cmdk-box" role="dialog" aria-modal="true" aria-label="Go to a screen or find help" tabIndex={-1} ref={box}>
        <div className="cmdk-search">
          <Icon name="search" size={17} />
          <input
            className="cmdk-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            placeholder="Go to a screen, or ask a question…"
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive(n => Math.min(n + 1, found.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActive(n => Math.max(n - 1, 0)); }
              if (event.key === 'Enter') {
                event.preventDefault();
                const picked = found[active];
                if (picked) choose(picked);
              }
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <div className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Screens and help" ref={list}>
          {found.length ? ordered.map(entry => (
            <div key={entry.group}>
              <div className="cmdk-group">{entry.group}</div>
              {entry.items.map(item => {
                index += 1;
                const here = index;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={here === active}
                    data-active={here === active}
                    className="cmdk-item"
                    onMouseMove={() => setActive(here)}
                    onClick={() => choose(item)}
                  >
                    <Icon name={item.icon} size={16} />
                    <span>{item.sub ? <><b>{item.title}</b> · {item.sub}</> : item.title}</span>
                    {item.tag ? <span className="soon">{item.tag}</span> : null}
                  </button>
                );
              })}
            </div>
          )) : (
            <p className="cmdk-empty">Nothing matches “{text.trim()}”. Screens are searched by name, section and description, and help by its words.</p>
          )}
        </div>

        <div className="cmdk-foot">
          <span><Icon name="updown" size={13} />Move</span>
          <span><Icon name="enter" size={13} />Open</span>
          <span>Searches screens and help, never learner records</span>
        </div>
      </div>
    </div>
  );
}
