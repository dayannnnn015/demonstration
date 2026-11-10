# Section 4A.1: subject catalog

Managers maintain an explicit catalog of learning areas and developmental domains. No official subject list, curriculum, assessment weights or grading policy is seeded. Grade `0` denotes Kindergarten; listing a subject for a grade does not define numeric assessment behavior.

## Metadata and access

Each subject has an immutable code, editable name, `kind=learning_area|developmental_domain`, distinct `grade_levels` from 0–6, an `active` flag and a version. Codes are trimmed and uppercased, contain 1–24 ASCII letters/digits/underscore/hyphen, and start with a letter. Names are trimmed, single-line and at most 120 characters. Grade arrays are sorted; duplicates and empty arrays are rejected.

Active staff may read catalog metadata. Only principals and administrative officers may create, update or read protected revision history. Catalog access grants no learner, section or assessment access. There is no deletion endpoint. Archive an unused/obsolete code instead of reusing it for a different subject.

## API

| Operation | Contract |
|---|---|
| `GET /api/v1/subjects` | Optional `active=true|false|all` (default true), literal `q` search, `limit` (50 default, 100 maximum), `after_id`. Filters precede UUID pagination. |
| `GET /api/v1/subjects/:id` | Read current metadata, including archived records. |
| `POST /api/v1/subjects` | Supply code, name, kind, grade_levels, active and reason. |
| `PATCH /api/v1/subjects/:id` | Supply current version and all editable metadata plus reason. Code cannot change. |
| `GET /api/v1/subjects/:id/events` | Manager history, newest first; limit 5 by default/10 maximum, `before_version` cursor. |

The reason is a single-line explanation of 10–500 characters. These metadata saves use version checks and append-only history; they have no separate preview/hash endpoint. Refresh after a conflict. No-op metadata updates are rejected. Subject creation returns version 1; each successful change advances it once. A history event preserves before/after values, reason, actor and request ID. Staff should verify the school curriculum before configuring real offerings.

## Storage and validation

Migration `0015` adds `subjects` and `subject_events`, a unique immutable-code command model, RLS, restricted write functions and transactional change/history audits. Runtime direct DML is denied. The existing registry advisory lock serializes changes with other academic setup commands. Catalog data contains no learner records; generic HTTP logs and change audits follow the existing metadata conventions.

Focused tests cover code normalization/uniqueness, explicit grade 0, input limits, archive/restoration, history, version races, role/SQL restrictions, rollback on journal failure and filtered pagination. Grading, curriculum approval and official forms remain subsequent work.
