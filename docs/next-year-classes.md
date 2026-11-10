# Next year's classes

Carrying learners from one school year into the next, from their approved
end-of-year outcomes. Section 5's last step.

> **Written 2026-11-04 from the code.** The original of this document was lost
> with the rest of `docs/` in the 0.86.1 recovery and exists in no branch and no
> commit, so this is written from `src/modules/next-year/`,
> `web/screens/NextYear.tsx` and the [changelog](../CHANGELOG.md), in that order
> of authority. Where this file and [constraints.md](constraints.md) disagree,
> that file wins.

> **Mostly automatic since 0070 (0.108.0).** Approving an end-of-year outcome
> now carries that learner into the following school year by itself, in the same
> transaction, at the grade their outcome leads to and with **no section** --
> through this module’s own rule and the same `place_enrollment`. When the
> following year does not exist yet, an `after insert` trigger on
> `academic_years` runs the outstanding carry-forward the moment it is created.
> Automatic runs are recorded in `next_year_placements` beside the manual ones,
> with a `reason` saying which of the two triggered them, so the history below
> reads the same either way.
>
> **This screen is still the way to do it in bulk**, and still the only way to
> carry forward outcomes approved before 0069 existed. It is now a catch-up and
> an audit rather than the step that must be remembered. Everything below is
> unchanged and still accurate. See [the promotion gate](promotion-gate.md).

## What this is, after 0049

It used to be a **draw**: every promoted learner was dealt into a section of
their next grade, balanced by sex and size from a seed. Migration `0049` removed
it.

The reason is in one sentence from the module's own header:

> Promotion does not choose a class — an adviser takes a learner into one
> afterwards, which is separate work.

So a carried-forward learner now arrives at their **grade with no section**, and
what is left is the part that was always the school's decision: **who has an
approved outcome, and where it leads.**

Nothing in this module changes an outcome. It reads them, works out the grade
each one leads to, and says plainly who is not coming and why.

### What that removal fixed

Under the draw, a learner whose next grade had **no section yet** was left behind
— so the school had to build all of next year's classes before it could promote
anybody. That ordering constraint is gone: a grade needs no sections now.

The marker of it is deliberate and worth not re-adding:

```ts
/**
 * Why a learner is not carried forward. `no_section` is deliberately absent:
 * under the draw, a learner whose next grade had no section yet was left
 * behind … A grade needs no sections now.
 */
export type Unplaced = 'left'|'no_outcome'|'not_approved'|'remedial'|'completer'|'already_enrolled';
```

## The two operations

```
GET  /api/v1/academic-years/:id/next-year-classes   preview — manager only
POST /api/v1/academic-years/:id/next-year-classes   commit  — manager only
```

Both are manager-only. `grade_level` narrows either to one grade.

## Where an outcome leads

```ts
const targetGrade = l => l.action === 'promoted' || l.action === 'conditionally_promoted' ? l.grade_level + 1 : l.grade_level;
```

| Approved outcome | Next year's grade |
|---|---|
| `promoted` | the next grade |
| `conditionally_promoted` | the next grade — **DepEd Order No. 15, s. 2026**, which moves the learner up with back subjects |
| `retained` | the same grade |
| `remedial` | **not carried.** The learner is still in remedial classes |

## Who is not carried, and why

`why()` runs in order, and the order is what makes the message useful — the first
true reason is the one reported:

| `reason` | Means |
|---|---|
| `left` | The learner's enrolment is withdrawn, not enrolled |
| `no_outcome` | No outcome recorded at all |
| `not_approved` | Recommended or returned, but **not approved** |
| `remedial` | The outcome is remedial |
| `completer` | The target grade would be above 6 — they have finished elementary school |
| `already_enrolled` | They already have an enrolment in the target year |

`to_grade` is reported for the reasons where a grade is meaningful, and `null`
for `completer`, `left` and `no_outcome`, where it is not. Both lists sort by
surname then first name.

**A learner enrolled this year but not yet in a class still has an outcome to
carry forward.** `section_id` and `section_name` are nullable in the source for
exactly that, since 0048 made the section optional.

## The reviewed commit

The preview carries a `review_hash` — a SHA-256 fingerprint of **who, and into
which grade**:

```ts
createHash('sha256').update(JSON.stringify({ source, target, grade,
  placements: placements.map(p => [p.enrollment_id, p.to_grade]).sort(…) })).digest('hex')
```

The commit recomputes it from a fresh read and refuses on a mismatch:

| Refusal | When |
|---|---|
| `PLACEMENT_CHANGED` | Something moved underneath since the preview was read |
| `PLACEMENT_EMPTY` | No learner in this preview is waiting to be enrolled |

The placements are sorted by `enrollment_id` before hashing, so the fingerprint
does not depend on the order the database happened to return rows in.

### The lock order, which is not optional

```ts
// Exclusive before the read takes it shared: a transaction never asks for a
// lock exclusively after holding it shared.
await tx.query('select pg_advisory_xact_lock(82412001)');
```

The commit takes the shared academic-setup lock `82412001` **exclusively, before
the read that would otherwise take it shared.** A transaction holding a lock
shared must never then ask for it exclusively — that is the deadlock the lock
convention exists to prevent, and it is why the `pg_advisory_xact_lock` call sits
above `source()` rather than below it.

`npm run test:race` and `npm run test:load` are the proof. Run both after
touching any of this.

## The vestigial seed

```ts
// The seed drew sections. Promotion no longer assigns one, so it decides
// nothing; it is still accepted and recorded, because next_year_placements.seed
// is NOT NULL and the runs already written carry theirs.
```

The API still accepts and records a `seed`. It decides nothing. It is kept
because `next_year_placements.seed` is `not null` and the runs written under the
draw carry theirs. Dropping that `not null` is a migration for no behaviour
change — listed as housekeeping in [status.md](status.md), not as a fault.

## Privacy

Both operations name learners, so both write a `record_access_events` row.

- `nextYearPreview` names **every enrollment in both lists** — the placements and
  the ones left out. A learner shown as "not coming, no outcome recorded" was
  still disclosed.
- `nextYearCommit` names both the source enrollment and the new one.

## What a principal actually checks

The preview's `grades` array is there for this: what each grade **receives**,
tallied by sex.

```ts
grades: [...new Set(placements.map(p => p.to_grade))].sort()
  .map(g => ({ grade_level: g, carried: tally(placements.filter(p => p.to_grade === g)) }))
```

**This field is why 0049 is a blocking migration.** The screen expects `grades`,
and a database still on 0047 does not return it, so **Next year's classes breaks
on load** until 0049 is applied.

`runs` carries the previous commits for the year — grade, seed, how many were
placed, the reason, who did it and when.

## How it fits the year's work

1. Advisers record each learner's outcome — `promotionsRecommend`.
2. A manager approves or returns it — `promotionsDecide`. **Approval places
   nobody** (D3a, 0.83.0).
3. Once every learner going into a grade next year has an approved outcome, the
   Overview offers **Prepare next year's** that grade, opening the reviewed
   preview at it.
4. The manager reads the preview, checks what each grade receives, and commits.
   Everyone lands **at their grade, in no class.**
5. A class is given to each learner separately — which is where the planned
   [teacher pull](roadmap.md#7-teacher-pull--an-adviser-retrieves-their-own-learners-into-their-class)
   would help, since the office is currently the only way in.

Steps 1 and 2 are [report-records.md](report-records.md). Step 5 is placement.

## No capacity, deliberately

Next year's classes **enforces and suggests no maximum class size.** Observed
sizes are known — 18–20 in Kinder, 29–37 elsewhere — and **observation is not
policy.** This sits behind the
[learner fields and class capacity gate](constraints.md#gates), which opens on an
approved maximum or a written statement that there is none.

## Where to look

| | |
|---|---|
| Who moves and where | `src/modules/next-year/placement.ts` — pure, no database |
| Locking, the hash check, privacy rows | `src/modules/next-year/service.ts` |
| Contracts and response shapes | `src/modules/next-year/contracts.ts` |
| The screen | `web/screens/NextYear.tsx` |
| Error codes | `src/core/errors.ts`, range `P21xx` |
| Migrations | `0033`, `0034`, `0036`, and `0049` which removed the draw |
| Outcomes | [report-records.md](report-records.md) |
