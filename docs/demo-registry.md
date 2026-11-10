# The demonstration registry

`npm run seed:demo-registry` prepares a database for a live demonstration to
the school: learner profiles, one class per grade, and the school year those
classes sit in. It stops there, deliberately, because the operator performs the
demonstration itself.

```bash
npm run seed:demo-registry -- --rehearse           # throwaway in-memory database
npm run seed:demo-registry -- --rehearse --prove   # and then walk the five operations
SEED_CONFIRM=seed-demo-registry npm run seed:demo-registry
```

Flags: `--per-grade=N` (default 10) and `--new=N` (default 10).

It refuses unless the database holds no school year, section, learner or
enrolment, so it only ever lands on a freshly reset one. Run
`RESET_CONFIRM=wipe-seeded-data npm run reset:seeded-data` first.

## Why it creates a school year and classes at all

The request that produced it asked for learner profiles **only** — no
enrolment, no class, no school year. Two facts about the schema make that
impossible to take literally, and both are worth knowing before anyone
"corrects" this script back towards the original wording.

**`edunexus.learners` carries no grade level.** Name, LRN, birth date, sex,
address and guardian are the whole profile (0004, 0053, 0056). A learner is "in
Grade 3" only by way of an enrolment. So a registry of bare profiles has no
grade distribution at all, and "learners across Kinder to Grade 6" can only
mean a birth-date cohort per grade.

**Promotion is keyed on an enrolment.** `promotion_decisions.enrollment_id`
references one; `promotion_section` refuses a *closed* year with `P1900`; and
`next_year_pair` requires the target year to be exactly
`source.start_year + 1`. Demonstrating promotion therefore needs a source year
that is **draft or active**, holding classes with learners to promote out of.
There is nothing to promote from a clean registry.

So the script seeds the thing promotion promotes *from*, and nothing beyond it.

## Why the source year is 2025–2026 and not the current one

The fourth operation in the demonstration is an adviser taking a learner into
their own class. That goes through `move_enrollment`, which refuses a movement
dated in the future — *"movement must advance the timeline within an open year
and cannot be future dated"*. So the year the operator creates and pulls into
has to contain today.

Seeding **2025–2026** makes the year they create **2026–2027**, which contains
today. Seeding the current year instead would push the new year to 2027–2028,
and every pull into it would be refused until June 2027. `next_year_pair` leaves
no choice about which year that is: it must be `source.start_year + 1`.

The learners' birth dates follow from this. `children()` in `scripts/seed/people.ts`
dates a birth so the learner is the right age for that grade in SY 2026–2027,
so the script asks for the cohort one grade up: that makes them the right age
for their grade in 2025–2026, and the right age again for the next grade once
the operator promotes them.

## Why one real teacher advises every class

`promotionsRecommend` refuses anyone whose role is not `teacher`
(`src/modules/report-records/service.ts`). A manager cannot endorse an outcome.
A class with no adviser therefore has nobody who may endorse one, and its
learners could not be promoted at all.

Only one real teacher account exists, so it advises all seven classes. No
teacher is invented to spread the load: an invented account would appear in the
staff list during the demonstration and would have to be wiped again.
Reassign them freely once the school's own teacher accounts exist.

## What it does not create

Nothing the operator demonstrates: the next school year, any promotion
recommendation or decision, any next-year placement, any adviser pull.

Nothing that would mean inventing school policy or school records either: no
subject catalogue (`web/learning-areas.ts` is a proposal a manager reviews,
never a seed), no attendance day rule (the principal records it), no
instructional calendar, no attendance mark, no grade, no report card, no
public-site content, and no school head on the forms' heading.

## Attribution and removal

Every record is attributed to one synthetic principal,
`demo.setup@balili-es.invalid`, under the reserved `.invalid` domain, with no
password and an unroutable address. That is how `reset:seeded-data` finds and
removes it, and it is why no invented record is ever journalled under a real
person's name.

The script writes a `seeded_data_notice` row. That row is what puts the seeded
banner on every screen, and `reset:seeded-data` **refuses to run without it** —
so removing the row to hide the banner also disarms the only cleanup tool.

## `--prove`, and the two defects it found

`--rehearse --prove` walks the five operations against a throwaway database, so
the seed is known to support them before a demonstration depends on it. It is
refused outside `--rehearse`, because running it is exactly what the operator
asked not be done for them.

It found two defects in existing code, neither introduced here:

**Carrying more than fifty learners into next year in one request is refused.**
`record_access_events` has `CHECK (cardinality(record_ids) <= 100)`, and
`nextYearCommit` logs two ids per learner — the source enrolment and the new
one. Sixty learners is 120 ids, and the insert fails with `23514`, which the API
maps to a generic `RULE_VIOLATION` naming no rule. The workaround is the
screen's own grade filter: one grade at a time, up to fifty learners each.

**Previewing next year is refused above one hundred learners.**
`nextYearPreview` logs one id per learner across placements and unplaced
together, so the same CHECK stops it. At the school's real roll of ~897 this
means neither the preview nor the commit works for a whole year, and per grade
(~130) is still over the cap.

Both are in `src/modules/next-year/service.ts`, and both are fixed by chunking
the ids into batches of 100 rather than by widening the CHECK — the cap is a
deliberate limit on how much one audit row may claim to have disclosed.
