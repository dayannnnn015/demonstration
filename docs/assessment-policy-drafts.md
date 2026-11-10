# Section 4A.3: assessment-policy drafts

Principals and administrative officers can prepare versioned weighted-assessment metadata for Grades 1–6. These records are **non-operational drafts**. There is no approval, publication, subject/offering binding or calculation endpoint. Teachers cannot read or change drafts. No policies or school data are seeded.

This deliberately separates drafting from school adoption. DepEd publishes [DO 8, s. 2015](https://www.deped.gov.ph/2015/04/01/do-8-s-2015-policy-guidelines-on-classroom-assessment-for-the-k-to-12-basic-education-program/) and its [DO 29, s. 2015 clarification](https://www.deped.gov.ph/2015/07/10/do-29-s-2015-clarifications-to-deped-order-no-8-s-2015-policy-guidelines-on-classroom-assessment-for-the-k-to-12-basic-education-program/). These are historical reference starting points, not a completed verification of the rules applicable to Balili's target school year. Current enclosures and school ECR examples must be reconciled before operational policy adoption. No default component names or weights are inferred from these references.

## Draft data

- Immutable normalized `code`: 1–24 ASCII letters/digits/underscore/hyphen, starting with a letter.
- Editable `name` (1–120 single-line characters) and `source_reference` (10–500 single-line characters). A source reference is supplied text, not proof of approval. The server does not fetch or execute it.
- Distinct `grade_levels` in 1–6. Kindergarten and descriptive assessment require a separate design and are excluded from this weighted draft model.
- 1–10 `components`, each with a distinct normalized code, name and integer `weight_basis_points` from 1–10000. The sum must equal exactly 10000, representing 100%; one basis point is 0.01 percentage point. This is a consistency constraint on proposed proportions, not a mandated school weighting scheme.
- `status=draft|archived`, version and timestamps. Both states are unapproved and non-operational. Metadata can be revised in either state; changing back to draft restores visibility in the default list. Archive does not delete history or free the code for reuse.

Grade arrays and component arrays are canonicalized by grade and component code. Reordering otherwise identical input is a no-op. Component codes are identifiers within a draft revision; a manager can revise them while drafting. Future adoption must preserve the exact accepted revision. These drafts contain no scores, assessment schedules, rounding, transmutation, missing-score treatment, passing thresholds or promotion decisions.

## API

| Operation | Contract |
|---|---|
| `GET /api/v1/assessment-policy-drafts` | `status=draft|archived|all` (default draft), literal code/name `q`, UUID `after_id`, `limit` default 50/max 100. Filters precede pagination. |
| `GET /api/v1/assessment-policy-drafts/:id` | Current draft metadata. |
| `POST /api/v1/assessment-policy-drafts` | Explicit code, name, source_reference, grade_levels, components, status and reason. |
| `PATCH /api/v1/assessment-policy-drafts/:id` | Current version, all editable metadata and reason; code is immutable. |
| `GET /api/v1/assessment-policy-drafts/:id/events` | Newest-first history, `limit` default 5/max 10, `before_version`. |

Every operation requires an active manager. Reasons use the same 10–500 single-line limit. Draft saves use optimistic versions and an atomic history write, without a separate preview/hash workflow. Conflicts require refresh; a lost response should be reconciled through history before retrying. API component/grade validation returns 422; direct SQL validation also protects stored state. Canonically unchanged saves return `POLICY_DRAFT_UNCHANGED` (409).

## Storage and validation

Migration `0017` adds manager-only RLS, SELECT-only runtime grants, private component validation and a manager-checking writer. Shared academic setup locks serialize mutations. Each save atomically writes before/after history, actor, reason, request ID and change audits. FK-backed history is indexed by policy/version and actor. Runtime direct writes and private-helper execution are denied. No learner data or permissions are introduced.

Ten focused tests cover canonical metadata, exact weights, malformed/direct SQL input, unsupported grades/approval, archive/history, version conflicts, manager isolation, complete journal-failure rollback, filtered pagination and absence of operational side effects. Retain draft roots and journals during application rollback. [Section 4A.4](assessment-policy-adoptions.md) now records reviewed immutable adoption of an exact draft revision. A draft with a standing adoption cannot be archived until that adoption is withdrawn; ordinary revisions stay allowed and never change a frozen snapshot. Remaining future work is offering binding, followed by separately verified calculation and score-entry rules.
