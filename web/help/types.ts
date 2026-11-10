import type { Tour } from '../components/tour';
import type { Role } from '../routes';

/**
 * Help is typed data, versioned with the screens it describes, so a change to a
 * screen and a change to its help land in the same commit and a test can hold
 * one against the other.
 *
 * Text carries three marks and nothing else:
 *   **Label**  the exact words on a control. A test finds every one in the
 *              screens' source, so help can never name a button that is gone.
 *   *words*    emphasis.
 *   {route}    a link to that screen, drawn with its name in the rail. It is
 *              plain text for a role whose navigation leaves the screen out.
 */
export type Lang = 'en';

/** Help for a screen differs between those who change its records and those who read them. */
export type Audience = 'manager' | 'teacher';

export type Guide = {
  /** The route this guide explains. */
  route: string;
  /** Omitted: everyone whose navigation offers the screen. */
  for?: Audience;
  /** What the screen is for, in one or two sentences. */
  summary: string;
  /** The work, in the order it is done. */
  steps: string[];
  /** When the screen will stop you, and why. A refusal is the system working, so it is explained, not apologised for. */
  refuses?: string[];
};

/** A topic that belongs to no one screen. */
export type Article = {
  id: string;
  title: string;
  /** Omitted: every role. */
  roles?: Role[];
  summary: string;
  body: string[];
  /** Ordered screens, for the start-here articles. */
  path?: string[];
  /** Tours offered at the top of the article, in order. */
  tours?: string[];
};

export type FaqGroup = { id: string; title: string };

/** A question staff ask. Its links may name a screen the reader cannot open, which is drawn as plain text: knowing where the work happens helps even when it is someone else's. */
export type Faq = {
  id: string;
  group: string;
  question: string;
  answer: string[];
  /** Omitted: every role. */
  roles?: Role[];
  /** The screens it concerns, so each screen's help can offer it. */
  routes?: string[];
  /** The API error codes it explains, so a refusal can link straight to it. */
  codes?: string[];
};

export type HelpContent = { guides: Guide[]; articles: Article[]; faq: Faq[]; faqGroups: FaqGroup[]; tours: Tour[] };
