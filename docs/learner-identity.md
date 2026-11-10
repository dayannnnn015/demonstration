# Section 2B.3: reviewed learner identity reconciliation

Principals and administrative officers can associate duplicate profiles with a retained learner and reverse that association. Teachers cannot preview, confirm, or inspect reconciliation history. Matching names alone never trigger a link. The acting manager must verify school records, review both profiles and enrollment summaries, and provide a reason. This is not a second-person approval queue.

## Preserving identity and history

Both learner rows remain. The duplicate's `merged_into` points to the retained profile; `identity_revision` and `version` advance on both profiles. The linked profile is frozen against profile changes, LRN assignment/correction, and new enrollments. No names, LRNs, birth dates, or sex values are automatically copied or overwritten.

Existing enrollments retain their original physical `learner_id`, UUIDs, versions, and histories. Enrollment API responses expose the currently retained identity as `learner_id` and the original as `recorded_learner_id`. Use `learner_id` for current roster display and `recorded_learner_id` for provenance. Filtering enrollments by the retained learner includes visible enrollments from its linked profiles. A filter by a linked ID addresses that profile's original enrollments.

Ordinary learner lists hide linked profiles. Managers can request `include_linked=true` or read a linked profile by ID to inspect its pointer. Teachers see the retained learner only through their own current enrolled, open-year assignments; they cannot read linked profiles or another teacher's enrollment. A link does not broaden enrollment row visibility.

## Review and confirmation

1. `POST /api/v1/learner-reconciliations/preview` with `canonical_id`, `duplicate_id`, both current versions as `canonical_version` / `duplicate_version`, `action: "link"` or `"unlink"`, and a single-line reason of 10–500 characters.
2. Review the returned profiles, `member_ids`, enrollment summaries, school years, `issues`, and `conflicting_year_ids`. Enable confirmation only when `can_commit=true` and `review_hash` is present.
3. `POST /api/v1/learner-reconciliations` with the unchanged request, returned `review_hash`, and `reviewed: true`.
4. Refresh both profiles and affected rosters. `GET /api/v1/learners/:id/identity-history` returns immutable snapshots, actor, reason, request ID, and review hash. Pagination uses `limit` (default 10, maximum 20), `offset`, and `has_more`; it is a live list, so concurrent insertions can shift offsets.

The database generates the SHA-256 hash over the proposal, actor, both profiles, group membership, enrollment versions/state, and school-year versions. It rebuilds that review under the shared registry lock before confirmation. The hash is a consistency check, not an authentication credential. Profile version conflicts and changed review context require a fresh preview. A lost confirmation response should be checked against history using the hash and actor; retrying stale versions returns 409 rather than a second event.

## Conflicts and reversal

| Issue | Required resolution |
|---|---|
| `SOURCE_HAS_LRN` | The duplicate must have no assigned LRN. Retain the correctly identified LRN-bearing profile where appropriate; separately verify conflicting assigned LRNs. This workflow never clears one. |
| `IDENTITY_FIELDS_DIFFER` | Verify and separately correct birth date or sex before linking. Name variations remain visible for manager review. |
| `OVERLAPPING_ENROLLMENT_YEARS` | Resolve conflicting valid annual records through [reviewed voiding](enrollment-records.md) when entered in error. A valid withdrawn enrollment still counts; a voided record does not. |
| `TARGET_IS_LINKED`, `SOURCE_IS_LINKED`, `SOURCE_HAS_LINKS` | Resolve existing associations first. Chains and cycles are prohibited; a retained profile can have multiple linked duplicates. |
| `LINK_NOT_FOUND` | Reload the current association before reversal. |
| `BIRTH_DATE_CONFLICT` | Correct the verified date/history conflict before proceeding. |

Reversal uses `action: "unlink"`, naming the current retained profile and its linked duplicate. It restores the original separate identity without deleting the link event or undoing later profile edits, enrollment movements, or timeline corrections. If a later correction used the retained birth date to place enrollment before the frozen duplicate's birth date, reversal is blocked until that conflict is resolved.

Closed-year enrollments can be associated because their rows and timelines do not change. They remain closed to movements and timeline corrections. Linking/unlinking or changing the retained profile invalidates affected timeline reviews; timeline validation uses the retained learner's birth date. The one-valid-enrollment-per-year constraint covers the entire linked group. Preview enrollment summaries include `record_state`; voided records remain in the preview and hash but do not block identity links through annual/date conflicts. Restoration rechecks the full identity group.

Roster import matching checks linked names but returns the retained profile as the candidate. Existing-profile CSV data must still match the retained values. Old linked IDs cannot be selected as an existing learner, and enrollment checks include the group's original records. Previously committed import receipts and correction snapshots remain historical records with their original IDs.

## Protection and verification

The runtime cannot directly change identity pointers/revisions or insert, modify, or delete reconciliation events. Reviewed database commands create an event and update both profiles in one transaction; a failed final update rolls back the entire operation. History is manager-only. Read-access logs contain disclosed learner IDs; general audit logs contain field names, without copying the sensitive profile snapshots.

Automated API/PostgreSQL tests cover authorization, preserved history, roster visibility, conflicts, imports, stale/competing requests, reversal, timeline interactions, closed years, and forced rollback. Hosted release evidence is recorded in [deployment](deployment.md). School acceptance, real authenticated workflows, concurrent hosted load, and restore testing remain outstanding. These endpoints are API-only; learner/reconciliation screens are still to be built.

Code predating API 0.5.0 does not understand retained identity mappings. After links exist, deploy a compatible release for rollback; never delete identity events or rewrite the original enrollment ownership to simulate rollback.

## Frozen monthly attendance

[Section 3B.2](monthly-attendance.md) rejects link/reversal if either profile is an original or retained member of any submitted/locked snapshot. Return or reopen all affected months before reconciliation, then review and resubmit. Confirmation can encounter this dependency after an otherwise valid preview. Ordinary displayed-name corrections remain allowed and do not rewrite frozen names or original ownership.
