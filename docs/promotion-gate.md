# The promotion gate, the term window, and automatic advancement

Three rules the school asked for on 2026-11-09, which EDUNEXUS did not have.
Migration `0069`, release 0.103.0.

They read like three features. They are one piece of work, because each of them
is about the same thing: **the end of a school year should not be something a
person has to remember to do.**

## What was true before, and why each was wrong

Each of these was found by reading the code, not inferred from the request.

**A term had dates and no meaning.** `edunexus.reporting_periods` (0001) holds
`ordinal`, `name`, `starts_on` and `ends_on`, and that is all — there is no
status column, no "active" flag and no operation to open or close one. The four
report-card writers checked only that a period *belonged to the year*
(`P1905`, `0030_report_records.sql:149`). So an adviser could encode the third
quarter in June, and "completing the first term unlocked the second" only in the
sense that nothing had ever been locked.

**Promotion was gated on nothing at all.** `edunexus.promotion_section` (0033)
checked that the caller advised the section and that the year was not closed. A
class with no grades recorded could be endorsed and approved, and the printed
promotion report would carry *Not recorded* down the general-average column
beside an approved outcome.

**Approval stopped at the word "approved".** `decide_promotions` set
`status='approved'` and returned. Carrying the learner into next year was a
separate manager action — Next year's classes, `nextYearCommit` — which a school
could simply never run. Nothing was wrong with that screen; what was wrong is
that the system's answer to "what happens after the principal approves?" was
"someone opens another screen".

## 1. A term accepts grades only once it has started

**The rule, as decided 2026-11-09:** a term opens on its own `starts_on` and
stays open while the school year is open. A term that has not begun is refused.
Completing a term unlocks nothing — the next term opens on the date the school
configured for it, and nothing else opens it.

**A term already begun never closes**, and that is a decision rather than an
omission. The ECR's figures arrive *after* the term is over: an adviser
transcribing the first quarter in October is doing ordinary work, and a rule that
shut a term at `ends_on` would make the promotion gate below unsatisfiable for
the last term of every year.

Where it is enforced: `edunexus.guard_report_period()`, a `before insert or
update` trigger on **`report_grades`, `report_values` and `report_notes`**.

It is on the tables rather than inside the writers deliberately. There are four
writers that take a reporting period — `record_report_grades`,
`record_report_values`, `record_report_notes` and `record_report_card` — and a
fifth could be added tomorrow. One rule on three tables cannot be forgotten by a
writer that did not exist when the rule was written. It also means the card
editor, which writes every box of one learner's card in a single transaction, is
covered without restating it.

**What is not gated:** a record that names no term. The subject average and its
remark (`reporting_period_id is null`), the general average, and the SF2 month
remark are not a reporting period's records, and the school's rule was about
reporting periods. This is a deliberate limit, recorded here so nobody has to
guess whether it was an oversight.

The refusal is `P1908` → `PERIOD_NOT_STARTED`, and it carries the term's own
name: *"Third Quarter has not started yet. Grades are encoded for a term once it
begins, on the date the school configured for it."*

On the screen, **Promotion** labels an unstarted term *— not started* in the term
and column pickers, draws its table read only above a note saying when it begins,
and the card editor shows those boxes as recorded values rather than inputs. The
subject average, the general average and the remarks stay open there too, for the
same reason they are not gated in the database.

## 2. Promotion is closed until the class's report cards are complete

**Required means what that grade's card actually prints.** This is the whole of
the definition, and it is why there is no list of required fields hard-coded
anywhere:

| Grade | What promotion waits for |
|---|---|
| Kindergarten | **Nothing.** It prints no card. Its outcome is the credential presented for Grade 1 and stays recordable |
| A descriptively graded grade (DO 15, s. 2026 — Grade 1 from 2026–2027) | Each term's narratives, for every learner. No numeric grade, because the card has none |
| Every other grade, 1 to 6 | Every active learning area's grade **in every configured term**, each learning area's subject average and remark, and each learner's general average |

Counted against **currently enrolled** learners (`record_state='valid'` and
`status='enrolled'`), so a withdrawn learner neither blocks promotion nor is
promoted.

`GET /api/v1/sections/{id}/promotion-readiness` answers it:

```json
{
  "ready": false, "blocked_by": "incomplete", "missing_total": 21,
  "learners": 30, "offerings": 8,
  "requires": { "descriptive": false, "grades": true, "note_kinds": [] },
  "periods": [{ "name": "First", "starts_on": "2026-06-01", "open": true, "missing": 0, "complete": true }],
  "final": { "missing_grades": 8, "missing_remarks": 8, "complete": false },
  "general_average": { "missing": 2, "complete": false }
}
```

`blocked_by` is one of `incomplete`, `no_periods` (the year has none configured)
or `no_offerings` (the class has no learning areas, so there are no grades to
complete), or `null` when promotion is open.

**It counts records and never reads a grade.** No value is compared, totalled or
averaged — the rule that nothing computes a grade is untouched. And because it
names no learner, it writes no `record_access_events` row, which is the same
reason `read_grade_entry` names none: a gate the dashboard asks for on every load
must not bury the privacy audit in its own noise.

Both writers ask it. `record_promotion_recommendations` and `decide_promotions`
call `edunexus.assert_promotion_ready`, which refuses with `P2002` →
`PROMOTION_NOT_OPEN`. The screen asks the same endpoint rather than working the
answer out from the records on the page, so what the interface shows and what the
writers accept cannot drift apart.

**The gate is per section, not per school.** One class's missing grade does not
stop another class being promoted, and a learner who joins a class late re-closes
that class's gate until their own records are in — which is correct, and tested.

## 3. An approved outcome carries the learner into next year

`decide_promotions` now advances every learner it approves, **in the same
transaction**, through `edunexus.advance_approved_enrollment`:

> **Narrowed 2026-11-09 by `0071` (0.104.1): only a promotion enrols.** The
> table below is 0069’s. The school narrowed it the same day — *"automatic
> enrolment will do only if the learner was recommended for promotion and the
> ao/principal approves it"* — so **`retained` no longer enrols anybody**. Its
> row below now reads like `remedial`: the outcome is recorded and approved and
> carries the learner nowhere. Everything else in this file is unchanged.

| Outcome | What happens |
|---|---|
| `promoted`, `conditionally_promoted` | Enrolled next year at `grade_level + 1`, **no section** |
| `retained` | **Not carried forward since `0071`.** Recorded and approved only; enrolled for next year separately |
| `remedial` | Not carried forward. It is the one outcome that names no next grade |
| `promoted` at Grade 6 | Not carried forward: they have completed elementary school |

No section is assigned, and that is `0049`'s settled decision rather than a
shortcut — *"a learner who moves up does not keep their old class and is not
given a new one by the principal; an adviser takes them into a class
afterwards."* It is also exactly what makes them appear in the next grade's
adviser's **pullable learners** list, which is what the school meant by the
succeeding grade-level teacher pulling them into their master class.

The enrolment goes through `edunexus.place_enrollment` — the same writer the
registry form, the roster import, the adviser pull and Next year's classes all
use. Nothing here is a second way to enrol anybody.

### When next year does not exist yet

EDUNEXUS cannot invent a school year: `academic_years` is created by a manager,
with its own dates, and nothing may guess them. So when the year with
`start_year + 1` does not exist, **the outcome is recorded and the carry-forward
runs the moment that year is created**, from
`edunexus.carry_forward_on_new_year()`, an `after insert` trigger on
`academic_years`.

Nothing is silently skipped. `decide_promotions` answers with `advanced`,
`waiting_for_next_year`, and a per-learner `advance` object carrying either the
new enrolment or the reason there is none:

`retained` · `remedial` · `completer` · `no_next_year` · `already_enrolled` ·
`not_enrolled` · `no_lrn` · `not_approved` · `returned`

`no_lrn` is reported rather than raised. `place_enrollment` refuses a learner
with no LRN (`P0303`), and one missing LRN must not take a whole class's approval
down with it. In practice it is unreachable for a currently enrolled learner,
because they needed an LRN to be enrolled in the first place.

### What does not happen

- **Nothing is deleted.** The previous year's enrolment keeps its section, its
  grade level, its status, its grades, its general average and its outcome. A
  test asserts each of those after an approval.
- **Nobody is enrolled twice.** `enrollments_valid_learner_year_idx` (0008) makes
  a second valid enrolment for one learner in one year impossible, and the
  advance looks for an existing one first and reports `already_enrolled`. A
  second approval of an already-approved outcome changes nothing and is refused
  with `P1904` → `NO_CHANGES`.
- **No partial promotion.** One refused entry rolls the whole batch back, the
  approvals in it included. Tested with a mixed batch.
- **Reporting periods are not activated.** Approving a promotion does nothing to
  any term. The two processes share no code and no state, which is what the
  school asked for in as many words.

### Where the run is recorded

In `next_year_placements`, beside the manual runs, so **Next year's classes**
shows the whole history in one place. `review_hash` is `NOT NULL` and means *the
fingerprint of the preview the manager approved*; an automatic run has no
preview, so it carries a digest of what it placed and its `reason` says which of
the two triggered it — *"Carried forward automatically when the outcome was
approved."* or *"… when this school year was created."* Entries are written in
chunks of 500, because the column's own CHECK caps a run at 1000 and the
school's roll is about 897.

## Previous advisers and the retained learner

> **Rewritten for `0071`.** This section described a retained learner being
> carried into next year with no section and pulled back in by their adviser.
> Since `0071` **they are not carried forward at all** — so the question below
> is no longer "which class do they land in" but "who enrols them". The answer
> is the office, their adviser’s pull (which offers a learner holding no
> enrolment this year on a search), or **Next year’s classes**, which still
> carries a retention because it is a reviewed preview a manager commits.
>
> The paragraph below is kept because the reasoning about **not guessing a
> same-named section** still governs what happens once somebody does enrol them.


The school's example asks for the Grade 1 adviser's active roster to hold only
the retained learner after approval. What this implementation does, and the one
place it differs:

- **A promoted learner leaves.** In next year they hold an enrolment with no
  section, so they are in nobody's class and are offered to every Grade 2
  adviser's pull.
- **A retained learner also holds an enrolment with no section**, at the same
  grade, and their Grade 1 adviser takes them back in through the same pull.
  They are not automatically placed into the equivalent next-year section.

That last point is `0049` again: next year's sections are a different set of
rows, created by a manager, and which of them a learner joins is an adviser's
act. Placing a retained learner automatically would mean guessing that a
same-named section is the same class, which is not a guess EDUNEXUS should make.
**The previous year's roster is untouched** — it is history, and reading it is how
the SF9 and the SF10 are produced.

If the school wants a retained learner returned to the equivalent class
automatically, that is a small, separate increment and it should be asked for
rather than assumed.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `P1908` | 409 `PERIOD_NOT_STARTED` | That term has not begun; its grades cannot be encoded yet |
| `P2002` | 409 `PROMOTION_NOT_OPEN` | The class's report cards are not complete, or the year has no terms, or the class has no learning areas |

## Tests

`tests/promotion-gate.test.ts` — 25 cases over the real API on PGlite: the
readiness counts term by term, the endorsement and the approval both refused
while incomplete, Kindergarten open with nothing recorded, adviser isolation in
HTTP and in SQL, a version conflict, the approval reporting `no_next_year`, the
carry-forward on year creation at the right grade for each outcome, the previous
year untouched, the run row, the immediate advance once the year exists, the
repeated approval, whole-batch rollback, the late joiner re-closing the gate, the
pullable list, and the journal carrying the advance.

`tests/web-promotion-gate.test.ts` — 3 cases in a real DOM against the real API:
the closed gate named term by term with the unstarted term explained, the picker
labelling it, and the API refusing it while accepting a term that has begun.

`tests/workflow-notifications.test.ts` was changed, not worked around: its
promotion cases now record the grades promotion waits for, and its quarters are
dated so that all four have begun.
