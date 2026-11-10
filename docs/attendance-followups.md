# Section 3B.4: manual attendance follow-up

Principals and administrative officers can open and track follow-up cases from recorded absences or unresolved attendance recording. The user confirmed that **the school has no approved automatic-alert rule**. Automatic alerts, threshold classifications and messaging remain disabled. These cases are manual staff decisions, not dropout determinations or official attendance totals.

## Access and responsibilities

Every case endpoint is manager-only. Teachers cannot read case queues, reasons, snapshots or history, including cases involving their assigned learners. Assignees must be active principals or administrative officers. Any active manager can review a case action; ownership organizes responsibility and does not grant exclusive edit rights or require two-person approval.

Suspending or changing the role of an assignee does not delete or transfer their cases. Other managers can find that person's queue and explicitly reassign the work. A new preview must name an active managerial assignee before it can be confirmed. Existing school staff protections remain unchanged.

## Opening a case

Use `POST /api/v1/enrollments/:id/attendance-follow-ups/preview` with `section_id`, `from`, `to`, `category`, `assignee_user_id`, nullable `due_on` and a single-line `reason` of 10–500 characters. The inclusive range is 1–31 nonfuture dates within that section's school year. The year must be active, the annual record must have eligible membership in the range, and the selected category must have matching evidence:

| Category | Required evidence |
|---|---|
| `absence` | At least one explicitly absent classroom session. |
| `recording_gap` | Missing classroom marks, an unconfigured eligible date or unsupported alternative-delivery sessions. |

Missing entries are never treated as absence. ADM remains unsupported evidence requiring review. Matching evidence makes a manual case possible; it does not automatically open one or mandate a school intervention. Counts are raw observations, not official credits.

The preview contains the exact enrollment's current dates, minimal names, original and retained identity IDs, calendar/monthly context, source versions, counts, proposed owner and reason. Review these before sending the identical proposal with `review_hash` and `reviewed=true` to `POST /api/v1/enrollments/:id/attendance-follow-ups`.

There may be only **one open case per annual enrollment**, across categories and date windows. A closed case may coexist with a newer case. Blocked previews return `can_commit=false`, a null hash and issues such as `OPEN_CASE_EXISTS`, `NO_MATCHING_EVIDENCE`, `NO_ELIGIBLE_MEMBERSHIP` or `YEAR_NOT_ACTIVE`. Confirmation rechecks the source, actor, owner version and proposal under the registry lock. A successful opening returns an immutable event containing `case_id`, version, actor and request ID.

## Case actions

Read `GET /api/v1/attendance-follow-ups/:id`, then preview an action with `POST /:id/preview`. Supply the current case `version`, `action`, full proposed `assignee_user_id`, nullable `due_on` and `reason`. Confirm with the unchanged hash and `reviewed=true` at `POST /:id/events`.

| Current status | Action | Result |
|---|---|---|
| `open` | `update` | Remains open; records a note, owner change or due-date change. |
| `open` | `resolve` | Becomes resolved. |
| `open` | `cancel` | Becomes cancelled. |
| `resolved` or `cancelled` | `reopen` | Becomes open if no other case for the enrollment is open. |

An update may intentionally keep the same owner/date and add a reviewed note. Every action advances the case version once and preserves its reason and reviewed current evidence. Resolution records the manager's decision; it neither asserts that every absence was corrected nor rewrites attendance. Cancellation preserves mistaken/duplicate case history. Reopening is a managerial decision and does not require current evidence to still match the original category.

New or changed due dates cannot be in the past in Asia/Manila. An already elapsed due date may be retained during an update. Clear `due_on` when resolving or cancelling; reopening requires a new current/future date or null. `overdue` means an open case with a due date earlier than today. No reminders are sent.

## Historical and current evidence

Each case preserves immutable `opening_evidence` and its hash. Details return `current_evidence`, `evidence_changed` and `overdue` alongside the record. Evidence format version `1` holds raw scoped marks/calendar and absence/gap counts. Its nested `source=live` describes where the evidence was collected; the stored opening copy is historical. Opening evidence is never overwritten by an update or reopening.

The comparison binds full captured context, so changes to names, profile/enrollment versions, calendars, monthly state, section metadata or year status can mark evidence changed even when the raw absence count is unchanged. A void or correction removing eligible membership returns `available=false` and a null current member while retaining the opening evidence. Case list names resolve the current retained profile; captured names and original ownership remain in history.

Case existence does not freeze attendance, identity or enrollment records. Existing monthly and daily dependency guards still control those edits. After source correction or year closure, existing cases remain readable and actionable so managers can document, resolve or cancel outstanding work. New cases require an active year. Case actions do not reopen the school year or unlock monthly attendance.

After any conflict, refresh and review again. There are no automatic replay receipts. If a response is lost, inspect case history for the actor, request ID and review hash before attempting another action. Do not silently retry with a new version/hash.

## Queue and history

`GET /api/v1/attendance-follow-ups` requires `academic_year_id`. Optional filters are `status=open|resolved|cancelled|all` (default open), `section_id`, `assignee_user_id` and `overdue_only=true|false` (default false). Filtering precedes UUID pagination; `limit` defaults to 50 and is at most 100, with `after_id` for the next page. The section filter refers to the case's original section, even after a learner moves. Pages show current minimal names and task metadata, without opening evidence or reasons. They are live queues, not point-in-time exports.

`GET /api/v1/attendance-follow-ups/:id/events` returns newest-first immutable history. `limit` defaults to 5 and is at most 10; use `before_version` for older events. Each event includes the reviewed before-state, current evidence, proposed action/owner/date, reason, actor and request ID. Clear protected data on sign-out and render names/reasons as text. Since 0.32.0 the Follow-up cases screen (`web/screens/Followups.tsx`) is the manager's interface to all of this; see [frontend integration](frontend-handoff.md).

## Storage and verification

Migration `0014` adds cases and append-only event tables, composite year foreign keys, a partial unique index for open annual cases, queue/FK indexes, manager-only RLS and SELECT-only runtime grants. Only validated commands mutate cases or events. The existing monitor implementation is shared through a private helper with an exact enrollment parameter; ordinary monitoring keeps its previous contract and privacy rules. Case opening never relies on a first-page learner lookup.

All actions revalidate under the existing registry advisory lock and year lock. External authentication calls remain outside the transaction. Case/event/audit writes commit or roll back together. Successful API access logs contain returned case IDs, or the selected enrollment ID for an opening preview, and request metadata; protected names/reasons/evidence are not copied into generic logs. No case deletion endpoint exists.

Tests cover evidence/category checks, current/recorded identity, missing/ADM data, manager/privacy boundaries, active assignees, due dates, lifecycle and competing writes, duplicate/reopening conflicts, source changes, void/closure resolution, frozen-month independence, journal-failure rollback and exact lookup/queue pagination beyond 100 records. Hosted release evidence is recorded in [deployment](deployment.md). Threshold-based automation, school follow-up procedures and retention approval remain future work.
