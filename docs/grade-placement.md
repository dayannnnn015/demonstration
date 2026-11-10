# Section 2B.5: reviewed grade-placement correction

Principals and administrative officers can correct the grade recorded for an existing annual enrollment and replace its timeline sections with sections in that grade. Teachers cannot preview, confirm, or read correction history. The school must verify the correct placement; EDUNEXUS does not determine eligibility from age, attendance, or academic results.

This workflow corrects the grade for the **whole annual record**. It is not promotion, acceleration, a midyear grade transition, or a change of school year. It keeps the enrollment UUID, original learner ownership, school year, validity, dates, movement types, and movement reasons. Original movement rows and earlier correction snapshots remain unchanged. No LIS update or official form release is performed.

## Review and confirmation

1. Read `GET /api/v1/enrollments/:id/timeline` for the current effective sequence, enrollment version, grade, and school year.
2. Select the verified target grade (`0` for Kindergarten through `6` for Grade 6) and replace every timeline entry's `section_id` with an existing section in that grade and the same year. Preserve all dates, event types, and reasons, in the same order.
3. POST `version`, `grade_level`, the complete `entries`, and a single-line review `reason` of 10–500 characters to `/api/v1/enrollments/:id/placement/preview`.
4. Review the returned previous/corrected grades, before/after entries, sections/advisers, identity context, and earliest affected date. Confirm through `/api/v1/enrollments/:id/placement/corrections` with the unchanged request, `review_hash`, and `reviewed: true`.

Both POST routes accept at most 256 KiB and 1000 entries, matching timeline correction limits. Every transition must remain valid. A reassignment cannot map consecutive entries to the same section; withdrawals retain the preceding section. If a date, transition, or reason was also recorded incorrectly, use timeline review separately, then review placement against the refreshed version. Same-grade repairs belong in timeline review.

The review hash binds the acting manager, enrollment version, retained learner/version, current and target grades, reason, complete before/after sequences, school-year version, and versions of all original/target sections. The database revalidates under the existing registry, year, learner, and enrollment locks before writing. A modified proposal or context requires a new preview. The hash is a consistency check, not an authentication credential or second-person approval.

## Effective history and access

Placement and timeline corrections share the append-only `enrollment_corrections` journal and section-reference table. The latest correction snapshot plus later ordinary movements remains the effective timeline. A placement correction advances the enrollment version and updates its grade and section projection without fabricating a movement event.

The correction response identifies `correction_kind` (`timeline` or `placement`), `previous_grade_level`, and `corrected_grade_level`. New timeline corrections record the current grade in both fields. Earlier timeline corrections can have null grade metadata; this means unknown, not Kindergarten. Applied migrations do not invent historical grades.

`GET /api/v1/enrollments/:id/placement/corrections` returns only placement revisions. The existing `/timeline/corrections` route returns both kinds. Both use `limit` (default 5, maximum 10) and a descending `before_version` cursor, with `next_before_version` for the next page.

The `/timeline` response includes current `grade_level` and `academic_year_id`. Original `/history` includes `current_grade_level`, year, and its existing original-movements label. Old movement section IDs can belong to the originally recorded grade. Use effective timeline sections and the current corrected grade for future calculations, while retaining original rows as evidence. Voided records remain ineligible for reporting.

Teacher access follows the corrected latest section immediately. The former adviser loses access unless another valid assigned enrollment grants it; the new adviser gains the existing permitted roster access. Managers can inspect original and correction histories. Subsequent movements and timeline corrections must use sections in the corrected grade. Record void/restoration and identity review detect changes through the enrollment version and effective timeline.

A mistaken placement correction is reversed through another reviewed correction back to the verified grade, mapping the complete **current** timeline. Subsequent legitimate movements or date corrections are not silently undone. After a lost response, inspect history for the submitted review hash and actor; a stale retry returns `VERSION_CONFLICT` instead of a duplicate revision.

## Boundaries and verification

Closed years and voided records reject placement changes. Invalid grades/sections, stale versions, malformed/oversized timelines, and broken movement transitions are rejected. `PLACEMENT_UNCHANGED` directs same-grade changes to timeline review. `PLACEMENT_HISTORY_CHANGED` means the request changed more than grade and section assignments. Changed review context uses the shared `TIMELINE_REVIEW_CHANGED` error code.

The runtime cannot directly update grades, change original school years, edit/delete correction history, or execute private validator/writer helpers. A matching correction intent in the same transaction, for the next enrollment version and exact old/new grades, authorizes a grade change. Correction snapshots, historical section references, projection, and audit commit or roll back together. Read-access logs identify the enrollment; general audit does not copy the reason or learner profile.

Automated coverage includes grade boundaries, full-history mapping, teacher isolation, later movements/corrections, reversal, stale/competing writes, SQL authorization, forced rollback, section references, legacy null metadata, a 260-entry sequence, and closed/voided records. Hosted release evidence is in [deployment](deployment.md). These operations remain API-only; actual staff sign-in workflows and school acceptance still need verification.

[Classroom attendance](daily-attendance.md) is now implemented. Confirmation rejects a placement change that would move existing non-null marks into a different section; review and clear the affected marks before repairing placement and re-recording them. The preview can still succeed before this downstream constraint is checked. [Monthly attendance](monthly-attendance.md) additionally blocks any change to frozen membership, even without marks. Return/reopen affected months before placement repair. Academic grading, promotion and official releases remain unimplemented; their correction and release rules must be integrated before enabling them.

Migration `0009` preserves existing rows and extends correction metadata. Rollback must use a release that understands placement revisions, shared effective history, and current grades. Do not remove correction snapshots or bypass the grade-change guard to reverse a release.
