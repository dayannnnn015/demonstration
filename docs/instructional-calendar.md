# Section 3A: instructional calendar

The calendar defines the expected AM and PM schedule before attendance is recorded. Principals and administrative officers configure it through reviewed changes. Active teachers can read the school schedule and the effective schedule of sections they currently advise. The manager-facing screen is `web/screens/Calendar.tsx`, which reads one month at a time and drives the preview-and-confirm workflow below; teachers have no calendar screen yet. [Section 3B.1](daily-attendance.md) now records classroom AM/PM attendance; [Section 3B.2](monthly-attendance.md) adds monthly submission and locking. Official attendance arithmetic remains unimplemented.

## Explicit dates and session modes

No school dates, official holidays, weekends or suspension notices are seeded. The school must supply its approved calendar. Missing dates and cleared school dates have `configured=false`, null session fields and `source=unconfigured`. They must remain visibly unknown. Do not infer absence, a holiday, or an instructional day from an unconfigured date.

Each configured date has a label and two explicit session modes:

| Mode | Meaning |
|---|---|
| `classroom` | Classroom instruction is scheduled. |
| `alternative_delivery` | Learning is scheduled through an alternative delivery mode. |
| `no_class` | No session is scheduled. |
| `suspended` | The session is suspended without a configured alternative delivery session. |

`regular` and `makeup` dates require at least one classroom or alternative-delivery session and cannot contain `suspended`. `holiday`, `school_break` and `weekend` dates require both sessions to be `no_class`. `suspension` dates require at least one suspended or alternative-delivery session. `other` permits the explicit combination selected by the manager. Labels contain 1–120 characters and reasons 10–500 characters, both single-line; the HTTP contract counts JavaScript UTF-16 code units and the database checks text length separately. The 32 KiB UTF-8 request limit also applies.

AM-only and PM-only schedules are supported. Summary fields count requested/configured/unconfigured dates and session modes; they do not assign half-day attendance credits or calculate SF2/SF4 totals.

DepEd distinguishes learning continuity from suspension of classroom activities. The separate modes preserve that distinction without assuming attendance-credit rules. See [DepEd's suspension and learning-continuity guidance](https://www.deped.gov.ph/2024/12/27/deped-pushes-for-learning-continuity-amid-disasters-updates-class-suspension-guidelines/). The existing flexible reporting-period model can accommodate different term structures; this module does not seed dates from the [2026 three-term calendar clarification](https://www.deped.gov.ph/2026/05/04/deped-binigyang-diin-ang-istruktura-at-layunin-ng-three-term-school-calendar-bago-ang-implementasyon/). Obtain school-approved dates, notices and attendance examples before configuring real schedules or implementing official totals.

## School baseline and section exceptions

A schoolwide date is the baseline. A section override replaces that complete date, including both sessions, classification and label. It requires a configured school baseline for the same date. If no override exists, or it was cleared, the section inherits the current school date. Reads expose `source=school`, `section` or `unconfigured` for every requested date.

A change or clear of a school date is blocked while configured section overrides exist for that date. Preview returns `SECTION_OVERRIDES_PRESENT` and the affected section IDs. Review and clear those overrides first, change the baseline, then review any exceptions that are still necessary. Each step is separately reviewed and versioned. The intermediate effective schedules are visible; this is not an atomic schoolwide multi-scope closure operation. A missing baseline yields `BASE_DAY_UNCONFIGURED` for a section set. A blocked preview has `can_commit=false` and no review hash.

Clearing retains the database row as an unconfigured tombstone and preserves every review snapshot. It never deletes evidence. An entirely unchanged proposal is rejected; mixed batches write only changed dates.

## API workflow

All paths below are relative to `/api/v1/academic-years/:id/calendar`. Authenticate with an active staff bearer token.

| Method and path | Input and result |
|---|---|
| `GET /` | Required `from` and `to`, optional `section_id`. Returns effective dates, source, summary and `calendar_version`. |
| `POST /preview` | `version`, optional nullable `section_id`, `changes`, `reason`. Returns raw/effective before-and-after states, metadata, conflicts and review hash. Managers only. |
| `POST /corrections` | Same proposal with `review_hash` and `reviewed=true`. Atomically returns the committed journal event. Managers only. |
| `GET /corrections` | All-scope history for the year, newest first. `limit` defaults to 5, maximum 10; continue with `before_version`. Managers only. |

Use the calendar path without a trailing slash for the read route. Read 1–62 consecutive dates inside the school year. A mutation contains 1–62 distinct dates inside the year; dates need not be consecutive. Larger periods require separate bounded requests. Read limits, change counts and byte limits are enforced independently.

Example preview body (synthetic date; not an official calendar):

```json
{
  "version": 0,
  "section_id": null,
  "changes": [
    {"day_on":"2026-06-15","action":"set","am":"classroom","pm":"no_class","day_type":"regular","label":"Morning classes"}
  ],
  "reason": "Schedule checked against the approved school calendar."
}
```

A clear contains only `day_on` and `action=clear`. Show the returned before/after effective sessions, school/section context, reason and conflicts before confirming. Send the same normalized proposal and reason with the returned hash; the same manager must confirm it. This is review by the acting manager, not a second-person approval queue. Normalization trims labels/reasons and orders dates chronologically.

One calendar version covers all scopes within the year. An uninitialized calendar reads as version `0` without creating a root row. The first commit creates version `1`; every successful batch advances it once. This version is distinct from the academic-year version. Another school or section commit invalidates an earlier review. Changes to year/section metadata, actor, reason or proposed content also require a new preview. Closed years remain readable, but preview/commit are blocked.

On `VERSION_CONFLICT`, `CALENDAR_REVIEW_CHANGED` or a blocking conflict, reload and require a new review. The screen does this by discarding the hash and returning to the form. Commits do not have import-style retry receipts. If the response was lost, inspect history for the hash and actor before trying again. History spans all scopes and retains school/section metadata as it stood during review. A current teacher assignment authorizes calendar reads even for a closed year; calendar data contains no learner roster or marks.

## Persistence, locking and downstream work

Migration `0010` adds one version root per configured year, scope/date rows with partial unique indexes, and an immutable review journal. Runtime table privileges are SELECT-only; manager-checking database functions own writes. Private state-resolution helpers are not callable by the runtime. Section/year foreign keys prevent cross-year exceptions. RLS restricts section rows and hides history from teachers and unauthenticated actors.

Preview and commit acquire the existing registry advisory lock followed by the school-year row lock. Reads hold a shared year lock, so a response cannot mix dates across a calendar commit, including the first lazy initialization. Commit rebuilds and hashes the proposal, then writes the root, journal, changed dates and generic audit in one transaction. Failures roll back the entire batch. API calendar access logs contain the academic-year ID and operation, without copying schedule labels or reasons into generic logs.

Section 3B.1 integrates effective valid enrollment with the schedule and rejects calendar changes that would leave existing marks in non-classroom sessions. Review and clear affected marks before such a change; confirmation can reject a calendar preview with `ATTENDANCE_DEPENDENCY`. Submitted/locked months now block affected calendar edits, including labels. Return/reopen them before correction; school baseline edits are conservatively blocked while any affected section month is frozen. See [monthly dependency rules](monthly-attendance.md). Released reports and official arithmetic require further work. This does not certify official attendance arithmetic or replace school acceptance and operational recovery testing.
