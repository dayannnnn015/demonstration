# Section 3B.1: reviewed classroom attendance

This increment records classroom AM and PM attendance against the corrected enrollment timeline and explicit instructional calendar. It adds daily sheets, bounded preview/confirmation, preserved correction history, and protection against conflicting calendar or enrollment edits. The screen is `web/screens/Attendance.tsx`, at `/attendance`, open to advisers and managers alike.

## Roles and dated rosters

Principals and administrative officers can read historical sheets and record/correct attendance. Teachers can record/correct accessible learners in sections they currently advise. The existing learner-access rule is preserved: withdrawn, voided, transferred-away and closed-year learner records remain unavailable to teachers. Teacher sheets are explicitly labeled `visibility=current_access_only`; they are not complete historical class reports. Manager sheets use `full_historical_roster`. Changing an adviser changes access immediately.

A learner belongs on a dated sheet only if their annual record is valid and their latest effective timeline entry on or before that date assigns them to the requested section without withdrawal. A movement applies from its effective date. Reentry starts eligibility again; gaps and dates before enrollment are excluded. The resolver includes reviewed timeline/grade corrections and subsequent ordinary movements. Current names and retained identity are used for sheet display; original ownership is returned as `recorded_learner_id` and recorded identities remain in review snapshots.

Sheets return minimal learner names and identifiers, not birth dates, sex or LRNs. Results are ordered by enrollment UUID, with at most 100 learners per page (default 50), and an `after_id` cursor. Pagination is not a frozen roster snapshot; reload after roster changes. There are no whole-class or official attendance totals in this increment.

## Mark semantics

Each learner has two independently nullable fields, `am` and `pm`:

| Value | Meaning |
|---|---|
| `present` | Explicitly recorded as present for that classroom session. |
| `absent` | Explicitly recorded as absent for that classroom session. |
| `null` | Unmarked or explicitly cleared; unknown, never inferred present or absent. |

Non-null marks require that session's effective calendar mode to be `classroom`. Missing dates, `no_class`, `suspended` and `alternative_delivery` sessions do not accept these marks. Alternative-delivery participation/conversion, tardiness and excused-absence classifications need a later school-reviewed policy. No half-day credits, percentages, official monthly denominators or SF2/SF4 arithmetic are computed here. The [official adoption of school forms](https://www.deped.gov.ph/2014/01/30/do-4-s-2014-adoption-of-the-modified-school-forms-sfs-for-public-elementary-and-secondary-schools-eeffective-end-of-school-year-2013-2014/) establishes SF2/SF4 purposes; obtain the school's current approved templates and examples before implementing their totals or output.

Only active academic years and dates on or before today in Asia/Manila accept writes. Managers can read draft/closed-year sheets; teachers cannot read closed-year sheets. An uninitialized sheet has version `0` and creates no persistent attendance rows. Future dates may be read for preparation but cannot receive marks. `recording_available` describes the year/date/schedule; per-learner eligibility is still revalidated at preview and commit.

## API workflow

Paths are relative to `/api/v1/sections/:id/attendance`.

| Method/path | Behavior |
|---|---|
| `GET` | Required `day_on`; optional `limit`, `after_id`. Returns schedule, context, version and accessible dated roster. |
| `POST /preview` | Required `day_on`, `version`, `changes`, `reason`. Returns proposed before/after marks, current context and a review hash. |
| `POST /corrections` | Same proposal with `review_hash` and `reviewed=true`. Returns the committed journal event. |
| `GET /corrections` | Manager-only history for required `day_on`; `limit` defaults to 5, maximum 10; use `before_version` for older events. |

Each change has exactly `enrollment_id`, `am` and `pm`. Both session fields are required: this is a replacement of that learner's AM/PM pair, not a patch of one session. Preserve the other field when editing only AM or PM. Supply 1–100 distinct enrollments in one section/date, with a single-line reason of 10–500 characters. The standard 32 KiB UTF-8 body limit applies. Omitted learners are unchanged; sending two nulls clears that learner's marks while retaining a tombstone and journal evidence.

Show proposed before/after values and schedule context before confirmation. The acting staff member must confirm the same normalized proposal and reason; this is not a second-person approval queue. Initial entry, later correction and clearing all follow this workflow. Preview makes no attendance or generic change-audit writes; successful API reads/previews do record access. All-no-op batches fail; mixed batches write only changed learners.

The version is shared across the section/date sheet, so two staff members cannot silently overwrite different parts of the same sheet using stale versions. Every committed batch advances it once. The hash also binds actor, reason, selected enrollment/profile versions, section/year context, calendar version and effective schedule. Another calendar batch conservatively invalidates a review even if it affected a different date. A commit rebuilds the review and verifies its hash; it does not trust the supplied learner IDs or earlier access.

After any 409 conflict, refresh and review again. On a lost response, managers can inspect protected history for the review hash and actor. Teachers can refresh the sheet and have a manager inspect history; they have no history endpoint that could disclose formerly assigned learners. There are no import-style replay receipts, and silently retrying with a new version is prohibited.

## Protecting existing marks

Calendar changes are rejected with `ATTENDANCE_DEPENDENCY` if any non-null mark would end up in a non-classroom session. A date's label can change while its classroom sessions remain intact. Section overrides and baseline edits use the same guard.

An enrollment update is checked against all its non-null dated marks after its effective timeline has been updated. A withdrawal/reassignment on or before an affected mark, a timeline/grade repair moving that mark to another section, or voiding the annual record is rejected. A later withdrawal that leaves earlier attendance valid is allowed. The deferred database constraint checks the final timeline and causes the complete business transaction—including correction journals and audits—to roll back on failure.

Calendar and enrollment preview endpoints can still return a review before this downstream check; confirmation may reject it with `ATTENDANCE_DEPENDENCY`. Review and clear the affected marks through the attendance workflow, perform the calendar/enrollment correction, then review any re-recording against the corrected context. These are separate transactions and must be explicit to staff. Mark history and original enrollment ownership survive the process. A cleared mark can be recorded in the corrected section without creating a second mark for the same enrollment/date.

Section 3B.2 adds [submitted and locked months](monthly-attendance.md). Both states block daily writes and affected calendar, membership and identity changes until a manager returns or reopens the month. Reads now include `month_status` and `month_version`, and frozen sheets have `recording_available=false`. These context fields are optional in saved journal contracts because pre-0012 history lacks them. The month version also invalidates a daily preview across submission and return. Frozen monthly snapshots preserve historical names/membership; daily sheets still use current display and teacher access. Official released forms remain later work.

## The screen

`web/screens/Attendance.tsx` is one section on one date, both sessions, and it is the highest-frequency screen in the system: thirty advisers, twice a day. What it settled is worth keeping if it is ever rebuilt.

**Marks are held locally until they are reviewed together.** The API records a batch atomically against one shared sheet version, so saving each mark as it is clicked would be thirty writes, thirty version bumps and thirty chances for two staff members to overwrite each other's half of the same class. The primary action counts what is pending and opens the review.

**A change carries both sessions.** `pending()` in that file builds the payload, and it has a test for every branch: a learner whose AM moved sends their untouched PM back unchanged, because a change replaces the pair rather than patching half of it, and an omitted session would clear a mark nobody touched. A learner marked and then put back exactly as they were is dropped, since an all-no-op batch is refused.

**Three chips, not a select.** Marking a class is the one task here done at speed against a paper list, so present, absent and not-marked are each one click. The third is how a mark is cleared: the API clears with an explicit null, and without that control a mark recorded by mistake could only be replaced with another guess. The radio stays in the tab order — it is taken out of the visual flow rather than hidden with `display: none` — and the visible chip carries the focus ring.

**An unmarked session is drawn.** `MarkValue` renders `Unrecorded`, never a blank cell and never an em dash. A session that cannot hold a mark at all — unconfigured, no class, suspended, alternative delivery — says which, rather than appearing as an empty control the adviser would try to use.

**The refusal is explained before it happens.** `recording_available` is false for four different reasons, and the screen names the one that applies: a year that is not active, a future date, a frozen month together with the screen that unfreezes it, or a date nobody has configured together with the screen that configures it. A disabled control with no sentence beside it is what this replaces.

**The review hash is never reused after a refusal.** A 409 discards the hash and returns the adviser to the form, exactly as the calendar screen does.

Manager-only change history sits below the register, because a teacher's history endpoint could disclose formerly assigned learners. A teacher's sheet carries a `current_access_only` badge and a sentence saying it is a current class list rather than a historical report.

## Database and verification

Migration `0011` adds section/date version roots, marks unique by annual enrollment/date, and immutable review events. Runtime access is SELECT-only with RLS; attendance commands validate active staff, section and learner access internally. Private date/context resolvers cannot be invoked by the runtime. Roster and calendar changes hold the academic advisory lock exclusively. Since migration `0023` the register itself takes that lock shared, with a per-section lock beside it: reads of any sections run side by side, a confirmation holds only its own section exclusively, and neither ever overlaps a roster or calendar change. The year lock comes after both. [The load measurement](load-measurement-2026-09-25.md) records why. External authentication calls are outside those transactions.

API access logs record only returned/reviewed enrollment IDs, split into at most 100 IDs per event. Names and reasons remain in protected business snapshots rather than generic logs. A batch, its version, journal, marks and generic audits commit or roll back together. Local and hosted tests are development verification, not a substitute for real staff sign-in testing, school acceptance, monthly arithmetic validation, backup restoration or realistic concurrent API load.
