# Section 4A.5: assessment-policy offering binding

An [adoption](assessment-policy-adoptions.md) says the school stands behind one policy revision for one school year. It does not say where that revision applies. Binding is that statement: a manager records that a standing adoption governs one [section subject offering](section-subjects.md).

Binding still computes nothing. There is no score, component total, rounding, transmutation, MPS, GWA or grade at any endpoint in this increment. A binding is a scoping record that a later, separately verified calculation increment can read.

## Binding data

- `offering_id` and `offering_version` identify the exact offering revision a manager reviewed. `adoption_id` and `adoption_version` do the same for the adoption. A stale version on either side returns 409, so a binding is never recorded against something that changed under review.
- `section_id` and `academic_year_id` are copied from the offering, with a composite foreign key keeping them consistent with the section.
- `status` is `bound` or `released`, with a version and timestamps.

A bind is refused unless all of the following hold. The adoption is standing, not withdrawn. The offering and the adoption belong to the same school year. The offering is active. The section's grade level is one of the adopted revision's grade levels — which excludes Kindergarten, because the draft model does.

At most one **standing** binding exists per offering. Released rows stay as evidence and do not occupy that slot, so an offering can be bound again, including to a different adoption. Two offerings in the same section may be governed by different adopted policies, which is how a school with different weightings per learning area would express it.

## Release, and what a standing binding protects

Release is the only state change a binding accepts. It requires the current binding version and a reason, and it happens once. Nothing edits a binding in place: correcting a mistaken binding means releasing it and recording a new one, which preserves the original evidence.

A standing binding is a live statement that an adopted revision governs an offering, so the records underneath it cannot be pulled away:

| Attempted change | Result |
|---|---|
| Withdraw an adoption with standing bindings | `ADOPTION_BOUND` (409) — release the bindings first |
| Retire an offering with a standing binding | `OFFERING_BOUND` (409) — release the binding first |
| Archive a draft with a standing adoption | `POLICY_DRAFT_ADOPTED` (409), from Section 4A.4 |

Together these keep the chain draft → adoption → binding consistent from either end. Closed school years are read only: neither binding nor release is available, and existing rows remain readable as evidence.

## API

| Operation | Contract |
|---|---|
| `GET /api/v1/assessment-policy-bindings` | `status=bound\|released\|all` (default bound), UUID `academic_year_id`, `section_id`, `offering_id`, `adoption_id`, `after_id`, `limit` default 50/max 100. Filters precede pagination. |
| `GET /api/v1/assessment-policy-bindings/:id` | One binding. |
| `POST /api/v1/assessment-policy-bindings` | Explicit offering, offering version, adoption, adoption version and reason. |
| `POST /api/v1/assessment-policy-bindings/:id/release` | Current binding version and reason. |
| `GET /api/v1/assessment-policy-bindings/:id/events` | Newest-first history, `limit` default 5/max 10, `before_version`. |

Every operation requires an active manager. Teachers have no access to bindings, adoptions or drafts. Since migration `0024` an adviser can read one narrow thing instead: the component codes and names of the policy bound to an offering of their own section, without its weights, through `GET /section-subjects/:id/assessment-components` — see [assessment tasks and raw scores](assessment-scores.md).

A duplicate standing binding returns `ALREADY_EXISTS` (409), a withdrawn adoption or already-released binding returns `BINDING_STATE` (409), and a year, grade or active-state mismatch returns `BINDING_SCOPE` (409). On a conflict, refresh and decide again; after a lost response, inspect history before binding a second time.

## Storage and validation

Migration `0019` adds manager-only RLS and SELECT-only runtime grants on both tables, a partial unique index for the standing binding, and manager-checking writers. The shared academic setup lock serializes mutations and the school year is locked for share while its status is read. Each save atomically writes the binding row, the before/after journal entry with actor, reason and request ID, and the change audits.

The same migration replaces the Section 4A.4 adoption writer and the Section 4A.2 offering writer to add the two guards above. Migrations `0016` through `0018` are unchanged, and both replaced functions keep all of their existing behavior.

Ten focused tests cover the recorded binding and journal, every scope rule, cross-year refusal, the standing-binding index and rebinding, versioned one-way release with history pagination, both protection guards in HTTP and SQL, closed-year read-only behavior, manager isolation, complete journal-failure rollback, and filtered pagination with no score or calculation surface.

## Next increment

[Section 4B.1](assessment-scores.md) now records named assessments and raw learner marks against a bound policy. Calculation remains blocked by the **grading enclosure and ECR examples** gate in [constraints](constraints.md). When the school supplies the current enclosure and its own ECR examples, the binding records here identify which policy applies to which offering, and calculation can be built and verified against approved fixtures.
