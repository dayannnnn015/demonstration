# Section 4B.1: assessment tasks and raw score entry

Teachers record the marks they actually give: a named assessment with a maximum, and one raw score per learner. That much is true under **any** grading policy, which is why it can be built while the grading gate in [constraints](constraints.md) is still closed.

Nothing here is summed, weighted, averaged, converted to a percentage, transmuted or turned into a grade. No endpoint returns a total. Those arithmetic rules come from the school, and inventing them would silently corrupt real report cards.

## What makes this safe to build early

Two facts do not depend on which DepEd issuance applies:

- An assessment has a maximum score, and a learner's raw mark falls between zero and that maximum.
- An assessment belongs to a component the school has named.

The second is why a task must reference a component code from the **bound adopted policy revision**. EDUNEXUS never invents "WW" or "PT"; it reads them out of the frozen snapshot the school adopted in [4A.4](assessment-policy-adoptions.md) and bound in [4A.5](assessment-policy-bindings.md). An offering with no standing binding cannot hold assessments at all, which is what makes that chain load-bearing rather than decorative.

## Assessment tasks

- `component_code` must exist in the bound adoption's `policy_snapshot.components`. It is normalized to upper case.
- `reporting_period_id` must belong to the offering's school year.
- `sequence` is 1–99 and unique per offering, period and component, so "Written Work 3" is unambiguous.
- `max_score` is `numeric(7,2)`, above zero and at most 10000. This is a storage and sanity bound, not a grading rule; the school can revise it. It was `numeric(6,2)` until migration `0022`, which stops at 9999.99, so the documented maximum itself raised an overflow instead of saving.
- `status` is `open` or `archived`. Archived tasks reject new scores and drop out of the default list.
- Offering, period, component and sequence are fixed once a task exists. Title, maximum and status are versioned and journaled.

Lowering `max_score` below a mark already recorded is refused with `TASK_MAXIMUM`: the saved evidence would become invalid. Correct the scores first, then lower the maximum.

## Raw scores

A score row exists only once a mark is recorded. An unrecorded learner is **null**, not zero — the same rule attendance uses for unmarked sessions, and for the same reason: absence of a record is not evidence of a zero.

Scores are written in batches of 1–100, each entry carrying its own expected `version` (`0` for a learner with no score yet). Two teachers editing different learners in the same task do not conflict; two edits to the same learner do, and the second gets `VERSION_CONFLICT`. Setting a score to null clears it, advances its version and keeps the history.

The whole batch is one transaction. If any entry is out of range, references a learner outside the section, or has a stale version, nothing in that batch is written. A batch whose entries all match what is already stored returns `ASSESSMENT_UNCHANGED` rather than writing an empty journal row.

One journal row is written per batch, holding before/after for each changed entry, rather than one row per learner — the same shape [daily attendance](daily-attendance.md) uses, so a class entry does not produce a hundred history rows.

## Which components an adviser may use

Adoptions and bindings are manager-only, so until migration `0024` an adviser creating an assessment could not see which component codes the bound revision holds. `GET /api/v1/section-subjects/:id/assessment-components` answers for any offering the caller may read: `bound: false` with no components when no standing binding exists, otherwise each component's `code` and `name` in code order. **Weights are never returned**; nothing an adviser does needs them and nothing in EDUNEXUS computes with them. `read_assessment_components` repeats the access checks of `assessment_entry_context` — a manager, or the section's adviser in a year that is not closed; anyone else gets `NOT_FOUND` — but takes the academic lock **shared**, as register reads have since `0023`, rather than exclusively, since it writes nothing. It names no learner and writes no access row.

## The screen

`web/screens/Scores.tsx` (0.41.0) is open to every role. It picks a school year, section, subject and reporting period; lists the assessments under the bound policy's components; adds one through a sheet whose component list comes from the read above; corrects a title or maximum or archives one; and shows one class sheet — learners down, one raw mark each. Marks are typed into the sheet and held until reviewed together, then recorded in one batch with a reason, like the daily register: only learners whose box changed are sent, each at the version it was read, and an emptied box against a recorded mark is an explicit null that the review labels *Cleared*. A mark outside zero to the maximum, or with a third decimal place, is refused beside its box and never rounded. A version conflict reloads the sheet with the typing kept and returns to the review, where the colleague's newer mark shows as *Recorded now*, so nothing is overwritten unseen. The screen draws no total, average, percentage or grade anywhere, and says so.

## Access

Advisers read and record for their own currently assigned sections in open years. Managers read everything and may record historically. An unassigned teacher gets 404, because the offering is simply not theirs; a suspended account gets 403 at the door. Task and score history are manager-only.

Scores survive the learner leaving the section. Entry requires a valid enrollment in the task's own section, so an adviser cannot correct a transferred-out learner's mark — a manager can. This mirrors the `current_access_only` rule in daily attendance.

## API

| Operation | Contract |
|---|---|
| `GET /api/v1/section-subjects/:id/assessment-tasks` | `status=open\|archived\|all` (default open), `reporting_period_id`, `component_code`, `after_id`, `limit` default 50/max 100. |
| `POST /api/v1/section-subjects/:id/assessment-tasks` | Reporting period, component code, sequence, title, maximum and reason. |
| `GET /api/v1/assessment-tasks/:id` | One task. |
| `PATCH /api/v1/assessment-tasks/:id` | Current version, title, maximum, status and reason. |
| `GET /api/v1/assessment-tasks/:id/scores` | The section roster with recorded marks, `limit` default 100, `after_id`. Returns `recorded_scores_only: true` and no aggregate of any kind. |
| `POST /api/v1/assessment-tasks/:id/scores` | 1–100 entries of `enrollment_id`, `raw_score` (nullable) and `version`, plus a reason. |
| `GET /api/v1/assessment-tasks/:id/events` | Manager-only task history. |
| `GET /api/v1/assessment-tasks/:id/score-events` | Manager-only batched score history, newest first, `before_id` cursor. |

Errors: `TASK_COMPONENT` means no standing binding or an unknown component code; `TASK_PERIOD` a period outside the school year; `TASK_STATE` an archived task or closed year; `SCORE_RANGE` a mark outside zero to the maximum; `SCORE_ENROLLMENT` a learner outside this section; `TASK_MAXIMUM` a maximum below a recorded mark. A learner the caller may no longer read is `NOT_FOUND`, the same answer the rest of the system gives, rather than an admission that the record exists.

## Storage and validation

Migration `0021` adds `assessment_tasks`, `assessment_scores` and their two journals. Runtime grants are SELECT-only with RLS; advisers see their own current open-year sections and managers see everything, and both journals are manager-only. Validated security-definer commands own every write, take the shared academic setup lock and lock the school year for share. `assessment_entry_context` resolves the offering, its standing binding and the actor's access in one place and is not runtime-callable.

Migration `0022` corrects four defects the [20 September review](backend-review-2026-09-20.md) reproduced against `0021`. Each restored a guarantee the rest of the system already held; none of them is arithmetic, and no endpoint or error code was added.

- **A teacher reads only the learners they currently teach.** Checking the task's section alone left a withdrawn or transferred learner's marks readable by their former adviser and writable through the entry function, in HTTP and in direct restricted-role SQL alike. The score row policy and the writer now both apply `can_read_enrollment`, the predicate daily attendance already uses. It stays true for a manager, so no history is lost.
- **Only an explicit JSON null clears a mark.** An entry that omitted the `raw_score` key reached the null branch and erased a recorded mark. The HTTP schema always rejected it; the database boundary did not, and the database boundary is the authority. A missing key is now `23514`, and whole-batch rollback is unchanged.
- **Reading a score sheet writes a privacy access row.** A sheet names learners and their marks, so it is a disclosure and belongs in `record_access_events` beside every other learner read. `scoreSheet`, `scoreRecord` and `scoreHistory` are permitted resources and log exactly the enrollments each response disclosed. `taskGet`, `taskList` and `taskHistory` name no learner and log nothing.
- **The documented maximum fits.** `max_score` and `raw_score` widened to `numeric(7,2)`.

Both writers now take the shared academic-setup lock before reading the state they version-check against, rather than after. That ordering is asserted as text, because PGlite serializes transactions: a real multi-connection regression is still owed before the concurrency finding closes.

Sixteen tests cover component sourcing from the bound revision, refusal without a binding, recording and clearing, unrecorded learners staying null, range and maximum protection, stale versions and duplicate learners in a batch, archival and closed years, adviser and suspended-account scoping, whole-batch rollback including journal failure, pagination, the absence of any total, average, percentage or grade in the responses and the contract, and one case per corrected defect above. Each of those four fails against `0021`.

## What is still gated

Everything arithmetic. Raw entry itself was taken out of the grading gate on 26 September 2026, recorded in [constraints](constraints.md). Component totals, weighting by the adopted basis points, rounding, transmutation, MPS, GWA, subject and section averages, and reviewed finalization all wait on the **grading enclosure and ECR examples** gate. When the school supplies them, the scores recorded here are the input, and the adopted policy bound to each offering says which rules apply.

Kindergarten remains excluded: the draft model covers Grades 1–6 only, and descriptive assessment needs its own design behind its own gate.
