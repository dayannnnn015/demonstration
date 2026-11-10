# Section 2A: learner registry and enrollment

This section adds the minimum learner profile, annual enrollment, and an immutable movement timeline. It builds on the existing staff authentication, role checks, school years, and sections. The user confirmed that principals and administrative officers make changes; teachers only read their assigned learners.

## Identity and duplicate handling

One internal learner UUID persists across school years. The profile contains first name, optional middle name, last name, optional name extension, birth date, sex as recorded for school forms, the official LRN if available, and — since migration 0053 (0.88.0) — one optional line of **address**, at most 300 characters.

**Address, and only address.** It was added for the initial learner-information import, on the user's explicit decision of 2026-11-04, and it opens that one field of the *learner fields and class capacity* gate. No parent contacts, health details, religion, ethnicity, indigenous group, supporting documents, or any breakdown of that line into house number, street, barangay and municipality are collected: each is a fact about a child or their family that 897 real records would hold, and which of them the school may keep is the school's answer to give. The learner contract is strict, so an extra field is refused rather than silently dropped. The school still owes a reviewed field list and a capacity policy before real-data rollout.

An address nobody has recorded is `null` — unrecorded, not blank — and the interface draws that rather than printing an empty cell. It is printed on no form: none of the forms the school has supplied has a box for it.

An LRN is a 12-digit **string**, preserving leading zeroes. It is unique when supplied. `null` means the official LRN is pending; EDUNEXUS does not generate one. An assigned LRN cannot be cleared or replaced through these endpoints. A dedicated assignment endpoint fills a pending LRN once, using the current record version. DepEd identifies the LRN as a permanent identifier maintained across transfers and school levels. [DO 22, s. 2012](https://www.deped.gov.ph/2012/03/20/do-22-s-2012-adoption-of-the-unique-learner-reference-number/).

Duplicate LRNs produce HTTP 409. Name and birth-date search helps a manager inspect possible duplicate profiles; matching names do not prove the records belong to the same child. Automatic merges remain unavailable. Section 2B.1 adds a separate [reviewed LRN correction workflow](registry-review.md), preserving the previous value and review reason. Basic identity fields correspond to DepEd's enrollment form, but this increment does not implement or claim completeness against the entire form. [Basic Education Enrollment Form, DM 032, s. 2024](https://www.deped.gov.ph/wp-content/uploads/DM_s2024_032.pdf).

## One learner, in two parts (0.92.0)

A learner opened from the registry is shown in two parts rather than one column: **Learner profile** and **Enrollment**. They are two different records, which is the reason for the split — the profile is the one permanent identity row in `learners`, and the enrollment is the annual timeline in `enrollments`. In one panel, whichever was being looked for was the hardest to find, and the arrangement invited the reading that correcting a name was correcting a year.

**Academic history is not one of the parts.** It was a signpost tab in 0.91.1 and was removed on the user's instruction the next day, which returns this panel to where 0.90.2 left it: the navigation rail already carries that screen, and a second door here is what 0.90.2 took out. It has now been removed twice, so the gate is explicit and opens **both** parts of the panel before asserting that no link to `prior-records` exists — 0.90.2's own gate was vacuous on its first run because it asserted on the closed learner list, where nothing inside a learner's panel is rendered at all. The screen, its route and every historical record are untouched.

**Editing is an action, not a disclosure (0.92.0).** It used to be folded inside a `Task` titled *Correct the details*, which is where this panel's **reviewed** workflows live — the LRN correction and the identity links — so a plain correction read as unavailable. **Edit profile** now opens a sheet over the panel, which is the workspace's rule for a form that writes a record, and the reviewed workflows stay folded below it.

**No permission moved.** Corrections go through `PATCH /learners/:id`, which is manager-only at the HTTP boundary and under the `learners` update policy; row security is untouched. An adviser is offered no editor and is told whose the correction is, and the API refuses one from them regardless of the screen — `tests/web-learner-profile.test.ts` asserts that by sending one for a learner in their **own** class and `tests/registry-guardian.test.ts` by sending a guardian correction. A learner `PATCH` replaces the whole profile, so a correction carries every field, the guardian pair included; a partial body is a 422 rather than a silent merge, which is what stops a form that does not know about a field from clearing it.

**The profile shows the fields the record holds, and nothing more.** That is `profileFields`: the name, LRN, birth date, sex, one line of address (0053) and the parent or guardian with a contact number (0056). A learner imported from a class list opens with their information already there and is never typed in twice — the import's eight columns are the whole of `ROSTER_HEADER`, and all eight are on the record.

What the record does **not** hold is **named on the profile in words** rather than left to be inferred from a gap: no mother tongue, religion or indigenous group, no relationship field, no second guardian, no guardian email, occupation or address, no contact number of the learner's own, and no breakdown of the address line. A reader of a profile is unusually likely to read silence as "nothing to report", and a profile is the one screen whose purpose is to look complete. Tests assert that none of those is offered as a control and that each is a 422 at the API rather than a silently dropped field.

## The parent or guardian (0056)

Two nullable columns on `edunexus.learners`, `guardian_name` and `guardian_contact`, which left the **learner fields and class capacity** gate on the user's own explicit decision — asked for by name after the previous release reported, in those words, that this gate blocked parent or guardian and contact number. That is the same way `address` left it, and the only way a field may.

- **Both nullable.** A learner the school has written no guardian for is **unrecorded**, never "no guardian", and the profile draws that rather than an empty line. Requiring either would refuse a class list the school already keeps.
- **One name field, and no relationship field.** Nothing supplied says which relationships the school records or how it writes them, so a closed list invented here would refuse a real family. Where it matters, it is written into the name as the school's own records write it — *Maria Reyes (mother)* — which is one line of text and no guess at a taxonomy.
- **The number is kept exactly as recorded.** It accepts digits and the punctuation a number is written with, so `09171234567`, `+63 917 555 0101`, `(074) 422-1234` and `(074) 422-1234 / 0917 555 0101` all pass unchanged. There is **no minimum length, no leading-zero rule and no +63 normalisation**: the school's own records are the authority on how it writes a number, and a stricter pattern invented here would refuse a real one. Letters are refused, because a contact number is a number; a learner with none is left unrecorded rather than typed "none".
- **Not in the class-list import template.** `ROSTER_HEADER` still carries its eight columns, and that is deliberate: extending a published import contract is its own decision, so the guardian is typed per learner until the school asks otherwise. At 897 learners that is the known cost of the choice, and `tests/web-learner-profile.test.ts` holds the template to eight columns so the day it changes is a decision rather than a drift.
- **The journal holds no value.** `edunexus.audit_events` (0001) has `changed_fields text[]` and no snapshot columns, so it records *which* field changed and never what it changed to. That was already true of every learner detail; it is asserted for this one because `guardian_contact` is the first field on `learners` that holds **a third party's phone number**, and a journal that copied values would accumulate the contact details of 897 families in a table that is append-only and never deleted.
- **Writable only through its grants.** 0004 grants `learners` column by column, so 0056 adds `grant insert(col),update(col)` for each; without them a registration answers *permission denied for column guardian_name* as a 403 that reads like a role problem. 0056 also had to `create or replace` `register_learner_into_section`, whose closed deny-unknown key list from 0054 rejects any new learner column — the control working, and a new migration rather than an edit to an applied one.
- **An adviser may record a guardian only when registering a child the school has never held**, through that writer, which is an exception they already had. They cannot correct a profile, so they cannot change a guardian once the record exists.

**Academic history stays a signpost.** The part names where the historical records are and what they are, and deliberately carries **no link** to them: the shortcut *Academic history before EDUNEXUS* was taken out of this panel in 0.90.2 because the navigation rail already holds that screen, and reorganising the panel is not a reason to put it back. Restoring it is a decision for the user to make. The gate in `tests/web-registry-scope.test.ts` asserted on the closed list and so was vacuous on its first run; the new one opens the tab that is now the only place such a link could appear.

## Annual enrollment and date semantics

- A learner has at most one valid enrollment per school year. Reviewed voided records remain as evidence and do not occupy that annual slot. The section determines its school year and grade. A learner awaiting assignment can exist in the registry without an enrollment.
- Initial enrollment must fall within the school-year dates and after the learner's birth date. Draft and active years accept enrollment; closed years do not. Future initial dates are permitted for class preparation, and assigned teachers can see these prepared rosters.
- Reassignment stays within the same school year and grade. [Grade-placement review](grade-placement.md) corrects an erroneously recorded whole-year grade while preserving dates and movements. Promotion belongs to the later promotion section.
- Withdrawals record one of `transfer_out`, `withdrawal`, `dropout`, or `death`. These are recorded staff decisions, not classifications calculated from attendance.
- Reentry resumes the same annual enrollment; it does not create a second enrollment row. A withdrawal recorded as death cannot be reentered through the ordinary workflow.
- A movement's `effective_on` is the **first day of the new state**. The previous state applies up to the preceding day. For example, transfer-out on September 10 means the learner is no longer enrolled from September 10 onward.
- Ordinary movements must strictly follow the previous effective event, remain within the year, and not be future-dated in Asia/Manila. [Section 2B.2](enrollment-timeline.md) now provides reviewed same-day repairs and inserted/removed historical movements, while preserving the original records. These date conventions need school review before final SF4 arithmetic is implemented.
- Closing a year leaves all enrollment events available to managers and prevents further movements. It does not automatically mark learners promoted, withdrawn, or graduated.

The enrollment row is the latest effective state. Original events preserve recorded movements and actor/request metadata. After a correction, effective history comes from the latest correction snapshot plus subsequent movements. Future attendance calculations must use the resolved `/timeline` for the report date; neither the latest row alone nor original events alone account for all historical corrections.

## Access and concurrency

Managers can read and edit learner profiles and enrollment records. Teachers can read profiles and enrollment rows only when the learner is currently enrolled in a section they advise in an open year. Reassignment, withdrawal, staff suspension, or year closure removes the corresponding teacher access. Previous advisers do not retain historical access by default. Movement history and read-access logs are manager-only. Both the HTTP boundary and PostgreSQL enforce these restrictions.

Every edit uses a record version. Concurrent competing updates cannot silently replace one another. Enrollment creation/restoration is protected by a partial unique learner/year index for valid records and an identity-group guard. Enrollment commands serialize with the existing staff/section advisory lock, then lock the year and learner before applying the transaction. The runtime has no direct INSERT/UPDATE/DELETE access to enrollment state or event tables; only the narrowly scoped, manager-checking database functions can write them.

Movement history and ordinary change audit commit with the state change, or all roll back together. Successful API reads record actor, request ID, resource, and returned record UUIDs. They do not copy learner names, LRNs, birth dates, search terms, or full responses into the access log. A read log records successful authorization/retrieval, not proof that a person viewed the response. Access-log review is restricted to managers, and the runtime cannot alter or delete either audit log. Database operators remain trusted administrators.

## API

All routes below use `/api/v1` and a Supabase bearer token. The complete request and response schemas are in `docs/openapi.json` and `/openapi.json`.

| Route | Purpose |
|---|---|
| `GET /learners` | Scoped search by text, exact LRN, or birth date; paginated |
| `POST /learners` | Create a minimum learner profile |
| `GET /learners/:id` | Read a visible profile |
| `PATCH /learners/:id` | Correct profile fields with the last-read version |
| `PATCH /learners/:id/lrn` | Fill a pending official LRN once |
| `GET /enrollments` | Scoped, paginated filter by year, section, learner, or status, in learner-name order. Since 0.42.0 each row carries `learner` — the retained identity's id, names and LRN, or null when the caller may not read them — and the access row names both the enrollments and those learners, so a class list is one read rather than one per learner |
| `POST /enrollments` | Create an annual enrollment and initial event atomically |
| `GET /enrollments/:id` | Read the latest visible enrollment state |
| `POST /enrollments/:id/movements` | Append reassignment, withdrawal, or reentry with the current version |
| `GET /enrollments/:id/history` | Manager-only chronological, paginated movement history |
| `GET /record-access-events` | Manager-only audit, newest first with a `before_id` cursor; `actor_user_id` narrows it to one staff member and `record_id` to reads that returned one learner or enrollment ID (since 0.39.0) |
| `GET /enrollment-counts` | Valid enrollments of one school year counted by grade and status, within what the caller may read. Names no record and writes no access row; voided records are not counted. Added in 0.37.0 for the Overview. |

Example movement body (the UUID must identify an existing section in the same year and grade):

```json
{
  "version": 1,
  "action": "reassigned",
  "effective_on": "2026-09-10",
  "section_id": "00000000-0000-4000-8000-000000000010"
}
```

On HTTP 409, fetch the current record and reconcile the intended change. Do not silently retry with the newer version. Initial POST retries are protected against a second annual enrollment, but are not a general-purpose idempotency-key workflow.

## Next increment

Section 2B.1 adds [CSV import review/commit and LRN corrections](registry-review.md); Section 2B.2 adds [enrollment timeline review](enrollment-timeline.md). The ordinary mutation endpoints retain their restrictions. Original `/history` responses now include `interpretation`, `timeline_version`, and `has_corrections`; use `/timeline` for effective dates and states. [Section 2B.3](learner-identity.md) adds reviewed identity links and reversals. Enrollment responses now expose the retained `learner_id` and original `recorded_learner_id`; learner lists hide linked profiles unless managers request `include_linked=true`. [Section 2B.4](enrollment-records.md) adds reviewed void/restoration to resolve erroneous annual records. Enrollment lists default to `record_state=valid`; managers can inspect `voided` or `all`. Timeline/history responses label record validity and reporting eligibility. School-reviewed sample mappings, class capacities, and additional fields need further work. [Section 2B.5](grade-placement.md) provides dedicated whole-year grade-placement correction; it does not implement promotion or midyear grade transitions. [Classroom attendance](daily-attendance.md) uses dated valid enrollment and prevents conflicting movements or repairs while non-null marks exist. The workspace now includes a read-only learner search and enrollment-record view; registration, correction, arbitrary XLSX/LIS import, monthly attendance workflows, grades, promotion, and forms remain unimplemented.
