import { useEffect, useMemo, useRef, useState } from 'react';
import type { Row } from '../api';
import { Icon } from '../components/icons';
import { Sheet } from '../components/overlay';
import { Select, localToday } from '../components/primitives';
import { PrintCopy } from '../components/print';
import { appVersion } from '../components/update';
import { articlesFor, editions, faqAddress, faqFor, guideFor, opens, searchFaq, tourFor, toursFor, type Article, type Faq, type Guide } from '../help';
import { useHelp, type HelpTopic } from '../help/context';
import type { Tour } from '../components/tour';
import { Prose } from '../help/Prose';
import { groups, routes, type Route } from '../routes';

/** A topic named in the address, so a link can be sent and the back button works: `#/help?topic=attendance`. */
export const topicFromHash = (hash: string) => decodeURIComponent(/[?&]topic=([^&]+)/.exec(hash)?.[1] ?? '');
/** One question opened in the FAQ: `#/help?topic=faq&q=not-marked`. */
export const questionFromHash = (hash: string) => decodeURIComponent(/[?&]q=([^&]+)/.exec(hash)?.[1] ?? '');

const FAQ = 'faq';
const startOf = (role: unknown) => `start-${String(role)}`;

/** One answer, as the FAQ, a screen's help and a refusal's explanation all show it. */
export function FaqAnswer({ q, role }: { q: Faq; role: unknown }) {
  const can = opens(role);
  return <>{q.answer.map(line => <p key={line}><Prose text={line} opens={can} /></p>)}</>;
}

/** One screen's guide, as the Help screen and the Help sheet both show it. */
/** Starts a tour, when the shell is there to run it. */
export function TourButton({ id, label }: { id: string; label: string }) {
  const { tour } = useHelp();
  return tour ? <button type="button" className="btn primary tour-start" onClick={() => tour(id)}>{label}</button> : null;
}

export function GuideView({ route, guide, role, open = true }: { route: Route; guide: Guide; role: unknown; open?: boolean }) {
  const can = opens(role);
  const shown = tourFor(route.id, role);
  const asked = faqFor(role).filter(q => q.routes?.includes(route.id));
  return (
    <div className="help-body">
      <p className="help-summary"><Prose text={guide.summary} opens={can} /></p>
      {shown ? <p className="help-tour"><TourButton id={shown.id} label={shown.steps.some(s => s.route && s.route !== shown.route) ? `Take the tour: ${shown.title}` : 'Show me around this screen'} /><span>{shown.summary}</span></p> : null}
      {route.feeds ? <p className="help-feeds"><span className="form-chip">Feeds<b>{route.feeds}</b></span></p> : null}
      <h3>How it is done</h3>
      <ol className="help-steps">
        {guide.steps.map(step => <li key={step}><Prose text={step} opens={can} /></li>)}
      </ol>
      {guide.refuses?.length ? (
        <>
          <h3>When it will stop you</h3>
          <ul className="help-refuses">
            {guide.refuses.map(line => <li key={line}><Prose text={line} opens={can} /></li>)}
          </ul>
        </>
      ) : null}
      {asked.length ? (
        <>
          <h3>Questions about this screen</h3>
          <ul className="help-asked">
            {asked.map(q => <li key={q.id}><a href={faqAddress(q.id)}><Prose text={q.question} opens={can} /></a></li>)}
          </ul>
        </>
      ) : null}
      {open ? <p className="help-open"><a className="btn secondary" href={`#/${route.id}`}>Open {route.nav}<Icon name="forward" size={15} /></a></p> : null}
    </div>
  );
}

function ArticleView({ article, role }: { article: Article; role: unknown }) {
  const can = opens(role);
  // A start offers the tour of the workspace first: it is the furniture every other tour assumes.
  const offered = (article.tours ?? []).map(id => toursFor(role).find(t => t.id === id)).filter(Boolean) as Tour[];
  return (
    <div className="help-body">
      <p className="help-summary"><Prose text={article.summary} opens={can} /></p>
      {offered.map(t => <p key={t.id} className="help-tour"><TourButton id={t.id} label={t.id === 'workspace' ? 'Take the tour of the workspace' : `Take the tour: ${t.title}`} /><span>{t.summary}</span></p>)}
      {article.body.map(line => <p key={line}><Prose text={line} opens={can} /></p>)}
      {article.path?.length ? (
        <>
          <h3>In this order</h3>
          <ol className="help-path">
            {article.path.map(id => {
              const route = routes.find(r => r.id === id);
              return route ? (
                <li key={id}><a href={`#/help?topic=${id}`}><b>{route.nav}</b></a><span>{route.lede}</span></li>
              ) : null;
            })}
          </ol>
        </>
      ) : null}
    </div>
  );
}

/**
 * Every question the reader's role asks, grouped, or the ones matching what
 * they type. Each is a disclosure, so the list reads as questions and only the
 * answers asked for take room; the one named in the address opens on arrival.
 */
function FaqView({ role, opened }: { role: unknown; opened: string }) {
  const [text, setText] = useState('');
  const found = useMemo(() => searchFaq(text, role), [text, role]);
  const can = opens(role);
  const searching = text.trim().length > 0;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!opened) return;
    list.current?.ownerDocument.getElementById(`faq-${opened}`)?.scrollIntoView?.({ block: 'start' });
  }, [opened]);

  const question = (q: Faq) => (
    <details key={q.id} id={`faq-${q.id}`} className="faq" open={searching || q.id === opened}>
      <summary><span><Prose text={q.question} opens={can} /></span></summary>
      <div className="faq-answer">
        <FaqAnswer q={q} role={role} />
        <a className="faq-link" href={faqAddress(q.id)}>Link to this question</a>
      </div>
    </details>
  );

  return (
    <div className="help-body" ref={list}>
      <div className="field faq-search">
        <label className="label" htmlFor="faq-search">Search the questions</label>
        <input id="faq-search" type="search" autoComplete="off" value={text} onChange={event => setText(event.target.value)} placeholder="For example: password, SF2, locked month" />
      </div>
      {searching ? (
        found.length
          ? <><p className="faq-count" role="status">{found.length === 1 ? 'One question matches.' : `${found.length} questions match.`}</p>{found.map(question)}</>
          : <p className="faq-count" role="status">No question matches “{text.trim()}”. Try fewer words, or read the guide for the screen you are on.</p>
      ) : editions.en.faqGroups.map(group => {
        const inGroup = found.filter(q => q.group === group.id);
        return inGroup.length ? (
          <section key={group.id} className="faq-group" aria-labelledby={`faq-group-${group.id}`}>
            <h3 id={`faq-group-${group.id}`}>{group.title}</h3>
            {inGroup.map(question)}
          </section>
        ) : null;
      })}
    </div>
  );
}

const readerOf: Record<string, string> = { principal: 'the principal', administrative_officer: 'the administrative officer', teacher: 'advisers' };

/**
 * The whole guide for one role, on paper: its start, the general articles,
 * every screen it can open in the rail's order, and the questions it asks,
 * each answer written out. It is the Help screen's own text, so the printed
 * guide and the one in EDUNEXUS cannot say different things.
 */
export function PrintedGuide({ role }: { role: unknown }) {
  const articles = articlesFor(role);
  const start = articles.find(a => a.id.startsWith('start-'));
  const general = articles.filter(a => !a.id.startsWith('start-'));
  const screens = routes
    .map(route => ({ route, guide: guideFor(route.id, role) }))
    .filter((s): s is { route: Route; guide: Guide } => Boolean(s.guide) && s.route.id !== 'help');
  const questions = faqFor(role);
  const can = opens(role);
  return (
    <div className="printed-guide">
      <h1>EDUNEXUS staff guide</h1>
      <p className="printed-meta">For {readerOf[String(role)] ?? 'staff'} · printed {localToday()} from EDUNEXUS {appVersion}. The same guide is in EDUNEXUS under Help &amp; FAQ, and is kept up to date there.</p>
      {start ? <section className="printed-part"><h2>{start.title}</h2><ArticleView article={start} role={role} /></section> : null}
      {general.map(a => <section key={a.id} className="printed-part"><h2>{a.title}</h2><ArticleView article={a} role={role} /></section>)}
      {groups.map(group => {
        const inGroup = screens.filter(s => s.route.group === group);
        return inGroup.length ? (
          <div key={group} className="printed-group">
            <h2>{group}</h2>
            {inGroup.map(s => <section key={s.route.id} className="printed-part"><h3>{s.route.title}</h3><GuideView route={s.route} guide={s.guide} role={role} open={false} /></section>)}
          </div>
        ) : null;
      })}
      <div className="printed-group">
        <h2>Frequently asked questions</h2>
        {editions.en.faqGroups.map(group => {
          const inGroup = questions.filter(q => q.group === group.id);
          return inGroup.length ? (
            <section key={group.id} className="printed-part">
              <h3>{group.title}</h3>
              {inGroup.map(q => <div key={q.id} className="printed-question"><h4><Prose text={q.question} opens={can} /></h4><FaqAnswer q={q} role={role} /></div>)}
            </section>
          ) : null;
        })}
      </div>
    </div>
  );
}

export function Help({ me }: { me: Row }) {
  const role = me.role;
  const [printing, setPrinting] = useState(false);
  const articles = useMemo(() => articlesFor(role), [role]);
  // Each screen the role's navigation offers, with the guide that role reads, in the rail's order.
  const screens = useMemo(() => routes
    .map(route => ({ route, guide: guideFor(route.id, role) }))
    .filter((s): s is { route: Route; guide: Guide } => Boolean(s.guide)), [role]);
  const known = (id: string) => id === FAQ || articles.some(a => a.id === id) || screens.some(s => s.route.id === id);
  const fallback = articles.some(a => a.id === startOf(role)) ? startOf(role) : articles[0]?.id ?? 'help';

  const read = () => { const h = globalThis.location?.hash ?? ''; const t = topicFromHash(h); return { topic: known(t) ? t : fallback, q: questionFromHash(h) }; };
  const [at, setAt] = useState(read);
  const { topic } = at;
  useEffect(() => {
    const sync = () => setAt(read());
    addEventListener('hashchange', sync);
    return () => removeEventListener('hashchange', sync);
  });
  const choose = (id: string) => { location.hash = `#/help?topic=${id}`; setAt({ topic: id, q: '' }); };
  // A topic opened from a link may sit below the index's fold; bring it into view without moving the page.
  const index = useRef<HTMLElement>(null);
  useEffect(() => {
    const list = index.current;
    const here = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (list && here && (here.offsetTop < list.scrollTop || here.offsetTop > list.scrollTop + list.clientHeight - 40)) list.scrollTop = here.offsetTop - 80;
  }, [topic]);

  const article = articles.find(a => a.id === topic);
  const screen = screens.find(s => s.route.id === topic);
  const general = articles.filter(a => !a.id.startsWith('start-'));
  const start = articles.find(a => a.id.startsWith('start-'));
  const title = topic === FAQ ? 'Frequently asked questions' : article ? article.title : screen ? screen.route.title : 'Help';

  const item = (id: string, label: string) => (
    <li key={id}>
      <button type="button" className="help-topic" aria-current={id === topic ? 'page' : undefined} onClick={() => choose(id)}>{label}</button>
    </li>
  );

  return (
    <div className="help">
      <nav className="help-index" aria-label="Help topics" ref={index}>
        <div className="field help-picker">
          <label className="label" htmlFor="help-topic">Topic</label>
          <Select id="help-topic" value={topic} onChange={event => choose(event.target.value)}>
            {start ? <option value={start.id}>{start.title}</option> : null}
            <option value={FAQ}>Frequently asked questions</option>
            <optgroup label="Working in EDUNEXUS">{general.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</optgroup>
            {groups.map(group => {
              const inGroup = screens.filter(s => s.route.group === group);
              return inGroup.length ? <optgroup key={group} label={group}>{inGroup.map(s => <option key={s.route.id} value={s.route.id}>{s.route.nav}</option>)}</optgroup> : null;
            })}
          </Select>
        </div>
        <div className="help-list">
          <ul>
            {start ? item(start.id, start.title) : null}
            {item(FAQ, 'Frequently asked questions')}
          </ul>
          <h2>Working in EDUNEXUS</h2>
          <ul>{general.map(a => item(a.id, a.title))}</ul>
          {groups.map(group => {
            const inGroup = screens.filter(s => s.route.group === group);
            return inGroup.length ? (
              <div key={group}>
                <h2>{group}</h2>
                <ul>{inGroup.map(s => item(s.route.id, s.route.nav))}</ul>
              </div>
            ) : null;
          })}
        </div>
      </nav>

      <article className="card help-article" aria-labelledby="help-title">
        <div className="card-head">
          <h2 id="help-title">{title}</h2>
          <div className="card-head-actions">
            <button type="button" className="btn secondary small" onClick={() => setPrinting(true)}><Icon name="print" size={14} />Print the whole guide</button>
          </div>
        </div>
        <div className="card-body">
          {topic === FAQ ? <FaqView role={role} opened={at.q} />
            : article ? <ArticleView article={article} role={role} />
            : screen ? <GuideView route={screen.route} guide={screen.guide} role={role} open={screen.route.id !== 'help'} />
            : null}
        </div>
      </article>
      <PrintCopy printing={printing} onPrinted={() => setPrinting(false)}><PrintedGuide role={role} /></PrintCopy>
    </div>
  );
}

/**
 * Help over the page: the current screen's guide, or the answer to a refusal.
 * It is a sheet rather than a trip to the Help screen, because the person
 * asking is usually half-way through something on the screen beneath it.
 */
export function HelpSheet({ topic, route, role, onClose }: { topic: HelpTopic; route: Route; role: unknown; onClose: () => void }) {
  if ('faq' in topic) {
    const q = faqFor(role).find(item => item.id === topic.faq);
    return (
      <Sheet title="What does this mean?" onClose={onClose}>
        <div className="help-body">
          {q ? <><h3 className="help-question"><Prose text={q.question} opens={opens(role)} /></h3><FaqAnswer q={q} role={role} /></> : <p>This question is not in your help.</p>}
          <p className="help-more"><a href={`#/help?topic=${FAQ}`}>All questions</a></p>
        </div>
      </Sheet>
    );
  }
  const guide = guideFor(route.id, role);
  return (
    <Sheet title={`Help: ${route.nav}`} note={route.lede} onClose={onClose}>
      {guide ? <GuideView route={route} guide={guide} role={role} open={false} /> : <p>This screen has no guide yet.</p>}
      <p className="help-more"><a href="#/help">All help and questions</a></p>
    </Sheet>
  );
}
