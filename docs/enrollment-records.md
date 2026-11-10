# Section 2B.4: reviewed annual enrollment record corrections

Principals and administrative officers can void an annual enrollment entered in error and review restoration of a mistakenly voided record. Teachers cannot perform these operations or read their history. These are EDUNEXUS record corrections; they do not update DepEd LIS or represent school approval of an external enrollment change.

## Record validity and learner status

`record_state` is `valid` or `voided`, independently of the learner's `status` (`enrolled` or `withdrawn`). Voiding means the annual record should not count. It does not mark a child withdrawn, transferred, dropped out, or deceased, and it does not invent a movement date. Use the movement workflow for real withdrawals and the timeline workflow for historical date/section corrections.

Voiding preserves the enrollment UUID, original learner ownership, grade, section, dates, status, movement rows, and timeline correction snapshots. Only record validity, version, and update timestamp change. A separate immutable event records the review and its evidence. Restoration returns the same record to valid state without reconstructing or deleting its history. Both operations advance its version.

Default enrollment lists include only valid records. Managers can filter `record_state=voided` or `record_state=all` and read any record by ID. Teachers cannot see voided enrollments, even by direct ID or by changing list filters; associated learner visibility disappears unless another valid assigned enrollment grants it. Manager learner profiles remain available.

`GET /enrollments/:id/timeline` and `/history` include `record_state` and `usable_for_reporting`. A voided timeline remains readable as historical evidence, with `usable_for_reporting=false`; its entries must not contribute to future attendance or reports. `true` only means the enrollment is valid, not that a report has been finalized or approved. Use the corrected `/timeline`, not original `/history`, for date calculations. Voided records reject movements and timeline corrections until restoration.

## Preview, confirmation, and history

All routes below are under `/api/v1` and require an active manager.

| Route | Purpose |
|---|---|
| `POST /enrollments/:id/record-review/preview` | Review the complete proposal and detect conflicts without changing enrollment/history |
| `POST /enrollments/:id/record-review` | Confirm the unchanged preview atomically |
| `GET /enrollments/:id/record-review` | Read immutable review snapshots, newest first |

Example duplicate-record preview:

```json
{
  "version": 1,
  "action": "void",
  "reason_code": "duplicate_record",
  "replacement_enrollment_id": "00000000-0000-4000-8000-000000000010",
  "reason": "Synthetic example: verified against the retained school record."
}
```

Use `action: "void"` with `reason_code: "incorrect_entry"` and no replacement for a record entered in error without a retained duplicate. Use `action: "restore"`, `reason_code: "restoration"`, and no replacement to reverse a void. Reasons must be 10–500 characters of single-line text. All other combinations are rejected in both SQL and HTTP.

The preview shows the original and currently retained profiles, enrollment state, resolved timeline, school year, related annual records, dependent voided records, and optional retained enrollment/profile/timeline. Enrollment objects **inside these historical review snapshots** use the original stored `learner_id`; the separate `learner` profile represents the currently retained identity, and `recorded_learner` represents original ownership. This differs from ordinary enrollment API projections, whose `learner_id` is the retained ID and `recorded_learner_id` is original ownership.

Display every issue. Enable confirmation only if `can_commit=true` and `review_hash` is present. Send the same request with that hash and `reviewed: true`. The database binds review to the actor, reason, both record contexts, resolved timelines, relevant profiles and year, related enrollments, and current replacement dependencies. A change requires fresh review. This is review by the acting manager, not a second-person approval queue.

History includes the full protected `review_snapshot`, resulting enrollment version, action/reason, retained enrollment ID if applicable, actor, request ID, and timestamp. Pagination uses `limit` (default 5, maximum 10) and `before_version`; use `next_before_version` for the next page. Lost confirmation responses should be checked against history by review hash and actor. A stale retry returns 409 rather than another event.

## Resolving duplicate annual records

1. Inspect both annual records and their effective timelines. Identify the correct retained enrollment using verified school records. Where legitimate movements are missing from that retained timeline, use the existing timeline review to repair it first.
2. Preview and confirm voiding the erroneous record with `duplicate_record` and the retained enrollment ID. Both must be in the same year; the retained record must be valid and distinct. The retained profiles must agree on birth date and sex, and must not have conflicting assigned LRNs. A retained record may be withdrawn: it is still a valid annual record.
3. Separately review the [learner identity link](learner-identity.md). Only valid annual records now cause overlap conflicts; voided history remains visible in the identity preview. No identity link or transfer of movements occurs automatically during voiding.

An enrollment currently named as the retained record by a voided duplicate cannot itself be voided (`REPLACEMENT_IN_USE`). Review restoration of its dependent records first. If those identities were linked, reversal of that identity link may be needed before restoration; review each step and resolve annual conflicts. This prevents chains of voided replacement records.

Restoration is blocked if any valid enrollment already exists for that retained identity in the same year, including a withdrawn enrollment or one originally attached to a linked profile (`ANNUAL_ENROLLMENT_EXISTS`). It is also blocked if the preserved enrollment date no longer follows the retained birth date (`BIRTH_DATE_CONFLICT`). Profile date checks ignore voided records, so a subsequent verified profile correction can create such a restoration conflict. Correct the verified profile or retain the voided record as evidence and create the correct annual enrollment; do not rewrite history to force restoration.

Other preview issues are `YEAR_CLOSED`, `RECORD_STATE_UNCHANGED`, `INVALID_REPLACEMENT`, and `REPLACEMENT_IDENTITY_CONFLICT`. Preview can display them; confirmation returns `ENROLLMENT_RECORD_CONFLICT`. Voided records reject ordinary mutations with `VOIDED_ENROLLMENT_READ_ONLY`. Closed years reject both voiding and restoration, including proposals reviewed before closure.

## Database, imports, and compatibility

A partial unique index enforces one valid record per original learner/year, and the identity guard extends that rule across linked profiles. Withdrawn valid records still count. Historical voided rows remain indexed and FK-protected. PostgreSQL supports uniqueness over a selected subset of rows through [partial unique indexes](https://www.postgresql.org/docs/current/indexes-partial.html).

The commands revalidate under the shared registry advisory lock and school-year/learner/enrollment locks. An immutable event and its exact transaction/version authorize the state update and prevent a fabricated movement event. A failed update rolls back the snapshot, state, and audit together. The runtime cannot directly write enrollment validity or review history. [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html).

Imports exclude voided records when checking annual occupancy and can create a corrected enrollment after a void. Previously committed import receipts remain unchanged. Replaying such a receipt returns its original IDs even if an enrollment was later voided; inspect current enrollment state rather than treating the receipt as a current roster. Identity review hashes include record validity/version, and void/restoration invalidate prior timeline reviews through enrollment version changes.

Review endpoints audit disclosed enrollment IDs, including retained, related, and dependent records, in batches of at most 100. General audit logs contain changed field names without copying profiles or reasons. Full evidence belongs only in manager-protected review history and must be cleared from frontend memory on sign-out.

Migration `0008` preserves all existing rows and defaults them to valid. After voids exist, code predating API 0.6.0 would misinterpret these records; roll back using a compatible release. Do not delete review events, disable guards, or reapply an older uniqueness constraint to simulate rollback.

Automated coverage includes SQL/HTTP authorization, validity and roster changes, restoration, duplicate linking, preserved corrected timelines, import receipts, stale/competing reviews, forced rollback, and closed years. Hosted checks and release details are in [deployment](deployment.md). These operations remain API-only. [Grade-placement corrections](grade-placement.md) are implemented separately. [Classroom attendance](daily-attendance.md) now rejects void confirmation while non-null marks exist; review and clear those marks before voiding. [Submitted/locked months](monthly-attendance.md) additionally reject void/restoration that changes frozen membership, even without marks. Return/reopen affected months before repair. School-reviewed sample mappings, additional learner fields, grades/forms, real authenticated load, restore testing and school UAT remain outstanding.
