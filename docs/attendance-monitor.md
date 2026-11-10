# Section 3B.3: classroom absence monitoring

This read-only module helps staff find recorded classroom absences and gaps in attendance recording. Its screen is `web/screens/Monitor.tsx`, at `/monitor`, open to advisers and managers alike. It computes live evidence from corrected enrollment timelines, explicit calendars and current marks. It creates no alert cases, changes no attendance, sends no messages, assigns no dropout/risk labels and calculates no official attendance credits or rates. School-approved thresholds and follow-up procedures remain separate work.

## Access and request

`GET /api/v1/sections/:id/attendance/monitor` requires active staff authentication. Principals and administrative officers can read historical section membership. Teachers can read sections they currently advise and only learners still visible under current open-year roster rules. A withdrawn/transferred-away/voided learner is not disclosed through a teacher's historical monitor. Adviser changes and year closure update access immediately. Managers can read draft and closed years.

Required query fields are `from` and `to`: an inclusive range of 1–31 dates within the section's school year, ending no later than today in Asia/Manila. There is no implicit clipping or lookback. The range may cross a month boundary. Today's missing marks can reflect sessions not yet recorded; they are never automatically absences.

Optional `view` is `all` (default), `with_absences` (at least one recorded absent classroom session), or `incomplete` (at least one missing classroom mark, unconfigured eligible date, or unsupported ADM session). Filters apply before pagination. `limit` defaults to 50 and is at most 100; continue with `after_id` from `pagination.next_after_id`. No whole-section total is implied by a page. Records without any eligible date in the range are excluded.

## Evidence and counts

The response identifies current section/year context, calendar version, `visibility`, `source=live`, the range/filter and effective `days`. Each day includes schedule source, AM/PM modes, configured status and monthly workflow state/version. Members include minimal current names, enrollment/profile versions, retained `learner_id`, immutable original `recorded_learner_id`, dates and a summary. No LRN, birth date or sex is returned.

Each member has an evidence row for every requested date, including ineligible gaps. A movement applies from its effective date; corrected timelines, reentry gaps and valid-record state determine eligibility. Marks outside that learner's eligible section dates are not disclosed. Classification follows this order:

| Classification | Meaning and effect on an absence run |
|---|---|
| `not_eligible` | No valid section membership on that date; breaks the run. |
| `unconfigured` | Missing effective calendar; unresolved and breaks the run. |
| `unsupported_adm` | At least one alternative-delivery session; unresolved and breaks the run. |
| `no_classroom` | Only explicit no-class/suspended modes; skips the date without increasing or breaking the run. |
| `incomplete` | At least one scheduled classroom mark is null; breaks the run. |
| `absent` | Every scheduled classroom session is explicitly absent; increases the run by one date. |
| `attended` | Classroom recording is complete and includes a present session; breaks the run. |

An AM-only classroom date can classify as absent when AM is absent and PM is explicitly non-classroom. This counts one observed classroom-absence date, not an official full-day credit. A mixed present/absent date has a raw absent session but breaks the all-classroom-absent date run. A classroom/ADM date retains its classroom observations while remaining unsupported for date-run classification.

Summary fields count eligible dates, expected/present/absent/missing classroom sessions, unsupported sessions, unconfigured dates, and absent classroom dates. `needs_completion` is true for missing marks, missing schedules or ADM. Null marks remain unknown. The longest and trailing absent-date runs count only within the requested window. Explicit nonclass dates are skipped; no dates before `from` are inspected, so a run may have started earlier. The trailing run is evaluated through `to`, not through today's date when an older range was requested. These are descriptive observations, not a school intervention threshold.

## The screen

`web/screens/Monitor.tsx` opens on the fortnight ending today — long enough to show a run forming, short enough to stay well inside the 31-date limit — clamped to the school year at both ends.

**The window is checked before a request is spent.** The API refuses anything out of bounds with one `MONITOR_RANGE` code that does not say which of the four rules was broken, so `windowProblem()` checks them separately and each gets its own sentence: a reversed range, a window wider than 31 dates, a window ending after today or after the year, and one starting before the year. It is a pure function with a test per branch.

**A gap in the record is never drawn as an absence.** `unconfigured` and `incomplete` carry the unrecorded mark rather than a badge, and a test asserts neither renders the word "absent". A date nobody configured and a session nobody marked are unknown; reading either as an absence is exactly the mistake this module exists to prevent.

**The window is stated beside every count it produced**, along with the fact that a run may have started before it, because no date before `from` is inspected.

**Nothing on the screen is a threshold.** The closing note says so in the school's own terms: there is no approved absence rule, so the screen shows the evidence and leaves the judgement to whoever reads it, and it points at the manual follow-up screen rather than offering to open a case itself.

## Live corrections and frozen months

Monitoring recomputes after reviewed attendance, calendar, enrollment or identity changes and uses current display names. It is not a frozen report or immutable page set. Reload pages after changes; do not combine different requests into a claimed point-in-time official report. A submitted/locked month's existing guards remain in force. Its workflow state is displayed, but historical captured names and evidence must be read through the separate [monthly snapshot API](monthly-attendance.md).

Monitoring itself has no write endpoints or notification jobs. [Section 3B.4](attendance-followups.md) separately adds manual manager-reviewed cases while retaining these read-only monitoring semantics. Staff use existing reviewed correction workflows when a record is wrong. The school has no approved automatic-alert rule; automated case creation and messaging remain disabled.

## Database and verification

Migration `0013` adds one restricted security-definer read function and the `attendanceMonitor` access-log resource. It reuses the register's context, so since migration `0023` it takes the academic lock and its section's lock shared and runs alongside other reads; it also reuses the shared year lock, corrected timeline resolver and access predicates. The range and filter/page limits are validated again inside PostgreSQL. Timelines and date cells are materialized once per read; matching records are selected before building the bounded page. The API computes deterministic classification and summary from that ordered evidence. Runtime statement/lock timeouts remain in force.

Successful API reads log only the returned enrollment IDs and request metadata, including an empty-ID event when no records match. No names, raw queries or summary payloads are copied into generic logs. Tests cover absence-run barriers, partial sessions, unknown/ADM modes, corrected and withdrawn/voided membership, current teacher privacy, retained identities, correction refresh, frozen-month display, 101-member pagination across 31 dates, direct-SQL denial and date boundaries. Hosted checks and deployment evidence are recorded in [deployment](deployment.md).
