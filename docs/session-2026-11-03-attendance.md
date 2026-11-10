# Session of 3 November 2026 — attendance capture, the school forms, and sign-in

Branch `branch-out`, on top of `80d8d7c` (the recovered 0.86.1). **Nothing is
committed.** Version is still `0.86.1` — no bump. This session's work sits in the
same dirty tree as the previous session's SF9/SF10 print work, which is also
uncommitted; see [session-2026-11-03.md](session-2026-11-03.md) for that.

One new migration, `0050`, and it is **not applied anywhere**. Live sits at 0047,
so `0048`, `0049` and `0050` are all pending.

---

## 0. Read this first: the branch cannot pass its own gate

`AGENTS.md` requires `npm run check` before a commit. On this branch it cannot
pass, for two reasons that predate any work here:

- `npm run typecheck` fails on `scripts/demo-school.ts:26` (a `string` where a
  uuid literal union is wanted) and `scripts/seed-test-data.ts:224` (`.rows` on
  an array). `tsc --noEmit` fails there before it ever reaches the web projects.
- `tests/` was dropped by the recovery commit — all 43 files, leaving only
  `tests/helpers/database.ts`. Until this session `npm test` exited 1 with
  "No test files found".

**Verify work with `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc --noEmit`
(ignoring the two `scripts/` errors), `npm run build` and `npx vitest run`**, and
say plainly that the suite is partial. Do not report the gate as passed.

`tests/helpers/dom.ts` and the whole real-DOM screen harness are still gone, so a
screen's *data paths* cannot be tested here yet. Four test files now exist; see §7.

---

## 1. `docs/school-forms.md` restored

The recovery commit deliberately left out the whole `docs/` tree (66 files)
because `.vercelignore` kept it out of the deployment the source was rescued
from. Only this one file was brought back, from `80d8d7c^`, because it is the
only record of what the school's SF2, SF4 and SF9 specify. It carries a dated
note at the top saying it is the 0.42.0 copy and has not been re-checked against
0.43.0–0.86.1.

**`docs/status.md`, `docs/constraints.md` and 63 others are still absent.**
`constraints.md` is the settled-decisions authority, and this session needed it
twice (§5). Read it out of git history at `80d8d7c^` when a decision is in doubt.

---

## 2. Daily register: typed marks

`web/screens/Attendance.tsx`. The register is the surface 27 advisers touch twice
a day and it was radios only. It now takes the keyboard, with the SF2 grid's own
letters:

| Key | Marks |
|---|---|
| `x` | absent all day |
| `p` | present all day |
| `m` | absent in the morning only |
| `a` | absent in the afternoon only |

Each letter sets the learner's **whole day** and moves focus to the next learner
in the same column, the order a paper register is read in. The letters are
imported from `typedPair` in `web/forms/sf2.tsx` rather than restated, so the
register and the form a teacher corrects it on cannot drift.

Three decisions worth keeping:

- **The arrow keys are left to the radio group.** They already move between the
  three chips natively; hijacking them would cost a screen-reader user the only
  way to change a mark.
- **`Delete`/`Backspace` are deliberately not carried over** from the SF2 map. A
  blank cell on the SF2 *is* a presence, so clearing one there means "present";
  on the register "not marked" is its own value, and a key that reads as "clear
  this" must never record a presence nobody observed.
- **A blocked session keeps what it holds.** Typing `p` on a date whose afternoon
  has no class sets only the morning.

**Open question:** `a` means *afternoon*, not *absent*, which matches the SF2
exactly but is not an adviser's first guess. The hint above the table spells it
out. Flagged to the user, not yet decided.

---

## 3. The downloaded SF2 now draws what the screen draws

The complaint was that shading "becomes tricky" when downloaded. Reading the
`styles.xml` the file actually contains found the cause: **invalid OOXML.**

```xml
<stop position="0.5"><color rgb="FF808080"/></stop>
<stop position="0.5"><color rgb="FFFFFFFF"/></stop>
```

Two stops at the same position. The spec requires them distinct and rising, so
Excel either faded grey across the cell or "repaired" the file. Now `0, 0.499,
0.5, 1`, which gives the hard edge.

The user first proposed replacing the shading with letters, then withdrew it on
seeing the form's own CODES legend: **the download must match the screen.** Five
mismatches were found and closed:

| Mark | Screen | Download was | Download now |
|---|---|---|---|
| Tardy half | `#6b6b6b`, hard edge | `#808080`, invalid gradient | `#6b6b6b`, valid hard edge |
| Day still to come | diagonal hatch `#a6a6a6` | flat light grey | `lightDown` pattern fill |
| Session nobody marked | red `?`, red outline | plain black `?` | red `?`, red border |
| Total rows | tinted `#f2f2f2` | no tint | tinted `#f2f2f2` |
| No class | `#d9d9d9` | `#d9d9d9` | unchanged |

`web/xlsx.ts` gained `hatch`, `color` and `borderColor` on `XStyle`, and `half`
now takes its colour from `fill` instead of hardcoding one.

There were also **two separately written key texts** — one for the screen, one for
the file — already saying different things. They are now one `keyItems()` in
`web/forms/sf2.tsx` that both read.

**Known limitation, stated to the user:** half-shading is a gradient fill, and
**Google Sheets does not support gradient fills at all**. Excel and LibreOffice
are fine. If staff open these in Google Sheets, letters are the only robust
answer — the user's original instinct, left on the table.

**Not a defect:** a 31-learner SF2 cannot fit one A4 landscape page. Fixed content
alone (titles 88pt, column heads 37pt, DepEd foot 459pt) is 584pt against a page
capacity of ~624pt, leaving 40pt for 34 learner rows that need 510. It comes out
as grid on page 1, foot on page 2, with the foot kept whole.

---

## 4. The SF9 names the dates that leave a month empty

A learner's card showed October's *School Days* as 22 but *Present* and *Tardy*
blank, and the user reported that October **did** have marks.

**No defect.** The 22 itself rules out the other causes: the guard for an
unconfigured or alternative-delivery date blanks the day count too, so the
calendar and the rule were fine. The remaining branch is `unmarked` — and
`dayValue` requires *every* classroom session on a date to be marked. **One
half-marked day (morning marked, afternoon not) blanks the whole month**, and the
blank month blanks the year's Total. The register visibly has marks on it and the
month is still empty; the two are not in conflict.

Also checked and clean: `transfer_out`, `withdrawal`, `dropout` and `death` all
map to `event_type='withdrawn'`, so a departed learner does not keep accruing
uncountable days.

The real failing was that the card said *nothing*. `attendanceFor` now collects
the dates as it counts, keeping the two causes apart — `unmarked` (a session
nobody marked) and `unset` (a date the calendar does not hold) — and the warnings
name them:

> October is empty because 2 days have a session nobody marked (5 and 7 October).
> A missing mark is never counted as present, so mark it on the register and this
> month fills in.

Two further changes came with it:

- **The current month is covered now.** The old condition was `r.to < today`, so a
  gap earlier in the month you are *in* produced a blank with no warning at all.
- **The dates stay off the printed card.** They live in `warnings`, which the SF9
  sheet never renders; `FormDialogs.tsx` shows them, as a list when there is more
  than one. This is workflow information, not something a parent reads.

Touched: `src/modules/forms/cards.ts`, `src/modules/forms/contracts.ts`,
`web/forms/types.ts`, `web/screens/FormDialogs.tsx`, `docs/openapi.json`.

---

## 5. SF2 → SF4: verified, and two failures repaired

Both forms count through the **same two functions** (`dayKind`, `dayValue`)
against the same recorded rule over the same `attendance_marks` table. The chain
is gated, not merely conventional: an SF4 cannot be issued until every section's
month is submitted on Monthly consolidation (`service.ts`, `FORM_NOT_SUBMITTED`).

Agreement proved in `tests/forms-consolidation.test.ts` — one set of marks turned
into both sources the way the two SQL functions do: days of classes, registered
at end of month, average daily attendance per sex and in total, percentage of
attendance, and the grade and school roll-up all match. Refusals propagate
correctly: one incomplete section nulls that section's average *and* the school
total's, while registered **counts** still add up.

Then two failures, both repaired.

### 5a. The SF4 disagreed with the SF2 about "today" — fixed in TS

The SF2 holds today over as still to come until a mark is recorded on it; the
SF4 counted anything not in the future. So every morning before registers were
taken, today's whole roster landed in `unmarked_learner_days` and the section was
flagged incomplete — **the consolidation screen reporting sections as behind when
they were simply not due yet.** `computeSf4` now applies the SF2's own test.

### 5b. Movements disagreed at a month boundary — fixed by migration `0050`

Proved against the real SQL in PGlite (`tests/forms-movements.test.ts`), not by
reading: for one section with two October departures, one effective the 1st and
one the 15th, **the SF4 reported 2 transfers out and the SF2 reported 1.**

The learner who left on the 1st was already withdrawn on day one, never entered
October's roster, and the SF2 derived its movement counts *from that roster*. The
form's column is the movements **of the month**, so the SF4's reading is correct.

`0050_sf2_movements.sql` is a `create or replace` of `read_sf2_source` adding a
`movements` aggregate defined exactly as `read_sf4_source` defines it, so the two
queries cannot drift again. Checksum added to `database/migration-checksums.json`.
**The roster is deliberately untouched** — a learner with no day in the month
still gets no row on the register; only the summary count moved. If the API runs
against a database still on 0049 the key is absent and `monthEvents` falls back to
the roster: the old undercount, not a form that will not open.

### Still open, unproven

`resolve_enrollment_timeline`'s consumers pick a learner's state with
`order by effective_on desc limit 1` and **no tiebreaker**, so two events on the
same date — a section change and a withdrawal, say — resolve arbitrarily, even
though the timeline is built in `enrollment_version` order. Not repaired: it is
not demonstrated, and *which* event should win is a records question, not one to
guess at. The PGlite harness to test it now exists.

---

## 6. Sign-in: authenticator out, "Keep me signed in" in

### The QR authenticator is removed

This **restores** a settled decision found in `docs/constraints.md` at `80d8d7c^`:

> **2026-09-18 — Multi-factor authentication is removed.** A full read of the
> manuscript found no mention of MFA, an authenticator, TOTP, OTP or a second
> factor anywhere... Sign-in is email and password. Reinstating it is a code
> change, not a configuration switch.

It had evidently been reinstated between 0.43.0 and 0.86.1; whatever recorded that
is in the lost part of `docs/`.

**The server enforcement was removed first, deliberately.** `src/core/auth.ts`
refused any token at `aal1` when the account had a verified factor. Deleting only
the UI would have **locked out every already-enrolled account** — no form left to
complete the second step, and a permanent 403.

Deleted: `web/two-step.tsx`, `web/components/qr.tsx`. Removed: the `two-step`
sign-in stage, the **Turn on two-step sign-in** setting on My profile, the
`TWO_STEP_REQUIRED` branch in the API client, and the FAQ and guide entries.
`SessionAuth` moved to `web/api.ts` and is now just `signOut`.

Kept on purpose: the sessions list still reads `assurance`, because a factor
enrolled before today still raises a token to `aal2` and "with a code" should say
what happened; and the 0.79.0 what's-new entry stays with a note that it was taken
out again, because that release did happen.

**`supabase/config.toml` was not touched.** `[auth.mfa.totp] enroll_enabled` is
still `true`. That file mirrors live so `supabase config diff` catches drift, and
editing it would manufacture false drift; `config push` is forbidden outright.
Nothing in EDUNEXUS offers or requires a factor now, so this is cosmetic — if the
service should refuse enrolment, that is a dashboard change by the operator.

### "Keep me signed in on this computer"

**This is a deliberate exception to a standing rule**, decided by the user on
2026-11-03 after it was raised. `AGENTS.md` says sessions live in `sessionStorage`
and must not move to `localStorage`, because a shared staffroom browser must not
leave a session behind. The chosen scope is **opt-in, off by default**:

- Unticked (the default) nothing changes — the session dies with the tab.
- Ticked, it moves to `localStorage` and survives closing the browser.

The mechanism is one storage adapter in `web/api.ts` the Supabase client is built
on. Three details that matter:

- **The choice is set before the sign-in call.** The session is written as that
  call returns, so setting it afterwards lands it in the wrong store.
- **Signing out forgets the choice**, so the next person at a staffroom computer
  starts with the box empty rather than inheriting someone else's.
- **The box is pre-ticked only for someone who chose it on that computer before.**

**`AGENTS.md` still states the old flat rule and should be amended**, and the
decision recorded in `constraints.md` when that file comes back.

#### A real bug, found by its own test

```ts
removeItem(key) { try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch {} }
```

In a private window `localStorage` **throws**, so the exception fired before the
tab's copy was cleared — **signing out would have left the session sitting in
`sessionStorage`.** Each store now gets its own `try`. This would not have shown
up in normal browsing.

---

## 7. Tests

Four files, 38 cases, all passing. These are the first tests back on this branch.

| File | Covers |
|---|---|
| `tests/forms-attendance.test.ts` | The SF9's attendance record: every branch that leaves a month empty, and the warning strings end to end through `computeSf9`. |
| `tests/forms-consolidation.test.ts` | SF2 ↔ SF4 agreement over one month, the roll-up, and what the SF4 refuses. |
| `tests/forms-movements.test.ts` | The real SQL in PGlite: both source queries over one section's month. |
| `tests/web-session-store.test.ts` | Where a session is kept, the opt-in, sign-out, and a store that throws. |

`tests/web-session-store.test.ts` is registered in `tsconfig.json` (excluded) and
`tsconfig.web.json` (included), as the contract requires of a web test.

---

## 8. State at the end

- **Nothing is committed.** The tree carries the previous session's SF9/SF10 print
  work *and* all of this. How it splits into increments is the user's call; it was
  left rather than folded together.
- **No version bump.** Still `0.86.1` in `package.json` and `src/openapi.ts`.
- `docs/openapi.json` regenerated for the SF9 contract change (§4). The sign-in
  work needed none — `TWO_STEP_REQUIRED` was never in the published contract.
- **Migrations `0048`, `0049` and `0050` are unapplied.** Until `db:migrate` runs,
  the school's SF2 still undercounts a first-of-month departure.

### The single next action

Decide how this tree splits into commits, then commit. After that, in the order
the user flagged them:

1. Verify the October SF9 against the real data — the card now names its dates
   (§4). If it names dates advisers insist *are* marked, that is a new problem.
2. The timeline tiebreaker (§5, "Still open").
3. Amend `AGENTS.md` for the session-storage exception (§6).
4. Restore `tests/` from `80d8d7c^` as its own increment — expect real failures,
   since that is the 0.42.0 suite against 0.86.1 source.
