# Information requests for Balili Elementary School

Every remaining EDUNEXUS backend module is blocked on a decision or document the school holds. This file tracks those requests: what to ask for, why, what it unblocks, and what a sufficient answer looks like. The gates themselves are defined in [constraints](constraints.md); this is the operational side of opening them.

Update the status column as answers arrive, and record the resulting decision in the settled-decisions table in [constraints](constraints.md).

## Priority

Ask in this order. Request 1 alone unblocks roughly ten increments and is the critical path; it is also the slowest to answer because it depends on documents the school may have to retrieve. Send it first and separately rather than waiting to bundle everything.

| # | Request | Unblocks | Status |
|---|---|---|---|
| 1 | Grading enclosure and ECR examples | Arithmetic, MPS, GWA, finalization, promotion, SF9, SF10 — and, in practice, score entry, which needs an adopted policy to name assessments under | Not sent. Partly answered unasked — see below |
| 2 | AM/PM mark meanings and half-day rules | SF2, SF4, alternative-delivery conversion | Not sent. Two questions added 2026-09-19 |
| 3 | Blank approved form templates and signatories | SF2, SF4, SF9, SF10 rendering and release | Not sent. SF2, SF4 and SF9 for Grades 4–6 received 2026-09-19 |
| 4 | Kindergarten assessment policy | Kindergarten reporting | Not sent |
| 5 | Learner fields and class capacity | Registry acceptance and promotion capacity | Not sent. Observed section sizes known |
| 6 | Privacy owner and approved purposes | Importing any real learner data | Not sent. **Now urgent** — real staff records are held locally |
| 7 | Staff sign-in and acceptance testing | Section 1 sign-off, Section 7 turnover | Not sent |
| 8 | Design review of the ERD and the workspace | Closing User Design in the paper's own terms | Not sent |
| 9 | Confirmation of cloud hosting | Recorded deployment decision | Not sent |

## What arrived unasked, 2026-09-19

The school supplied three documents before any request was sent: a blank SF9 for Grades 4–6, a blank LIS-generated SF2 for one Grade 3 section, and a **filled** SF4 for July of School Year 2026–2027. [What the school's own forms specify](school-forms.md) records everything they establish and everything that must not be copied out of them; the gate-by-gate effect is in the table at the end of that file.

Two things follow for this file. Request 3 is most of the way open and its remaining items are now specific rather than general. Request 6 moved from important to urgent: the SF4 names 33 real staff, and no privacy owner has been named to hold them.

Nothing in the three documents names a learner.

## Handling what comes back

**Filled ECR files and form samples contain real learner names and grades.** Ask for them with learner names and LRNs removed, or replaced with placeholders. What EDUNEXUS needs from a sample is the structure, the formulas and the resulting numbers, not the identities. If the school can only supply unredacted copies, treat them as real learner data: they fall under request 6, and they must not be committed to this repository or pasted into any issue, chat or deployment log.

Keep every supplied document in the ignored local working area, never in version control. Record only the decision it produced.

## Request 1 — Grading enclosure and ECR examples

**Why:** the manuscript describes Written Works, Performance Tasks and Quarterly Assessments with transmutation, but its bibliography cites the June 2026 revised grading order, and DepEd separately issued an April 2026 three-term calendar order. EDUNEXUS cannot tell from the paper which rules apply to the target school year, and inventing them would silently produce wrong report cards.

**Ask for:**

- Which DepEd grading issuance the school is following for the target school year, by number and date.
- Its enclosure — the part that gives component weights per learning area and grade level, and the transmutation table.
- Two or three completed Electronic Class Records, one per grade level if they differ, with learner identities removed. A real one matters more than a blank template, because it shows the formulas and the rounding actually in use.
- How a missing score is treated: excused, zero, or excluded from the total.
- Whether the school year runs on quarters or the three-term calendar, and how many reporting periods per year.

**Sufficient answer:** enough to reproduce one learner's quarterly grade in one subject, by hand, and get exactly the number the school's own ECR shows — including the rounding at every step.

**Already answered by the supplied SF9**, for Grades 4–6 only: four quarters rather than three terms, so the reporting-period question is settled for that card; the descriptor bands and the passing mark of 75; and the learning-area list. **Still needed, and still the whole point of the request:** the issuance number and date, the component weights, the transmutation table, the rounding, and the treatment of a missing score. Do not let the descriptor table read as an answer — it is the output scale, not the arithmetic that reaches it.

## Request 2 — AM/PM mark meanings and half-day rules

**Why:** EDUNEXUS records morning and afternoon attendance separately and deliberately counts raw sessions. Turning those into official SF2 and SF4 totals needs the school's own rules, and guessing would misstate a learner's attendance record.

**Ask for:**

- What one morning mark and one afternoon mark mean for a day's attendance: does present-morning-absent-afternoon count as half a day, a full day, or an absence?
- How a school day is counted when only one session is held.
- The rule for a learner who transfers in or out mid-month: which day is their first or last counted day.
- How alternative-delivery participation converts to attendance, if at all.
- Who approves a monthly SF2 before it goes to the administrative officer, and what happens when a correction arrives after submission.

Added 2026-09-19, after reading the school's own SF2:

- **Does the school keep two-session registers at all?** The official SF2 has one column per school day, marked blank for present and `x` for absent. EDUNEXUS records AM and PM independently. If advisers only ever mark a day, the two-session model is ours alone and the conversion question changes shape entirely.
- **How is tardiness recorded, and does it belong in EDUNEXUS?** The form marks it by half-shading a day cell, upper for a late comer and lower for cutting classes, and the SF9 reports a count of times tardy per month. The `present | absent | null` enum can hold neither, and a tardy learner is present.

**Sufficient answer:** enough to compute a month of SF2 totals for one section by hand and match the school's own submitted form.

**Already answered by the supplied SF2:** the mark vocabulary, the three official formulas, the first-Friday cut-off and the two distinct denominators, the monthly summary fields, and the submission path through the principal's office into SF4. What remains is every rule for turning observed sessions into those figures.

## Request 3 — Blank approved form templates and signatories

**Why:** EDUNEXUS must render forms the school can actually file, not an approximation. Release versions and signatories also have to be recorded so a reprinted form matches what was originally issued.

**Ask for:** blank current SF2, SF4, SF9 and SF10 templates as used now; who signs each; and what the school does today when an already-issued form needs correcting.

**Received 2026-09-19:** the SF2 (LIS form version `2014.2.1.1`), the SF4 workbook, and the SF9 for Grades 4–6. Signatories are named on the forms themselves — adviser and school head on the SF2, Teacher-Adviser and Principal I on the SF9.

**Still outstanding:** the SF9 as used for Kinder and for Grades 1–3, the SF10 / Form 137, and the correction process. The correction process is the part no template can supply and the part the release-snapshot design depends on, so ask for it in words.

## Request 4 — Kindergarten assessment policy

**Why:** EDUNEXUS stores Kindergarten as grade level `0` and applies no numeric grading to it. Kindergarten uses descriptive assessment, and applying a Grade 1–6 numeric policy to it would be wrong.

**Ask for:** the checklist or descriptive instrument in use, how it is reported to parents, and whether Kindergarten appears in SF9 and SF10 in a different form.

## Request 5 — Learner fields and class capacity

**Why:** the registry stores a deliberately minimal profile. Before real enrollment the school should confirm nothing required is missing, and promotion needs capacity rules.

**Ask for:** any learner field the school needs that EDUNEXUS does not store; maximum class size per grade; whether sections are balanced by any attribute the school has authorized; and who decides section assignment.

**Narrower since 2026-11-04, and more urgent for it.** `learners.address` was added on that date (migration 0053) as one nullable line, by the user's explicit decision, for the initial learner-information import. The registry now holds the name, LRN, birth date, sex and address, and nothing else. So this request is no longer *"is anything missing?"* in the abstract: it is **which further fields the school needs and may lawfully keep**, asked while the system is about to hold 897 real children's records. Name the candidates when asking — mother tongue, religion, indigenous-group membership, parent or guardian, contact number, and whether the address must be broken into house number, street, barangay, municipality and province to match the school's own forms — and ask for each whether it is required, by whom it would be read, and under which approved purpose. **Answer this together with Request 6**, since each field named here is a field that request has to approve.

**Context from the supplied SF4**, which is observation and not policy: thirty sections, Kinder A–F at 18–20 learners and Grades 1–6 A–D at 29–37, the largest being Grade 4 A. Ask whether 37 is within an approved maximum or already over one. The SF4 also shows every section counted male and female separately at every level, which is worth raising against "balanced by any attribute".

**One more thing to ask, prompted by the SF4:** three teachers there carry no advisory and teach across sections — Science and MAPEH in Grade 4, and Araling Panlipunan paired with GMRC and with MAPEH across Grades 5 and 6. EDUNEXUS gives a teacher access only to the section they currently advise, and subject-teacher access was deliberately not invented. **Ask two things, in this order: first whether the school actually runs a subject-teacher role officially and what it is called, and only then what those three should be able to see and record.** Integration is deferred until the first is answered (2026-11-05), so an answer to the second alone does not start the work.

## Request 6 — Privacy owner and approved purposes

**Why:** education records are sensitive personal information under the Data Privacy Act. This has to be settled before any real learner record is imported, not after.

**Ask for:** who at the school is accountable for learner data; the approved purposes and the fields approved for each; how long records are retained; who may access what; and acknowledgement that hosting is on Supabase and Vercel.

**Sufficient answer:** a named person, a written scope, and a tested restore of a backup into an isolated project before the first real import.

**Raised in priority 2026-09-19.** The supplied SF4 holds 33 named staff with their positions, specializations and section assignments, and one record of a staff member on maternity leave. Its hidden template sheets also hold teachers from four other schools. That is real personal data sitting in the local working area with nobody named as accountable for it, and it arrived before the question was asked. Ask this one now, and ask explicitly whether the approved scope covers **staff** records as well as learner records — the request as originally written only says learner.

## Request 7 — Staff sign-in and acceptance testing

**Why:** an invited administrator identity exists but no real person has completed password setup, so an end-to-end authenticated login has never been proven. Section 7 also needs at least 27 concurrent teacher sessions.

**Ask for:** a scheduled session with the school head or administrative officer to complete enrollment and sign in once; agreement on acceptable response time and error rate; and a date when enough staff can be online together for a realistic load test.

**Note:** the paper asks for no second authentication factor, so sign-in is email and password only. Agree how a staff member requests a password reset when the emailed link does not reach them, and write that into the operational runbook.

## Request 8 — Design review of the ERD and the workspace

**Why:** the methodology makes the database design and the interface prototypes reviewable deliverables, approved by the school head, administrative officers and teachers, with revisions until they agree. Neither has been through that review.

**Ask for:** a session where the school walks through [the ERD](erd.md) and the deployed workspace, and says what is missing, misnamed or wrong. Record what they ask to change.

**Sufficient answer:** an approval, or a list of changes, attributable to named staff on a date.

## Request 9 — Confirmation of cloud hosting

**Why:** the paper says the deployment approach is decided with the client. EDUNEXUS runs on Vercel and Supabase because the operator chose that; the school has not confirmed it, and it is inseparable from where learner data physically sits.

**Ask for:** confirmation that cloud hosting is acceptable, or the constraint that would require a local deployment instead. This belongs in the same conversation as the privacy owner in Request 6.

## What the school does not need to decide

To keep the requests short, these are already settled and should not be reopened unless the school raises them: principals and administrative officers manage learner records while teachers see only their currently assigned learners; one adviser per section; and attendance marks are recorded as observed and never inferred.

**One item left this list on 2026-09-19.** "There is no automatic absence alert, because the school confirmed it has no approved threshold" is now contested by the school's own SF2, whose guideline 5 obliges the adviser to intervene for a learner absent five consecutive days, and whose monthly summary carries a field counting exactly those learners. Ask which is current: a form-level obligation on the adviser is not the same thing as an approved threshold for the system to act on, and EDUNEXUS must not raise an alert until one of the two is written down as the rule. Note also that one adviser per section holds, but one section per adviser does not — three Kinder advisers each hold two.
