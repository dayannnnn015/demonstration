# Section 2B.2: controlled enrollment timeline corrections

Principals and administrative officers can correct an open-year enrollment timeline after reviewing a before/after preview. Teachers retain read-only access to their current assigned learners and cannot read or change historical timelines. This increment does not merge learner identities, cancel an entire annual enrollment, change its learner/year/grade, reopen closed years, or calculate attendance and official forms.

## Effective history and original records

`GET /api/v1/enrollments/:id/timeline` is the effective history: it returns the enrollment `version`, ordered `entries`, and `latest_correction_id`. Before the first correction, entries come from original movement events. After a correction, they come from the latest immutable correction snapshot plus any ordinary movements recorded afterward. Future attendance/reporting work must use this resolved history, not the latest enrollment row alone or the original-event table alone.

`GET /api/v1/enrollments/:id/history` still returns original movement records and their actors/request metadata. Its response now explicitly includes `interpretation: "original_movements"`, `timeline_version`, and `has_corrections`. An original movement can be superseded by a correction; it is never physically removed or rewritten. Correction versions do not generate fictional movements, so original event version numbers can contain gaps.

The enrollment row remains the latest effective state. Updating a historical date increments its version even if its latest section/status remains unchanged. The shared read lock keeps the returned effective timeline consistent with its enrollment version.

## Preview and confirmation

Fetch the effective timeline, edit its entries, and POST to `/api/v1/enrollments/:id/timeline/preview`:

```json
{
  "version": 1,
  "entries": [
    {
      "event_type": "enrolled",
      "effective_on": "2026-06-02",
      "section_id": "00000000-0000-4000-8000-000000000010",
      "reason": "regular"
    }
  ],
  "reason": "Synthetic example: initial enrollment date checked against school records."
}
```

The example UUID is a placeholder. Supply the existing enrollment's complete proposed sequence, not just the changed rows. The separate top-level reason explains the correction; entry reasons describe school events. The API accepts 1–1000 entries and a 10–500 character, single-line correction reason. Only the two timeline preview/correction POST routes accept JSON bodies up to 256 KiB; all other routes keep the 32 KiB limit. Existing school-year bounds and strictly increasing dates also limit the possible sequence length.

The preview performs no enrollment or correction writes. It returns normalized `before_entries` and `after_entries`, previous/proposed latest states, the school year, relevant sections/advisers, learner version, `first_affected_on`, and `review_hash`. `first_affected_on` is the earliest date among entries differing between the two sequences; it is a conservative review boundary, not a recalculated attendance or SF4 result. Successful preview reads are access-audited.

Show the before/after sequence, target sections, latest-state effect, date boundary, and correction reason to the manager. Confirmation POSTs to `/api/v1/enrollments/:id/timeline/corrections` with the preview's `version`, `after_entries` as `entries`, `reason`, `review_hash`, and `reviewed: true`.

The database reuses the same validator, rebuilds the preview under locks, and compares its SHA-256 fingerprint. It binds the proposal/reason, acting manager, enrollment and learner versions, school-year version, and every section/adviser version involved in the before/after sequence. Changes require another preview. The fingerprint uses PostgreSQL's canonical JSONB representation and built-in SHA-256; it is a change-detection value, not an authorization credential or proof of a second person's approval. [PostgreSQL JSON functions](https://www.postgresql.org/docs/current/functions-json.html), [SHA-256 functions](https://www.postgresql.org/docs/current/functions-binarystring.html).

Unlike stored roster-import previews, timeline review is stateless and has no separate expiry window. Current authorization and all rules are rechecked on commit. The acting manager confirms their own review; no second-person approval queue is implemented. Whitespace around the correction reason and JSON property order do not change the normalized proposal.

## Timeline rules

- The first entry must be `enrolled`, with reason `regular` or `transfer_in`. At least one entry must remain. Its date falls within the year and after birth. Future initial dates remain allowed for class preparation, consistent with ordinary enrollment.
- Subsequent dates strictly increase, fall within the year, and cannot be future-dated in Asia/Manila. Array order is meaningful; the API does not silently sort entries. Same-day repair means replacing the erroneous effective state, not adding two transitions on the same date.
- Every section belongs to the enrollment's existing year and grade. A correction cannot perform a promotion or move records into a different academic year.
- `reassigned` requires currently enrolled status, a different section, and reason `section_change`.
- `withdrawn` keeps the preceding section and requires enrolled status with reason `transfer_out`, `withdrawal`, `dropout`, or `death`.
- `reentered` requires withdrawn status, a same-year/grade section, and reason `return_to_school`. Reentry after a death record is invalid; correct an incorrectly recorded death through review first.
- Removing a mistaken movement or adding a missed historical movement is permitted only when the entire resulting sequence remains valid. Unchanged proposals are rejected.
- Closed years remain immutable. [Classroom attendance](daily-attendance.md) now blocks a committed timeline change that would invalidate existing non-null marks. Review and clear affected marks before repair and re-recording; preview can succeed before this constraint rejects confirmation. [Submitted/locked months](monthly-attendance.md) additionally block changes to frozen membership even without marks; return/reopen affected months before repair. Grades and issued forms still need their own dependency and release rules.

Date conventions remain subject to school review before official-form arithmetic is implemented. These rules do not claim to replace DepEd reporting policy.

## Atomicity, access, and recovery

Preview/commit use the existing shared registry transaction lock, then lock the year, learner, and enrollment. They serialize with ordinary enrollment movements, imports, profile edits, and relevant staff/section changes; year closure is blocked by the year lock. Current-version checks prevent competing corrections or movements from overwriting each other. A lock timeout returns a retry conflict rather than a partial save.

Commit inserts an immutable `enrollment_corrections` row containing before/after entries, affected date, reason, actor, request ID, review fingerprint, and resulting enrollment version. It also records section references with foreign keys, then updates the enrollment projection in the same transaction. Any failure rolls back all snapshots, references, projection changes, and ordinary audit writes. Original movement events remain intact. A transaction-bound correction intent prevents the projection update from inventing a movement; a session flag cannot suppress ordinary history.

`GET /api/v1/enrollments/:id/timeline/corrections` returns snapshots newest first, with `limit` 1–10 (default 5) and a `next_before_version` cursor passed as `before_version`. Teachers cannot retrieve these snapshots through the API or SQL. Runtime users cannot directly insert/update/delete snapshots, their section references, or enrollment state. Narrow database functions enforce manager authorization; the internal resolver is owner-only. Database operators and the verified backend remain trusted boundaries.

Timeline reads, preview, successful correction responses, and correction-history retrieval record the enrollment UUID and request metadata in the protected access log. Raw snapshots, review text, and profile fields are not copied into HTTP/access logs. Correction snapshots themselves are protected school records; their retention policy requires school approval.

Errors include `VERSION_CONFLICT`, `TIMELINE_DATES`, `TIMELINE_TRANSITION`, `TIMELINE_SECTION`, `TIMELINE_UNCHANGED`, `TIMELINE_REVIEW_CHANGED`, and `YEAR_CLOSED`. On conflict, fetch the latest timeline and reconcile the proposed change. A repeated successful correction request returns a version conflict; it does not create another snapshot. If a response is lost, inspect correction history for the same `review_hash`/actor and inspect the latest timeline before deciding what to do. Do not automatically reapply against a newer version.

## Validation and remaining work

Tests cover initial-date/section repair, inserted/removed history, subsequent ordinary movements, repeated corrections, raw-event preservation, teacher access changes, invalid dates/transitions/sections, review drift, concurrency, rollback, SQL boundaries, section references, read audit, closed years, and a 260-entry timeline above the ordinary body-size limit. Hosted results are recorded in [deployment](deployment.md).

[Section 2B.3](learner-identity.md) now reconciles duplicate identities through reversible links. Timeline previews expose retained `learner_id` and original `recorded_learner_id`, use the retained birth date, and bind the hash to the retained profile version. Original correction snapshots remain unchanged. [Section 2B.4](enrollment-records.md) adds reviewed void/restoration. Timeline/history responses now expose `record_state` and `usable_for_reporting`; retained entries from a voided record must not count toward reports. Voided records reject timeline edits and movements until restored. [Section 2B.5](grade-placement.md) now shares the correction journal for reviewed whole-year grade changes. Correction responses include `correction_kind` and previous/corrected grades (nullable for legacy timeline records); effective timeline responses include current grade/year. School sample mappings, additional fields, frontend screens, real authenticated integration/load testing, backup restoration, and UAT remain further work.
