# EDUNEXUS implementation roadmap

**Rewritten 2026-11-04.** The previous roadmap was lost with the rest of `docs/`
in the 0.86.1 recovery; it is still readable at `git show 80d8d7c^:docs/roadmap.md`
and is **stale** — it describes Sections 5 and 6 as unbuilt, and both have
shipped since. This replaces it.

Read [standing rules, gates and settled decisions](constraints.md) first — where
it and this file disagree, **it wins and this one is wrong**. That file does not
exist on this branch yet; restoring it is step 4 below, and until then the gates
table at the end of this file is the working copy.

Every step says what it waits on. A step with **Gate: none** can be built today.
A step naming a gate must not be approximated, worked around, or built with a
default standing in for the school's decision.

---

## Where the build actually stands

| Section | State |
|---|---|
| 1 — Staff authorization and school setup | Implemented, with screens |
| 2A/2B.1–2B.5 — Learner registry, enrollment, reviewed corrections | Implemented, with screens |
| 3A/3B.1–3B.4 — Calendar, daily register, monthly consolidation, monitor, follow-ups | Implemented, with screens |
| 4A.1–4A.5 — Subject catalog, offerings, policy drafts, adoptions, bindings | Implemented, with screens |
| 4B.1 — Assessment tasks and raw score entry | Implemented, with a screen |
| 4B.2 — Grade *calculation* | **Superseded.** Nothing computes a grade; advisers enter them from the DepEd ECR (decided 2026-10-08). The old roadmap's "Next: calculation" is no longer the plan |
| 4C — Report-card records (grades, averages, observed values, narratives) | Implemented, with screens. Since 0.103.0 a term accepts its records only once it has **started** (0069) |
| 5 — Promotion and next-year assignment | Implemented, with screens (0033, 0034, 0036, 0049, **0069**). Since 0.103.0 promotion is **closed until the class’s report cards are complete**, and an approved outcome **enrols the learner into next year by itself** — see [the promotion gate](promotion-gate.md) |
| 6 — Official forms: SF2, SF4, SF9, SF10 | Implemented, with screens, printing measured in real Chrome |
| 6B — Historical SF10 encoding | Implemented (0051), with a screen |
| 7 — Operational acceptance and turnover | **This is the remaining work** |

All 28 routes in `web/routes.tsx` are built; there are no placeholder screens
left. The honest summary is that EDUNEXUS is feature-complete for everything the
school has unblocked, and what remains is **deploying it, finishing two
unfinished features, restoring the project's own documentation, and handing it
over**. Resist adding modules to fill out the interface.

---

## Phase 0 — Deploy what is already written

Nothing below can be verified against reality until this is done.

### 1. Apply migrations 0048–0052 ✅ **done 2026-11-04**

**The live database is at 0052.** All five applied in one transaction.

```bash
npm run db:migrate          # there is no dry-run flag; see below
```

**Note for next time: `npm run db:migrate` has no dry run.** The line that used
to sit here implied one. The runner applies, in a single transaction, and
refuses outright if a *previously applied* file has changed — which is the
protection it does have, not a preview. What stands in for a dry run is a
read-only check first: the recorded migrations from `edunexus_meta.migrations`,
and `migrationChecksum` over every file against
`database/migration-checksums.json`. All 52 matched, 0 drifted.

What was established before applying, because it is what made it safe:

| | |
|---|---|
| `seeded_data_notice` holds a row | **The hosted database is synthetic**, as the privacy gate requires. 893 seeded learners, not the 897 real ones |
| School code is **135617** | The right Balili, not 135642 |
| `next_year_placements` is **0** | Nobody has ever run the one screen where 0049 could misbehave against the deployed app |

**Verified after:** 52 applied; all ten new or replaced functions present; all
four new tables present **with row security on**; `enrollments.section_id` now
nullable; and every record count unchanged — 893 learners, 893 enrolments, 36
staff, 78,699 attendance marks, 21,324 grades. The migration touched no data.

`read_sf4_source` refused an operator connection with `42501`, which is correct:
it re-checks `is_manager()` inside the security-definer function and an operator
has no staff actor. That is the rule in `AGENTS.md` about re-checking row
policies inside a definer function, working.

**`npm run smoke`: 179 of 186 passed.** Health, readiness and the workspace page
all pass, which is the signal that mattered — **the deployed 0.86.1 app still
runs correctly against the 0052 schema.** All 7 failures are the deployment
being 0.86.1: the version string, and the six `prior-records` routes that do not
exist there yet.

| | Until applied |
|---|---|
| 0048 optional section | Registering a learner *with* a grade fails — `place_enrollment` does not exist |
| 0049 promotion without sections | **Next year's classes breaks on load** — the screen expects a `grades` field the old function does not return |
| 0050 SF2 movements | A section's SF2 and the SF4 compiled from it disagree by one for a learner who left on the first of a month |
| 0051 prior academic records | **Academic history and the merged SF10 do not work at all** |
| 0052 SF4 unplaced learners | The SF4 still under-reports a learner registered with no class, and can still be issued short |

**The schema half of the acceptance is met.** The rest of it — Academic history
opening, Next year's classes loading, an SF4 refusing with an unplaced learner —
**cannot be met by applying migrations**, and the plan was wrong to put them in
this step. They are 0.87.0 screens, and the deployment is 0.86.1. See step 2.

### 2. Walk the five changes on the deployment — **blocked on a deploy**

Not a test run — the screens, as staff use them. Register a learner with a
grade; open Next year's classes; encode one previous year and print the SF10;
read an SF4 for a month with someone unplaced.

**This cannot be done yet, and it is not a migration problem.** 0.87.0 is
uncommitted and undeployed: the live app is still 0.86.1, which has no Academic
history screen and no `prior-records` routes — `npm run smoke` shows those six
answering 404. The step needs **commit, then deploy**, both of which are the
user's (`AGENTS.md`: the user commits and merges; the 2026-09-19 decision: every
release is deployed before the session ends).

**One thing to know during the window between now and that deploy.** 0049
replaced `commit_next_year_placement` so that it ignores any section on an entry
and enrols with none. The deployed 0.86.1 screen still *draws* learners into
sections and sends them — so if anyone opened **Next year's classes** on live
before 0.87.0 ships, the draw would appear to work and then place everyone with
no class. It is acceptable only because the records are synthetic, no run has
ever been made (`next_year_placements` is 0), and next-year is end-of-year work
in a year that has just begun. **Do not use that screen on live until 0.87.0 is
deployed.** Every other pending migration is additive to what 0.86.1 reads,
which is why smoke's 179 other checks pass.

**Acceptance:** each behaves as [the academic history](prior-academic-records.md)
and [status](status.md) describe. **Gate: none**, but it waits on a commit and a
deploy.

---

## Phase 1 — Restore the project's own memory ✅ **done 2026-11-04**

**Steps 3, 3b and 4 are complete; step 5 is not.** `README.md` and `AGENTS.md`
held **34 links to documents that were not there, and all 34 now resolve.**

The counts in the plan were wrong in one place, corrected here: **23 recovered
from git history, 11 had to be written** — not 8. The three the plan missed were
`roster-submissions.md`, `guides/acceptance-testing.md` and
`guides/staff-guide.md`, each confirmed absent from every branch, every commit
and the reflog.

| | |
|---|---|
| Recovered from `80d8d7c^` | 62 files, including `docs/brand/` and all of `docs/diagrams/` |
| Written from the code | 11 documents |
| Rebuilt as the live file | `constraints.md` |
| **Still outstanding** | **step 5**, `tests/helpers/dom.ts` — and `tests/web-help.test.ts`, see below |

### 3. Recover the documents that still exist in history ✅

```bash
git archive 80d8d7c^ docs/ | tar -x -C <tmp>     # then copy what is absent
```

Done as an extract-and-copy rather than 26 `git show` commands, so that
`docs/brand/` (the supplied mark artwork `AGENTS.md` refers to) and the 33 files
under `docs/diagrams/` — including `paper/`, the capstone figures — came back
too. Four files already present were left alone: `openapi.json`, `roadmap.md`,
`school-forms.md`, `status.md`.

Each recovered file is **as of 0.42.0** and must be read against the code before
being trusted;
releases 0.43.0–0.87.0 are not in any of them. Recover, then correct, in this
order of value:

1. `constraints.md` — see step 4, it is its own step
2. `architecture.md` — identity, the database boundary, concurrency, audit
3. `school-information-requests.md` — what to ask the school, which Phase 3 depends on
4. `runbooks.md` — removing access, rollback, restore, leak response. Needed for Phase 4
5. `frontend-handoff.md` — the rules every screen must respect
6. `report-card-forms.md`, `report-records.md`, `attendance-forms.md` — the SF9/SF10/SF2/SF4 contracts
7. The remaining per-section files, as each is next needed

**Done 2026-11-04.** 23 of the 34 dangling links resolved from this step.

### 3b. Write the 11 documents that are gone for good ✅

**Eleven, not eight.** Each was confirmed absent from all seven branches, from
`git log --all --reflog`, and therefore from every commit in the repository. They
were written for releases 0.43.0–0.86.1 and `.vercelignore` kept `docs/` out of
the deployment the source was rescued from, so they went with it.

Written from `src/modules/`, `web/` and the `CHANGELOG`, in that order of
authority — the code is true, the changelog says why:

| Document | What it describes |
|---|---|
| `attendance-forms.md` | The SF2 and SF4: the recorded day rule, where a mark becomes a day, to-date counting, movements from the timeline (0050), unplaced learners (0052), issuance and its refusals in order |
| `report-card-forms.md` | The SF9 and SF10: three card layouts and their page rules, the printed-not-applied descriptors, attendance on the card, the eight-block data loss, fingerprints |
| `report-records.md` | Grade entry from the ECR, observed values, narratives, the class summary, outcomes, `grade-entry` as the counting-read pattern, and the ORDER BY journal bug |
| `next-year-classes.md` | Promotion outcomes into next year's enrolment after 0049 removed the draw, the review hash, the lock order, the vestigial seed |
| `roster-submissions.md` | The adviser-proposes/manager-approves shape, why the check reads no learner, why acceptance points at an import rather than performing one |
| `notifications.md` | The personal inbox (0056): the two decisions it reverses and the condition that changed, why no notification names a learner, why it carries no version and no journal of its own, why the API cannot forge one, and the roster emitters |
| `public-site.md` | The front page as a second entry, its own content policy, what publishes and what never does |
| `staff-profiles.md` | Profiles, avatars, why a photo loads no image file, what `checkJpeg` strips, sessions, the two-step removal, name corrections |
| `help-and-tutorials-plan.md` | The in-app help, FAQ and tours, the three marks, the refusal-to-answer bridge — **and that the test holding them to the screens is missing** |
| `guides/staff-guide.md` | For school staff, by role: setting up a year in order, the monthly routine, the register, report cards, the academic history, and what EDUNEXUS deliberately does not compute. **Its screenshots are not restored** — retake them from `npm run demo` |
| `guides/acceptance-testing.md` | For whoever runs UAT: task scripts for all three roles, the accessibility pass, a problem log with an is-it-a-rule-or-a-bug table, the TAM questionnaire and how to summarise it, the sign-off sheet |
| `profile-plan.md` | A stub saying it is superseded, pointing at `staff-profiles.md`. The changelog's 0.81.1 entry links to it |

**Acceptance met:** every link in `README.md` and `AGENTS.md` resolves, and every
internal link between the documents resolves.

#### One gap this step found, which is not in any step

`tests/web-help.test.ts` **does not exist.** `AGENTS.md`, `web/help/en/tours.ts`
and `web/help/en/whats-new.ts` all name it, and it is the test that finds every
`**Label**` in the screens' source — the whole reason the help markup exists. It
went with `tests/`. `labelsIn` and `linksIn` are still exported from
`web/help/Prose.tsx` and are ready for it.

**It belongs beside step 5**, as the other half of the testing contract the
recovery broke. Until both exist, `AGENTS.md` describes two tests that do not run.

### 4. Rebuild `docs/constraints.md` as the live file ✅

Done 2026-11-04. [constraints.md](constraints.md) exists again and is the live
file. **It, not this roadmap, is now the authority** — where the two disagree,
correct this one.

What was done:

- **Standing rules rewritten to 2026-11-04.** Six rules added that were being
  carried only by `AGENTS.md`: nothing computes a grade; absence of a record is
  not evidence; attendance figures come only from the recorded rule; the SF10 is
  one cumulative derived record beginning at Grade 1; every SF4 figure is counted
  by section; never run `supabase config push`. The manager-only rule now names
  its one exception.
- **Gates rewritten.** The **subject-teacher access** gate is recorded as new;
  its integration was then deferred on 2026-11-05 because the role itself is
  unconfirmed, so it needs the role confirmed before any access decision. Official form templates is widened to say the SF10
  workbook is in hand and to name the four outstanding items. The grading gate
  records that calculation was **superseded** on 2026-10-08 rather than opened —
  so what it blocks is a feature nobody is waiting on.
- **25 decision rows added** above the recovered ones, covering 0.43.0–0.87.0.
- **The recovered 0.42.0 rows are unaltered.** A superseded row is contradicted by
  a newer row rather than edited, so the record of what was decided when survives.
- Rows are **dated where a date is recorded** in `AGENTS.md`, the changelog or a
  session file, and **attributed to their release where no date is.** No date was
  guessed at.

`AGENTS.md` was corrected in two places while doing this, both stale: the flat
*"sessions must not move to `localStorage`"* rule, which the 2026-11-03
*Keep me signed in* decision amended, and a claim that the sign-in hillside is
the only image `/app` loads, which the SF9 and SF10 seals contradict. Two stale
source comments were fixed for the same reason — `web/forms/sf9.tsx` said the
Grades 4–6 card is US Letter, and `src/http-app.ts` said two files are served
under `img-src`. Both now match the code.

**Still to do:** `status.md` carries a decisions table of its own as a stopgap and
should be cut down to point at `constraints.md` instead.

### 5. Rebuild `tests/helpers/dom.ts` ✅ **done 2026-11-04**

`AGENTS.md` requires a screen's data paths to be tested in a real DOM against
the real API over PGlite. The helper is rebuilt, and the suite went from
**102 tests in 9 files to 114 in 11**.

`tests/helpers/dom.ts` exports:

| | |
|---|---|
| `serverApi(db)` | The workspace's own client (`createApi` from `web/api.ts`) pointed at the real API. `signInAs`, `signInWithToken`, `sessionLost()`, and `sent[]` — every request the client actually made |
| `mount(element)` | A mounted component, with `until(predicate)`, `settle()`, `byText`, `field`, `click`, `type`, `submit` |
| `mountScreen(Screen, server, me)` | A screen with the props every route takes, and the `setStatus` calls it made |

Both tsconfigs already listed `tests/helpers/dom.ts`, so only the new test files
needed adding.

**Acceptance met**, in `tests/web-dom-harness.test.ts` (7 cases): a real request
leaving the client at the path it builds; a refusal arriving as the server's own
code (`SF10_NOT_YET`) with the opposite case passing; row security deciding what
a signed-in teacher sees; the role gate refusing a manager-only read; a real
version conflict reported as `isConflict`; a field rejection mapped to
`year.grade_level` the way `Editor` needs; and a 401 ending the session.

`tests/web-prior-records-server.test.ts` (5 cases) then drives the **real
Academic history screen** through it: the screen reads no learner list until
asked, the search it builds is one the API accepts, an adviser sees only their
own learners while a manager sees both, and `may_write` comes from the database
rather than from the screen's guess at the role — which is the adviser exception
of 2026-11-03 tested where it actually lives.

`tests/web-prior-records.test.ts` was **kept, not converted.** A stub is still
the quickest way to assert a layout that the server would need a long fixture to
produce, and its own header now says which half it covers. The server-backed
file covers the half it cannot reach.

#### Four things the rebuild had to get right, recorded so they are not redone

- **happy-dom enforces the Same Origin Policy**, so a request to the app on a
  loopback port is blocked before it is sent. The wrapper hands the request to
  supertest instead, which binds the app and makes a genuine HTTP request. Only
  the browser's origin check on a request a browser would never make is skipped:
  in the deployed app the API is same-origin with the workspace.
- **A controlled React input ignores `node.value = x`.** React tracks the last
  value it wrote and sees the assignment as no change, so the event is swallowed
  and the screen's state never moves — a test built on it asserts nothing.
  `setNativeValue` goes through the prototype's own setter.
- **A synthetic click on a submit button does not submit a form.** Every `Finder`
  and `Editor` is a real `<form onSubmit>`, so the harness has `submit()`.
- **A fixed number of microtask flushes is not enough.** A request here is real
  I/O, so `until(predicate)` waits on what the screen says rather than on how
  long a round trip took.

### 5b. Rebuild `tests/web-help.test.ts` ✅ **done 2026-11-05**, with `tests/migrations.test.ts`

Both existed in `AGENTS.md` and nowhere else. Done together, because they are
the same kind of gap: a rule the project states and nothing enforces.

`tests/web-help.test.ts` (8 cases) finds every `**Label**` in every guide,
article, FAQ answer, tour step and what's-new item in the screens' own source;
checks every `{route}` link and every guide, FAQ and tour route against the route
table; checks every tour step's `data-tour` target, understanding the two
attributes built from a template or a map; and requires a guide for every screen
a role can actually open — which is not every built route, since `policies` and
`scores` are hidden from every role that could reach them.

`tests/migrations.test.ts` (5 cases) holds `database/migration-checksums.json`
against the files on disk **in both directions**, checks the numbering runs from
0001 with no gap, and refuses a bare `create function` on a name an earlier
migration already created, allowing the three legitimate ways to replace one:
`create or replace`, a `drop function`, and `0012`'s `alter … rename to`. The
last check earns its place because the runner applies every pending migration in
**one transaction**, so one such line fails the whole deploy — after the
checksums have already passed.

**The lesson worth keeping, and now the rule for any gate added here: break it
on purpose before trusting it.** The help test was **vacuous on its first run**.
It scanned all of `web/`, which includes `web/help/`, so every label matched the
help file it was written in; a deliberately broken label did not fail it. With
`web/help/` excluded it found eight stale marks at once — five real, including
the registry button renamed in 0.82.1 and a whole guide still describing the
section draw that 0049 removed — and then caught three more in the help written
for 0.89.0 before it shipped.

**What is still missing:** `tests/concurrency.pg.test.ts`, the opt-in
two-connection proof behind `npm run test:race` and `npm run test:load`. Both
scripts currently run nothing. It needs Docker, so it skips unless
`EDUNEXUS_RACE_PG_URL` is set, and it must never be pointed at a shared or
hosted server.

---

## Phase 2 — Features to build now

Steps 6 and 7 are **done** (0.90.0). **Step 8, the batch SF10, is deliberately
left for a later phase** — the user deferred it explicitly on 2026-11-05 while
asking for 6 and 7, so do not start it without being asked.

### 6. School-wide encoding oversight ✅ **done 2026-11-05 (0.90.0)**

The one unmet requirement of the 4 November brief, now met.
`GET /academic-years/:id/encoding-progress` (`read_encoding_progress`, 0054)
counts, for every section of a year: the learners it holds, how many have an
encoded previous school year, how many have the Grade 1 credential, how many
have **neither** — the work left — the years encoded, and the adviser's name.
Learners registered at a grade with no class yet are counted on their own, so
the school total is the whole school rather than only its placed part, for the
same reason the SF4 reports its unplaced learners (0052). It is **Across the
school** above the learner finder on Academic history, for managers only.

**It mirrors `read_grade_entry` (0035) exactly**, which was the instruction and
is the point: counts only, **no learner named, no rating read, no
`record_access_events` row written**. A DOM test asserts the access-event count
does not move when a manager opens it, because that is the property that would
rot silently. A manager who needs a name opens the learner, which logs that read
as it should.

### 7. Teacher pull ✅ **done 2026-11-05 (0.90.0)** — and it reversed this step's own design

This step said the pull *"must stay a **request**, not a grant: an adviser
proposes a roster, a manager approves it"*, reusing `roster-submissions`. **The
user decided otherwise**: the adviser does it directly. The reversal is recorded
in [constraints.md](constraints.md) with its date, as this step itself required,
and `roster-submissions` stays for an adviser who prefers to submit a list.

- `GET /sections/:id/pullable-learners` — the learners registered for that
  section's year at its grade **with no class yet**, and, with a search of two
  characters or more, a learner with no enrolment this year at all.
- `POST /sections/:id/pulls` — takes one in. A class is given to the enrolment
  they already hold, or they are enrolled at the section's grade if they hold
  none this year.
- `POST /sections/:id/learners` — registers a new learner straight into that
  class.

**What widened, and nothing beyond it.** Always a section they advise in an open
year (`may_advise_section`, the single predicate every path goes through).
Taking a learner in only ever gives a class to an enrolment that has none, so
moving a learner out of a colleague's class, withdrawing and re-entering stay a
manager's movement. Registering refuses a name and birth date already on the
registry, because an adviser cannot search it and two records for one child is
two SF10s. No profile correction, LRN, grade change or withdrawal is opened.
Row security is untouched.

**No second enrolment path**: both writes go through `place_enrollment` and
`move_enrollment`, each replaced in 0054 with one authorisation line changed and
its 0048 signature intact.

**The trap this step hid, worth not re-stepping on.** Deciding *which* of the
two writes applies cannot be done in the service. An adviser **cannot see** an
unplaced learner's enrolment — `visible_learner_identity` answers null for
exactly that caller, correctly — so a service-layer lookup under row security
finds nothing, takes the "not enrolled" branch, and tries to create a **second
enrolment for the same learner in the same year**. Only the unique index caught
it, on the first test run. The decision now lives in
`pull_learner_into_section`, a security-definer function that re-checks the
policy it bypasses. The general rule is in `constraints.md`: when a write must
branch on records the caller may not read, the branch belongs in the definer
function.

### 7b. The promotion gate, the term window and automatic advancement ✅ **done 2026-11-09 (0.103.0)**

Asked for on 2026-11-09 and built the same day, as migration `0069`. Three
requests that turn out to be one piece of work: **the end of a school year
should not be something a person has to remember to do.**

Promotion is closed until a class’s report cards are complete, judged
against what that grade’s card actually prints — so Kindergarten waits for
nothing and a descriptively graded grade waits for its narratives. A term
accepts grades only from its own `starts_on`, enforced by a trigger on the
three record tables rather than inside the four writers. And `decide_promotions`
now enrols each approved learner into next year in the same transaction, with no
section, through the same `place_enrollment` everything else uses; when next
year does not exist yet, an `after insert` trigger on `academic_years` runs the
carry-forward the moment it is created.

**What was deliberately not done, and must not be assumed later:** a retained
learner is not placed back into the equivalent next-year section automatically —
that would mean guessing a same-named section is the same class, against 0049’s
settled decision. And the final grade, the subject average and the general
average name no term, so they are not inside the term window. Both limits are
recorded in [the promotion gate](promotion-gate.md); neither is an oversight.


### 7c. One SF9 per grade level, and the history of them ✅ **done 2026-11-09 (0.104.0)**

Asked for after 7b was finished, and **four of its five requirements were
already true**: an SF9 is derived per *enrolment* and never stored, every
report-card record is keyed by `enrollment_id`, and `form_issuances` CHECKs that
an `sf9` row names both a school year and an enrolment -- with the prior a
reissue looks for keyed on that same scope, so a later grade can neither find
nor overwrite an earlier one, and no row is ever updated or deleted.

So most of `0070` is `tests/sf9-per-grade.test.ts`, which walks a learner’s
Grade 1 to Grade 2 year and asserts each step -- because none of that is visible
from any one file and all of it would break silently. The one thing genuinely
missing was the history: `GET /learners/{id}/sf9-history`, and the **Report
card** column it feeds on the learner’s profile.

**Do not add an actor to that read.** It is `security definer` so that a teacher
can see a card the office issued, and it returns no staff name or id at all --
widening it would hand every adviser every issuer, which is the 0.92.0 boundary.
See [the SF9 history](sf9-history.md).


### 8. Batch SF10, and a batch for the encoding — **deferred, do not start**

Deferred by the user on 2026-11-05, in the same instruction that asked for
steps 6 and 7: "Do NOT implement batch SF10 generation in this development
task. Leave this feature untouched for a future implementation phase."
Everything below is the unchanged plan for whenever it is asked for.

SF9 has **Print the section's SF9s**; the SF10 has no batch, so a permanent
record is printed one learner at a time. At turnover, and whenever a cohort
leaves, that is 897 separate operations.

- A section's SF10s printed in one pass, reusing `PrintCopy` and `@page sf10`.
- Consider the same for issuance, which must stay one journal row per learner.

**Acceptance:** one section's SF10s print as one document, each learner starting
a new leaf so duplex still pairs. **Gate: none.**

### 8b. Bulk import of the historical records — **considered and declined for go-live**

Built on 4 November at the user's request and **reverted the same day at the
user's direction**: it is explicitly *not* a go-live requirement, and may be
reconsidered as an enhancement if the school asks for one. The school can use
EDUNEXUS with no historical records at all, and encode or import them whenever it
chooses.

Recorded so a future session neither rebuilds it by accident nor re-derives what
it would have to be. The attempt was a workbook **generated by EDUNEXUS** from
the columns a template endpoint published, parsed and refused **cell by cell,
per row** (a typed schema answers one wrong cell in row 40 with one 422 about the
whole upload), written row by row through **the same `write_learner_prior_year`**
as a year typed by hand, replacing nothing already on a record, in one
transaction, with the file's name and hash kept. It passed its own tests
(21 server, 14 workbook). Four things it had to avoid are worth keeping in mind
if it returns: it must not name learning areas per grade, because an earlier
curriculum's areas are not the ones the school's cards print today; it must carry
no formula, because a general average on a permanent record must be the school's
arithmetic and not ours; it must not compare a general average against the
average of its ratings, which is DepEd's to define; and the review must take the
academic lock **exclusively and first**, since the writer takes it exclusively
and a shared-then-exclusive upgrade is the deadlock the register's lock ordering
exists to avoid. **Gate: none** — this is a priority decision, not a blocked one.

**What remains the way historical records go in:** one school year at a time on
**Academic history**, for the learners a manager or the learner's own adviser may
encode for. Unchanged, and the only path.

---

## Phase 3 — Features behind a school decision

**Do not build any of these yet.** Each needs something written from the school.
Ask for all of them in one request — see `school-information-requests.md` once
step 3 has restored it.

### 9. The Kinder and Grades 1–3 SF9 cards

Gate: **official form templates** (partly open). The school supplied the Grades
4–6 card; `sf9Get` refuses Kindergarten with `NO_KINDERGARTEN_CARD`, and the
Grade 1 and Grades 2–3 layouts were built from the school's spreadsheets rather
than an official blank.

**Needs:** the blank Kinder and Grades 1–3 SF9, and for Kinder the assessment
policy too. **Until then:** no Kinder card and no numeric Kinder grading. A
Kinder learner's records stay the SF5-K and the ECCD checklist.

### 10. Subject-teacher access — **deferred 2026-11-05: the role is unconfirmed**

The user deferred integration on 2026-11-05: the function is not to be built
and the role is yet to be confirmed by the school. Confirm the role exists
before asking what it may do, and do not start either from the evidence alone.

Gate: **none recorded — this needs a new decision.** The school's own SF4 shows
**three teachers teaching across sections they do not advise** (Science and
MAPEH in Grade 4; Araling Panlipunan with GMRC and with MAPEH across Grades 5
and 6). EDUNEXUS models no subject-teacher access at all, by the settled
decision that it must not be invented — so those three teachers cannot record
anything for the classes they actually teach.

**Needs:** a decision on whether a subject teacher may enter scores and grades
for a section they do not advise, and for which learning areas.
**Put it to the school; do not design around it.**

### 11. Class capacity

Gate: **learner fields and class capacity**. Observed sizes are known (18–20
Kinder, 29–37 elsewhere) and observation is not policy. Next year's classes
enforces and suggests no maximum, deliberately.

**Needs:** an approved maximum, or a written statement that there is none.

### 11a. The learner profile's remaining demographic fields

Gate: **learner fields and class capacity**, the same one.

**Two of the fields this section used to block have shipped.** A Learner
Profile feature was asked for on 2026-11-05 with sections for parent and
guardian names, relationship and contact information, and "other existing
demographic fields". The first finding was that the class-list import collects
nothing the registry did not already hold — `ROSTER_HEADER` is
`lrn, first_name, middle_name, last_name, name_extension, birth_date, sex,
address`, all eight on `edunexus.learners` — so there was no imported
information to surface, and every extra field the request named was blocked
here. That was reported in those words; the user then asked for the guardian
name and contact number **by name**, which is the reaffirmation that opens this
gate, and `guardian_name` and `guardian_contact` shipped in 0.92.0 (migration
0056).

**What this section still blocks**, and each is a fact about a child or their
family that 897 real records would hold: mother tongue, religion, indigenous
group, a relationship-to-learner field, a second guardian, a guardian email,
occupation or address, the learner's own contact number, and any breakdown of
the address line into columns. Two of these were refused *within* the shipped
work rather than merely not built: **no relationship field**, because nothing
supplied says which relationships the school records or how it writes them and a
closed list would refuse a real family; and **the guardian pair is not in the
import template**, because extending a published import contract is its own
decision. At 897 learners the second is a real cost — the guardian is typed per
learner — and it is the likeliest thing to be asked for next.

The profile **names the fields EDUNEXUS does not hold** rather than leaving them
as empty lines, so the screen is ready for more and refuses to guess at them.

**Needs:** the school's reviewed field list — which facts about a child and
their family it may keep, and for what purpose. Nothing here is a layout
problem, so do not design the sections before the list exists. **And now a
second thing is owed**, which was not before: the guardian pair is personal
data about an adult who is not the learner, so the privacy owner's approved
purposes must cover it before real records are imported.

### 12. Absence alerts and follow-up thresholds

Gate: **absence-alert rule** — **contested**. The settled record says the school
has no approved threshold; the school's own SF2 obliges intervention at five
consecutive absences and counts those learners monthly.

**Needs:** which of the two is current. Until then follow-up stays manual and
nothing alerts, messages or notifies.

### 13. The SF2/SF4 arithmetic that is still unknown

Gate: **mark meanings and conversion rules**. The formulas arrived with the
school's SF2; the rules for feeding them did not. Still unknown: how a morning
and an afternoon become one daily mark beyond the rule the principal records,
half-day credit, single-session days, transfer effective dates, and
alternative-delivery conversion. The form's single daily column also raises
whether the school keeps two-session registers at all.

**Needs:** approved rules for each. Until then an affected figure stays empty,
never estimated.

### 14. The form correction process

Gate: **official form templates**. Issuance records a serial, a fingerprint and
a reason for a changed re-issue, but the school's own process for correcting an
*already-issued* form is not recorded.

**Needs:** the process. Also settle the two open form questions in
[status](status.md): whether Balili's head should be pre-printed on the SF9's
Cancellation block (the *receiving* school completes it), and which DepEd order
the SF10-ES footer should cite.

---

## Phase 4 — Section 7: operational acceptance and turnover

This is the real remaining work, and most of it is not coding.

### 15. Drill every runbook once against an isolated project

The runbooks are written; each must be exercised once.

```bash
npm run drill:restore -- --confirm    # live schemas into a throwaway container
npm run drill:revocation              # removing someone's access
```

Also: deployment rollback, a migration applied under load, and private-document
recovery. **Acceptance:** each runbook is walked, and corrected where reality
differed. **Gate: load and recovery verification.**

### 16. Prove the system under the real staff cohort

```bash
npm run test:race     # two-connection lock races
npm run test:load     # 27 advisers submitting the register at once
```

Both pass locally. What has **not** been established is hosted throughput,
realistic multi-session authentication load, or every concurrent locking race.
Test the hosted API with at least 27 concurrent teacher sessions, preferably all
33 staff, and agree latency and error targets with the school.

**Acceptance:** targets agreed and met. **Gate: load and recovery verification.**

### 17. Settle privacy before any real learner data

**This gate blocks the import of every real record, and it is the most important
one in the project.** EDUNEXUS will hold roughly 897 learners' and 33 staff's
records.

**Needs:** a named privacy owner, approved purposes and fields, the hosting
arrangement, recovery objectives, and a *tested* restore.
**Gate: privacy owner and approved purposes.** Until it is open, the hosted
database holds synthetic records only.

### 18. Go live

In order, once 17 is open:

1. `npm run seed:test-data -- --rehearse` against a throwaway database, to rehearse the shape
2. `npm run reset:seeded-data` with `RESET_CONFIRM=wipe-seeded-data` — the wipe that keeps real staff profiles
3. Enter the school's own facts: profile (school ID **135617** — pin the ID, there is a second Balili Elementary School at 135642), the 2026–2027 year and its four quarters, 30 sections, advisers, the learning areas, and the principal's attendance rule
4. Import the learner registry, then enrol
5. Encode the historical records — Phase 2 steps 6 and 7 are what make this manageable
6. `npm run smoke`

**Acceptance:** a real staff member signs in, marks a register, enters grades,
and prints an SF9 and an SF10 that the school reconciles against their own.
**Gate: privacy owner and approved purposes**, plus **real staff sign-in and
school acceptance**.

### 19. UAT, TAM evaluation and training

The TAM evaluation measures the interface, not the API. Walk every screen with
real staff for all three roles, at 1366 and 390 px, with the accessibility
settings on. Train the office on registration, enrolment, placement and the
historical encoding; train advisers on the register, report cards and their own
part of the encoding.

**Acceptance:** sign-off recorded. **Gate: real staff sign-in and school acceptance.**

---

## The gates, as they stand

Recovered from the 0.42.0 `constraints.md` and corrected to 2026-11-04. **This
is a working copy** until step 4 restores the real file, which then wins.

| Gate | Blocks | Opened by |
|---|---|---|
| **Privacy owner and approved purposes** | Importing any real learner data | A named owner, approved purposes and fields, hosting, recovery objectives, a tested restore |
| **Official form templates** | *Partly open.* Kinder and Grades 1–3 SF9; the form correction process | The blank cards and the process |
| **Grading enclosure and ECR examples** | Component arithmetic, rounding, transmutation, MPS, GWA, any total of raw marks. **Raw score entry is out of this gate** (2026-09-26); **grade entry from the ECR replaced calculation** (2026-10-08) | The verified current enclosure and the school's ECR examples, reconciled |
| **Kindergarten assessment policy** | Any numeric Kindergarten grading or report output | An explicit approved policy |
| **Mark meanings and conversion rules** | Official SF2/SF4 arithmetic, half-day credits, alternative-delivery conversion | Approved rules for each |
| **Absence-alert rule** | Any threshold, alert, notification or messaging | **Contested.** The school says it has none; its SF2 obliges intervention at five consecutive absences |
| **Learner fields and class capacity** | Capacity enforcement, additional profile fields | A reviewed field list and capacity policy |
| **Load and recovery verification** | Section 7 turnover | 27+ concurrent sessions, restore, revocation and rollback drills |
| **Real staff sign-in and school acceptance** | Hosted acceptance sign-off | *Half open.* A manager has signed in; school acceptance outstanding |
| **Subject-teacher access** | Three teachers recording for classes they teach but do not advise | **Deferred 2026-11-05 — the role itself is unconfirmed, so confirm the role before asking what it may do.** Evidence is in [school forms](school-forms.md) |
| **Service-role key in the runtime** | Nothing currently built | A written decision accepting the risk. Account creation no longer needs it |

---

## What must never be built

From `AGENTS.md`, repeated because a roadmap is where someone looks for
permission to add something:

- **Nothing computes a grade** — no total, average, percentage, MPS, GWA or
  transmutation, anywhere, including client-side.
- **No invented DepEd policy** — no weights, transmutation table, rounding rule,
  passing mark or numeric Kindergarten grading.
- **No estimated attendance figure.** With no rule, an unmarked session, an unset
  date or an alternative-delivery date, the figure is empty.
- **Absence of a record is not evidence.** Null, never zero, never "present".
- **No backend control weakened** to make a screen easier.
- **No per-year SF10.** One cumulative record per learner, beginning at Grade 1.
