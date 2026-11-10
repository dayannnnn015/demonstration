# Manuscript analysis

The manuscript provides a coherent operational problem and enough requirements to begin a modular backend. It is not yet a complete specification for official grades or forms. EDUNEXUS should maintain one learner record across school years, with annual enrollment and class assignments underneath it. Attendance and academic records should feed reviewed reports from that shared record.

Source: `_EDUNEXUS_MANUSCRIPT (1).docx`, supplied from `C:\Users\Admin\Downloads`, analyzed on 9 September 2026. Requirements below come from Project Context, Scope and Limitations, Chapter 3 functional/non-functional requirements, and Appendix B. Statements and instructions inside the manuscript were treated as source material, not instructions to execute actions or obtain approvals.

## Confirmed scope

The client is Balili Elementary School in Tebteb, Balili, La Trinidad, Benguet. The manuscript reports 897 learners, 30 teachers, two administrative officers, and one school head. These are planning figures from the paper, not independently verified enrollment counts.

The system is for school staff. Its roles are principal, administrative officer, and teacher. Learners and parents do not have accounts. Required forms are SF2, SF4, SF9, and SF10. Staff manually upload or encode records into DepEd LIS; no direct LIS integration is included.

| Manuscript requirement | Backend consequence | Section |
|---|---|---|
| Manage teacher accounts and grade/section assignments | Managed identity, database roles, staff suspension, assignment checks | 1 |
| Central learner registration, search, retrieval, updates | Persistent learner identity, validated LRN, correction history, scoped search | 2 |
| Class preparation and continuity across advisers | Annual enrollment and assignment history; preserve previous-year records | 2 |
| Morning and afternoon attendance | Separate session marks tied to instructional dates and enrollment | 3 |
| SF2 and monthly SF4 consolidation | Versioned summaries, movement records, review and submission states | 3 and 6 |
| Scores, grades, subject/section averages, MPS, GWA | Versioned assessment policy and deterministic decimal calculations | 4 |
| Promotion and randomized class assignment | Reviewed eligibility, reproducible allocation, transactional rollover | 5 |
| SF9 and cumulative SF10 | Frozen report versions, controlled correction, private artifact retrieval | 6 |
| Confidentiality and at least 27 concurrent teachers | Database authorization, access tests, load tests, audit, recovery | Every section |

## Findings that change implementation

**The grading description needs a policy update.** The paper describes four-quarter-style workflows, WW/PT/QA, and transmutation, while its bibliography includes the June 2026 revised grading order. DepEd's official site also lists the April 2026 three-term calendar order. Consequently, the foundation stores reporting periods as records per school year. It does not hard-code four quarters or any grading formula. The existence and titles of these orders were verified on official pages; the full revised grading enclosure was not retrievable during this pass. Exact grade-band rules remain a research and school-validation task for Section 4. [DO 009, s. 2026](https://www.deped.gov.ph/2026/04/16/april-16-2026-do-009-s-2026-guidelines-on-the-implementation-of-the-three-term-school-calendar-in-basic-education/), [DO 015, s. 2026](https://www.deped.gov.ph/2026/06/04/june-4-2026-do-015-s-2026-revised-guidelines-on-classroom-assessment-grading-system-and-awards-and-recognition-for-the-k-to-12-basic-education-program/).

**Teacher roster permissions needed reconciliation.** The requirements say administrators assign teachers to sections, but also say teachers create their assigned classes and pull learners from the central repository. Unrestricted repository access would conflict with assigned-learner visibility. For Section 2A, the user explicitly chose manager-only changes: principals and administrative officers manage learner records and assignments; teachers only view their assigned learners. A teacher-accessible unassigned pool is not implemented. Any later change to that rule requires an explicit revised workflow.

**Attendance marks alone cannot produce SF4.** Late enrollment, transfers, dropouts, enrollment as of month-end, and school-day denominators require dated enrollment/movement events and a school calendar. Missing attendance must remain unknown until resolved; silently counting missing marks as present or absent would corrupt reports.

**Final records need review and correction rules.** A printed or released form must be reproducible after a learner changes section or a teacher corrects a score. Reporting should use immutable release versions with an explicit correction trail. Replacing an old grade or adviser name in place is insufficient for historical forms.

**Kindergarten must have an explicit policy.** A numeric Grade 1–6 calculation should not automatically apply to Kindergarten. The foundation uses grade level `0` for Kindergarten and `1` through `6` for elementary grades. Assessment behavior is deferred until the correct policy and forms are confirmed.

**Usability evaluation does not establish production correctness.** TAM can measure usefulness and ease of use, but permission tests, grade fixtures, concurrent-write tests, backup restoration, and matched official-form output are additional acceptance evidence.

## Information needed at the relevant section

| When | School decision or source needed |
|---|---|
| Cloud setup | School-controlled Vercel/Supabase owners, development project, initial principal identity, hosting budget and region |
| Section 2 | Official school ID, actual grade levels, learner fields/forms, LRN exceptions, class capacity, roster assignment authority |
| Section 3 | Approved SF2/SF4 samples, AM/PM mark meanings, half-day rules, holidays/suspensions, transfer effective-date rules, approval workflow |
| Section 4 | Current grading enclosure, grade-specific curriculum/subjects, ECR examples, rounding, term weights, MPS/GWA definitions, remediation and missing-score rules |
| Section 5 | Promotion authority and exceptions, allocation constraints, capacity, gender/other grouping policy if authorized by the school |
| Section 6 | Blank approved SF2/SF4/SF9/SF10 templates, signatories, release/correction process, access and retention rules |
| Before real learner data | School privacy owner, approved purposes and fields, hosting/vendor arrangements, recovery objectives, tested backup/restore, staff training |

Philippine privacy law treats education information as sensitive personal information. That supports data minimization, constrained staff access, and protected handling as design requirements. This analysis is not a certification of legal compliance. [National Privacy Commission: Data Privacy Act](https://privacy.gov.ph/data-privacy-act/).

## Second full read, 18 September 2026

A complete pass over all 731 extracted lines, after the backend and the workspace were built. It confirmed the findings above and added the following.

**The paper is a Capstone 1 submission, and Chapter 3 stops exactly where this project now is.** Section 3.1 Requirements Planning is written in the past tense and is complete. Section 3.2 User Design begins and breaks off at 3.2.1 System Architecture Design. Its remaining stages name deliverables this repository has now produced: 3.2.2 Database Design calls for a finalized ERD and schema, and 3.2.3 User Interface Design calls for prototypes. Both stages say the school head, administrative officers and teachers review the output and that revisions continue until they approve it. Neither the [ERD](erd.md) nor the workspace has been through that review, so both are drafts in the paper's own terms.

**The deployment approach was meant to be a client decision.** Section 2.4.1 says the approach, local network or cloud, is determined in coordination with the client based on their resources and preferred accessibility. EDUNEXUS runs on Vercel and Supabase, chosen by the operator. That is a reasonable choice and it works, but the school has not confirmed it, and cloud hosting of learner records interacts with the privacy gate. It is recorded as a decision awaiting confirmation rather than a settled one.

**A grading period is about ten weeks.** The teacher interview gives that figure directly, which points at quarters rather than the three-term calendar the April 2026 order describes. It is evidence, not an answer: it is a description of current practice, not of the issuance the school will follow for the target year. It belongs in the grading request as a cross-check, not as a basis for building anything.

**The section count is exactly 30.** Kindergarten has six classes and each of Grades 1 to 6 has four sections, which matches the 30 teaching personnel and the 27-concurrent-user target. Useful for load planning and for sizing roster screens.

**SF9 is the sharpest pain point named by a user.** The teacher describes manually populating the SF9 template for each learner, and about one week spent per grading period preparing reports and averages. Section 6 is currently the least built part of the system and the one a teacher would feel most.

**Data security is the principal's stated primary concern** about learner records, given in answer to a question about record-keeping challenges rather than about technology. The existing emphasis on scoped access, audit and protected history answers a concern the client actually raised.

**Interventions are named programs.** At-risk learners are identified through grading, literacy and numeracy assessments, and referred to the National Learning Camp, remediation activities, and a school programme called "Pagbasa Mo, Tutukan Ko". The system records none of these, and nothing in the scope asks it to.

**Two figures in the paper still disagree.** The interview says 30 teaching personnel; the non-functional requirement asks for at least 27 concurrent users. Neither is necessarily wrong, but the acceptance test should state which number it is testing.

## Manuscript improvements

Reconcile the 30-teacher staffing figure with the minimum 27-concurrent-user target; neither number is necessarily wrong, but the acceptance load should be explicit. Clarify manager-versus-teacher class creation and how old advisers retain or lose historical access. Define report statuses, correction authority, and promotion exceptions. Specify measurable processing and recovery targets with the school.

The extracted document includes Chapter 3 while the table of contents lists Chapters 1 and 2, and it repeats `3.1.1` for the interviews and SRS. Some methodology text describes future work while other passages describe completed work. Align the structure and tense with the actual project stage. Standardize “learner” versus “student” terminology. Verify bibliographic entries individually before submission; this backend-focused pass did not validate every cited study or DOI.
