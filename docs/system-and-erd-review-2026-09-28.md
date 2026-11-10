# System and process-ERD review - 28 September 2026

## Current system

EDUNEXUS 0.42.0 implements a substantial records workflow for Balili Elementary School. It supports staff identity and roles, school years and sections, permanent learner profiles, annual enrollment, reviewed roster imports and corrections, instructional calendars, daily attendance, monthly attendance snapshots, manual follow-up, subjects and offerings, assessment-policy records, tasks and raw scores. These workflows have workspace screens; the system is no longer only a backend scaffold.

The architecture is React/Vite over an Express/TypeScript API, with Supabase Auth and PostgreSQL, hosted on Vercel. The API verifies staff identity, uses the restricted `edunexus_app` database role, and relies on RLS and validated database writers for authorization. Version checks, transactional journals and protected record-read logs are central controls. Learner identity persists across years; attendance and raw scores attach to annual enrollment. Frozen snapshots preserve historical decisions and monthly submissions.

This is **not yet a complete, school-accepted production records system**. The standing gates in [constraints](constraints.md) still block grade computation, official attendance conversion, automatic absence alerts, promotion and some official-form work. Real learner imports require school privacy approval and recovery readiness. Staff acceptance, restore/revocation/rollback drills, hosted authenticated load, SMTP/operator settings and the subject-teacher access decision remain outstanding. A high local test count does not close those gates.

### Evidence checked for this review

- Start state: clean `master`, synchronized with origin, headed by `b27880b`; package version 0.42.0.
- Read the repository contract, status, constraints, architecture, roadmap, operation registry, database/auth boundaries, original Mermaid sources and diagram documentation.
- Applied all **24 migrations** to a new local PGlite database and inspected its actual catalog: **44 tables**. Exported column nullability, PK/FK/unique constraints, unique indexes and migration hashes. No hosted database or real learner records were queried.
- Inspected only page-size/margin XML from the original manuscript: portrait A4, approximately 6.60 inches of text width.
- `npm run check`: **480 tests passed**, **40 test files passed**, **10 tests in one opt-in concurrency file skipped**, three typechecks and production build passed. The exporter is covered by the server typecheck and was executed successfully.
- Reconstructed all three process figures; checked every displayed column and drawn foreign key, and visually inspected all three rendered PDF pages at their paper layout.

The status file records the 26 September production deployment, 118-check smoke run, 10-case real PostgreSQL race test and 27-adviser disposable-database load run. Those are **previously recorded results**, not fresh hosted checks in this illustration session. This review is a source/schema and documentation review with regression tests, not a penetration test or a school acceptance sign-off.

## Assessment of the original figures

The domain split is useful and was retained: class preparation establishes annual placement, attendance records observations against that placement, and academic records associate raw marks with a subject offering and adopted policy revision. The weaknesses were presentation and a few misleading cardinalities, rather than a need to redesign the database.

| Figure | Finding | Recreated figure |
|---|---|---|
| 7 - Class Preparation | A wide notes column and many attributes force tiny print. The adviser relationship looks mandatory even though the FK is nullable. The prose overstates that every section reference uses the same composite key. | All 8 entities retained; optional adviser shown as `0..1`; actual composite enrollment key explained separately. Required enrollment placement remains `1`. |
| 8 - Attendance Record | Faint lines and long routes obscure calendar/mark/month responsibilities. Calendar `id` is labeled only PK, despite also being an FK. The snapshot side is not enough to explain historical versus current use. | All 11 entities retained; PK/FK calendar root identified; nullable calendar scope and marks shown. A saved month points to one snapshot, and a snapshot to at most one current month. Initial virtual draft explained. |
| 9 - Academic Record | The offering-to-binding `0..1` line describes only the standing binding while the entity also stores released history. Long policy notes crowd out the useful structure. | All 11 entities retained; lifetime multiplicity shown as `0..N`, with the one-standing-binding partial constraint in prose. Both frozen policy and subject snapshots remain visible. |

The redraw does not invent tables, calculated grades, a notification engine or a calendar-to-sheet foreign key. Numerical endpoint cardinalities replace tiny crow's-foot symbols. Every table and field uses its actual SQL identifier, with nullability and key badges derived from the rebuilt catalog. Selected context FKs and operational fields remain omitted and are explicitly disclosed in each figure and the [figure guide](diagrams/paper/README.md).

## Deliverables and use

The [figure guide](diagrams/paper/README.md) links the three-page printable PDF and explains insertion at **6.5 inches wide**, one figure per portrait A4 page. The same folder contains editable SVG and 600-dpi PNG versions. The PDF supplies exactly the requested captions, Figures 7, 8 and 9, plus short explanatory notes. The generator and schema metadata are included for reproducibility.

This is a documentation increment. The application version remains 0.42.0. No new backend module, endpoint, migration, deployment or school-policy decision is part of this work.
