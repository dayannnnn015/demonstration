import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { BrandMark } from '../components/brand';
import { SiteIcon } from './art';
import { loadSite, schoolName, type PublicSite } from './data';
import { AboutPage, AnnouncementPage, AnnouncementsPage, CalendarPage, FaqPage, Home, NotFound } from './pages';

/**
 * The school's public front page. It reads one public endpoint, which returns
 * only what the principal or administrative officer published, and it routes
 * on real paths so a notice can be shared by its link. The staff workspace
 * lives at /app; nothing here signs anyone in.
 */
// The page's own file name is how a local preview reaches it; it means the home page.
const pathOf = () => { const p = location.pathname.replace(/\/+$/, ''); return !p || p === '/site.html' ? '/' : p; };

// Contact lives on the About page; /contact is kept so an old link still lands on it.
// Questions appear only once the school has published one, so the menu never leads to an empty page.
const nav = [['/', 'Home'], ['/announcements', 'Announcements'], ['/calendar', 'Calendar'], ['/faq', 'Questions'], ['/about', 'About & contact']] as const;
// A tab opens at its top, title and all: the inner tabs used to skip a tall banner to reach their content, and since
// 2026-11-10 they have a plain title instead, which is worth seeing. Only Contact still lands part-way down its page.
const pageTarget = (path: string) => ({ '/': 'home', '/contact': 'contact' } as Record<string, string>)[path];
let announcementOrigin = '/announcements';
const scrollToPageTarget = (path: string) => requestAnimationFrame(() => {
  const element = document.getElementById(pageTarget(path) ?? '');
  if (element) element.scrollIntoView();
  else window.scrollTo({ top: 0 });
});

export type Go = (path: string) => void;

/** A same-site link that moves without reloading, and still works as a link when opened in a new tab. */
export function Link({ to, go, className, children, label }: { to: string; go: Go; className?: string | undefined; children: ReactNode; label?: string | undefined }) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go(to);
  };
  return <a href={to} className={className} onClick={click} aria-label={label}>{children}</a>;
}

export function Site() {
  const [path, setPath] = useState(pathOf);
  const [site, setSite] = useState<PublicSite | null>(null);
  const [failed, setFailed] = useState('');
  const [menu, setMenu] = useState(false);
  const [activeNav, setActiveNav] = useState('/');
  const [announcementBackground, setAnnouncementBackground] = useState('/');
  // The home page's opening plays once, on the page the visitor arrived at; moving between pages is still.
  const [opening, setOpening] = useState(true);
  // Staff portal opens the workspace's sign-in over this page rather than leaving it (the UI notes of 8 November, note 7).
  const [portal, setPortal] = useState(false);
  const main = useRef<HTMLElement>(null);

  const fetchSite = useCallback(() => {
    setFailed('');
    loadSite().then(setSite).catch(error => setFailed(error instanceof Error ? error.message : 'The page could not be loaded.'));
  }, []);
  useEffect(fetchSite, [fetchSite]);

  // Opening a notice, or any page, changes it at once (the UI notes of 8 November, note 6). It used to cross-fade
  // the whole page and slide the new one up while the notice's panel opened over it.
  const go: Go = useCallback(to => {
    const currentPath = pathOf();
    const openingAnnouncement = to.startsWith('/announcements/') && !currentPath.startsWith('/announcements/');
    const closingAnnouncement = currentPath.startsWith('/announcements/') && to === announcementOrigin;
    if (openingAnnouncement) {
      announcementOrigin = currentPath === '/' ? '/' : '/announcements';
      setAnnouncementBackground(announcementOrigin);
    }
    if (to !== location.pathname) history.pushState(null, '', to);
    flushSync(() => { setPath(to); setMenu(false); setOpening(false); });
    if (!openingAnnouncement && !closingAnnouncement) scrollToPageTarget(to);
    // Tell a screen reader the page changed, the way a full load would.
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }));
  }, []);
  useEffect(() => {
    const back = () => {
      const next = pathOf();
      const returningToAnnouncementList = next === announcementOrigin;
      setPath(next);
      setMenu(false);
      setOpening(false);
      if (!returningToAnnouncementList) scrollToPageTarget(next);
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    if (path !== '/') {
      const match = nav.find(([to]) => to !== '/' && (path === to || path.startsWith(`${to}/`)));
      setActiveNav(path === '/contact' ? '/about' : match?.[0] ?? '/');
      return;
    }
    const sections = nav
      .filter(([to]) => to !== '/faq')
      .map(([to]) => document.getElementById(to === '/' ? 'home' : to.slice(1)))
      .filter((element): element is HTMLElement => !!element);
    if (!sections.length) return;
    const update = () => {
      const marker = 96;
      const visible = sections.filter(section => {
        const box = section.getBoundingClientRect();
        return box.top <= marker && box.bottom > marker;
      });
      const next = visible.at(-1) ?? sections.find(section => section.getBoundingClientRect().top > marker) ?? sections.at(-1);
      if (next) setActiveNav(next.id === 'home' ? '/' : `/${next.id}`);
    };
    const observer = new IntersectionObserver(update, { threshold: [0, 0.1], rootMargin: '-68px 0px -55% 0px' });
    sections.forEach(section => observer.observe(section));
    update();
    return () => observer.disconnect();
  }, [path, site]);

  const name = site ? schoolName(site) : 'Balili Elementary School';
  const section = path.split('/')[1] ?? '';
  const announcementId = section === 'announcements' ? path.split('/')[2] : undefined;

  let page: ReactNode;
  let title = name;
  if (!site) page = failed ? <LoadFailed message={failed} retry={fetchSite} /> : <Loading />;
  else if (path === '/') page = <Home site={site} go={go} />;
  else if (announcementId) {
    const found = site.announcements.find(a => a.id === announcementId);
    title = found ? `${found.title} · ${name}` : name;
    page = announcementBackground === '/' ? <Home site={site} go={go} selectedId={announcementId} /> : <AnnouncementsPage site={site} go={go} selectedId={announcementId} />;
  }
  else if (path === '/announcements') { title = `Announcements · ${name}`; page = <AnnouncementsPage site={site} go={go} />; }
  else if (path === '/calendar') { title = `School calendar · ${name}`; page = <CalendarPage site={site} go={go} />; }
  else if (path === '/faq') { title = `Questions · ${name}`; page = <FaqPage site={site} go={go} />; }
  else if (path === '/about' || path === '/contact') { title = `About and contact · ${name}`; page = <AboutPage site={site} go={go} contact={path === '/contact'} />; }
  else page = <NotFound go={go} />;
  useEffect(() => { document.title = title; }, [title]);

  const current = (to: string) => activeNav === to || (to === '/about' && activeNav === '/contact');

  return (
    <div className={opening ? 'site opening' : 'site'}>
      <a className="skip-link" href="#content">Skip to the content</a>
      {site?.seeded ? (
        <div className="test-ribbon" role="note">
          <SiteIcon name="alert" size={16} />
          <span><b>Test copy.</b> This page shows sample notices while EDUNEXUS is being tested. Nothing here is an official announcement of the school.</span>
        </div>
      ) : null}
      <GovBar />
      <header className="site-header">
        <div className="wrap header-inner">
          <Link to="/" go={go} className="site-brand" label={`${name}, home`}>
            <span className="brand-tile"><BrandMark size={30} /></span>
            <span className="brand-words">
              <b>{name}</b>
              <small>{site?.school.school_code ? `DepEd School ID ${site.school.school_code}` : 'Department of Education'}</small>
            </span>
          </Link>
          <button type="button" className="menu-toggle" aria-expanded={menu} aria-controls="site-nav" onClick={() => setMenu(open => !open)}>
            <SiteIcon name={menu ? 'close' : 'menu'} size={22} /><span>{menu ? 'Close' : 'Menu'}</span>
          </button>
          <nav id="site-nav" className={`site-nav${menu ? ' open' : ''}`} aria-label="Main">
            <ul>
              {nav.filter(([to]) => to !== '/faq' || (site?.faqs?.length ?? 0) > 0).map(([to, label]) => (
                <li key={to}><Link to={to} go={go} className={current(to) ? 'active' : undefined}>{label}</Link></li>
              ))}
            </ul>
            {/* Still a link to /app, so a new tab or no script lands on the sign-in page; a plain click opens it over this page. */}
            <a className="portal-link" href="/app" onClick={event => {
              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              setMenu(false);
              setPortal(true);
            }}><SiteIcon name="lock" size={15} />Staff portal</a>
          </nav>
        </div>
      </header>
      <main id="content" ref={main} tabIndex={-1}>{page}</main>
      <Footer site={site} name={name} go={go} />
      {portal ? <StaffPortal onClose={() => setPortal(false)} /> : null}
    </div>
  );
}

/**
 * The government web template's top bar: the link to GOVPH and Philippine
 * Standard Time, which every government site carries. The clock reads the
 * reader's own device, shown in Manila's time zone.
 */
function GovBar() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);
  const shown = now.toLocaleString('en-US', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return (
    <div className="gov-bar">
      <div className="wrap gov-inner">
        <a className="govph" href="https://www.gov.ph/" rel="noopener" target="_blank">GOVPH</a>
        <p className="pst"><span className="pst-label">Philippine Standard Time:</span> <time dateTime={now.toISOString()}>{shown}</time></p>
      </div>
    </div>
  );
}

function Footer({ site, name, go }: { site: PublicSite | null; name: string; go: Go }) {
  const s = site?.site;
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <span className="brand-tile"><BrandMark size={34} /></span>
          <div>
            <b>{name}</b>
            <p>{site ? site.school.address : 'La Trinidad, Benguet'}</p>
            <p className="footer-gov">Republic of the Philippines · Department of Education{site?.school.division ? ` · ${site.school.division}` : ''}</p>
          </div>
        </div>
        <div>
          <h2>Reach the school</h2>
          <ul className="footer-list">
            {s?.phone ? <li><a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>{s.phone}</a></li> : null}
            {s?.email ? <li><a href={`mailto:${s.email}`}>{s.email}</a></li> : null}
            {s?.office_hours ? <li>{s.office_hours}</li> : null}
            {site?.faqs?.length ? <li><Link to="/faq" go={go}>Questions from parents</Link></li> : null}
            <li><Link to="/about" go={go}>Visit and contact details</Link></li>
          </ul>
        </div>
        <div>
          <h2>DepEd</h2>
          <ul className="footer-list">
            <li><a href="https://www.deped.gov.ph/" rel="noopener" target="_blank">DepEd Philippines<SiteIcon name="external" size={13} /></a></li>
            <li><a href="https://car.deped.gov.ph/" rel="noopener" target="_blank">DepEd Cordillera<SiteIcon name="external" size={13} /></a></li>
            <li><a href="https://depedbenguet.com/" rel="noopener" target="_blank">DepEd Benguet<SiteIcon name="external" size={13} /></a></li>
          </ul>
        </div>
      </div>
      <div className="wrap footer-base">
        <span>© {new Date().getFullYear()} {name}</span>
        <span>Records kept with <a href="/app">EDUNEXUS</a></span>
      </div>
    </footer>
  );
}

/**
 * The workspace's own sign-in, over the front page (the UI notes of 8 November, note 7).
 *
 * A frame of this origin's /app, not a copy of the form: the sign-in code and the call to the sign-in service stay in
 * the workspace, and this page's content policy gains only `frame-src 'self'`. The frame shares this tab's session
 * store, so a sign-in there moves the tab into the workspace already signed in, with "Keep me signed in", the browser's
 * password saving and the recovery link all as they are on the sign-in page.
 */
function StaffPortal({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    close.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); body.style.overflow = previous; opener?.focus?.(); };
  }, [onClose]);
  return (
    <div className="portal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="portal-dialog" role="dialog" aria-modal="true" aria-labelledby="portal-title">
        <div className="portal-head">
          <h2 id="portal-title">Staff sign-in</h2>
          <button ref={close} type="button" className="announcement-dialog-close" onClick={onClose} aria-label="Close staff sign-in"><SiteIcon name="close" size={20} /></button>
        </div>
        <iframe className="portal-frame" src="/app?embed=signin" title="Sign in to EDUNEXUS" />
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="loading" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the school’s page…</span>
      <div className="skeleton-hero" />
      <div className="wrap skeleton-row"><div className="skeleton" /><div className="skeleton" /></div>
    </div>
  );
}

function LoadFailed({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="wrap state-block" role="alert">
      <h1>The school’s page could not be loaded</h1>
      <p>{message} Check the connection and try again.</p>
      <button type="button" className="btn btn-primary" onClick={retry}>Try again</button>
    </div>
  );
}
