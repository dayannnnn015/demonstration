# Section 4A.4: reviewed assessment-policy adoption

Principals and administrative officers can record that the school adopted one exact [assessment-policy draft](assessment-policy-drafts.md) revision for one school year. An adoption is **immutable evidence of a school decision**. It is not a grading engine: no section subject offering is bound, no score is accepted, and no grade, average, MPS, GWA or transmutation is computed anywhere in this increment.

An adoption also does not certify that the content is correct. `adoption_reference` is the school's own record of the decision — a memorandum, minutes or issuance number — supplied as text. The server never fetches, executes or validates it. The current DepEd enclosure and the school's ECR examples still have to be reconciled before any calculation is built on an adopted revision. EDUNEXUS does not infer weights, rounding or Kindergarten behavior from an adopted draft.

## Why adoption is separate from drafting

Section 4A.3 lets a manager prepare proposals and revise them freely. Nothing there says which proposal the school stands behind. Adoption is that statement, and it has to survive later editing: a revision made after the decision must not silently change what was adopted.

So adoption copies the whole draft revision into `policy_snapshot` at the moment it is recorded. Editing the draft afterwards advances the draft's own version and history and leaves every existing snapshot untouched. Reading an adoption therefore always shows the content the school actually decided on, not the newest proposal.

## Adoption data

- `academic_year_id` must be a draft or active school year. Closed years neither adopt nor withdraw.
- `policy_id` and `policy_version` must identify the **current** revision of a draft whose status is `draft`. A stale `policy_version` returns 409, and an archived draft is refused: archiving retires a proposal, so it cannot be the thing the school stands behind.
- `adopted_on` is a calendar date inside that school year's `starts_on`/`ends_on` range.
- `adoption_reference` and `reason` are 10–500 single-line characters.
- `policy_snapshot` is the frozen draft record: id, code, name, source reference, grade levels, components, status and version, without timestamps. `grade_levels` is copied alongside it for filtering.
- `status` is `adopted` or `withdrawn`, with a version and timestamps.

Grade applicability comes from the adopted revision, which excludes Kindergarten by construction. At most one **standing** adoption exists per school year and policy; withdrawn rows stay as evidence and do not occupy that slot, so the same policy can be adopted again after a withdrawal. Two different policies may be adopted in the same year — which subjects or sections each governs is not decided here.

## Withdrawal

Withdrawal is the only state change an adoption accepts, it requires the current adoption version and a reason, and it happens once. A withdrawn adoption cannot be withdrawn again, and no route edits an adoption's date, reference or frozen revision. Correcting a mistaken adoption means withdrawing it, which preserves the original evidence, and recording a new one.

## API

| Operation | Contract |
|---|---|
| `GET /api/v1/assessment-policy-adoptions` | `status=adopted\|withdrawn\|all` (default adopted), UUID `academic_year_id`, `policy_id`, `after_id`, `limit` default 50/max 100. Filters precede pagination. |
| `GET /api/v1/assessment-policy-adoptions/:id` | Current adoption and its frozen revision. |
| `POST /api/v1/assessment-policy-adoptions` | Explicit school year, policy, current policy version, adoption date, reference and reason. |
| `POST /api/v1/assessment-policy-adoptions/:id/withdrawal` | Current adoption version and reason. |
| `GET /api/v1/assessment-policy-adoptions/:id/events` | Newest-first history, `limit` default 5/max 10, `before_version`. |

Every operation requires an active manager; teachers have no access to adoptions, drafts or their history. Adoption uses optimistic versions and an atomic history write, without a separate preview/hash workflow. On a conflict, refresh and decide again rather than retrying; after a lost response, inspect history before recording a second adoption. A duplicate standing adoption returns `ALREADY_EXISTS` (409), an archived or already-withdrawn target returns `ADOPTION_STATE` (409), and a closed year or out-of-range date returns `ADOPTION_YEAR` (409).

## Storage and validation

Migration `0018` adds manager-only RLS and SELECT-only runtime grants on both tables, a partial unique index for the standing adoption, and manager-checking writers. The shared academic setup lock serializes mutations and the target school year is locked for share while its status and dates are read. Each save atomically writes the adoption row, the before/after journal entry with actor, reason and request ID, and the change audits. Runtime direct writes and the private writer are denied.

The same migration replaces the Section 4A.3 draft writer so archiving a draft fails with `POLICY_DRAFT_ADOPTED` (409) while an adoption stands. Migration `0017` is unchanged; ordinary draft revisions remain allowed and never reach a frozen snapshot.

Ten focused tests cover frozen snapshots, revision independence, archived and stale targets, closed years and out-of-range dates, the standing-adoption index and re-adoption, versioned one-way withdrawal with history pagination, the archival guard in HTTP and SQL, manager isolation, complete journal-failure rollback, filtered pagination, and the absence of any binding, score or calculation surface.

## Next increment

[Section 4A.5](assessment-policy-bindings.md) now records which section subject offerings an adopted revision governs. A standing binding blocks withdrawal until it is released. Score entry, component arithmetic, rounding, transmutation, MPS, GWA and Kindergarten treatment stay out until the current enclosure and the school's ECR examples are independently verified with the school.
