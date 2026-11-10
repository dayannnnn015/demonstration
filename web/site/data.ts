import { months, weekday } from '../dates';

export type Kind = 'news' | 'event' | 'advisory';
export type Announcement = {
  id: string; kind: Kind; title: string; summary: string; body: string;
  event_on: string | null; event_ends_on: string | null; event_time: string | null; venue: string | null;
  pinned: boolean; published_at: string;
};
export type ClosedDay = { day_on: string; day_type: 'holiday' | 'school_break' | 'suspension'; label: string };
export type PublicSite = {
  school: { name: string; school_code: string | null; address: string; region: string | null; division: string | null; district: string | null;
    school_head_name: string | null; school_head_position: string | null };
  site: { tagline: string | null; about: string | null; mission: string | null; vision: string | null; phone: string | null; email: string | null;
    office_hours: string | null; facebook_url: string | null };
  seeded: boolean;
  today: string;
  school_year: { start_year: number; starts_on: string; ends_on: string; terms: { name: string; starts_on: string; ends_on: string }[] } | null;
  closed_days: ClosedDay[];
  announcements: Announcement[];
  /** Questions for parents and guardians, published by the school, in its order. */
  faqs: Faq[];
};
export type Faq = { id: string; question: string; answer: string };

export async function loadSite(): Promise<PublicSite> {
  const response = await fetch('/api/v1/public/site', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`The school's page could not be loaded (${response.status}).`);
  return ((await response.json()) as { data: PublicSite }).data;
}

export const kindWord: Record<Kind, string> = { news: 'News', event: 'Event', advisory: 'Advisory' };

/** "Friday, July 17, 2026", from a plain calendar date, never through local time. */
export const longDate = (date: string) => `${weekday(date)}, ${months[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
/** "Jul 17, 2026". */
export const shortDate = (date: string) => `${months[Number(date.slice(5, 7)) - 1]!.slice(0, 3)} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
/** A published moment as the school's own calendar date. */
export const postedOn = (moment: string) => new Date(moment).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

export const eventDates = (a: Announcement) => (!a.event_on ? '' : a.event_ends_on && a.event_ends_on !== a.event_on
  ? `${shortDate(a.event_on)} to ${shortDate(a.event_ends_on)}` : longDate(a.event_on));

/** Whether an event is on a date, counting every day of a range. */
export const onDate = (a: Announcement, date: string) => !!a.event_on && date >= a.event_on && date <= (a.event_ends_on ?? a.event_on);

/** The seeded test school's name carries a label the test banner already states. */
export const schoolName = (site: PublicSite) => (site.seeded ? site.school.name.replace(/\s*\(SEEDED TEST DATA\)\s*$/i, '') : site.school.name);

export const closedWord: Record<ClosedDay['day_type'], string> = { holiday: 'Holiday', school_break: 'School break', suspension: 'Classes suspended' };

/** The term today falls in, if the school year has one. */
export const currentTerm = (site: PublicSite) => site.school_year?.terms.find(t => t.starts_on <= site.today && site.today <= t.ends_on) ?? null;

/** Paragraphs from plain text: a blank line starts a new one. Nothing in a notice is read as markup. */
export const paragraphs = (text: string) => text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

const DAY = 86400000;
/** Whole days from one plain date to a later one: `2026-10-11` to `2026-10-12` is 1. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export type Today = { tone: 'closed' | 'open' | 'quiet'; title: string; note: string };

/**
 * What the school's own calendar says about today, and nothing more: a day it
 * marked without classes, a weekend, a date outside the school year, or else
 * classes as usual. A suspension declared this morning reaches the page only
 * once the school records it, which the note says plainly.
 */
export function today(site: PublicSite): Today {
  const closed = site.closed_days.find(d => d.day_on === site.today);
  if (closed) return { tone: 'closed', title: `No classes today`, note: `${closedWord[closed.day_type]}: ${closed.label}` };
  const day = new Date(`${site.today}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return { tone: 'quiet', title: 'No classes today', note: 'It is the weekend. Classes resume on Monday unless the school posts otherwise.' };
  const year = site.school_year;
  if (!year) return { tone: 'quiet', title: 'Between school years', note: 'The school posts the opening of classes here once it is set.' };
  if (site.today < year.starts_on) return { tone: 'quiet', title: 'Classes have not started', note: `The school year opens on ${longDate(year.starts_on)}.` };
  if (site.today > year.ends_on) return { tone: 'quiet', title: 'The school year has ended', note: 'Enrollment and the next opening of classes are posted here.' };
  return { tone: 'open', title: 'Classes as usual', note: 'Nothing on the school calendar closes classes today. Suspensions are posted here once declared.' };
}

/** How far today sits through the school year, from 0 to 1, for the slim term bar. */
export const yearProgress = (site: PublicSite) => {
  const y = site.school_year;
  if (!y) return null;
  const whole = daysBetween(y.starts_on, y.ends_on);
  return whole > 0 ? Math.min(1, Math.max(0, daysBetween(y.starts_on, site.today) / whole)) : null;
};

export type Dated = { date: string; ends: string | null; kind: 'closed' | 'event'; title: string; note: string; id?: string };

/** Events and days without classes ahead, in date order: the one list a family reads. */
export function ahead(site: PublicSite): Dated[] {
  const events: Dated[] = site.announcements
    .filter(a => a.kind === 'event' && a.event_on && (a.event_ends_on ?? a.event_on) >= site.today)
    .map(a => ({ date: a.event_on!, ends: a.event_ends_on && a.event_ends_on !== a.event_on ? a.event_ends_on : null, kind: 'event', title: a.title, note: [a.event_time, a.venue].filter(Boolean).join(' · '), id: a.id }));
  const closed: Dated[] = site.closed_days.filter(d => d.day_on >= site.today)
    .map(d => ({ date: d.day_on, ends: null, kind: 'closed', title: d.label, note: closedWord[d.day_type] }));
  return [...closed, ...events].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'closed' ? -1 : 1));
}

/** A term's name without the seeded label the test banner already states. */
export const termName = (name: string) => name.replace(/\s*\(seeded dates\)/i, '');
