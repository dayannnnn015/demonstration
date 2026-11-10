# Where things stand

> ## 0.111.9 is committed, not deployed
>
> **Forms open quiet.** Every field hint follows the one notes switch, off by
> default, so a form is its labels and boxes and the explanation is a click
> above it. A rejection, a warning and an *Affects* block are not notes and
> stay. **The *General average* box is gone from Academic history**, asked for;
> a year already carrying one keeps it, because the SF10 prints that row.
>
> **0.111.8 was never deployed** — `npx vercel --prod` was refused by the
> permission check. Live is 0.111.7, so neither 0.111.8 nor this is on the
> school’s address yet.
>
> ## 0.111.8 is live
>
> **The offer to list a grade’s learning areas is always drawn.** It
> rendered only when it had something to add, so on opening **Add a school
> year** — grade still on *Choose…* — there was nothing at all, and it was
> reported twice as a feature never built. It now names which of three states
> it is in, and all three are tested.
>
> ## 0.111.7 merges the 2026-11-10 interface work onto the live line
>
> **Built on `promotion-and-sf9`, which was sixteen commits behind**
> `origin/master` the whole time it was written — the branch was at 0.110.0
> while live ran 0.111.6. That was found only when a cloud routine was being
> set up, and the user chose to finish the work there and merge afterwards,
> which is what 0.111.7 is. Nothing of 0.111.0–0.111.6 was lost: a deploy from
> the unmerged branch would have rolled production back seven releases, the
> same accident `docs/status.md` already records for 8 November.
>
> **Seven changes, each its own commit with the whole suite run before it.**
> No endpoint, schema, permission, error code or migration, so the hosted
> database stays at 0072.
>
> 1. The monthly screen lost *Membership and marks* and *Transition history*;
>    the attendance rule card lost its *Not recorded yet* callout.
> 2. The attendance rule is chosen from stacked lines, not a select
>    (`Editor` gained `radios`, which starts on nothing).
> 3. **Include retired** appears only where something is retired.
> 4. Every titled note folds from its own heading, open to begin with.
> 5. `FileRules` replaces both copies of the class-list file hint.
> 6. The staff sign-in panel drops its footer line; **Staff portal** stays.
> 7. *List the <grade> learning areas* works where it is aimed — it was a
>    layout fault, and the behaviour now has the two tests it never had.
>
> **How the one collision was settled.** 0.111.3 folds a *description* behind
> one switch, off by default, and its settled row already says a refusal, a
> warning or an *Affects* block is not a description and stays in sight. The
> per-note fold of change 4 is the other half of that rule, not a reversal of
> it: a warning is still shown by default and can now be folded on its own.
> Both survive the merge, each governing its own kind of text.
>
> **Next action: deploy 0.111.7.** It needs no migration.

> ## 0.111.6 is live; the hosted database is at migration 0072 — read this first
>
> **Deployed 2026-11-09 and verified by `npm run smoke`.** No migration: 0.110.0
> is workspace only, so the database is unchanged from 0.109.1’s release.
>
> **Three interface asks, built one increment at a time** — the empty panel on
> the front page’s inner tabs, one name for the password toggle, and a screen
> description folded away by default. A fourth, naming whether the email or the
> password was wrong on a refused sign-in, was **asked for and not built**; it is
> a settled row in [constraints.md](constraints.md) and is named on the
> service-role gate as a request waiting behind it, so opening that gate does
> not silently grant it too.
>
> **Why increments.** The six asks of 2026-11-09 were first written in one go.
> That attempt passed `npm run typecheck` while breaking three tests — one per
> change — and was thrown away rather than patched. Each increment since has run
> the **whole** suite before landing, and the one that touched `PageHeader`
> (every screen’s first paragraph) began with an audit of all 29 route
> descriptions against every test, which found exactly one that depended on a
> visible one.
>
> ### 0.111.0: the last two asks, done (9 November)
>
> **Increment 3 — the Subject averages tab is gone from Promotion.** Decided on
> the user's instruction to continue with full permission, after they were shown
> the cost: grades are now typed a learner's card at a time on **Report card**
> (or on the SF9), and **Class summary** still shows the class. The class grid by
> learning area is the one thing that went; restoring it is one tab entry and its
> block from 0.110.0. Recorded in [constraints.md](constraints.md).
>
> **Increment 5 — a notification opens its source.** The line is the link: the
> screen opens at the notification's school year and class (and a waiting class
> list opens in its review on Admissions), and it is marked read. **No learner id
> ever goes in the address.** `useScope` takes `year` and `section` from the
> address as a first choice only.
>
> **The six asks are settled:** 1, 2 and 4 in 0.110.0; 5 and 6 in 0.111.0; 3
> (which half of a refused sign-in was wrong) is deliberately not built, as
> recorded in constraints. **Live** as `edunexus-4mqybdiho` from a clean worktree of
> `71f8e8b`; `npm run smoke` passes all 198 checks.
>
> **0.111.1:** a rejected form says each problem once — the summary box above a short form is gone, and appears
> only when a rejected field is out of sight. **Live** as `edunexus-lb4p9now9` (`17112a9`), smoke 198/198. **Next:**
> nothing in flight.
>
> **0.111.2:** Create sections takes names one at a time, as chips, rather than a comma-separated line. **Live** as
> `edunexus-afi6aa8vq` (`b43a7cf`), smoke 198/198.
>
> **0.111.3:** the learning-area sheets' long notes fold behind the description switch, off by default; neither sheet
> asks a reason (since 0.103.0). **Live** as `edunexus-d5q9gh4en` (`aa7508f`), smoke 198/198.
>
> **0.111.4:** the Grade offerings filters line up; the class count sits beside its label. **Live** as
> `edunexus-c030zzmey` (`a93d8f3`), smoke 198/198.
>
> **0.111.5:** the front page's inner tabs open on a plain title; Home keeps its hero. **Live** as
> `edunexus-5pj0nz7ya` (`942127d`), smoke 198/198.
>
> **0.111.6:** the Overview says who is signed in — the role, and an adviser's classes. **Live** as
> `edunexus-iyq7l28p3` (`b22c326`), smoke 198/198. **Next:** nothing in flight.

> Everything below is `origin/master`’s own account of 0.102.2–0.107.0 and is
> unchanged by this release.

> ## 8 November: 0.102.2 recovered from production — read this first
>
> **Production serves 0.102.2, and the hosted database is at migration 0068.** Neither was on GitHub: 0.95.4
> through 0.102.2 were deployed on 6–7 November with `vercel --prod` from a working copy that was never pushed.
> Commit `0a236a3` recovers that source from deployment `dpl_C9UEZjPc4C28xaM3qmqDegzHVbQ2` (`edunexus-h461k2r6a`)
> through the Vercel deployment-files API: 318 files, each checked against its SHA-1, and all 68 migrations
> matching the checksums recorded in `edunexus_meta.migrations` on the hosted database.
>
> **Missing, and not recoverable from Vercel:** the tests and docs written for 0.95.4–0.102.2 (`.vercelignore`
> keeps `tests/` and `docs/` out of every upload). `CHANGELOG.md` was deployed and describes every one of those
> releases. Fourteen 0.95.3 tests asserted behaviour those releases changed on purpose; each was updated to the new
> behaviour with the changelog entry that changed it named in the test (0.95.5, 0.98.0, 0.99.0, 0.100.0, 0.101.0).
> Whoever holds the 0.102.2 working copy should push its `tests/` and `docs/`, or say it is gone.
>
> **A wrong deploy, corrected the same day.** On 8 November a Claude Code session working in an older checkout
> (0.86.1, never pushed) deployed its own 0.87.0 over live 0.102.2 for about an hour; nothing in the database was
> touched. `edunexus-h461k2r6a` (0.102.2) was promoted back to production. That 0.87.0 work (the UI notes plan and
> its U1) is kept on the local branch `local/0.87.0-u1` and is being redone on top of this version.
>
> **Before any work or deploy: `git fetch` and compare with `origin/master` and the live `/openapi.json`.**
>
> **0.103.0, the same day: U1 of [the UI notes](ui-notes-plan.md) brought onto 0.102.2.** One rule for boxes; a
> list read again kept on screen; a still front page; no reason asked when adding a subject, an offering or a
> historical record (U-D2). No migration. **Live** the same day as `edunexus-gx8hw8boc`, from a clean worktree of
> `161f39c`, built first; `npm run smoke` passes all 195 checks.
>
> **0.104.0, U2: the learner registry.** A **Class** filter (and `section_id` on `GET /learners`), duplicate entries
> called that, and the learner's profile opening on who they are. No migration. **Live** as `edunexus-k78v8uw2y` from a
> clean worktree of `90dec93`; `npm run smoke` passes all 195 checks.
>
> **0.105.0, U3: counts on the rail (migration 0069).** A number beside Admissions, Promotion and Staff access for
> what waits on a manager, from `GET /waiting/count`. **Committed and pushed, not deployed: migration 0069 is not yet
> applied to the hosted database** (Claude Code's permission check refuses `npm run db:migrate`). Live stays 0.104.0,
> which needs nothing from 0069. To release: `! npm run db:migrate`, then build in a clean worktree, `npx vercel --prod
> --scope joshs-projects-47d7b071`, `npm run smoke`. **Do not deploy 0.105.0 before 0069 is applied**: its readiness check
> requires `read_waiting_counts()`.
>
> **0.106.0, U4: Staff portal and staff profiles.** Staff portal opens the workspace's sign-in in a same-origin frame
> over the front page (U-D3 as amended, 9 November); a colleague's row opens on who they are. No migration of its own,
> but it carries 0.105.0, so **it too waits on migration 0069** before it can be deployed.
>
> **0.107.0, U5: Next year's classes and the test pass. The UI notes plan is complete.** Also waits on 0069. **Next:
> apply 0069 (`! npm run db:migrate`), then deploy 0.107.0 from a clean worktree and `npm run smoke`.**

> ## The hosted database is a demonstration registry, and live is at migration 0060 — read this first
>
> **Version 0.95.3, merged to `master` and pushed as `aed5294` on 2026-11-06. The live database was wiped and
> reseeded on 2026-11-06, and migrations 0053–0059 were applied to it.**
>
> **0.95.2 and 0.95.3 are workspace-only fixes and are NOT deployed.** Live
> still serves 0.95.1. It changes no endpoint, schema, permission, error code or migration,
> so the live database needs nothing: it needs a deploy, and on this project a
> push does not deploy — see the Git-link note below.
>
> **Live is at migration 0060 and 0.95.1 is deployed and verified** (194/194
> `npm run smoke` checks against `https://edunexus-balili.vercel.app`). The
> adviser pull is live: `pullable-learners` and `pulls` answer 401 rather than
> 404.
>
> **The Vercel project had no Git link, and that is why nothing deployed for
> days.** `prj_soIqKqi62yMehbsUarsD0aHsWmJz` ("edunexus", team
> `joshs-projects-47d7b071`) reported `link: null`, so pushing to
> `bustamante-j/edunexus` triggered nothing — two pushes on 2026-11-06 produced
> no deployment while production continued to serve the 29 October build. The
> deployment that fixed it was made **from this machine with the Vercel CLI**
> (`vercel --prod`), which needs no Git link. `.vercel/project.json` now links
> this checkout to that project and is gitignored.
>
> **Still to do, and it is a dashboard/account action rather than code:** run
> `npx vercel git connect` (or Vercel → project → Settings → Git) to attach the
> repository, or every future release needs another manual `vercel --prod`.
> Until then **a push does not deploy**, which is the opposite of what anyone
> picking this up will assume.
> The migrations were applied because the seed could not run without them: the
> registry writer inserts `address`, `guardian_name` and `guardian_contact`
> (0053, 0056) and live was at 0052, and the adviser pull the demonstration needs
> *is* 0054.
>
> **What the hosted database holds now:** the 5 real staff accounts with their
> roles, credentials, invitations and profiles; the real school profile; one
> synthetic principal, `demo.setup@balili-es.invalid`, that every seeded record is
> attributed to; the active school year **2025–2026** with three terms; one class
> per grade Kinder–Grade 6, all seven advised by the real teacher account; **80
> learner profiles**, 70 of them enrolled (10 a grade) and 10 registered with no
> enrolment; and a `seeded_data_notice` row, so the seeded banner shows and
> `reset:seeded-data` can still run. **No promotion, placement, attendance mark,
> grade, report card, subject, calendar or attendance rule exists** — those were
> left for the user to demonstrate, and the subject catalogue and attendance rule
> are the school's to record rather than ours to invent.
>
> The wipe removed 893 learners, 893 enrolments, 78,699 attendance marks, 136,618
> audit rows and 31 synthetic staff across 66 tables. Nothing real was lost: every
> row in the wiped tables was authored by a synthetic account or was an audit
> trail *about* fake learners.
>
> **Why the source year is 2025–2026 and not the current one, why there are
> classes at all when "learner profiles only" was asked for, and why one teacher
> advises all seven**, are each a schema constraint rather than a preference, and
> all three are written down in [demo-registry.md](demo-registry.md). Read it
> before changing the seed; each reason is the kind that gets "corrected" away.
>
> ### The defect the rehearsal found, which is live and not ours
>
> **Next year's classes does not work at real scale.** `record_access_events` has
> `CHECK (cardinality(record_ids) <= 100)`; `nextYearCommit` writes two ids per
> learner, so it is refused above **fifty** learners in one request, and
> `nextYearPreview` writes one per learner, so it is refused above **one hundred**.
> At the school's real roll of ~897 neither works for a whole year, and per grade
> (~130) is still over the cap. The fix is to chunk the ids into batches of 100 in
> `src/modules/next-year/service.ts`, **not** to widen the CHECK. It was reported
> rather than fixed because it is a code increment, not data preparation. **For the
> demonstration it does not bite**: at ten learners a grade, the screen's own grade
> filter sends 20 ids.
>
> ### The single next action
>
> **Connect the Vercel project to the repository** (`npx vercel git connect`), so
> a push deploys again. Then, if the user wants it, fix the
> `record_access_events` chunking as its own increment — it is what stops Next
> year's classes working at the school's real roll.
>
> Everything below describes the branch before this and is unchanged by it.

> ## Branch `notifications` — read this first
>
> **Version 0.95.0, migrations 0057–0059, merged into `branch-out`.**
> The notification work is now reconciled with `0056_learner_guardian.sql`; the
> current tree is the merged worktree.
>
> **Latest increment:** the synthetic demo seed now uses the authorized
> report-card and adviser workflows, so `npm run demo` can populate its
> report data without bypassing role controls. Full `npm run check` passes
> (321 tests).
>
> **Two things to know before merging.**
>
> 1. **The migration number was reconciled.** `branch-out` already had
>    `0056_learner_guardian.sql`, so notification migrations are `0057`–`0059`.
>    `tests/migrations.test.ts` requires numbering from 0001 with no gap and no repeat,
>    The checksums were recomputed for the renamed files. None of these migrations
>    is applied anywhere; live remains at 0052.
> 2. **The status notes are reconciled.** The current branch's guardian and Settings
>    notes remain below the notification summary.
>
> **What shipped here:** notifications, in two commits. **0.92.0** is the substrate
> and the four roster emitters (migration 0057); **0.93.0** is the bell in the top bar
> and the notification popout behind it, which changes no endpoint, schema, permission
> or error code; **0.94.0** adds migration 0057, the enrollment and class-assignment
> emitters; **0.95.0** adds migration 0059, the monthly consolidation, promotion
> outcome and calendar emitters.
> It reverses two settled decisions by the user’s explicit decision of 2026-11-05;
> the reasoning is in [notifications.md](notifications.md) and in the top row of
> [constraints.md](constraints.md). `npm run check` passes: 297 tests in 30 files.
>
> **The approved first release is built**, except for the three things below, each
> named in notifications.md with its reason.
>
> **The single next action on this branch is a decision, not code:**
> `adviser_assigned`, `adviser_removed`, `year_activated` and `year_closed` cannot
> be emitted, because a section’s adviser and a year’s status are set by **plain
> SQL in `src/modules/foundation/service.ts`**, not by a `security definer`
> function — there is nothing to `create or replace`. Closing it means a new
> writer function for those core 0001 tables, which is its own increment and
> changes a write path everything else depends on. The other way, granting
> `notify` to `edunexus_app`, **was refused** and is recorded as a decision: it
> would let the API forge a notification. Ask the user which they want before
> building either.
>
> **Two smaller gaps, both safe to leave:** an adviser pulling or registering a
> learner who holds *no* enrolment this year reaches `place_enrollment` and so
> notifies nobody; and `next_year_placed` has a writer and could be done, but is
> loop-shaped like the import and must emit once, not per learner.
>
> **Read the 2026-11-06 decisions in constraints.md before adding any emitter:**
> emit at the intent boundary, and check whether the writer is ever called in a
> loop first.
>
> **Two repository gaps found on the way, neither mine to fix here.** `tests/web-screens.test.ts`
> and `tests/web-shell.test.ts` are described in `AGENTS.md` but **do not exist in this
> tree** — lost with the rest of `tests/` in the 0.86.1 recovery — so no test renders
> every route, and `tests/web-notifications.test.ts` stands in for the new screen only.
> And `AGENTS.md` describes the dark theme as retuning tokens under
> `@media (prefers-color-scheme: dark)`; in this tree it is `:root[data-scheme='dark']`
> in `app.css`, resolved in JS by `web/preferences.ts`.
>
> Everything below describes `branch-out` and is unchanged by this branch.


**Version 0.91.1.** Branch `branch-out`, from `80d8d7c` (the recovered 0.86.1).
**Committed on this branch only** through `2c58ac1` (SF9 A4 preview sizing),
with the local `user.name` and
`user.email` set to match the branch's existing history. **Not merged anywhere
and not pushed, by instruction** — the user merges. The commit bundles
0.87.0–0.90.1 in one, which the working contract would normally not allow: the
increments were built on the recovered 0.86.1 without ever being committed and
overlap in the same files, so they cannot be separated retroactively without
inventing hunks that were never a working state. Its message says so.

[docs/constraints.md](constraints.md) is the authority. The decisions table this
file used to carry lives there; this file is a pointer, not a second changelog.

## The single next action

**Deploy 0.95.3** (it carries 0.95.2 with it). It is merged to `master`, pushed,
and `npm run check` passes on `master` (32 files, 327 tests), and it needs no migration — the live database is already at 0059 and
this release touches only `web/`. Live is at 0060. Deploy it with `vercel --prod` from this
checkout, because the Vercel project has no Git link and **a push does not
deploy** (the note at the top of this file has the project id and the one
dashboard action that would fix it for good). Then `npm run smoke`.

The migration backlog named here in earlier sessions is **done**: 0053–0059 were
applied to live on 2026-11-06, and the caution about opening Next year's classes
against a 0.86.1 build is spent with it.

## Waiting on the user

**Migration 0060 IS applied to live — an earlier note in this file said it was
not, and that was wrong.** Checked directly against `edunexus_meta.migrations` on
2026-11-06: `0060_conditional_promotion_restored.sql` was applied at 07:44:11Z and
its checksum matches `database/migrations/` byte for byte. Live therefore carries
60 migrations, not 59, and `conditionally_promoted` is **not** broken on it. There
is no migration backlog: the code and the live schema agree, and only the deploy
is outstanding.

**The demonstration database cannot show the adviser pull as it stands, and two
office steps would fix it.** Confirmed by a read-only query on 2026-11-06: every
enrolment in the active year already has a class, so the pullable list is
correctly empty for everyone. **Re-measured after the adviser assignments were
changed later that day:** the real teacher account now advises Grade 2 **B** in
the active year, which holds nobody; seven classes in the **closed** 2025 year
holding ten learners each, which row security does not show and
`may_advise_section` refuses; and one in the **draft** 2027 year. So it still
reads no learners, for a reason that is nothing to do with the pull. To demonstrate the feature, a manager
needs to (1) make that teacher the adviser of a class on **Staff access**, and
(2) enrol a learner into that class's grade **without** a section, or carry last
year's learners over on **Next year's classes**. Neither is a code change, and
`scripts/seed-demo-registry.ts` places every learner it enrols
([line 249](../scripts/seed-demo-registry.ts)), so a reseed alone will not
produce a pullable learner either.

**Are advisers meant to section the new school year in advance?** 0.95.2 took the
answer the user gave for *this* release — the school builds its classes only once
the principal has activated the year — and enforced it in the workspace, leaving
`move_enrollment`'s refusal of a future-dated movement exactly as `0048` wrote
it. If sectioning actually happens in May, before classes open, that gate is the
wrong answer: `move_enrollment` then needs a narrow allowance for a section
assignment dated at or after a not-yet-started year's `starts_on`, as a new
migration and a recorded decision. Worth asking the principal once, because the
screen now states the rule in words and the school will read it as policy.

**Should the learner's Academic history part link to that screen?** 0.91.1 gave
it a signpost and no link, because the shortcut was deliberately removed from
this same panel in 0.90.2 (the rail already carries the screen) and
reorganising the panel is not a reason to reverse that. Restoring it is one
anchor in `web/screens/LearnerProfile.tsx` and one assertion in
`tests/web-learner-profile.test.ts` — but it reverses a settled decision, so it
is the user's to make, not the next agent's.

## What shipped in this session

### The clean-slate demonstration (2026-11-06) — verified, nothing reset

The user is wiping the demonstration records to run the whole workflow live, by
hand, and asked for verification rather than action. **No reset and no seed was
run from here**, by their explicit instruction.

**A backup was taken first**, read-only: every table snapshotted to
`.local/backups/edunexus-data-<stamp>.json` — 4,218 rows across 30 non-empty
tables, 74 `edunexus` tables plus `edunexus_meta.migrations` and `auth.users`. It
is a **data** snapshot, not a `pg_dump`: no local `pg_dump` exists and Docker
Desktop was not running, and the schema is reproducible from
`database/migrations/` anyway. `bytea` is base64 under `__bytea_base64`.

**What `npm run reset:seeded-data` would do, read rather than assumed.** It
refuses outright unless `edunexus.seeded_data_notice` holds a row (it does, 1).
`keptTables` preserves `staff`, `school_profile`, `staff_invitations`,
`staff_invitation_events`, `staff_profiles`, `staff_photos` and
`staff_profile_events`; every other table in the schema is truncated, read from
`pg_tables` so a later migration's table goes too. **Account deletion is scoped
to `id = any(synthetic)`**, and synthetic means only
`%@seed.edunexus.invalid` or `%@balili-es.invalid`. Measured against live:
**5 real accounts survive** — Alexei Borodin (principal, inactive), Development
Administrator, Diane Ancheta (principal), Joshkane Gabol (administrative
officer) and Diane Kaye Ancheta (**the only teacher**) — and **31 synthetic
accounts go**, 1 principal and all 30 seeded teachers. No `auth.users` row lacks
a `staff` row, so nothing is orphaned. After the wipe the school has exactly one
teacher account, which is enough for Phases 5 and 6 but worth knowing.

**The empty state is now tested, and it never was before.** Every other DOM test
builds a fixture first, so "the day the school starts" was the one day nobody
had looked at. `tests/web-empty-school.test.ts` mounts **every route** for a
principal, an administrative officer and an adviser against a database holding
nothing but staff, with the real API and real fetches, and asserts each renders,
none renders a crash and none leaks `[object Object]` or `undefined is not…`.
63 route renders, all passing. It also drives the first school year end to end
from nothing — create, four periods, activate, build a class — and records that
`/roster-imports/template` is **manager-only by design**, so an adviser's
Roster import screen uses the workspace's own `ROSTER_HEADER` copy instead.

### 0.95.3 — the empty registry an adviser reads now points at Add learner (no migration)

Reported as "the teacher's Learner Registry shows nothing, and Add learner
cannot retrieve unassigned learners", with the reading that the pullable query
required a `section_id`. **It did not.** `read_pullable_learners` (`0054`) joins
enrolments on `section_id is null and grade_level = the section's grade` for the
section's year, so an unplaced learner is exactly what it returns. The whole
reported workflow was re-run end to end against the API — unplaced learners at
the adviser's grade listed, another grade's refused `P2600`, the take-in
assigning the enrolment the office already holds with no second learner or
enrolment row, the learner leaving the list, a second take-in refused `P2602`,
and a manager still reading everyone. It all held. The reasoning is in
[teacher-roster.md](teacher-roster.md).

**The live cause was the data, and it is the office's to fix, not code's.** A
read-only query against live found that all 69 enrolments in the active year
already held a class (`unplaced = 0`), so nobody was pullable; and the one real
teacher account, *Diane Kaye Ancheta*, advised **none** of that year's 30
classes, so row security correctly gave it no learners. Only the seeded teacher
accounts advise anything, and only the seven `A` sections hold learners.

What was actually wrong was the sentence: the empty table said "No learners are
currently assigned to your sections." and stopped, which is true of the class and
silent about the learners waiting at that grade. It now names what it is
describing, does not call the registry empty, and carries **Add learner** inside
it. The read scope is untouched, and the pull stays scoped to a section the
teacher advises (the user reaffirmed this on 2026-11-06 rather than adopting the
grade-level assignment the report assumed).

### 0.95.2 — the adviser's class sheet refuses a year that is not running (no migration)

The school reported that **no learner appeared on Add learner after the principal
created the new school year**. Verified end to end against the real API, and it
was three things rather than one:

- **The empty list was correct.** `read_pullable_learners` offers only learners
  already registered *into that year* at that grade with no class, and a year
  just created holds none, so the office's carry-over comes first. The search
  path was never broken — it finds a learner with no enrolment that year and
  answers `how: 'enrol'`.
- **The take-in was genuinely broken.** The sheet's first day for a year that
  has not begun is its `starts_on`, a future date: `move_enrollment` refuses a
  future-dated movement (`409`), while `place_enrollment` has no such check and
  silently wrote a future-dated enrolment. One refusal and one silent success
  for the same date on the same sheet.
- **The class picker named no year**, listed every section the adviser advises,
  and opened on whichever sorted first under `order by academic_year_id` — a
  uuid, so not chronological.

The user chose the frontend fix, so **the backend is untouched**: `MyClass.tsx`
refuses an unactivated, closed or not-yet-begun year up front, offers neither
write while it holds, and reads nothing for such a class (the list names
learners, and naming one writes a `record_access_events` row). The picker now
reads `/academic-years` with `/sections`, names the year in every option, sorts
newest first and opens on a class that can be built; the empty state says what
an empty list means instead of claiming the class is full. Decision recorded in
`docs/constraints.md`; detail in `docs/teacher-roster.md`.

### 0.91.1 — one learner, read in three parts (no migration)

Asked for as a **Learner Profile** feature over "the personal, demographic and
other relevant information" the bulk import collects. The first finding is the
one that shaped the increment, and it should be read before anyone picks the
request up again:

**The class-list import collects nothing the registry did not already hold.**
`ROSTER_HEADER` in `web/csv.ts`, which `tests/registry-address.test.ts` holds
equal to what `GET /roster-imports/template` publishes, is
`lrn, first_name, middle_name, last_name, name_extension, birth_date, sex,
address` — eight columns, all eight already on `edunexus.learners`. So there was
no imported information anywhere waiting to be surfaced, and **no parent,
guardian, relationship, contact number, mother tongue, religion or
indigenous-group field to show**: each is named by the **learner fields and
class capacity** gate as what it still blocks. The request's sections A–D could
not be built as written, and nothing was invented in their place.

What did ship is the reorganisation the request also asked for. The panel under
a learner on the Learner registry — which stacked the enrolment history, the
profile correction, the LRN workflow and the identity links in one column — is
now three parts with the profile first: **Learner profile**, **Academic
history**, **Enrollment**. Three parts because they are three different
records, not three views of one.

- **No endpoint, column, policy, row-security predicate or error code changed,
  and no migration was written.** `web/screens/LearnerProfile.tsx` is new and
  holds `LearnerDetail` plus `EnrollmentHistory`, moved there from
  `Learners.tsx`; the registry screen lost 100 lines and gained a component.
- **Editing is the existing manager-only `PATCH /learners/:id` on the same
  row**, which is what makes a second learner record impossible. The test
  counts `learners` across an edit and asserts the version went to 2.
- **The fields EDUNEXUS does not hold are named in the profile** rather than
  left as empty lines, because a profile is where an empty line most readily
  reads as *nothing to report*.
- **Academic history is a signpost with no link.** The shortcut was removed from
  this very panel in 0.90.2 because the rail already carries that screen;
  reorganising the panel is not a reason to restore it. **If the user wants the
  link back, that is the one open question from this increment.**

`tests/web-learner-profile.test.ts` is new: 12 cases in a real DOM against the
real API. Both gates that guard a decision — no gated field offered, no second
door into Academic history — were **mutation-tested**: a planted guardian field
and a planted `prior-records` link each fail them. This matters because
0.90.2's own gate was vacuous on its first run.


### 0.91.0 — spacing and a small text size (migration 0055)

**This reverses yesterday's own decision**, and the reason is recorded: both
were declined in 0.90.9 for needing a migration against preference axes nobody
had asked for *by name*. The user then asked for both by name, which is exactly
the condition that was missing.

Built the way 0043 and 0047 built the other nine: columns on
`staff_profiles` with `check` constraints, `save_my_profile` widened by one
key, the view — and so the journal snapshot, which is built from it —
following. The `text_size` check is **replaced** rather than altered, because
a check cannot be widened in place.

Two choices worth keeping:

- **Spacing moves two tokens**, `--row-y` and `--pad-card`, which every row
  and card already read, rather than editing padding rule by rule. A choice
  therefore cannot land on one screen and miss another. The column header's
  padding is derived from the row's, so the heavier rule under the column names
  keeps its proportion at every setting.
- **Small is not the default.** The scale only ever grew before; a new, smaller
  choice must not quietly shrink somebody who never picked it. 93.75% is one
  step down by the ratio the larger steps go up.

**Three fixes asked for alongside it.** Academic history offers no *Add a
school year* for a learner with no year above Grade 1 — an SF10 block is
Grade 1 to Grade 6 and Kindergarten is never one, so the only year behind a
Grade 1 learner is Kindergarten and there is nothing to copy; the disabled
action carries its own callout rather than reading as broken, and points at
*Eligibility for Grade 1*. Academic history now steps between the learners a
search found with **arrows and a count** instead of *Choose another learner*;
the results are kept while a learner is open, and the way back to the list
stays as an icon, because with one result both arrows are disabled and a row
with no way out is worse than the button it replaced. And the Learner
registry's *Take learners into my class* is now **Add learner**, in the screen,
the sheet, both guides and the tests.

**Two stale assertions of my own were corrected**, both found by this release's
check rather than by reading: a prior-records case still looked for the button
that became arrows, and a 0.90.9 guard pinned the **whole project's migration
count** to make a point about one change that added none — it broke the moment
an unrelated migration landed, which is the assertion being wrong rather than
the code. It now checks the thing it meant.

### 0.90.9 — My profile and Settings reviewed; one field added

A full specification for My profile and Settings & Accessibility was checked
against what exists. **Almost all of it was already built**, so the work was
mostly the review.

Already there: the nine accessibility axes and the theme (0043, 0047) — text
size, motion, contrast, links, focus, target size, line spacing, Atkinson
Hyperlegible for dyslexia, light/dark/system — applied as `<html>` attributes
the stylesheets read, saved per account, arriving with `/me` and so restored
at sign-in; the start screen; the session list with *Sign out everywhere else*;
*Put these back* as the reset; and a password change that verifies the current
password by re-authenticating, requires twelve characters and a matching
confirmation, and shows or hides what is typed.

**Added: the address the person signed in with**, and when this sign-in began.
Read from the **open session**, not `/me`: both live on `auth.users`, which
the API deliberately cannot read, since the service-role key is confined to one
Edge Function. No endpoint, no column, **no migration**, nothing stored. It
rides on `AccountTools`, which every screen already receives.

**Declined, with reasons, so they are not re-proposed** — the full list is in
[constraints.md](constraints.md):

| Asked for | Why not |
|---|---|
| Interface density, a *Small* font size | Each needs a new column or widened `check` on `staff_profiles`: real migrations for axes nobody has asked for by name |
| Interface language | No translation layer; help ships one edition, `en` |
| Time zone | Fixed to `Asia/Manila` by a check in `0001`, and already the school's own |
| Date and time format | Would put a display preference in front of `web/dates.ts`, which never converts a `YYYY-MM-DD` through local time |
| Notification preferences | **EDUNEXUS sends no notifications.** The specification's own rule was to offer only categories the system supports |
| Password update date | Not exposed by the anon client; reading it means the service-role key |
| Contact number | A new staff field, so a school decision, by the same rule as the learner-fields gate |

### 0.90.8 — four fixes to the screens staff type into

**Academic history is closed to advisers who teach only Kindergarten or
Grade 1.** An SF10 scholastic block is Grade 1 to Grade 6 and Kindergarten is
never one — it is the credential presented for Grade 1, and `0051`'s writer
refuses any other grade with `P2504` — so those advisers have no previous
school year to encode for anybody in their classes. Their classes decide it
rather than their role, so the rule is `hiddenByAssignment` in
`web/routes.tsx`, not the route table's `hiddenFor`. Filtered out rather
than greyed, because a disabled item with no explanation is read as broken.
A manager is never narrowed, an adviser with no sections yet is left alone, and
one class at Grade 2 or above opens it again.

> **The consequence to watch.** A Grade 1 adviser can no longer record the
> Kindergarten credential under *Eligibility for Grade 1*, which lives on that
> screen. A manager still can. If the school expects Grade 1 advisers to record
> it, this is the decision to revisit.

**There was never a 2024 floor on a historical school year.** The field takes
1990 to this year and the server's own check says the same; the hint used 2024
as its worked example, and an example in the position of a rule reads as one.
Reworded to say what the field means.

**The boxes a grade is typed into now fit a grade.** At 4.5rem, once the
field's side padding and a number input's spinner had taken theirs, there was
room for barely two digits — 88 fitted, 88.5 did not, and the figure a teacher
had just typed scrolled out of sight inside its own box. The spinner is gone
(about 17px of the narrowest box on the screen), the padding is smaller, the
column is 6rem.

**Previous and Next learner are arrows**, matching the month nav on the forms,
keeping the words as the accessible name and the tooltip.

### 0.90.7 — two Setup screens leave an adviser's navigation

Asked for, and it is a **menu change rather than a permission change**:
`hiddenFor: ['teacher']` leaves a route out of a role's navigation and touches
nothing the API allows. Both reads are still answered, so nothing an adviser
could previously do becomes a refusal, and no manager's view moves.

Neither screen was an adviser's work. Every control on **School years &
sections** is a manager's — the year an adviser works in is named in the top
bar, and the sections they advise are on their own screens. **School profile**
is the heading the forms they issue already print, and the attendance rule that
gave them a reason to open it moved to the calendar in 0.90.5.

**The two teacher guides went with them.** A guide written for a screen a role
cannot open is exactly how that screen comes to look like part of their job.

**Two stale pieces of help, both missed consequences of the 0.90.5 move**, found
while doing this and fixed: the manager's School profile guide still advertised
the attendance rule — it would have sent a principal to the wrong screen — and
the calendar's guide never mentioned it although the card now lives there. It
now carries **Record the rule** and what it governs.

`tests/web-registry-scope.test.ts` holds four properties, including that
**neither route is manager-gated at the API** — a screen hidden from a role
whose API also refused it would be a permission change dressed as a menu
change, and this keeps the two from being confused later — and that an adviser
keeps the five screens their work needs.

### 0.90.6 — School profile shows what it already knew

Asked to add what is "valid to be added", and **the restraint is the answer**.
No field was added: a school telephone, email, website or logo would each be a
requirement nobody has stated — none appears in the headings of the school's own
SF2, SF4, SF9 or the SF10 workbook — and inventing one is the mistake the
learner-fields gate exists to prevent. What went in is derivation and
visibility, so **no migration and no permission changed**.

**How this prints on the forms.** The heading the SF2, SF4, SF9 and SF10 share,
rendered from the values on file, with the unset lines **named**. It earns a
card because the forms *omit* what is unset rather than marking it — every line
is `{s.region ? <p>…</p> : null}` — so a missing schools division simply is
not there, and the only way to find out was to print an SF9 and look. It also
says whether the signature line will carry a name. Drawn with `Unrecorded`,
and built from tokens rather than inside `.paper`, which carries the printed
sheet's fixed widths and its own light colours.

**Change history**, manager-only. The rows have been written since `0001` —
`audit_record` is on `school_profile` like every other versioned table — but
`GET /audit-events` could only be asked for *everything*, so the journal
existed and no screen could show one record's own history. The read now takes an
optional `entity_table`: a **closed list** of the five journalled tables,
never free text, still manager-only, and unfiltered it answers as before. This
is the one contract change in the release.

Gated by `tests/school-profile.test.ts` (6 cases), mutation-tested by removing
the filter's `where` clause and the preview card — three cases fail.

**Not done, and recorded:** an uploadable school seal for branding. The content
policy keeps a closed list of images, the SF9's and SF10's seals are versioned
files served from this origin, and the staff-photo pattern — bytes through the
API drawn on a canvas — does not print reliably, which is a seal's whole
purpose. It needs the school to ask, and a design, not a field.

### 0.90.5 — Academic history, and the attendance rule's home

Three asked-for changes, **no permission changed**.

**A bug first.** A manager choosing *Any grade* on Academic history saw **no
learners at all**. The list was gated on
`Object.values(search).some(Boolean)`, and *Any grade* is the empty value — so
the widest choice read as no choice and cleared the list, and the screen
reported an empty school. Applying the finder now opens the list whatever
values it carries.

**An adviser is simply shown their learners**, on opening, with no grade level
to choose. **A manager still starts from a search, and that asymmetry is the
privacy rule rather than an oversight**: a teacher's list is the classes they
advise — about twenty, already theirs to read — while a manager's is 897, and
every list under `/learners` writes a `record_access_events` row naming
exactly what it returned. A manager opening the screen must not log a read of
the registry. The oversight card above it still names nobody and writes no
access row.

**The attendance rule moved off School profile** to the **Instructional
calendar**, the other half of the same question: the calendar says which dates
are days of classes, the rule says how a day's morning and afternoon become the
SF2's one mark. It was **moved, not deleted** — it is the only place the rule
can be recorded and the SF2 and SF4 are refused without it, so a deletion would
have left both broken with no way to fix them. Its tour and the nine references
in help and on five screens moved with it. School profile keeps the school's
identity and the heading its forms carry.

Gated by `tests/web-attendance-rule-home.test.ts`, which mounts both screens
against the real API, and three new cases in
`tests/web-prior-records.test.ts`. All were mutation-tested.

### 0.90.4 — the Grade 1 card's remark boxes keep a stated height

Asked for as a print fix, and it builds directly on 0.90.3: that release gave
`.paper.sf9` its A4 page and added the `sf9-${layout}` class, which is what
makes these per-layout rules selectable at all.

The two narrative boxes were `min-height`, so each was as tall as whatever was
typed into it, and the three terms clustered at the top of their column leaving
a third of the sheet empty. They are now **23mm, stated outright**, with
`overflow: hidden`, and the terms are spread down the column with
`space-between` so each signature stays directly under its own boxes.

**Measured in real Chrome rather than asserted.** CSS geometry cannot be checked
in happy-dom, which computes no layout, so `.local/sf9-print/boxes.tsx` renders
the card with the print stylesheet emulated at A4 less 6mm and reads the boxes'
own rects. Run it with
`npx tsx --tsconfig .local/sf9-print/tsconfig.json .local/sf9-print/boxes.tsx`
— it needs Chrome, which is why it stays in `.local/` rather than `tests/`.

| | short | long (1000 chars) | empty |
|---|---|---|---|
| before | 90px | **248 and 275px, 2 sheets** | 90px |
| after | **23mm** | **23mm, 1 sheet** | **23mm** |

Two designs were measured and rejected on the way: `min-height` (the original
fault) and giving each box an equal *share* of the column, which equalised the
six boxes but still gave 98px for long against 90px for short, because a grid
row takes its height from its items' max-content.

**The trade, which is the part to know:** a remark longer than roughly 350
characters is **clipped on the printed card**. That is what a fixed box means
and it is what was asked for; the remark is stored in full and shown in full
where it is encoded, so nothing is lost from the record, but the parent's copy
can show less than the adviser wrote. *What's new* now tells advisers to keep a
printed remark brief. If that proves wrong in practice the answer is a
character limit at encoding time, not a box that grows again.

Scoped to the Grade 1 card: the Grades 2-3 and 4-6 cards are a different layout
on landscape paper and are untouched, which `tests/web-card-boxes.test.ts`
asserts along with the stated height.

### 0.90.3 — SF9 previews keep a fixed A4 page

The SF9 preview now uses the same fixed paper dimensions as its print contract:
Grade 1 is A4 portrait and Grades 2–6 are A4 landscape. Grade 1 term cards
reserve space rather than shrinking around their content, while long text wraps
inside the reserved area. Print output keeps its existing `@page` rules. No
endpoint, schema, permission or error code changed.

### 0.90.2 — the registry asks an adviser nothing it already knows

Two interface changes, both asked for, and **no permission changed** — because
the access control the request described was already in force.

**The grade-level filter is now a manager's control.** An adviser reads only
the learners in the classes they advise, so the filter could only ever narrow a
list that is already their own class; offering grades they do not teach invites
the reading that the registry is withholding learners from them. Their registry
opens on their own learners with nothing to choose first. Principals and
administrative officers keep the filter and the whole school, untouched.

**The scope is enforced where it always was.** `can_read_learner` requires,
for a teacher, an enrolment in a section whose `adviser_user_id` is theirs
(`0004`, teacher branch replaced in `0008`). Hiding a select box is not a
permission, so what mattered was proving the parameter is powerless in their
hands: `tests/registry-grade-filter.test.ts` now sends `grade_level` for a
grade they do not advise and gets back only their own learner, and does the
same through a name search.

**The shortcut *Academic history before EDUNEXUS* is gone from the learner's
panel**, since the rail already carries that screen. The screen, its route, the
records and every encoding capability are untouched — only the second door is.

**A role note:** the request names Principal, AO and **Admin** as three roles.
EDUNEXUS has three in total — `principal`, `administrative_officer`,
`teacher` — and `is_manager()` is the first two. There is no separate admin
role, so "unrestricted admin access" is the principal's and nothing needed
adding.

**The gate lesson repeated.** The DOM gate for the removed shortcut was
**vacuous on its first run**: it asserted on the closed learner list, and the
shortcut lived inside the learner's own panel, which is not rendered until a row
is opened — so it passed with the shortcut still in the file. It now opens the
row first, and both gates were then confirmed by putting each change back.

### The SF10 and all six elementary grades (2026-11-05) — no code changed

A clarification asked that the SF10 carry Grade 1 through Grade 6 and not be
limited to four. **It already did.** The four is `PER_SHEET` — four scholastic
blocks to a printed *side*, which is what the school's own SF10 workbook rules
— and no grade level was ever capped: `cards.ts` builds a block per encoded
prior year and per recorded enrolment with no slice, and `Sf10Sheet` rounds
the slots up to a whole leaf and continues onto further leaves. A cap of eight
did exist once and was removed when it was found to lose a ninth year off a
permanent record.

What was missing was the test that would have made the question unnecessary.
`tests/forms-sf10-six-grades.test.ts` (7 cases) now holds every rule the
clarification names, through the real API: six sections in order; issued
without waiting for all six; an unencoded grade blank and a not-yet-reached
grade blank; **no figure copied between grades**, each grade encoded with its
own average and asserted against it; and a missing record never reading as
failed, an unfinished year carrying a null average *and* a null remark. It was
mutation-tested — pointing one block's average at a constant fails it with
`[84,84,84,84,84,null]`, which is what a copied block looks like.

**The request to fit six grades on one side of long bond is left for the user.**
It is already long bond, and a six-grade record already prints on **one sheet**
— eight slots, four to a side, front and back. One *side* would depart from the
four-blocks-a-side the school's workbook rules, on the record that follows a
learner between schools, and would shrink 7pt cells to about 5.7pt: the SF9
print pass recorded 5.5pt as making text unreadable. Full reasoning in
[report-card-forms.md](report-card-forms.md).

### 0.90.1 — every control says when it is waiting

The school reported **a delay when clicking**. The delay is real and is not the
fault: a hosted request over a school connection takes a moment. What made it a
fault is that **nothing said the system was working** — `.btn:disabled` is .45
opacity under a `not-allowed` cursor, so the button a person had just pressed
looked switched off, and the repair for a button that looks broken is to press
it again. In a records system that is the one reaction not to invite.

Three changes, no new behaviour and no API change:

- **Every request is counted at one place.** `onApiBusy` in `web/api.ts`, the
  chokepoint every request already passes. The shell shows **Working…** in the
  top bar once a wait passes **300ms** — held back so it never flashes on a
  fast request, which would itself read as a fault. This is what covers the
  many clicks that open a sheet, refetch a list or reload a screen and have no
  control of their own to speak through.
- **48 acting buttons carry `aria-busy`** beside the progressive label most
  already had, so the stylesheet keeps them at full strength under a
  `progress` cursor. A button disabled because something *else* is running is
  deliberately **not** marked: it is unavailable, not working, and marking it
  would lie to a screen reader. The shared `Button` primitive, which had **no
  busy affordance at all**, and one button on Roster submissions that fetched a
  submission and said nothing while it did, both now say **Working…**.
- **A ghost button keeps a visible edge.** With a transparent border it reads
  as a line of text to anyone who does not already know where the controls are.

Gated by `tests/web-buttons.test.ts` (9 cases). **Every gate was broken on
purpose before being trusted**, and that paid again: the screen-reader-name
gate was **vacuous on its first run** — an icon's own `size={20}` counted as a
label — so it passed on a button whose name had been deleted.

### 0.90.0 — Phase 2 steps 6 and 7 (migration 0054)

Step 8, the batch SF10, is **deferred by instruction and untouched**. Full
account in [an adviser's own class roster](teacher-roster.md).

**Step 6 — school-wide encoding oversight.** The one unmet requirement of the
4 November brief. `GET /academic-years/:id/encoding-progress` counts, for every
section of a year: the learners it holds, how many have an encoded previous
school year, how many have the Grade 1 credential, how many have **neither** —
the work left — the years encoded, and the adviser's name. Learners registered
at a grade with no class yet are counted on their own, so the school total is
the whole school. It is **Across the school** above the learner finder on
Academic history, managers only.

**It reads counts and nothing else** — no learner named, no rating read, **no
`record_access_events` row written** — mirroring `read_grade_entry` (0035),
because every list under `/learners` and `/enrollments` logs the records it
returned and a view built by paging the registry would bury the privacy audit in
its own noise. A DOM test asserts the access-event count does not move when it is
opened.

**Step 7 — teacher pull, which reverses a settled rule.** An adviser may now
take an already-registered learner into a class they advise, and register a new
learner into it. The reversal is recorded in [constraints.md](constraints.md)
with its date and its limits, as the roadmap's own step 7 required, and the
standing rule in `AGENTS.md` and `constraints.md` now reads *three exceptions*
rather than one.

What widened, and nothing beyond it: always a section they advise in an open
year (`may_advise_section`, the single predicate); taking a learner in only ever
**gives a class to an enrolment that has none**, so moving a learner out of a
colleague's class, withdrawing and re-entering stay a manager's; registering
refuses a name and birth date already on the registry; and no profile
correction, LRN, grade change or withdrawal is opened. **Row security is
untouched** — a teacher still reads only their own classes. Both writes go
through `place_enrollment` and `move_enrollment`, so there is no second enrolment
path and no second learner record is ever created.

The three teacher capabilities coexist as required: taking learners in,
registering new ones, and encoding historical records for the learners in their
classes.

### One bug the first test run caught, worth not re-stepping on

Deciding *which* of the two writes applies cannot be done in the service layer.
An adviser **cannot see** an unplaced learner's enrolment —
`visible_learner_identity` answers null for exactly that caller, correctly — so
the lookup found nothing, took the "not enrolled" branch, and asked
`place_enrollment` for a **second enrolment for the same learner in the same
year**. Only the unique index caught it. The decision now lives in
`pull_learner_into_section`, a definer function that re-checks the policy it
bypasses. The general rule is in `constraints.md`.

### Housekeeping, 2026-11-05 — the local scratch cleared

Asked for as a quick cleanup of unused files. **Nothing tracked was removed,
because nothing tracked was unused**: every file under `web/`, `src/` and
`scripts/` is referenced by another file, by a `package.json` script, or by a
document — `scripts/export-erd-schema.ts` looks orphaned and is not, since
[the paper diagrams](diagrams/paper/README.md) runs it by hand — and all six
images in `web/public/images/` are loaded by a screen, which matters because the
image list is closed by the content policy.

What went, all of it gitignored and all of it reproducible:

- **`.local/sf9-print/out/`** — 580 files, nearly all of them three throwaway
  Chromium user-data profiles the print harness creates on each run, plus the
  PNG and PDF proofs from it. The two seals and the wordmark that came out of
  that work are committed in `web/public/images/`, so the proofs hold nothing
  the repository does not. The 13 harness scripts are **kept**: two are cited by
  path in `prior-academic-records.md`.
- **Eight spent one-off scripts in `.local/db/`** — `check-0048`,
  `check-lrn`, `check-phase2`, `check-promotion`, `check-readers`,
  `check-unapplied`, `probe-enrol`, `try-demo`. Each verified something that
  has since shipped with tests of its own, and several said in their own header
  that they live in `.local/` and are deleted afterwards, which is the rule in
  `AGENTS.md`. **Kept**: `applied.ts` and `dry-run.ts` (read-only, and what
  you want before `db:migrate`), `bootstrap.ts` and `verify-live.ts`.
- One stale background probe test (`tests/zz-probe.test.ts`) had already been
  cleaned up by its own run; the shell that wrote it was stopped.

`.local/npm-cache/` is **not** scratch — `.npmrc` points npm's cache there.
Nothing in `.local/` held a credential: it was checked before anything was
deleted.

### Earlier in this session

- **0.89.0** — register every learner first, settle classes afterwards: the
  class-list import takes a year and a grade with no section. Plus the two test
  gates `AGENTS.md` claimed existed, `tests/migrations.test.ts` and
  `tests/web-help.test.ts`, both mutation-tested; the help one was **vacuous on
  its first run** and then found eight stale marks.
- **0.88.0** — the learner's address (migration 0053, one field of the
  learner-fields gate) and the Excel class-list template on Roster import.
- **The bulk historical-records import was built and reverted** at the user's
  direction: not a go-live requirement. Individual encoding on Academic history
  is unchanged and remains the only path.

## Verification

| Check | Result |
|---|---|
| `npm run check` | **passes, exit 0** |
| `npx vitest run` | **252 passed**, 25 files (114 in 11 at the start of the session) |
| `npm run build` | clean |
| `npm run api:export` | regenerated for 0.90.1. **0.90.1 adds no endpoint**: it changes the workspace only |
| Migration checksums | **54/54**, by `tests/migrations.test.ts` — which caught 0054's missing checksum on its first run |
| 0054 in PGlite over every earlier migration | applies clean; all earlier tests pass unchanged against the two replaced writers |
| `npm run db:migrate` | **not run.** Live is still at 0052 |
| `npm run smoke` | **not re-run.** It would show the same routes missing as before, all of them the deployment being 0.86.1 |

New tests: `tests/teacher-roster.test.ts` (23) — mostly refusals, because a
widening tested only for its happy path is how a role gate becomes decoration:
the wrong section, a learner in somebody else's class, a learner at another
grade, a stale version, a duplicate name, a duplicate LRN, and every movement an
adviser still cannot make. Plus `tests/web-teacher-roster.test.ts` (6) driving
both screens in a real DOM against the real API.

## Outstanding

**Blocking**

1. **Apply 0053 and 0054, then deploy 0.90.2.** **Next year's classes must not
   be opened on live** until it ships. Merging `branch-out` anywhere is the
   user's, and was explicitly withheld on 2026-11-05.

**Not finished**

2. **`tests/concurrency.pg.test.ts` is still missing**, so `npm run test:race`
   and `npm run test:load` run nothing. 0054 touches two writers that take the
   academic lock; both take it exclusively and first, as before, and neither
   changed its lock order — but that is read by eye, not proved by a test.
3. The recovered 0.42.0 documents are **as of 0.42.0**. `learner-registry.md`,
   `registry-review.md`, `architecture.md` and `frontend-handoff.md` have been
   corrected for the recent releases; `runbooks.md` and
   `school-information-requests.md` only partly, the rest not at all.
4. `guides/staff-guide.md` has **no screenshots** and nothing about the address
   column, the Excel template, registering without a class, the adviser's pull or
   the oversight card. Retake from `npm run demo`, synthetic records only.
5. **Step 8, the batch SF10, is deferred** — do not start it unasked.

**Waiting on the user**

5b. **Whether to fit the SF10's six grades onto one *side* of long bond.** It
   already prints on one sheet, front and back. One side means six blocks a
   side instead of the workbook's four and about 5.7pt type. Recommended: leave
   it. If it is wanted anyway, the honest form is an explicit choice at print
   time rather than a silent change to the form everyone issues.

**Waiting on the school** (see the gates in [constraints.md](constraints.md))

6. **The reviewed learner-field list and the capacity policy**, sharpened in
   [the information requests](school-information-requests.md) with the candidate
   fields named, to be answered with the privacy-owner request.
7. **Subject-teacher access — integration deferred 2026-11-05 because the role
   itself is unconfirmed.** The user asked for it not to be integrated: the role
   is yet to be confirmed. So the question to the school is now two, in order —
   does it run this role officially, and only then what may it record. Three
   teachers in the school's own SF4 teach classes they do not advise, which is
   evidence of a timetable, not of a role carrying permissions. **The adviser
   pull does not help them, and is not to be stretched into helping them**: it
   is scoped to a section they advise, and a subject teacher advises none.
   Nothing is modelled for the role — no role value, no section-teacher table,
   no second predicate beside `may_advise_section`, no placeholder screen.
8. Whether Balili's head should be pre-printed on the SF9's Cancellation block.
9. Which DepEd order the SF10-ES footer should cite — the school's workbook says
   *DepEd Order No. 10, s. 2024*, the 4 November clarification says **No. 58,
   s. 2017**.
10. The Kindergarten card and assessment policy.
11. `a` on the daily register means *afternoon*, not *absent*. Flagged, undecided.

**Housekeeping**

12. **Done 2026-11-05: the local scratch was cleared** (see below). What is left
    in `.local/` is four read-only database tools and the print harness two
    sections of [prior-academic-records.md](prior-academic-records.md) cite by
    path. Promoting the print harness into `tests/` is still open — it needs a
    headless browser, which the suite deliberately does not.
13. The SF10's front and back row heights differ. Cosmetic.
14. `next_year_placements.seed` is vestigial since 0049.

## The plan from here

[docs/roadmap.md](roadmap.md). **Phase 1 is done. Phase 2 steps 6 and 7 are
done**; step 8 is deferred by instruction and step 8b (the historical bulk
import) is recorded as considered and declined for go-live. So Phase 2 is closed
unless step 8 is asked for. Phase 3 is seven features behind a school decision;
Phase 4 is the Section 7 turnover — drills, hosted load, privacy, go-live, UAT.

**What the school needs for go-live, in order:** register the current learners —
onto the registry at a grade and into classes afterwards, or a class list at a
time, or by an adviser building their own class, or one learner at a time on the
registry — then set the year's calendar and attendance rule, then run the year.
**Historical academic records are not on that list**: they can be encoded at any
time afterwards, the office can now see how far that has got, and nothing waits
on them.
