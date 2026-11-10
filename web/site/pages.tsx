import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { monthName, monthOf, weekday } from '../dates';
import { SiteIcon, type IconName } from './art';
import { Link, type Go } from './Site';
import {
  ahead, daysBetween, eventDates, kindWord, longDate, paragraphs, postedOn, schoolName, shortDate, termName, today, yearProgress,
  currentTerm, type Announcement, type Dated, type Kind, type PublicSite, type Faq,
} from './data';


type Page = { site: PublicSite; go: Go };

const yearLabel = (site: PublicSite) => (site.school_year ? `${site.school_year.start_year}–${site.school_year.start_year + 1}` : null);
const when = (days: number, date?: string) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : days <= 45 || !date ? `in ${days} days` : `on ${shortDate(date)}`);

/** "Balili" large and "Elementary School" beneath it, with anything after it; any other name is set whole. */
function splitName(name: string): [string, string | null] {
  const match = /^(.*\S)\s+(Elementary School\b.*)$/i.exec(name);
  return match ? [match[1]!, match[2]!] : [name, null];
}

function Meta({ a }: { a: Announcement }) {
  return (
    <p className="notice-meta">
      <span className={`kind kind-${a.kind}`}>{kindWord[a.kind]}</span>
      {a.pinned ? <span className="pinned"><SiteIcon name="pin" size={13} />Pinned</span> : null}
      <span>{a.kind === 'event' ? eventDates(a) : `Posted ${shortDate(postedOn(a.published_at))}`}</span>
    </p>
  );
}

function SectionHead({ kicker, title, note, link }: { kicker: string; title: string; note?: string; link?: { to: string; label: string; go: Go } }) {
  return (
    <div className="section-head">
      <p className="kicker">{kicker}</p>
      <h2>{title}</h2>
      {note ? <p className="section-note">{note}</p> : null}
      {link ? <Link to={link.to} go={link.go} className="text-link">{link.label}<SiteIcon name="arrow" size={16} /></Link> : null}
    </div>
  );
}

function DateTile({ date, tone }: { date: string; tone?: 'sun' | undefined }) {
  return (
    <span className={`date-tile${tone ? ` date-tile-${tone}` : ''}`} aria-hidden="true">
      <small>{weekday(date).slice(0, 3)}</small><b>{Number(date.slice(8))}</b><small>{monthName(monthOf(date)).slice(0, 3)}</small>
    </span>
  );
}

function NoticeList({ items, go }: { items: Announcement[]; go: Go }) {
  return (
    <ol className="notice-list">
      {items.map(a => (
        <li key={a.id} className={`notice reveal${a.pinned ? ' notice-pinned' : ''}`}>
          <Meta a={a} />
          <h3><Link to={`/announcements/${a.id}`} go={go}>{a.title}</Link></h3>
          <p>{a.summary}</p>
        </li>
      ))}
    </ol>
  );
}

function AnnouncementShowcase({ items, go }: { items: Announcement[]; go: Go }) {
  const featured = items.find(a => a.pinned) ?? items[0]!;
  const regular = items.filter(a => a.id !== featured.id);
  return (
    <div className="announcement-showcase">
      <article className={`announcement-feature${featured.pinned ? ' announcement-feature-pinned' : ''}`}>
        <div className="announcement-feature-body">
          <span className="announcement-label">{featured.pinned ? 'Featured announcement' : 'Latest announcement'}</span>
          <Meta a={featured} />
          <h3><Link to={`/announcements/${featured.id}`} go={go}>{featured.title}</Link></h3>
          <p>{featured.summary}</p>
          <Link to={`/announcements/${featured.id}`} go={go} className="announcement-read-more">Read more<SiteIcon name="arrow" size={16} /></Link>
        </div>
      </article>
      {regular.length ? (
        <ol className="announcement-grid">
          {regular.map(a => (
            <li key={a.id} className={`announcement-card${a.pinned ? ' announcement-card-pinned' : ''}`}>
              <Meta a={a} />
              <h3><Link to={`/announcements/${a.id}`} go={go}>{a.title}</Link></h3>
              <p>{a.summary}</p>
              <Link to={`/announcements/${a.id}`} go={go} className="announcement-read-more">Read more<SiteIcon name="arrow" size={16} /></Link>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Agenda({ items, go }: { items: Dated[]; go: Go }) {
  return (
    <ul className="agenda">
      {items.map(d => (
        <li key={`${d.kind}-${d.date}-${d.title}`} className={`agenda-row reveal agenda-${d.kind}`}>
          <DateTile date={d.date} tone={d.kind === 'closed' ? 'sun' : undefined} />
          <div>
            <span className="agenda-kind">{d.kind === 'closed' ? 'No classes' : 'Event'}</span>
            <h3>{d.id ? <Link to={`/announcements/${d.id}`} go={go}>{d.title}</Link> : d.title}</h3>
            <p>{[d.kind === 'closed' ? d.note : null, d.ends ? `${shortDate(d.date)} to ${shortDate(d.ends)}` : longDate(d.date), d.kind === 'event' ? d.note : null].filter(Boolean).join(' · ')}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return <div className="empty"><b>{title}</b><p>{body}</p></div>;
}

/* ------------------------------------------------------------------ Home */

/** Whether there are classes today, as one mark: a pulse in the day's colour, a word, the date. */
function TodayBadge({ site }: { site: PublicSite }) {
  const now = today(site);
  const label = site.closed_days.find(d => d.day_on === site.today)?.label;
  return (
    <p className={`today-badge today-${now.tone}`}>
      <span className="today-pulse" aria-hidden="true" />
      <b>{now.title}</b>
      {label ? <span className="today-badge-note">{label}</span> : null}
      <span className="today-badge-date">{shortDate(site.today)}</span>
    </p>
  );
}

/** A quick-access tile: the picture carries the information, the words name it. */
function Tile({ to, go, label, meta, tone, children }: { to: string; go: Go; label: string; meta: string; tone: string; children: ReactNode }) {
  return (
    <Link to={to} go={go} className={`tile tile-${tone} reveal`} label={`${label}: ${meta}`}>
      <span className="tile-art" aria-hidden="true">{children}</span>
      <span className="tile-label">{label}</span>
      <span className="tile-meta">{meta}</span>
      <span className="tile-go" aria-hidden="true"><SiteIcon name="arrow" size={18} /></span>
    </Link>
  );
}

/** A megaphone with the number of notices posted, or none. */
function NoticesArt({ count }: { count: number }) {
  return (
    <svg viewBox="0 0 72 72" width="72" height="72">
      <circle cx="36" cy="36" r="34" className="art-ground" />
      <path d="M16 31v10a3 3 0 0 0 3 3h5l15 11V17L24 28h-5a3 3 0 0 0-3 3Z" className="art-main" />
      <path d="M45 28a10 10 0 0 1 0 16M50 22a18 18 0 0 1 0 28" className="art-line" />
      <path d="M24 44l3 11h6l-2-9" className="art-line" />
      {count ? <g className="art-count"><circle cx="54" cy="18" r="12" /><text x="54" y="22.5" textAnchor="middle">{count > 9 ? '9+' : count}</text></g> : null}
    </svg>
  );
}

/** The next date on the school calendar as a calendar page, its month on the binding. */
function DateArt({ date, closed }: { date: string | null; closed: boolean }) {
  return (
    <svg viewBox="0 0 72 72" width="72" height="72">
      <circle cx="36" cy="36" r="34" className="art-ground" />
      <rect x="15" y="17" width="42" height="40" rx="6" className="art-paper" />
      <path d="M15 23a6 6 0 0 1 6-6h30a6 6 0 0 1 6 6v6H15Z" className={closed ? 'art-sun' : 'art-main'} />
      <path d="M25 13v8M47 13v8" className="art-line" />
      {date ? (
        <>
          <text x="36" y="27.5" textAnchor="middle" className="art-month">{monthName(monthOf(date)).slice(0, 3).toUpperCase()}</text>
          <text x="36" y="50" textAnchor="middle" className="art-day">{Number(date.slice(8))}</text>
        </>
      ) : <path d="M26 42h20M26 49h12" className="art-line" />}
    </svg>
  );
}

/** The school year as a ring: each term an arc, the part already gone filled in, a dot for today. */
function YearArt({ site }: { site: PublicSite }) {
  const y = site.school_year;
  const R = 25, C = 2 * Math.PI * R;
  if (!y) return <svg viewBox="0 0 72 72" width="72" height="72"><circle cx="36" cy="36" r="34" className="art-ground" /><circle cx="36" cy="36" r={R} className="ring-track" /></svg>;
  const whole = Math.max(1, daysBetween(y.starts_on, y.ends_on));
  const at = (d: string) => Math.min(1, Math.max(0, daysBetween(y.starts_on, d) / whole));
  const done = yearProgress(site) ?? 0;
  const term = currentTerm(site);
  const index = term ? y.terms.indexOf(term) + 1 : 0;
  const angle = done * 2 * Math.PI - Math.PI / 2;
  return (
    <svg viewBox="0 0 72 72" width="72" height="72">
      <circle cx="36" cy="36" r="34" className="art-ground" />
      <g transform="rotate(-90 36 36)">
        <circle cx="36" cy="36" r={R} className="ring-track" />
        {y.terms.map(t => {
          const from = at(t.starts_on), to = at(t.ends_on);
          return <circle key={t.name} cx="36" cy="36" r={R} className="ring-term" strokeDasharray={`${Math.max(0, (to - from) * C - 2.5)} ${C}`} strokeDashoffset={-from * C} />;
        })}
        <circle cx="36" cy="36" r={R} className="ring-done" strokeDasharray={`${done * C} ${C}`} />
      </g>
      <circle cx={36 + R * Math.cos(angle)} cy={36 + R * Math.sin(angle)} r="4.5" className="ring-now" />
      <text x="36" y="41" textAnchor="middle" className="art-day art-day-small">{index ? `T${index}` : `${Math.round(done * 100)}%`}</text>
    </svg>
  );
}

/** A pin on the hill's contour lines. */
function VisitArt() {
  return (
    <svg viewBox="0 0 72 72" width="72" height="72">
      <circle cx="36" cy="36" r="34" className="art-ground" />
      <g className="art-contour">
        <ellipse cx="36" cy="50" rx="24" ry="8" /><ellipse cx="36" cy="50" rx="15" ry="4.8" /><ellipse cx="36" cy="50" rx="7" ry="2.2" />
      </g>
      <path d="M36 50s13-11.6 13-21a13 13 0 0 0-26 0c0 9.4 13 21 13 21Z" className="art-main" />
      <circle cx="36" cy="29" r="5" className="art-paper" />
    </svg>
  );
}

export function Home({ site, go, selectedId }: Page & { selectedId?: string }) {
  const name = schoolName(site);
  const [lead, sub] = splitName(name);
  const notices = site.announcements.slice(0, 5);
  const dates = ahead(site).slice(0, 6);
  const next = dates[0];
  const term = currentTerm(site);
  const place = site.school.address.split(',').map(part => part.trim()).filter(Boolean).slice(-2).join(', ');
  const s = site.site;
  const selected = selectedId ? site.announcements.find(a => a.id === selectedId) : undefined;
  return (
    <>
      <section className="hero home-section" id="home">
        {/* Balili's painted hillside: the StoBoSa homes forming their sunflower, the schoolhouse under the flag.
            It shows no person. A phone gets the right of the hill, so the sunflower stays whole. */}
        <picture className="hero-art">
          <source media="(max-width: 700px)" srcSet="/images/hero-balili-v1-phone.webp" type="image/webp" />
          <img src="/images/hero-balili-v1-1881.webp" srcSet="/images/hero-balili-v1-1200.webp 1200w, /images/hero-balili-v1-1881.webp 1881w"
            sizes="100vw" width="1881" height="836" alt="" fetchPriority="high" decoding="async" />
        </picture>
        <div className="wrap hero-inner">
          <div className="hero-copy">
            <p className="hero-gov">Republic of the Philippines <span aria-hidden="true">·</span> Department of Education</p>
            <h1 className="hero-name">
              {/* A long first line is set smaller rather than broken over three. */}
              <span className={`line${lead.length > 12 ? ' line-long' : ''}`}><span>{lead}</span></span>{' '}
              {sub ? <span className="line line-sub"><span>{sub}</span></span> : null}
            </h1>
            <div className="hero-facts">
              <TodayBadge site={site} />
            </div>
          </div>
        </div>
      </section>

      <nav className="quick" aria-label="Find it quickly">
        <div className="wrap quick-grid">
          <Tile to="/announcements" go={go} tone="blue" label="Announcements"
            meta={notices.length ? `Latest ${shortDate(postedOn(notices[0]!.published_at))}` : 'None posted yet'}>
            <NoticesArt count={site.announcements.length} />
          </Tile>
          <Tile to="/calendar" go={go} tone={next?.kind === 'closed' ? 'sun' : 'red'} label="Calendar"
            meta={next ? `${next.kind === 'closed' ? 'No classes' : 'Event'} ${when(daysBetween(site.today, next.date), next.date)}` : 'Nothing ahead yet'}>
            <DateArt date={next?.date ?? null} closed={next?.kind === 'closed'} />
          </Tile>
          <Tile to="/calendar" go={go} tone="green" label="School year"
            meta={site.school_year ? (term ? `${termName(term.name)} · to ${shortDate(term.ends_on)}` : `${yearLabel(site)}`) : 'Not yet set'}>
            <YearArt site={site} />
          </Tile>
          <Tile to="/about" go={go} tone="navy" label="Visit & contact" meta={place || 'La Trinidad, Benguet'}>
            <VisitArt />
          </Tile>
        </div>
      </nav>

      <section className="band band-paper home-section" id="announcements">
        <div className="wrap announcement-section">
          <SectionHead kicker="From the school office" title="Announcements" note="News, events and advisories, newest first; pinned notices stay on top." link={{ to: '/announcements', label: 'View all announcements', go }} />
          {notices.length ? <AnnouncementShowcase items={notices} go={go} /> : <Empty title="No announcements yet" body="Notices the principal or the school office posts appear here first." />}
        </div>
      </section>

      <section className="band band-white home-section" id="calendar">
        <div className="wrap split">
          <SectionHead kicker="Coming up" title="Dates for families" note="Events the school has announced and the days without classes on its calendar." link={{ to: '/calendar', label: 'Full school calendar', go }} />
          {dates.length ? <Agenda items={dates} go={go} /> : <Empty title="Nothing scheduled yet" body="Events and days without classes appear here once the school posts them." />}
        </div>
      </section>

      <section className="band band-night home-section" id="about">
        <div className="wrap visit">
          <div className="visit-copy reveal">
            <p className="kicker kicker-light">Our school</p>
            {s.tagline ? <p className="visit-tagline">{s.tagline}</p> : null}
            <h2>{s.about ? paragraphs(s.about)[0] : `${name} is a public elementary school of the Department of Education${site.school.division ? `, ${site.school.division}` : ''}.`}</h2>
            <Link to="/about" go={go} className="text-link text-link-light">About the school<SiteIcon name="arrow" size={16} /></Link>
          </div>
          <ContactList site={site} tone="light" />
        </div>
      </section>
      {selected ? <AnnouncementDialog announcement={selected} go={go} closePath="/" /> : null}
    </>
  );
}

type ContactRow = [IconName, string, ReactNode];

function ContactList({ site, tone }: { site: PublicSite; tone?: 'light' }) {
  const s = site.site;
  const rows: ContactRow[] = [
    ['place', 'Visit', site.school.address],
    ...(s.office_hours ? [['clock', 'Office hours', s.office_hours] as ContactRow] : []),
    ...(s.phone ? [['phone', 'Call', <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>{s.phone}</a>] as ContactRow] : []),
    ...(s.email ? [['mail', 'E-mail', <a href={`mailto:${s.email}`}>{s.email}</a>] as ContactRow] : []),
    ...(s.facebook_url ? [['facebook', 'Facebook', <a href={s.facebook_url} rel="noopener" target="_blank">The school’s page<SiteIcon name="external" size={13} /></a>] as ContactRow] : []),
  ];
  return (
    <div className={`contact reveal${tone ? ` contact-${tone}` : ''}`}>
      <dl>
        {rows.map(([icon, label, value]) => <div key={label}><dt><SiteIcon name={icon} size={18} />{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {!s.phone && !s.email ? <p className="contact-none">{s.facebook_url ? 'Message the school on its Facebook page, or visit the school office on class days.' : 'The school has not published a phone number or e-mail here yet. The school office can be visited on class days.'}</p> : null}
    </div>
  );
}

/* --------------------------------------------------------- Inner pages */

/** A plain title for every tab but Home: the hillside banner is Home's alone (asked 2026-11-10, "keep it simple"). */
function PageHead({ kicker, title, lede }: { kicker: string; title: string; lede?: string }) {
  return (
    <section className="page-head">
      <div className="wrap page-head-inner">
        <p className="kicker">{kicker}</p>
        <h1>{title}</h1>
        {lede ? <p>{lede}</p> : null}
      </div>
    </section>
  );
}

export function CalendarPage({ site, go }: Page) {
  const items = ahead(site);
  const months = useMemo(() => {
    const grouped = new Map<string, Dated[]>();
    for (const d of items) { const key = d.date.slice(0, 7); grouped.set(key, [...(grouped.get(key) ?? []), d]); }
    return [...grouped.entries()];
  }, [items]);
  const terms = site.school_year?.terms ?? [];
  return (
    <>
      <PageHead kicker="School calendar" title="Dates for learners and families" lede="Events the school has announced and the days without classes ahead. A change is always posted as an announcement." />
      {terms.length ? (
        <section className="band band-white">
          <div className="wrap">
            <h2 className="h-small">Terms of {yearLabel(site)}</h2>
            <ol className="terms">
              {terms.map(t => {
                const now = t.starts_on <= site.today && site.today <= t.ends_on;
                return (
                  <li key={t.name} className={now ? 'term term-now' : site.today > t.ends_on ? 'term term-done' : 'term'}>
                    <b>{termName(t.name)}</b>
                    <span>{shortDate(t.starts_on)} to {shortDate(t.ends_on)}</span>
                    {now ? <em>Now</em> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      ) : null}
      <section className="band band-paper page-target" id="calendar-content">
        <div className="wrap">
          {months.length ? months.map(([key, list]) => (
            <div key={key} className="month">
              <h2 className="month-name">{monthName(monthOf(`${key}-01`))}</h2>
              <Agenda items={list} go={go} />
            </div>
          )) : <Empty title="Nothing scheduled yet" body="Events and days without classes appear here once the school posts them." />}
          <p className="fine">Days without classes are read from the school’s own calendar for the next four months.</p>
        </div>
      </section>
    </>
  );
}

function AnnouncementDialog({ announcement: a, go, closePath }: { announcement: Announcement; go: Go; closePath: string }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') go(closePath); };
    document.addEventListener('keydown', closeOnEscape);
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      body.style.overflow = previousOverflow;
    };
  }, [go]);
  const stop = (event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) go(closePath); };
  return (
    <div className="announcement-dialog-backdrop" onMouseDown={stop}>
      <div className={`announcement-dialog announcement-dialog-${a.kind}`} role="dialog" aria-modal="true" aria-labelledby="announcement-dialog-title">
        <button type="button" className="announcement-dialog-close" onClick={() => go(closePath)} aria-label="Close announcement"><SiteIcon name="close" size={20} /></button>
        <div className="announcement-detail-card">
          <Meta a={a} />
          <div className="announcement-detail-copy">
            <p className="announcement-detail-kicker">{a.kind === 'advisory' ? 'School advisory' : a.kind === 'event' ? 'School event' : 'From the school office'}</p>
            <h2 id="announcement-dialog-title">{a.title}</h2>
            <p className="announcement-detail-summary">{a.summary}</p>
          </div>
        </div>
        {a.kind === 'event' ? (
          <dl className="event-box">
            <div><dt><SiteIcon name="calendar" size={16} />When</dt><dd>{eventDates(a)}{a.event_time ? `, ${a.event_time}` : ''}</dd></div>
            {a.venue ? <div><dt><SiteIcon name="place" size={16} />Where</dt><dd>{a.venue}</dd></div> : null}
          </dl>
        ) : null}
        {a.body.trim() ? paragraphs(a.body).map((p, i) => <p key={i} className="announcement-dialog-body">{p}</p>) : null}
        <p className="posted">Posted {longDate(postedOn(a.published_at))} by the school office.</p>
      </div>
    </div>
  );
}

export function AnnouncementsPage({ site, go, selectedId }: Page & { selectedId?: string }) {
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const shown = site.announcements.filter(a => kind === 'all' || a.kind === kind);
  const count = (k: Kind) => site.announcements.filter(a => a.kind === k).length;
  const selected = selectedId ? site.announcements.find(a => a.id === selectedId) : undefined;
  return (
    <>
      <PageHead kicker="From the school office" title="Announcements" lede="News, events and advisories, newest first." />
      <section className="band band-paper page-target" id="announcements-content">
        <div className="wrap narrow">
          {site.announcements.length ? (
            <div className="filters" role="group" aria-label="Show">
              {([['all', `All (${site.announcements.length})`], ['news', `News (${count('news')})`], ['event', `Events (${count('event')})`], ['advisory', `Advisories (${count('advisory')})`]] as const).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? 'chip active' : 'chip'} onClick={() => setKind(k)}>{label}</button>
              ))}
            </div>
          ) : null}
          {shown.length ? <NoticeList items={shown} go={go} /> : <Empty title={kind === 'all' ? 'No announcements yet' : 'Nothing of this kind yet'} body={kind === 'all' ? 'The school has not posted an announcement yet.' : `No ${kindWord[kind as Kind].toLowerCase()} has been posted.`} />}
        </div>
      </section>
      {selected ? <AnnouncementDialog announcement={selected} go={go} closePath="/announcements" /> : null}
    </>
  );
}

export function AnnouncementPage({ site, go, id }: Page & { id: string }) {
  const a = site.announcements.find(x => x.id === id);
  if (!a) {
    return (
      <div className="wrap state-block">
        <h1>This notice is not posted</h1>
        <p>It may have been taken down or replaced by a newer one.</p>
        <Link to="/announcements" go={go} className="btn btn-primary">See every announcement</Link>
      </div>
    );
  }
  return <AnnouncementsPage site={site} go={go} selectedId={a.id} />;
}

export function AboutPage({ site, contact }: Page & { contact: boolean }) {
  const name = schoolName(site);
  const s = site.site;
  // An old /contact link lands on the contact details.
  useEffect(() => { if (contact) document.getElementById('contact')?.scrollIntoView(); }, [contact]);
  const facts: [string, string | null][] = [
    ['School ID', site.school.school_code],
    [site.school.school_head_position ?? 'School head', site.school.school_head_name],
    ['District', site.school.district],
    ['Division', site.school.division],
    ['Region', site.school.region],
  ];
  return (
    <>
      <PageHead kicker="Our school" title={`About ${name}`} lede={s.tagline ?? `A public elementary school of the Department of Education${site.school.district ? ` in ${site.school.district}` : ''}.`} />
      <section className="band band-white page-target" id="about-content">
        <div className="wrap about">
          <div className="prose">
            {s.about ? paragraphs(s.about).map((p, i) => <p key={i}>{p}</p>) : <p className="muted">The school has not written its introduction here yet.</p>}
            {s.mission ? <><h2 className="h-small">Mission</h2>{paragraphs(s.mission).map((p, i) => <p key={i}>{p}</p>)}</> : null}
            {s.vision ? <><h2 className="h-small">Vision</h2>{paragraphs(s.vision).map((p, i) => <p key={i}>{p}</p>)}</> : null}
          </div>
          <dl className="facts">
            {facts.filter((r): r is [string, string] => !!r[1]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </div>
      </section>
      <section className="band band-paper" id="contact">
        <div className="wrap split">
          <SectionHead kicker="Visit or reach us" title="Contact the school" note="For enrollment, records and school activities, reach the school office." />
          <ContactList site={site} />
        </div>
      </section>
    </>
  );
}

/**
 * Questions parents and guardians ask, answered by the school. Every one was
 * written and published by the principal or the administrative officer; the
 * page invents none, and says so plainly when the school has published none.
 */
export function FaqPage({ site, go }: Page) {
  const faqs: Faq[] = site.faqs ?? [];
  return (
    <>
      <PageHead kicker="Parents and guardians" title="Questions" lede="Answers from the school to questions parents and guardians often ask." />
      <section className="band band-white">
        <div className="wrap faq-page">
          {faqs.length ? (
            <div className="faq-list">
              {faqs.map(q => (
                <details key={q.id} className="faq-item" id={`q-${q.id}`}>
                  <summary><span>{q.question}</span><SiteIcon name="chevron" size={18} /></summary>
                  <div className="faq-answer prose">{paragraphs(q.answer).map((p, i) => <p key={i}>{p}</p>)}</div>
                </details>
              ))}
            </div>
          ) : <Empty title="No questions published yet" body="The school has not published any answers here yet. The school office can help with anything you need to know." />}
          <aside className="faq-more">
            <b>Not answered here?</b>
            <p>For enrollment, records and anything about your child, reach the school office.</p>
            <Link to="/contact" go={go} className="btn btn-primary">Contact the school</Link>
          </aside>
        </div>
      </section>
    </>
  );
}

export function NotFound({ go }: { go: Go }) {
  return (
    <div className="wrap state-block">
      <h1>Page not found</h1>
      <p>The address may be mistyped, or the page may have moved.</p>
      <Link to="/" go={go} className="btn btn-primary">Go to the home page</Link>
    </div>
  );
}
