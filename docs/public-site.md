# The school's public front page

The one part of EDUNEXUS anybody can read without signing in. It shows what
managers publish, and **it never shows a learner.**

> **Written 2026-11-04 from the code.** The original of this document was lost
> with the rest of `docs/` in the 0.86.1 recovery and exists in no branch and no
> commit, so this is written from `src/modules/site/`, `src/http-app.ts`,
> `web/site/` and the [changelog](../CHANGELOG.md), in that order of authority.
> Where this file and [constraints.md](constraints.md) disagree, that file wins.

## A second entry, not a route in the workspace

The front page is a **separate Vite entry**, built and served alongside the
workspace:

| | |
|---|---|
| Entry | `web/site.html` |
| Source | `web/site/Site.tsx`, `pages.tsx`, `data.ts`, `art.tsx` |
| Styles | `web/styles/site.css` |
| Served at | `/`, `/announcements`, `/announcements/:id`, `/calendar`, `/faq`, `/about`, `/contact` |
| Reads | `GET /api/v1/public/site` — **the one route that needs no token** |

`vite.config` declares both inputs; the server hands out `web/app.html` for
`/app` and `web/site.html` for the front page. They are separate bundles, so
nothing in the workspace — no screen, no client, no learner shape — ships to the
public page.

## The one public read

```
GET /api/v1/public/site      no token, no sign-in service, no third party
```

It answers with **only what the school published**, its profile, and its
school-wide days without classes. It is served from one database function,
`edunexus.read_public_site()`, so what is public is decided in SQL rather than by
a screen remembering to filter.

Three guards on that route:

```ts
await assertRuntimeRole(tx);
await tx.query("select set_config('statement_timeout','5000',true)");
res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
```

The runtime role is asserted as on every other route — an unauthenticated read is
still `edunexus_app`, not a wider role. A 5-second statement timeout caps what an
anonymous request can cost. And a minute's shared cache keeps a busy morning off
the database: the front page is the one thing that can be hit by anyone at all.

## Its own content policy

```
default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self';
img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'
```

Note `connect-src 'self'` with **nothing else**. The workspace's policy adds the
sign-in service's origin to `connect-src`; the front page does not, because **it
talks to this origin only: no sign-in service, no third party.** `form-action
'none'` means the page cannot submit anywhere — it is a reading page.

`Referrer-Policy` is `strict-origin-when-cross-origin` here, rather than the
workspace's `no-referrer`, because the front page may legitimately link out.

### Kept out of search engines until go-live

```ts
if (process.env.EDUNEXUS_SITE_INDEX !== 'yes') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
```

Opt-in, not opt-out. Until the school goes live with real records, the page is
not indexed. Turning it on is a deliberate act and is written up in
[the runbooks](runbooks.md).

## What managers publish

Every write is manager-only — the principal's and the administrative officer's.
Each is versioned and takes a reason, and keeps what it said before in the
journal.

```
GET   /api/v1/announcements              drafts included, with the front-page details
POST  /api/v1/announcements              write a draft
PATCH /api/v1/announcements/:id          change it
POST  /api/v1/announcements/:id/status   publish, unpublish, archive
GET   /api/v1/site-faqs                  the parents' and guardians' questions
POST  /api/v1/site-faqs
PATCH /api/v1/site-faqs/:id
POST  /api/v1/site-faqs/:id/status
PATCH /api/v1/site-settings              what the page says about the school
```

### Announcements, events and advisories

One table, three `kind`s, and the distinction is enforced rather than suggested:

```ts
.refine(v => (v.kind === 'event') === (v.event_on !== null),
        { path: ['event_on'], message: 'An event needs its date; news and advisories have none.' })
.refine(v => v.event_ends_on === null || (v.event_on !== null && v.event_ends_on >= v.event_on),
        { path: ['event_ends_on'], message: 'The last day comes on or after the first.' })
```

**The database refuses the rest; this names the field.** That is the pattern the
whole system uses — the database is the authority, and the contract exists so the
rejection arrives beside the box the person typed in, which `Editor` then marks
and focuses.

An event also carries `event_time` and `venue`. Any of the three can be `pinned`.

### Three states, and archive is final

`draft` → `published` → `archived`. Publishing puts it on the front page;
unpublishing takes it back to a draft; **archiving is for good**, which is why the
screen puts it behind `Confirm` and says what it costs.

### The front-page details

`siteSettingsSave` carries the tagline, about, mission, vision, phone, email,
office hours and a Facebook URL. The Facebook field is the only one with a shape
check:

```ts
/^https:\/\/(www\.|m\.)?facebook\.com\/\S{1,200}$/
```

An `https` Facebook page address and nothing else. Not a general URL field — a
free-text link on a school's front page is somewhere to put a phishing target.

### Text rules

Two shapes, used throughout:

| | |
|---|---|
| `line(min, max)` | One line: refuses every control character, including a newline |
| `paragraphs(min, max)` | May run to several lines; refuses the hidden control characters via `plainText` |

A title, summary, event time, venue, question, phone, office hours and tagline
are lines. An about, mission, vision, answer and body may have paragraphs.

## What never appears

> **No learner. Ever.**

There is no learner, enrolment, grade, attendance figure, register, form or
report anywhere in the public read, in the site module's contracts, or in the
front-page bundle. The page carries the school's own words, its calendar of
school-wide days without classes, and its contact details.

This is not a filter applied late. The public read is its own database function
and the page is its own bundle, so there is no code path from the front page to a
learner record to accidentally leave open.

## Its one image

The hero illustration, from `web/public/images/`, served from this origin and
versioned in its file name — `hero-balili-v1-1200.webp`,
`hero-balili-v1-1881.webp` and `hero-balili-v1-phone.webp`, so a phone does not
fetch a 1881px painting.

**It shows no person.** That is the rule, not an accident of the artwork: a school
front page showing a child is a disclosure.

The same illustration is the one image the sign-in page shows, which is how it
comes to be on the closed list of images the workspace loads. See
[constraints.md](constraints.md) under 2026-11-02 for that list.

`web/site/art.tsx` holds the page's drawn ornament, inline SVG, for the same
reason everything else in the system is: the content policy loads no image file
that is not on the list.

## Privacy

**The site module writes no `record_access_events` row**, because nothing it
reads or writes is a learner record. Every change is journalled with its
before/after snapshot, the actor and a reason, like every other mutation in the
system — that is the audit journal, not the privacy access log, and the two are
different things for a reason.

## The screens

| | |
|---|---|
| **Public site** | Where managers write, publish and archive. In the workspace |
| The front page itself | `web/site/Site.tsx` and `pages.tsx`, outside the workspace |

The front page's own FAQ is the published `site_faqs` — questions for parents and
guardians. It is **not** the workspace's in-app FAQ, which is fixed text that
names no record and is covered by
[help-and-tutorials-plan.md](help-and-tutorials-plan.md).

## Where to look

| | |
|---|---|
| Contracts, text rules, the state machine | `src/modules/site/contracts.ts` |
| Service and the public read | `src/modules/site/service.ts` |
| The route, its policy and its cache | `src/http-app.ts` |
| The page | `web/site.html`, `web/site/`, `web/styles/site.css` |
| Error codes | `src/core/errors.ts`, ranges `P22xx` (the site) and `P23xx` (its questions) |
