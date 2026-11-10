import { available, routes, type Role } from '../routes';
import { articles } from './en/articles';
import { faq, faqGroups } from './en/faq';
import { guides } from './en/guides';
import { tours } from './en/tours';
import type { Article, Audience, Faq, Guide, HelpContent, Lang } from './types';

export type { Article, Audience, Faq, FaqGroup, Guide, HelpContent, Lang } from './types';

/** One edition per language. A Filipino edition is a second entry here, not a rewrite. */
export const editions: Record<Lang, HelpContent> = { en: { guides, articles, faq, faqGroups, tours } };

export const audienceOf = (role: unknown): Audience => (role === 'teacher' ? 'teacher' : 'manager');

/** The screens a role's navigation offers, which are the only ones its help may link to. */
export const opens = (role: unknown) => new Set(routes.filter(route => available(route, role)).map(route => route.id));

/** The guide a role reads for a screen, or none when its navigation leaves the screen out. */
export function guideFor(route: string, role: unknown, lang: Lang = 'en'): Guide | undefined {
  if (!opens(role).has(route)) return undefined;
  const audience = audienceOf(role);
  const all = editions[lang].guides.filter(g => g.route === route);
  return all.find(g => g.for === audience) ?? all.find(g => !g.for);
}

export const articlesFor = (role: unknown, lang: Lang = 'en'): Article[] =>
  editions[lang].articles.filter(a => !a.roles || a.roles.includes(role as Role));

export const faqFor = (role: unknown, lang: Lang = 'en'): Faq[] =>
  editions[lang].faq.filter(q => !q.roles || q.roles.includes(role as Role));

/** The answer that explains a refusal, for the link beside it. */
export const faqForCode = (code: string, role: unknown, lang: Lang = 'en'): Faq | undefined =>
  faqFor(role, lang).find(q => q.codes?.includes(code));

/** Help text as plain words: each screen link becomes the screen's name and the emphasis marks go. */
export const unmarked = (text: string) =>
  text.replace(/\{([a-z0-9-]+)\}/g, (_, id: string) => routes.find(r => r.id === id)?.nav ?? id).replace(/\*/g, '');

export const faqAddress = (id: string) => `#/help?topic=faq&q=${id}`;

/** Plain words for searching: the marks stripped, case folded. */
const plain = (text: string) => unmarked(text).toLowerCase();

/**
 * Questions matching every word typed, the question's own words ranked above
 * the answer's. Fixed text only: nothing here reads a record.
 */
export function searchFaq(text: string, role: unknown, lang: Lang = 'en'): Faq[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const all = faqFor(role, lang);
  if (!words.length) return all;
  return all
    .map(q => {
      const asked = plain(q.question);
      const said = plain(q.answer.join(' '));
      if (!words.every(w => asked.includes(w) || said.includes(w))) return null;
      return { q, score: words.filter(w => asked.includes(w)).length };
    })
    .filter((hit): hit is { q: Faq; score: number } => hit !== null)
    .sort((a, b) => b.score - a.score)
    .map(hit => hit.q);
}

/** The tours a role may take: those whose screens its navigation offers. */
export const toursFor = (role: unknown, lang: Lang = 'en') =>
  editions[lang].tours.filter(t => (!t.roles || t.roles.includes(role as Role)) && (!t.route || opens(role).has(t.route)));

/** The tour that shows a screen, offered beside its guide. */
export const tourFor = (route: string, role: unknown, lang: Lang = 'en') => toursFor(role, lang).find(t => t.route === route);
