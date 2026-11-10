# Section 3B.2: monthly attendance review

This increment checks classroom completeness, preserves immutable monthly submissions, and controls subsequent corrections. The manager screen is `web/screens/Months.tsx`, at `/months`; teachers have no monthly screen, because the `/status` read available to them carries no counts or learner detail worth one. It does not calculate official attendance credits, percentages or SF2/SF4 totals. All counts are raw AM/PM classroom sessions.

## Scope and access

Each workflow belongs to one section and calendar month. Supply `month_on` as the first date of that month, even when the school year starts midmonth. The review clips its date range to the school year, includes leap days and requires every overlapping date to be explicitly configured, including weekends. Missing schedules are unknown, never automatically holidays.

Principals and administrative officers can review complete historical membership, submit, return, lock, reopen and read snapshots/history. Teachers can read only basic workflow status for sections they currently advise in an open year. The status response contains no learner details, counts or snapshot identifier. Teacher daily sheets continue to use current learner access and must not be presented as complete historical monthly reports. Adviser changes take effect immediately for access.

Monthly membership uses valid annual enrollment records and the corrected date-effective timeline. It includes learners who have since left, excludes withdrawal gaps and dates before enrollment, and applies a movement from its effective date. Each member contains original and retained learner IDs, captured names/profile and enrollment versions, and dated AM/PM pairs. Birth dates, sex and LRNs are omitted. No-class dates retain membership with null marks.

## Readiness and states

| Current state | Action | Result |
|---|---|---|
| `draft` | `submit` | `submitted`, with a new immutable snapshot |
| `submitted` | `return` | `draft`, retaining the old snapshot |
| `submitted` | `lock` | `locked`, retaining the submitted snapshot |
| `locked` | `reopen` | `draft`, retaining the old snapshot |

An untouched month is logically draft/version `0`; reads and previews do not create a workflow root. Every confirmed transition advances its version once. The acting manager reviews their own proposal; a different second approver is not required. Both submitted and locked states freeze the month. Return and reopening are explicit, reasoned corrections rather than history deletion.

Submission requires an active school year, a clipped end date strictly before today in Asia/Manila, explicit calendars for all dates, no alternative-delivery sessions, and a present/absent mark for every eligible classroom session. A month ending today cannot be submitted. No-class/suspended sessions require no marks. An empty section with a complete supported calendar can submit with zero expected sessions. Alternative-delivery participation/conversion remains unimplemented and blocks submission even if no learners are eligible on those dates.

`issues` identifies `YEAR_NOT_ACTIVE`, `MONTH_NOT_ENDED`, `UNCONFIGURED_DATES`, `UNSUPPORTED_ADM` and `MISSING_MARKS`. A blocked submission preview returns `can_commit=false` and no review hash. Resolve the causes and preview again. Raw `expected_sessions`, `missing_sessions`, `present_sessions` and `absent_sessions` must not be relabeled as official days or attendance rates.

## API workflow

Paths are relative to `/api/v1/sections/:id/attendance/months`.

| Method/path | Inputs and result |
|---|---|
| `GET /status` | `month_on`; basic state, version and clipped range only |
| `GET` | `month_on`; manager readiness, daily counts, schedule/context and data hash |
| `GET /members` | `month_on`, optional `snapshot_id`, `limit` (default 50, max 100), `after_id`; paged member evidence |
| `POST /preview` | `month_on`, current `version`, `action`, single-line `reason` (10–500 characters); proposed transition and review hash |
| `POST /transitions` | Unchanged proposal plus `review_hash` and `reviewed=true`; committed event |
| `GET /transitions` | `month_on`, `limit` (default 5, max 10), optional `before_version`; newest-first immutable events |

The standard 32 KiB request-body limit applies. Review processing supports at most 1,000 distinct enrollments per section/month; larger reviews fail explicitly with `MONTH_SIZE`, without truncating records. This is a processing bound, not a school class-capacity policy.

Show readiness, context, counts and membership before confirming a transition. The hash binds the acting manager, action, reason, state/version and current context. For submission it also binds the complete dataset. Refresh and require fresh review after a conflict; never silently substitute a new hash/version. A lost response can be investigated through transition history using its actor, hash and request ID. This workflow has no import-style replay receipt.

Draft reads have `source=live` and rebuild the current data. Submitted/locked reads use `source=submission_snapshot`. The outer section/year context is current; `review.section` and `review.school_year` belong to the captured submission. An explicit `snapshot_id` retrieves an older submission after return, reopening or resubmission; it must match the requested section/month. A returned draft may retain a last snapshot ID while its default review/members are live. Pass the explicit ID when historical evidence is intended.

Member pages sort by enrollment UUID. Frozen pages are stable. Live pages may change between requests; compare `data_hash` with the review and between pages, and reload if it changes. Transition confirmation independently verifies the complete dataset. Clear protected data on sign-out and render names/reasons as text.

## The screen

`web/screens/Months.tsx` reads one section and one month, and offers only the transitions the table above allows from the current state: submit from draft, return or lock from submitted, reopen from locked. There is no edit form, because nothing edits a month in place.

**A blocking issue is a sentence, not a code.** `YEAR_NOT_ACTIVE`, `MONTH_NOT_ENDED`, `UNCONFIGURED_DATES`, `UNSUPPORTED_ADM` and `MISSING_MARKS` each map to what the reader has to do next, and to the screen that does it. `issueText` in that file holds the mapping and a test asserts every code has one; an unmapped code falls back to itself rather than disappearing. The issue list is shown only for a draft, since a frozen month has already passed these checks and restating them there would read as a fault.

**Every count says what it is.** Present, absent, unmarked and expected are raw AM/PM classroom sessions, printed with a sentence saying they are not school days, attendance credits, percentages or SF4 totals. The mark-meanings gate is what stands between these numbers and any of those words.

**Neither the member list nor the transition history is on the screen.** Both cards were removed on 2026-11-10, at the user’s request. The member list named learner records and `monthSnapshot` writes a `record_access_events` row naming every one of them, so a card nobody opened was a privacy cost with no reader; the transition log restated what the page’s own status badge and the journal already hold. `GET .../months/members` and `GET .../months/transitions` are unchanged and still answer — nothing in the workspace calls them now.

A closed year offers no transitions at all, matching the rule that no monthly transition or reopening is allowed in one.

## Correcting dependencies

Submitted/locked months reject daily attendance writes and calendar edits affecting their dates. School baseline edits are conservatively blocked if any section month is frozen, including label-only edits or dates with overrides. An unrelated section override can still change. Existing calendar override rules also apply.

Enrollment constraints compare final date-effective membership with frozen evidence, even for dates with no marks. Backdated new enrollments, void/restoration, historical section/grade corrections and ordinary movements cannot change frozen membership. A later movement that preserves it is allowed. The deferred constraint runs after the final timeline update and rolls back the entire transaction on conflict, including journals/audits. Identity link/reversal is blocked if either affected profile is an original or retained member of a frozen snapshot. Ordinary profile display edits and adviser changes remain allowed; the frozen names and section context do not change.

Return or reopen all affected months before repairing dependencies. Existing calendar/enrollment/identity previews may succeed before their confirmation encounters `MONTH_FROZEN` or `MONTH_DEPENDENCY`. After unfreezing, the daily `ATTENDANCE_DEPENDENCY` rules still require explicit mark clearing before an incompatible calendar/enrollment correction. Repair, re-record as appropriate, review, and resubmit; earlier snapshots and transition evidence survive.

Daily reads now include `month_status` and `month_version`, with `recording_available=false` while frozen. These fields are optional in saved daily-journal contracts for compatibility with pre-0012 snapshots. A daily preview from before submission cannot be reused after return, even if the daily sheet version did not change.

Year closure remains an existing independent operation: it does not require all months to be locked. Managers retain closed-year reads, but no monthly transitions or reopening are allowed in a closed year. Complete necessary review/correction before closing; no automatic closure/reopening or year-close completeness gate is included here.

## Storage and verification

Migration `0012` adds `attendance_months`, immutable `attendance_month_snapshots`, and immutable `attendance_month_events`, with foreign keys, scoped uniqueness, RLS and manager-only SELECT privileges for the runtime. Only validated security-definer commands mutate them. Snapshots are created once per submission and referenced by later events, rather than copying full member data on every transition. Generic change/access logs contain identifiers and request metadata, not names or full snapshots.

Monthly commands use the existing registry advisory lock before a shared year lock. Effective timelines are materialized once per review. Private helpers and superseded daily entrypoints are not runtime-callable. All snapshot/root/event/audit writes are atomic. Dependency triggers follow PostgreSQL's [deferred constraint semantics](https://www.postgresql.org/docs/current/sql-createtrigger.html) and the existing [transaction locking order](https://www.postgresql.org/docs/current/explicit-locking.html).

Local coverage includes state/version races, actor/reason changes, privacy and direct-SQL denial, snapshot retention, rollback after journal failure, pagination, no-mark dependency guards, partial/leap months, today boundaries and the processing limit. Hosted verification is recorded in [deployment](deployment.md). Preserve the migration, evidence and guards during application rollback; a compatible application is required once submissions exist. School-approved attendance arithmetic, real staff authenticated HTTP, operational recovery and school acceptance remain separate work.
