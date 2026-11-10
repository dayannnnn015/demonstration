# Section 4A.2: section subject offerings

Managers (principal and administrative officer) select explicit catalog subjects for sections. An offering preserves the selected subject's code, name, kind, grade applicability, active flag and catalog version in `subject_snapshot`. Catalog edits never silently change existing offerings. This is academic setup only: no official curriculum, assessment weights, numeric Kindergarten grading or grade computation is supplied.

## Access and lifecycle

Active managers read and maintain offerings. Teachers read only their currently advised sections in open school years; adviser changes take effect immediately. Offering access grants no additional learner access. Only managers read revision history. Runtime tables are SELECT-only with row-level policies; validated database commands perform writes and atomic before/after history and change audits.

An offering is unique per section and subject, including retired offerings. Creation requires the current catalog version, an active subject and matching section grade. Draft and active years allow creation, retirement, reactivation and display-order changes. Closed years allow manager reads/history only. No deletion is exposed.

Explicit subject refresh requires a draft year, an active applicable subject and its current catalog version. Active-year subject details remain pinned. Archiving a catalog subject leaves existing offerings intact but blocks new use and reactivation. Reactivating a retained offering uses its pinned grade applicability and requires the catalog subject to be active; a later catalog grade edit does not rewrite that original selection.

Future assessment work must add result/finalization dependency rules before allowing scores. These metadata rules alone do not establish grading or official reporting readiness. Application rollback must preserve both subject and offering history and their pinned snapshots.

## API workflow

- `GET /api/v1/subjects` locates catalog entries; see [subject catalog](subject-catalog.md).
- `GET /api/v1/sections/:id/subjects` returns section/year context and offerings. Filters: `active=true|false|all` (default true), `limit` (default 50, maximum 100), `after_id`.
- `POST /api/v1/sections/:id/subjects` accepts `subject_id`, `subject_version`, `display_order` and `reason`; creates an active offering.
- `GET /api/v1/section-subjects/:id` returns context and `record`.
- `PATCH /api/v1/section-subjects/:id` accepts `version`, `active`, `display_order`, `refresh_subject`, nullable `subject_version` and `reason`. Supply a subject version only when explicitly refreshing; otherwise use null.
- `GET /api/v1/section-subjects/:id/events` returns newest revisions first; `limit` defaults to 5 (maximum 10), with `before_version` pagination.

Display order is 1–999 and ties are allowed. API pagination is by UUID, not display order; collect the required pages before sorting for display by order, then subject code/id. Reasons are 10–500 single-line characters. These metadata writes use current versions and a reason, without a separate preview/hash flow. Refresh after conflicts and inspect history after a lost response instead of blindly repeating a write. Render all supplied names/reasons as text.

Validation includes pinned metadata and draft refresh, catalog archival, grade-zero developmental domains, closed-year controls, adviser isolation, direct-write/private-helper denial, version conflicts, journal rollback and filtered pagination. No real school subject selections are created by this increment. Since 0.33.0 the Subjects and offerings screen (`web/screens/Subjects.tsx`) is the interface to both the catalog and offerings; see [frontend integration](frontend-handoff.md).
