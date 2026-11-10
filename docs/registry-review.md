# Section 2B.1: roster import and reviewed LRN corrections

Principals and administrative officers can import a class roster and correct an incorrectly recorded LRN. Teachers cannot preview/commit imports, inspect receipts, or read LRN correction history. Teacher roster boundaries still apply after import. This is a development contract for school review, using the existing minimum fields, not an arbitrary spreadsheet or official LIS importer. [Enrollment timeline corrections](enrollment-timeline.md) are implemented separately in Section 2B.2; [reviewed duplicate links](learner-identity.md) are implemented in Section 2B.3 without deleting or reparenting original records.

## CSV review

`GET /api/v1/roster-imports/template` returns instructions, limits, and this exact header:

```csv
lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,address
```

Send the UTF-8 CSV as the `csv` string to `POST /api/v1/roster-imports/preview`, with `section_id`, `enrolled_on`, optional `entry_kind` (`regular` by default, or `transfer_in`), and optional `resolutions`. Each batch enrolls 1–50 learners in one section. CSV content is limited to 24,000 UTF-8 bytes; the entire JSON request remains limited to 32 KiB. Quoted commas, escaped quotes, CRLF/LF, and a UTF-8 BOM work. Fields must be single-line text. Empty lines are skipped; malformed data records are never skipped.

The last column, **address**, was added by migration 0053 (0.88.0) and is the only learner field beyond the name, LRN, birth date and sex that EDUNEXUS holds; anything further waits on the school’s reviewed field list. It is one line of at most 300 characters, and optional: an empty cell, and a file saved from the earlier seven-column template, both record the learner with **no address**, which is unrecorded rather than blank. Either header is accepted, so a file already filled in is not refused. An address holding commas must be quoted, as a spreadsheet writes it; the workspace’s own Excel reader quotes it for you.

**The template is also an Excel file**, offered on Roster import as *Download the template (Excel)* beside the CSV. `rosterTemplateWorkbook()` in `web/csv.ts` builds it from `ROSTER_HEADER`, the workspace's one copy of the list this endpoint publishes, and `tests/registry-address.test.ts` asserts the two are equal — a copy rather than a fetch because this endpoint is manager-only and advisers prepare class lists too. In the workbook the LRN and birth-date columns are formatted as **text before anyone types in them** and the empty rows are written rather than left absent, since an unstyled cell is one Excel formats as a number and a twelve-digit LRN typed into it loses its digits for good; a second sheet names every column, says which are required, and shows one worked row, so the file explains itself away from the screen that produced it; and Excel itself refuses anything but `male` or `female` in the sex column. None of that is the authority: the API checks every row again, because a file can be filled in anywhere, including in a reader that ignores validation entirely.

LRNs must remain strings with all 12 digits, including leading zeroes. Blank LRN means pending official assignment. Blank middle name and extension become null. Dates use `YYYY-MM-DD`; sex is `male` or `female`. Field edges are trimmed; dates and spelling are never guessed. Preserve text formatting in spreadsheet software. The parser uses bounded `csv-parse` with automatic casting disabled. [CSV sync API](https://csv.js.org/parse/api/sync/), [record-size limit](https://csv.js.org/parse/options/max_record_size/).

Previews return normalized rows, existing candidates, row issues, and the selected section. `row` counts data records starting at 1, excluding the header; issue row `0` concerns the whole batch. Validation issues return `can_commit=false` and no preview token. Malformed CSV/header or request-shape errors return HTTP 422. Preview never inserts learners or enrollments.

Duplicate handling:

- An occupied LRN blocks creation. A distinct-person explanation cannot override it.
- First name, last name, and birth date matching case-insensitively require review, even when middle names differ. This conservative check is not proof of identity and cannot detect every spelling variant.
- Select a reviewed existing learner with `{ "row": 1, "action": "use_existing", "learner_id": "<UUID>", "version": 1 }`. CSV profile fields must match exactly after trimming. Blank CSV LRN may reuse an assigned LRN; supplied LRN must match. Imports never overwrite profiles or fill pending LRNs. Correct those through the separate versioned endpoints first.
- For a namesake, use `{ "row": 1, "action": "create_distinct", "reason": "Reviewed records identify a distinct person." }`. The 10–500 character reason is retained in the committed receipt. Exclude unrelated personal details.
- A batch cannot repeat an LRN, selected learner, or first-name/last-name/birth-date combination. Import distinct namesakes in separate reviewed batches. Up to six candidates per row are disclosed; `candidates_truncated=true` means there may be more. Search the registry to resolve ambiguity. An explicitly selected learner is included among the candidates.
- Any existing annual enrollment, including withdrawn status, blocks another. Use movement/reentry on the original enrollment.

After resolving issues, request another preview. A valid preview returns a UUID and a 30-minute expiry. Show the normalized rows, candidates, chosen actions, and target section/year/date before confirmation. Keep the file and payload in browser memory; never log or commit real school CSV files.

## Commit and receipts

`POST /api/v1/roster-imports/:id/commit` takes the identical CSV, section, date, entry kind, and resolutions, plus `confirmed=true`. Only the preview's creator can commit it, with current manager authorization. CSV whitespace or line-ending changes invalidate the input fingerprint; resolution list order alone does not.

The token binds both the input and the reviewed plan, including relevant learner, section, and year versions. The API acquires the shared registry transaction lock, locks the school year, rechecks duplicates/enrollments, and rebuilds the plan before writing. All learner writes acquire the same lock before row locks; year closure cannot pass the locked year. [PostgreSQL transaction and row locks](https://www.postgresql.org/docs/current/explicit-locking.html).

Changed records require fresh review. A failure on any row rolls back all learners, enrollments, events, change-audit rows, and the receipt from that commit. There is no partial-success mode. These small batches serialize roster writes; hosted throughput and contention still require realistic load testing. Lock conflicts return HTTP 409; statement timeouts return 503.

Identical retries against a committed preview return the original receipt without repeating inserts, even after expiry. `GET /api/v1/roster-imports/:id` retrieves your preview status or receipt. Receipts contain row numbers, learner/enrollment UUIDs, actions, and distinct-person reasons, without profile copies. Another manager cannot read your preview ID; managers can still inspect school-wide records through the registry APIs.

Stable errors include `PREVIEW_CHANGED`, `PREVIEW_EXPIRED`, and `PREVIEW_LIMIT`. Pending previews are capped at ten per manager. Commit releases a slot; abandoned previews expire after 30 minutes and are deleted when another valid preview is created. A deleted token returns `NOT_FOUND`. Committed receipts remain for audit and retries. School retention/disposal policy remains to be approved.

Pending previews store only fingerprints and metadata, with no staged CSV/profile copies or filesystem uploads. Candidate/receipt access is logged by UUID, in chunks of at most 100. HTTP and ordinary change-audit logs exclude raw bodies and personal field values. The runtime cannot directly edit preview receipts or correction history; narrow functions are intended for the verified API. Database operators and the backend runtime remain trusted boundaries.

## LRN correction

`POST /api/v1/learners/:id/lrn-corrections` requires the current `version`, `previous_lrn`, `corrected_lrn`, a 10–500 character `reason`, and `reviewed=true`. The manager must verify the learner's official identifier. The database locks the learner, checks the expected version and old value, records both values with reason, actor, request ID and timestamp, then updates the profile atomically. Occupied LRNs and unchanged values fail without leaving correction history. Pending LRNs still use the initial-assignment endpoint.

The ordinary LRN update guard remains in place. Only a restricted correction intent for the next learner version, created in the same transaction, permits replacement; an invented session flag cannot bypass it. `GET /api/v1/learners/:id/lrn-corrections` returns paginated manager-only history and records access. Runtime users cannot update or delete it.

“Reviewed” means review by the acting principal or administrative officer. This is not a second-person approval queue, an official LIS update, or an identity merge. The LRN remains the permanent official identifier; the workflow corrects an incorrectly recorded EDUNEXUS value. [DepEd DO 22, s. 2012](https://www.deped.gov.ph/2012/03/20/do-22-s-2012-adoption-of-the-unique-learner-reference-number/).

## Acceptance and remaining work

Tests cover parsing/input limits, explicit duplicates, preview ownership/expiry/tampering, retries, competing requests, changed records, a 50-row batch, a later-row database rejection, closed years, LRN conflicts, and protected history/bypass attempts. Hosted results are in [deployment](deployment.md).

Section 2B.2 now adds [enrollment timeline corrections](enrollment-timeline.md). Section 2B.3 adds [reviewed identity links](learner-identity.md). Imports match linked names to the retained candidate and detect annual enrollment across linked profiles; CSV values must still match the retained profile. Historical receipts keep their original IDs. Since 0.35.0 the Roster import screen, and since 0.34.0 the LRN correction on the Learner registry, are the interfaces to this module; school-approved sample mappings remain. [Section 2B.4](enrollment-records.md) resolves erroneous annual records through reviewed void/restoration. Import occupancy excludes voided records; historical receipts remain unchanged even if an imported enrollment was later voided. Additional fields, realistic authenticated load tests, UAT, and restore-tested backups require further work before real-data rollout.

## Importing onto the registry with no class yet (0.89.0)

A section is the older, shorter way of saying all three, since a section has
only one year and one grade. Sending an `academic_year_id` and a `grade_level`
with `section_id` null instead registers the learners and enrols them **at that
grade with no class**, which is how the school puts its whole roll on the
registry before the classes are settled.

```jsonc
// into a section, as before
{ "section_id": "<uuid>", "enrolled_on": "2026-06-01", "csv": "…" }
// onto the registry at a grade, with no class yet
{ "section_id": null, "academic_year_id": "<uuid>", "grade_level": 3, "enrolled_on": "2026-06-01", "csv": "…" }
```

**It is not a second way of enrolling.** Both call `place_enrollment`, which
`enrollmentCreate` has used for one learner since 0048, with the section as its
optional argument. So assigning a class afterwards is a **movement on the one
enrolment** — `POST /enrollments/:id/movements` with `action: "reassigned"` — and
not a second enrolment. That matters more than it reads: a learner with two
enrolments in one school year has two scholastic blocks for that year on their
SF10, and a permanent record saying they were in two classes at once.

Four refusals hold the shape, and each is tested in
`tests/roster-import-unplaced.test.ts`:

| | |
|---|---|
| Neither a section nor a year and grade | 422 from the contract. The destination is never guessed |
| A section contradicting the year or grade sent with it | 422 `SECTION_MISMATCH`. Not silently resolved one way: a class list landing at a grade other than the one its section teaches is a mistake worth refusing |
| Committing against a different destination | 409 `PREVIEW_CHANGED`. The section, year and grade are all in the plan hash and the input digest |
| A learner who already has an enrolment this year | refused on that row. So the same child cannot land on the registry list **and** on a class list — import one or the other, which the screen says in those words |

The preview answers `section: null` beside `academic_year_id` and `grade_level`;
the receipt carries `section_id: null` and `grade_level`. A year with sections
not yet created is no longer a dead end on the screen, because learners can be
registered onto it at a grade.

**What the school sees meanwhile.** Those learners are enrolled and count on
`GET /enrollment-counts`, at the grade they were registered at. Every SF4 figure
is counted *by section*, so they sit on no row — which is why 0052 reports them
separately as `unplaced`, counts by grade and sex naming no learner, and refuses
to **issue** the SF4 while any remain (`FORM_UNPLACED_LEARNERS`). The form can
still be *read*, because seeing who is missing is how the school finishes the
job. Row security follows placement, so no adviser can read an unplaced learner
until a class is assigned, and then only the adviser of that class.
