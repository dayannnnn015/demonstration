# The in-app help, FAQ and tours

Help written as typed data, versioned with the screens it describes, so a change
to a screen and a change to its help land in the same commit — and a test can
hold one against the other.

> **Written 2026-11-04 from the code.** The original of this document was lost
> with the rest of `docs/` in the 0.86.1 recovery and exists in no branch and no
> commit, so this is written from `web/help/`, `web/components/tour.tsx`,
> `web/screens/Help.tsx` and the [changelog](../CHANGELOG.md), in that order of
> authority. Where this file and [constraints.md](constraints.md) disagree, that
> file wins.
>
> **It was a *plan* document, and the thing it planned is built.** What follows
> describes what exists, which is what the next session needs.

## The idea

Help is **not prose in a CMS and not a wiki.** It is TypeScript data in
`web/help/en/`, imported by the workspace and bundled with it:

| File | Holds |
|---|---|
| `guides.ts` | One guide per screen, per audience |
| `faq.ts` | The questions staff ask, grouped, with the error codes each explains |
| `articles.ts` | Topics belonging to no one screen |
| `tours.ts` | Guided tours over the live interface |
| `whats-new.ts` | What changed for staff, newest first, in their words |
| `getting-started.ts` | Set-up progress, worked out from the records |

```ts
/** One edition per language. A Filipino edition is a second entry here, not a rewrite. */
export const editions: Record<Lang, HelpContent> = { en: { guides, articles, faq, faqGroups, tours } };
```

Two consequences follow from it being data rather than documents:

1. **Help ships in the same commit as the screen it describes**, so it cannot
   drift into describing last month's interface.
2. **A test can check it mechanically** — which is the whole point of the markup
   below.

## The three marks, and nothing else

```
**Label**   the exact words on a control
*words*     emphasis
{route}     a link to that screen, drawn with its name in the rail
```

`Prose.tsx` renders them, and that is the entire vocabulary. No HTML, no
Markdown, no headings inside a sentence.

`**Label**` is the load-bearing one:

> A test finds every one in the screens' source, so help can never name a button
> that is gone.

`labelsIn` and `linksIn` exist for that test. This is why `AGENTS.md` says
**renaming a control means updating its guide**: the rename breaks the test, not
a reader's trust six months later.

`{route}` is a real address in the workspace, so following a help link is the
same as choosing the screen in the rail — and **a screen the reader's role cannot
open is named without a link**:

```tsx
return opens.has(id) ? <a href={`#/${id}`}>{nameOf(id)}</a> : <span>{nameOf(id)}</span>;
```

Not hidden. Named as plain text, because *knowing where the work happens helps
even when it is someone else's.*

## A guide per screen, per audience

```ts
export type Guide = {
  route: string;
  for?: Audience;      // omitted: everyone whose navigation offers the screen
  summary: string;     // what the screen is for, in one or two sentences
  steps: string[];     // the work, in the order it is done
  refuses?: string[];  // when the screen will stop you, and why
};
```

Two things in that shape are decisions:

**`for: 'manager' | 'teacher'`.** Help for a screen differs between those who
change its records and those who read them, and the same screen genuinely is two
different jobs. `guideFor` prefers the audience's own guide and falls back to the
shared one — and returns **nothing** for a screen the role's navigation leaves
out, so help never explains a screen the reader cannot reach.

**`refuses`.** Every guide may list what will stop you:

> A refusal is the system working, so it is explained, not apologised for.

That is the posture of the whole system in one line. EDUNEXUS refuses a great
deal on purpose — an unplaced learner on an SF4, a Kinder SF10, a third decimal
place on a grade — and each refusal is a correctness rule doing its job.

## A refusal links to its own answer

This is the best-engineered part of the help system.

```ts
export type Faq = {
  …
  /** The API error codes it explains, so a refusal can link straight to it. */
  codes?: string[];
};
```

When the API refuses something, `StatusLine` shows *What does this mean?* beside
the message, and it opens the answer for that code. The chain:

1. `web/api.ts` throws an `ApiError` carrying the server's own `code`.
2. `message()` remembers the code.
3. `HelpContext.explain(code)` finds the FAQ answer via `faqForCode`.
4. `HelpContext.open({ faq: id })` opens it over the page.

`web/help/context.tsx` is **a context, not an import**, and the comment says why:

> so the primitives a hundred screens share can offer an explanation without
> depending on the route table the help is written against.

A shared primitive importing the help index would drag the route table into every
screen that uses a button.

## The help screen, the sheet and the `?` key

| | |
|---|---|
| `web/screens/Help.tsx` | The Help & FAQ screen, and `HelpSheet` |
| `?` key | Opens help over any page |
| **Help & FAQ** in the rail | The only *visible* way in, since 0.82.1 |

0.82.1 moved help into the rail and **removed the top bar's Help button and the
profile menu's entry.** The `?` key and *What does this mean?* under a refusal
stayed. The workspace tour points at **Help & FAQ** in the sidebar.

The sheet opens **over** the page so nothing typed on it is lost — the same rule
as every other overlay, and only the innermost open overlay answers the keyboard.

## Searching help, and what it must never search

```ts
/**
 * Questions matching every word typed, the question's own words ranked above
 * the answer's. Fixed text only: nothing here reads a record.
 */
```

`searchFaq` requires **every** word to appear, and ranks a hit in the question
above one in the answer. It searches the fixed text and nothing else.

The command palette (Ctrl/Cmd+K) searches the route table and, since 0.68.0, the
help and FAQ written about it — **and nothing else.** Not learners.

The reason is the same one that keeps the Overview away from the roster: every
learner and enrollment list writes a `record_access_events` row naming the
records it returned, so a palette that searched the registry would write one
**per keystroke** and bury the privacy audit it exists to serve. Help is safe to
search precisely because it is fixed text that names no record.

## Tours point; they never act

`web/components/tour.tsx`, with the tours themselves in `web/help/en/tours.ts`.

```
It points; it never acts. A step names a control and says what it does, and
the person presses it once the tour is over. A tour that pressed Confirm
would write a journalled record under someone's name that they did not
decide to make, so the shade over the page takes every click and nothing
beneath it can be used while a tour is open.
```

That is the rule, and the shade is how it is enforced rather than merely
intended.

A step points by `data-tour` name, and two details make it survive a real
interface:

- **Alternatives separated by `|`**, first one on screen wins — so a step can
  point at the rail on a laptop and at the menu button on a phone.
- **`absent`**, said *instead* of pointing when the control is not on screen, in
  the step's own words. A tour that silently pointed at nothing would be worse
  than one that explained the control is not there.

The content policy drops inline styles, so **nothing in a tour is positioned by a
`style` attribute.** The spotlight is an SVG the size of the window whose
rectangles are geometry attributes — the same technique as the charts — and the
words sit in a panel docked by the stylesheet.

`toursFor` offers a role only the tours whose screens its navigation opens;
`tourFor` finds the one that shows a given screen, offered beside its guide.
*Learning EDUNEXUS* on My profile restarts any tour for the role.

## Getting started is derived, not tracked

`web/help/getting-started.ts`, and this is a recorded decision:

> **Nothing stores who has done what (decided 2026-10-25):** each item is a fact
> about the school's records, so the list is never out of date and needs no table
> of its own.

Two further constraints on it:

- **Every fact comes from a read that writes nothing to the privacy log** — the
  Overview's own reads, the school profile, one row of the subject catalog.
- **The calendar is deliberately left out** for exactly that reason: its read
  records an access row for the school year, and the Overview writes none.

And the honest-absence rule again: **a fact that could not be read is `null`, and
its item says so** rather than claiming the step is done or not done.

## What's new, in staff words

`whats-new.ts` is the changelog's content rewritten for the people using the
system — *"A new screen, {prior-records}, for typing in the school years a
learner finished before EDUNEXUS"* rather than a migration number. It is held to
the same label test as the guides.

One entry is worth noting as a precedent: the 0.79.0 two-step sign-in entry
**stayed, with a note that it was taken out again**, because that release did
happen. What's new is a record of what changed, not a description of the current
state.

## The gap: the test is missing

`whats-new.ts` and `tours.ts` both name **`tests/web-help.test.ts`**, and
`AGENTS.md` describes it:

> a test finds every `**Label**` in the screens' source, so renaming a control
> means updating its guide

**That test does not exist on this branch.** It was lost with the whole `tests/`
tree in the 0.86.1 recovery; `tests/` currently holds nine files, none of them
the help test. So the mechanism this entire markup scheme exists to serve —
`labelsIn`, `linksIn`, `**Label**` — **is not currently enforced by anything.**

`labelsIn` and `linksIn` are still exported from `Prose.tsx` and are ready for
it. Rebuilding it means: for every guide, article, FAQ answer, tour step and
what's-new item, find each `**Label**` somewhere in `web/screens/` and
`web/components/`, find each `{route}` in the route table, and find each
`data-tour` name in the screens' source.

This is not listed in [the roadmap](roadmap.md) and should be: it belongs beside
step 5, the `tests/helpers/dom.ts` rebuild, as the other half of the testing
contract the recovery broke.

## What is deliberately absent

- **No help that names a record.** Fixed text only.
- **No learner in the command palette.**
- **No tour that presses anything.**
- **No inline style anywhere in the tour machinery.**
- **No stored progress** for Getting started.
- **No second language yet.** A Filipino edition is a second entry in `editions`,
  not a rewrite — the structure is already there.
- **No help for a screen a role cannot open.** `guideFor` returns nothing.

## Where to look

| | |
|---|---|
| The types, and the three marks | `web/help/types.ts` |
| Rendering, `labelsIn`, `linksIn` | `web/help/Prose.tsx` |
| Selection by role, search, code lookup | `web/help/index.ts` |
| The refusal-to-answer bridge | `web/help/context.tsx` |
| The content | `web/help/en/*.ts` |
| The tour runner | `web/components/tour.tsx` |
| The screen and the sheet | `web/screens/Help.tsx` |
| Derived set-up progress | `web/help/getting-started.ts` |
