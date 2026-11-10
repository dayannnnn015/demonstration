# Backend review — 20 September 2026

Scope: existing authentication/configuration, account provisioning, policy adoption/binding and raw-assessment boundaries; full existing test suite; hosted schema metadata and anonymous HTTP checks. This is a defect review, not acceptance or permission to cross a school-policy gate. Frontend work is paused at the user's request.

## Fixed without a migration

- A successful Auth response containing JSON null caused a TypeError instead of a controlled authentication-service failure. Validate the live identity response and UUID before reading it; malformed upstream data now fails closed with `AUTH_UNAVAILABLE` (503).
- The isolated account client likewise crashed on JSON null and accepted arbitrary string identifiers. Validate the response UUID and return `IDENTITY_SERVICE_FAILED` (502) for malformed responses. Timeout/failure messages now acknowledge an uncertain external outcome and direct operator reconciliation before retrying; an Auth invitation cannot be rolled back by the database.
- Provisioning configuration accepted loopback HTTP even in deployed environments, non-HTTP schemes on localhost, URL credentials and fragments. Require HTTPS for deployments, restrict the local-development exception to HTTP loopback, and reject credentials/fragments.
- Raw-mark validation multiplied floating-point numbers by 100 and incorrectly rejected ordinary decimal values such as 1.1. Validate the number's decimal representation without rounding or deriving grades. Regression cases cover 1.1, 2.55, 19.99 and excess precision.

Additional coverage verifies that an external identity followed by a journal failure grants no school access, preserves the outstanding invitation and can be reconciled through the existing operator link route. No real email was sent.

## Confirmed database defects, corrected by migration 0022 on 21 September

**Resolved.** The user authorized a corrective migration on 21 September 2026. All four defects below are fixed in `database/migrations/0022_assessment_score_corrections.sql`, released as 0.29.0, and each has a regression case in `tests/assessment-scores.test.ts` that was run against a database built without `0022` and fails there. No applied migration was edited; `0022` replaces the two writer functions with `create or replace` and alters the policy and columns in place. The paragraphs below are left as the review wrote them, because the reproduction is the durable part.

The user explicitly prohibited new migrations in the handoff. A clarification is pending about allowing a corrective migration for existing behavior only. No applied migration was edited and no corrective migration was created or applied during the unrestricted part of this review.

| Priority | Defect and reproduction | Required correction |
|---|---|---|
| High | Record a mark, withdraw the learner, then record a replacement as the former adviser. HTTP still returns 201. Direct restricted-role SQL also returns the saved mark although the learner no longer belongs to the teacher's current roster. | Re-check current learner access inside the security-definer score writer and in score RLS; retain manager access and history. |
| High | Record 9, then call `record_assessment_scores` with the enrollment ID and version but no `raw_score` key. SQL accepts the missing key and replaces 9 with null. The HTTP schema rejects it, but the database boundary does not. | Require the raw_score key explicitly; only explicit JSON null may clear a mark. Preserve whole-batch rollback. |
| High | Read a score sheet through HTTP and query `record_access_events` by that request ID. No privacy access entry exists, despite the response containing learner names and marks. | Add the score read/history resources to the permitted audit resources and log exactly the disclosed records in the response transaction. |
| Medium | Create a task with the documented allowed maximum 10000. HTTP returns 500 because `numeric(6,2)` cannot store it. | Reconcile database precision with the existing API bound using a new migration; do not invent an academic maximum or formula. |

The temporary synthetic regression cases reproduced all four categories. They are not counted as successful regression coverage or hidden inside the passing suite. No real school records were read or changed to reproduce them.

## Additional inspection findings

`write_assessment_task` reads its old row and checks the expected version before acquiring the shared lock through `assessment_entry_context`. `record_assessment_scores` similarly reads task maximum/status before that lock. A waiting writer may therefore proceed with stale task state after another transaction commits. This is a code-inspection finding; the embedded PGlite suite serializes transactions and does not establish the concurrent outcome. A corrective migration should lock before those reads, with a real multi-connection PostgreSQL regression before closing the finding.

**Partly addressed.** Migration `0022` moves `pg_advisory_xact_lock(82412001)` ahead of those reads in both functions, and a test asserts that ordering in the stored function source. **The finding stays open**: the ordering is asserted as text, not demonstrated under concurrency, and the multi-connection regression this paragraph asks for does not exist. PGlite cannot provide it.

**Closed on 2026-09-25 (0.37.3).** `tests/concurrency.pg.test.ts` runs both races on a real PostgreSQL 17 server with two connections, waiting until the second writer is genuinely blocked on the lock before the first commits. Against the 0021 definitions both races happen: the second manager's retitle silently overwrites the first, and a mark of 15 is recorded against a maximum that had just been lowered to 10. Against the 0022 definitions the stale retitle answers `P0003` and the mark answers `P1605`. It is opt-in, because it needs Docker: `npm run test:race` starts a disposable container, runs it and removes it.

Account provisioning holds the shared academic lock during an external call of up to ten seconds, while other transactions use a three-second lock timeout. The outcome is bounded refusal/retry, but this has not been load-tested with real invitations. The account service remains unverified in the deployed workflow; this review does not send mail or configure the function.

The score-entry gate in `constraints.md` still disagrees with the implemented raw-score module's documentation. Reviewing defects does not resolve that policy conflict or authorize expanding score functionality. No calculation, grading rule, automatic alert, new endpoint or P17xx code is introduced.

## Verification and limits

- Baseline: all 298 tests in 23 files, type checks and build passed.
- Runtime dependency audit: zero reported vulnerabilities.
- Hosted read-only metadata: all 21 migration checksums match; 44 domain tables have RLS and are not owned by the runtime; no domain table SELECT grants to `anon` or `authenticated`; security-definer functions have fixed empty search paths and no PUBLIC execution. Restricted runtime-role and readiness checks passed.
- Live baseline: all 109 documented protected operations rejected anonymous requests with 401; health, readiness and app routes returned 200.
- Targeted failure injection used signed synthetic JWTs, stubbed upstream services and synthetic PGlite records. No real staff session, outbound email, learner import, restore drill or realistic multi-session load was exercised.

Final release validation is recorded in `status.md` and the changelog. The open database findings remain material; passing existing tests does not establish school-production readiness.
