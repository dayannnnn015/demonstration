# EDUNEXUS

EDUNEXUS supports learner attendance and academic records for Balili Elementary School, La Trinidad, Benguet. It currently implements staff/school setup, learner registration/enrollment, reviewed roster imports, LRN and timeline corrections, learner identity reconciliation, enrollment void/restoration, grade-placement corrections, instructional calendars, daily/monthly attendance, manual follow-up, subject catalog/section offerings, and **Section 4B.1: assessment tasks and raw score entry**. Staff invitations are tracked records and account recovery can be initiated from the sign-in page. Backend development remains the priority. The [school workspace](https://edunexus-balili.vercel.app/app) covers Section 1 setup, the Section 2A learner registry and enrollment, and the whole of Section 3 attendance: the instructional calendar, the daily register, monthly consolidation, the absence monitor and manual follow-up cases, plus the subject catalog and each section's subject offerings. Later modules are API-only and appear as honest placeholders.

Picking this project up, as a person or an agent? Start with [AGENTS.md](AGENTS.md), the working contract, and [where things stand](docs/status.md). `CLAUDE.md` points at the same file, so Claude Code and Codex read identical instructions.

The manuscript has been analyzed and the work is divided into reviewable sections. Read [standing rules, gates and settled decisions](docs/constraints.md) first: it records what must never be built and what is blocked on a school decision, and [school information requests](docs/school-information-requests.md) lists what to ask the school to unblock it, against what [the school's own forms](docs/school-forms.md) already establish. Then read [the manuscript analysis](docs/manuscript-analysis.md), [implementation roadmap](docs/roadmap.md), and [architecture](docs/architecture.md) before extending it.

The [20 September backend review](docs/backend-review-2026-09-20.md) records the maintenance fixes and the four score-database defects it reproduced; migration `0022` corrected all four. Existing test coverage is not a production-readiness claim.

## What works in Section 1

- Supabase staff token verification with signature, issuer, audience, expiration, and live identity checks.
- Principal, administrative officer, and teacher permissions, enforced in the API and PostgreSQL row-level policies.
- Staff authorization, updates, suspension, and protection against self-lockout or removing the last principal.
- School profile, draft/active/closed school years, configurable reporting periods, and Kindergarten–Grade 6 sections with adviser assignments.
- Teacher access restricted to their assigned sections.
- Version checks to prevent lost updates, transactional audit records, and persistent request limits.
- Versioned SQL migrations, an OpenAPI contract, automated tests, CI, and Vercel configuration.

## What works in Section 2A

- Minimal learner identities with unique official LRNs, required for every new learner since 0.64.0 (an older record without one is completed on the registry), and versioned profile corrections.
- Scoped learner search and annual enrollment, with one enrollment per learner per school year.
- Dated same-grade section reassignment, withdrawal, and reentry with immutable event history.
- Manager-only changes and teacher visibility limited to current assigned open-year rosters.
- Read-access auditing, atomic rollback, protected history, and current-version checks on movements. Managers review the read log by staff member or by record ID on the Privacy access log screen.

## What works in Section 2B.1

- Bounded class-roster CSV validation and preview with explicit duplicate resolution.
- Confirmation bound to the reviewed file and record versions, atomic import, and safe retry receipts.
- Reviewed assigned-LRN correction preserving previous values, reason, actor, and request metadata.
- Database/API restrictions on preview ownership and protected correction history.

## What works in Section 2B.2

- Enrollment timeline preview and manager confirmation with version/context checks.
- Repair of dates, initial assignment, missed movements, and mistaken movements with immutable before/after snapshots.
- Effective timeline resolution alongside preserved original movement records, with updated teacher roster access.

## What works in Section 2B.3

- Reviewed, reversible duplicate links with preserved profiles and original enrollment history.
- Conflict checks for assigned LRNs, identity fields, annual enrollment, and stale reviews.
- Retained learner roster visibility, protected history, and import/timeline integration.

## What works in Section 2B.4

- Reviewed void/restoration of erroneous annual records, with immutable evidence and preserved timelines.
- Explicit retained-record references for duplicates and conflict protection on restoration.
- Roster/import/identity integration, with voided records excluded from valid annual enrollment.

## What works in Section 2B.5

- Reviewed whole-year grade correction with explicit replacement sections across the effective timeline.
- Preserved original movements, dates, reasons, and enrollment identity, with immutable old/new grade evidence.
- Updated teacher roster access and compatibility with later movements, timeline corrections, and reviewed reversal.

Read [learner registry](docs/learner-registry.md), [registry review](docs/registry-review.md), and [enrollment timeline](docs/enrollment-timeline.md) for API workflows and limits. Read [learner identity](docs/learner-identity.md) for linking and reversal. Read [enrollment record review](docs/enrollment-records.md) for resolving overlapping annual records. [Grade-placement corrections](docs/grade-placement.md) are implemented. School-reviewed sample mappings, additional learner fields, and class-capacity decisions remain. Attendance consolidation, grading, promotion, and forms remain subsequent work. No real learner data has been imported. See [deployment](docs/deployment.md); real invited-user sign-in and school acceptance remain to be verified.

## What works in Section 3A

- Explicit AM/PM schedules with classroom, alternative-delivery, no-class and suspended modes.
- School baselines and section overrides, with unknown dates kept unconfigured.
- Manager preview/confirmation, conflict protection, immutable review history and atomic batches.
- Effective schedule reads for assigned teachers, bounded requests and shared calendar version checks.
- A manager screen reading one month at a time, setting or clearing dates through preview and confirmation, and showing every change in the year.

Read [instructional calendars](docs/instructional-calendar.md). An unconfigured date is drawn as unknown on that screen, never blank: it is not a holiday, not a school day and not an absence.

## What works in Section 3B.1

- Dated sheets using effective enrollment history and current teacher access restrictions.
- Reviewed classroom AM/PM present/absent marks in atomic batches of up to 100 learners.
- Explicit unknown marks, corrections/clearing, protected history and stale-review checks.
- Calendar/enrollment guards preventing existing attendance from being silently invalidated.
- An adviser screen marking one section on one date, both sessions, reviewed and committed as one batch.

Read [daily attendance](docs/daily-attendance.md). A mark is present, absent or unrecorded, and the third is a real choice: only an explicit null clears one, and an unmarked session is never read as presence.

## What works in Section 3B.2

- Monthly readiness with complete date-effective membership, explicit unknowns and raw classroom session counts.
- Manager-reviewed submission, return, locking and reopening with immutable submission snapshots.
- Frozen-month guards for daily marks, calendars, enrollment and identity corrections.
- Teacher status-only access, manager snapshot/history pagination and atomic version/hash checks.
- A manager screen offering only the transitions the current state allows, with every blocking issue written as a sentence.

Read [monthly attendance](docs/monthly-attendance.md). Alternative-delivery conversion, official totals and absence alerts remain later work. Every count the screen shows is a raw classroom session, and it says so.

## What works in Section 3B.3

- Read-only classroom absence monitoring over 1–31 dates, with filtered 100-learner pages.
- Raw session observations, missing/unsupported data and within-range absence runs.
- Current teacher access, historical manager access and returned-record auditing.
- Live correction refresh and monthly freeze status without changing saved snapshots.
- A screen over a window of up to 31 dates, validated before the request, with every count stated beside the window that produced it.

Read [absence monitoring](docs/attendance-monitor.md). School alert policies and notifications remain later work: there is no threshold on that screen, because the school has no approved rule to put there.

## What works in Section 3B.4

- Manager-reviewed follow-up cases for recorded absences or gaps in recording.
- Assigned managerial responsibility, due dates, notes, resolution, cancellation and reopening.
- Immutable opening evidence and action history, with current-evidence comparisons.
- Duplicate-open-case protection, filtered queues and post-closure case resolution.

Read [attendance follow-up](docs/attendance-followups.md). The school has no approved automatic-alert rule, so automation and messages remain disabled. Managers open and act on cases by hand on the Follow-up cases screen.

## What works in Section 4A.1

- Explicit subject catalog with stable codes, learning-area/domain kind and grade applicability.
- Versioned metadata changes, archival and protected before/after history.
- Staff metadata reads, manager-only changes and no seeded curriculum or grading formula.

Read [subject catalog](docs/subject-catalog.md). This increment is API-only.

## What works in Section 4A.2

- Per-section subject selections preserve the selected catalog revision.
- Explicit draft-year refresh, retirement/reactivation, display order and protected history.
- Grade applicability, stale-version, archival and closed-year checks.
- Manager-only changes and current-adviser reads without expanded learner permissions.

Read [section offerings](docs/section-subjects.md). Operational grading policies and assessment entry remain subsequent work.

## What works in Section 4A.3

- Manager-only assessment drafts with source references and explicit Grades 1–6 applicability.
- Validated component weights stored as integer basis points totaling 100%.
- Versioned revisions, archival/restoration and protected before/after history.

Read [assessment-policy drafts](docs/assessment-policy-drafts.md). Drafts are non-operational: no approval, offering binding, score entry or grade calculation is enabled.

## What works in Section 4A.4

- Manager-only records that the school adopted one exact unarchived draft revision for one school year.
- Frozen policy snapshots that later draft revisions never change, plus an explicit school reference and in-year adoption date.
- One standing adoption per school year and policy, reviewed one-way withdrawal, and re-adoption afterwards.
- An adopted draft cannot be archived until its adoption is withdrawn.

Read [assessment-policy adoption](docs/assessment-policy-adoptions.md). Adoption records a school decision only: no score entry or grade calculation is enabled, and an adoption reference is not proof of approval.

## What works in Section 4A.5

- Manager-only records of which section subject offering a standing adoption governs.
- Reviewed binding on current offering and adoption versions, one shared school year, an active offering and an applicable section grade.
- One standing binding per offering, reviewed one-way release, and rebinding afterwards.
- Standing bindings block adoption withdrawal and offering retirement until released; closed years are read only.

Read [assessment-policy binding](docs/assessment-policy-bindings.md). Binding is a scoping record.

## What works in Section 4B.1

- Named assessments whose component codes come from the bound adopted revision, never invented.
- Raw marks in batches of up to 100, each against its own version, with unrecorded learners left null rather than zero.
- Clearing that preserves history, protection against lowering a maximum below a recorded mark, and archival.
- Adviser entry for current sections, manager historical access, and manager-only task and score journals.
- Marks of a learner who has left are kept for managers and closed to their former adviser, in SQL as well as over HTTP.
- Only an explicit null clears a mark, and every score read names the learners it disclosed in the privacy audit.
- An adviser reads the component codes and names of the policy bound to their subject, never its weights, so they can name an assessment (migration 0024).
- A Scores screen: add an assessment, type a class's marks, review and record them in one batch; blank stays unrecorded, and nothing is totalled or averaged.

Read [assessment tasks and raw scores](docs/assessment-scores.md). No total, average, percentage, transmutation or grade is computed anywhere; those wait on the school grading enclosure.

## What works in staff invitations

- Manager-recorded invitation requests with intended email, name and permission level.
- Operator-provisioned Auth identities linked so school access and the invitation complete in one transaction.
- One open request per email, terminal completion and cancellation, and protected history.
- Browser-initiated password recovery from the sign-in page, answering identically whether or not an address is registered.

Read [staff invitations](docs/staff-invitations.md). A manager records the request, then creates the account from the same screen. The API runtime still holds no service-role key: the key is confined to an isolated Edge Function whose only action is inviting one address, and a deployment without one keeps the operator's link-by-UUID route.

## What works in notifications

- A personal inbox per staff member, with an unread count, newest-first paging and mark-one or mark-all read.
- Emitted inside the transaction that made the change, by the writer that made it, so a notification cannot report something that did not happen.
- **No notification names a learner.** The payload admits a closed list of keys and the database refuses any other.
- **An inbox is personal**: the row policy answers only rows addressed to the caller, so a principal reads their own and not the school’s. It is the one table where being a manager grants nothing.
- **The API cannot send one.** `notify` is never granted to `edunexus_app`; only a security-definer writer can.
- Emitters: the four roster-submission events; enrollment — an import (once, with a count), a move, a withdrawal, a re-entry (0.94.0); and the monthly consolidation, promotion outcomes and the instructional calendar (0.95.0).
- **No notification carries an attendance figure.** The absence-alert gate is untouched: a month notification says a month moved, never how often anyone was absent.
- A bell in the top bar with the unread count, and a centre listing your own, newest first, with mark-one and mark-all read (0.93.0).

Read [notifications](docs/notifications.md). This reverses two settled decisions, on the user’s explicit decision of 2026-11-05, and the reasons are recorded there and in [constraints.md](docs/constraints.md). **Nothing here alerts, messages or notifies on attendance**: the absence-alert gate is untouched and still shut, and no figure is counted, compared or thresholded. Since 0.93.0 a **bell** in the top bar carries the unread count and opens the notification centre; the count names no record and writes no access row, so it may be polled.

## What works in the school workspace

The workspace at `/app` is a keyboard-navigable administrative interface: minimal since 0.63.0 — a light navigation rail divided from the page by one hairline, a near-white canvas and flat white cards, so the records are the only thing that holds the eye. Tables keep the register's hairline rules between rows, because every form the workspace feeds is a ruled sheet and that is the structure the staff already read. Every editor whose record feeds a school form says, above its save button, what else the save changes, and the SF2, SF4 and SF10 are edited on the forms themselves. The modules it covers are real screens; the rest appear in the navigation as honest placeholders rather than disappearing. It covers:

- **Help** (0.66.0): **Help & FAQ** in the rail opens a start for each role and a guide for every screen that role can open: what it is for, the steps in order, and when it will stop you and why; and since 0.67.0 a searchable FAQ, each question linkable and listed under the screens it concerns. Since 0.68.0 help comes to the work: **Help** in the top bar, or the ? key, opens the screen's guide over the page, and a refusal the FAQ explains carries *What does this mean?*, opened without leaving what was being typed. Since 0.69.0 a guided tour points at the live interface, step by step, and never presses anything itself; each role's *Start here* offers the tour of the workspace, and since 0.70.0 advisers have tours of the register, their class list and report cards; since 0.71.0 the principal and administrative officer have tours of setting up a year, closing a month, approving outcomes, the front page and staff. Since 0.74.0 **Print the whole guide** on Help & FAQ prints everything for the reader's role from the same text, so the printed guide and the one on screen cannot differ. Since 0.73.0 the front page can answer parents' questions at `/faq`, written and published by the principal or administrative officer (migration 0039). Since 0.72.0 the Overview opens with **Getting started**, a list of what the records still lack for the reader's role, which offers the role's tours and goes away once everything on it is done. Help is fixed text in `web/help/`, reads no record, and names only controls a test finds in the screens. See [the help and tutorials plan](docs/help-and-tutorials-plan.md).
- **Accessibility** (0.86.0): on My profile, higher contrast, underlined links, a thicker focus outline, larger buttons, more line spacing and a typeface for low vision, saved with the account; forms print as they always did.
- **Signing in** (0.85.0): the school's hillside beside the form, and the browser's own password manager offers to save the email and password once they work, so staff need not type them each time; the session still ends when the tab closes.
- **Advisers on Staff access** (0.84.0): a teacher's sections are ticked on their own row on Staff access, or every section's adviser set in one table there; a year's sections are created on School years & sections. Moving a section from another adviser asks first.
- **End-of-year outcomes on the Overview** (0.83.0): endorsements wait for the principal and administrative officer on the Overview, which opens each section's approval, and offers next year's classes for a grade once all its incoming learners are decided. Approval still places nobody: the classes are a reviewed draw.
- **My profile** (0.78.0): from your name at the top right, how the school has you recorded and the sections you advise, and your picture: initials, a drawn icon or a real photo, framed in the browser and kept without what the camera recorded. A manager can take down a colleague's photo from **Staff access**, which now shows faces. Migration 0043; see [your profile](docs/staff-profiles.md) and [the plan](docs/profile-plan.md). Since 0.79.0 it also holds **Signing in**: two-step sign-in with an authenticator app, which the API then requires of that account, the browsers where you are signed in, and **Sign out everywhere else** (migration 0044). Since 0.80.0 a person asks for their name or position to be corrected and a manager approves it on **Staff access**, and **Your activity** lists one's own changes and record reads (migration 0045). Since 0.81.0 preferences follow the account: the screen to start on, text size, less motion, and a light, dark or device theme, with printed forms unchanged.
- **An overview**: where the school year stands — its reporting periods with today marked, how many learners are enrolled at each grade, sections by grade, the section-and-adviser list, who holds access, and the latest recorded changes. The learner count names nobody, so loading the Overview writes nothing to the privacy audit. No average, attendance rate or standing appears, and the screen says so.
- **Section 1 setup**: school profile, staff authorization and access, school years, reporting periods, sections and advisers, and the change-audit history.
- **Attendance, end to end**: configure the instructional calendar a month at a time, mark a section morning and afternoon, review a month and submit or lock it, read recorded absences and gaps over a chosen window, and open, reassign and resolve a follow-up case by hand.
- **Year setup in batches**: create a year's sections from the SF4 layout, assign every adviser from one table, fill a stretch of the calendar with its holidays, and request invitations for a pasted staff list, each row still its own recorded change.
- **The parent or guardian on the learner record** (0.92.0, migration 0056): one name and one contact number, both optional, shown on the Learner profile and corrected with it. The number is kept exactly as the school wrote it — a mobile, a landline with an area code, or both — and is never reformatted. A learner the school has written no guardian for reads as *unrecorded*, never as having none. Nothing else about a child's family is held; what is not collected is named on the profile rather than left as an empty line. Not in the class-list import template, which still carries its eight columns.
- **Settings is a screen of its own** (0.92.0): how the workspace looks and behaves for you — preferences, accessibility and the guided tours — opened from your name at the top right, beside **My profile**, which keeps who you are, your picture, how you sign in and what you have done. Ctrl+K reaches either by name. No preference changed and nothing needed a migration.
- **One SF9 per grade level, and the history of them** (0.104.0): an issued SF9 is kept exactly as it was issued, against that learner, school year and grade level; a promoted learner starts the next grade with a card of its own, carrying none of the previous grade’s grades or general average; and neither overwrites the other, because the card is **derived per enrolment** rather than stored and every issuance names its own enrolment. A learner’s profile now says, for each school year, whether that year’s card is **issued** — with its serial and date — **in progress**, or **no Kindergarten card**, which the school has supplied none of. See [the SF9 history](docs/sf9-history.md).
- **Promotion waits, and an approved outcome moves the learner** (0.103.0): the **Promotion** section stays closed until a class’s report cards are complete — every learning area in every configured term, each subject average and remark, and each general average, judged against what that grade’s card actually prints, so Kindergarten waits for nothing and a descriptively graded grade waits for its narratives. Approving an outcome then **enrols the learner into next school year by itself**, at the next grade for a promotion and the same grade for a retention, with no class yet, so next year’s adviser takes them in through the same pull; when next year has not been created, the carry-forward runs the moment it is. And **a term accepts grades only once it has started**, on the date the school configured for it — finishing one term opens nothing. Nothing is deleted, nobody is enrolled twice, and approving a promotion activates no reporting period. See [the promotion gate](docs/promotion-gate.md).
- **One learner in three parts** (0.91.1): opening a learner on the Learner registry gives **Learner profile**, **Academic history** and **Enrollment** — the identity record, the previous school years transcribed from the school’s own documents, and the annual enrolment timeline, which are three different records rather than three views of one. The profile shows what the class-list import already carried, so an imported learner is never typed in twice, and a correction is the same manager-only write on the same record; the facts EDUNEXUS does not hold about a child are named rather than left as empty lines. See [the learner registry](docs/learner-registry.md#one-learner-in-three-parts-0911).
- **A learner's year**: from the Learner registry, one learner's attendance by month, their absences and every raw mark, read for that learner alone, printable for a parent conference.
- **School forms**: advisers see the month's SF2 inside Daily attendance; the principal and administrative officer have School Form 2 and School Form 4; every learner's SF9 and SF10 open from their row in the Learner registry; an open page notices a newer release.
- **SF9 and SF10**: each grade's report card and the permanent record, filled from the recorded grades and the attendance rule, printed and issued; see [the SF9 and SF10](docs/report-card-forms.md).
- **Report cards**: advisers record the grades the ECR computed, observed values and comments for the SF9 and SF10; see [report-card records](docs/report-records.md).
- **Academic history** (0.87.0): the school years a learner finished before EDUNEXUS, typed in once from the school's own spreadsheets and forms, onto the learner's one cumulative SF10 beside the years EDUNEXUS recorded itself. For every existing learner from Kindergarten to Grade 6; a Kindergarten record is the credential presented for Grade 1, which carries no grade. See [the academic history](docs/prior-academic-records.md).
- **An adviser builds their own class** (0.90.0): on the Learner registry, **Take learners into my class** lists the learners the office has registered at that class’s grade with no class yet and takes as many as the adviser ticks into it; **Register a new learner into my class** is for a child the school has never held, and is refused when the same name and birth date is already on the registry. Both go through the same two enrolment writers as everything else, so no second learner record is ever created, and a teacher still reads only the classes they advise. See [an adviser’s own class roster](docs/teacher-roster.md).
- **School-wide encoding oversight** (0.90.0): **Across the school** on Academic history shows a manager, for every class, how many learners have a previous school year or the Grade 1 credential encoded, how many have neither, and who the adviser is — counts only, naming no learner and recording no access to anybody’s records.
- **Register every learner first, settle the classes afterwards** (0.89.0): the class-list import also takes a school year and a grade with no section, enrolling every learner in the file at that grade with no class yet. Assigning a class later is a change to that one enrolment, never a second one, so no learner ever holds two enrolments for a school year. Unplaced learners are reported on the SF4 as counts naming nobody, and the SF4 cannot be issued until every registered learner is in a class. See [registry review and import](docs/registry-review.md#importing-onto-the-registry-with-no-class-yet-0890).
- **Learner address, and the class-list template as Excel** (0.88.0): the registry holds one line of address beside the name, LRN, birth date and sex, and **Roster import** offers the EDUNEXUS Excel template that carries all of them, with what each column holds and a worked row in the file itself. Registering one learner at a time is unchanged. Any further learner field waits on the school's reviewed field list. See [registry review and import](docs/registry-review.md).
- **The school's front page** at the root address: announcements, events, the school calendar, about and contact, showing only what the principal or administrative officer publishes on **Public site**; staff sign in at `/app`. See [the public front page](docs/public-site.md).
- **DepEd's 2026 orders**: the SY 2026–2027 calendar and three terms from DepEd Order No. 9, s. 2026 offered for review; conditional promotion and Grade 1's descriptive grading from DepEd Order No. 15, s. 2026. See [school forms](docs/school-forms.md#depeds-2026-orders).
- **Grade entry** (managers): how many grades, general averages and outcomes each section has recorded, for each term, counted without reading a grade; and on Report cards each section's **class summary** of entered grades, printable. See [report-card records](docs/report-records.md#grade-entry-and-the-class-summary-0560).
- **Next year's classes** (managers): continuing learners enrolled into the following year from their approved outcomes, each grade's sections drawn from a repeatable draw number and balanced by sex, all at once; see [next year's classes](docs/next-year-classes.md).
- **End-of-year outcomes**: the adviser recommends promoted, retained or remedial, the principal or administrative officer approves, and the SF9 and SF10 print the grade the learner is eligible for; nothing is derived from grades.
- **SF2 and SF4, complete**: computed by the attendance rule the principal records, printed in the templates' layout, saved as Excel, and issued with a fingerprint; see [the attendance forms](docs/attendance-forms.md).
- **Class lists from advisers**: an adviser checks and submits their section's list on Roster import; a manager imports it through the reviewed import, which accepts the list.
- **Attendance today** (managers): every section's register for one day, in counts, naming no learner.
- **SF4** on Monthly consolidation: registered learners and movements by section and sex, in the form's own columns, with the attendance columns waiting on the school's rule.
- **Downloads**: a section's class list and a month of raw marks as spreadsheets, every cell saying what is there and nothing counted. See [the staff guide](docs/guides/staff-guide.md).
- **Subjects and section offerings**: managers maintain the subject catalog and choose each section's subjects, each offering pinned to the catalog revision it was chosen from; advisers read their own section's list. **While the hosted database holds seeded test data, every screen says so; see [the runbooks](docs/runbooks.md#seeded-test-data-and-the-go-live-wipe).** The learning areas printed on the school's report cards for Grades 1–6 can be added in one reviewed batch, and a section offered its grade's card in printed order, each row still its own journalled change.
- **The SF9, typed on the SF9** (0.62.0): from the Learner registry, **Type on the card** turns every box an adviser fills into an input on the printed card, reviewed and recorded together; attendance stays counted from the register. The SF9 and SF10 open in a view of their own beside the rail. The SF2 fits a laptop screen and counts a month under way to date. See [the SF9 and SF10](docs/report-card-forms.md#typed-on-the-card-0620) and [the attendance forms](docs/attendance-forms.md#a-month-under-way-0620).
- **The report card, box by box** (0.61.0): on **Promotion → Report card**, one learner's card laid out as it prints, every box typed and recorded together or not at all. See [report-card records](docs/report-records.md#the-report-card-box-by-box-0610).
- **One late learner** (0.60.0): the administrative officer enlists a learner without a file, finding a record already on file first; an adviser adds one row to the class list they submit.
- **Roster import**: preview a class list from the EDUNEXUS template, as an Excel or CSV file, decide each possible duplicate explicitly, then import the identical reviewed file into one section in one step, all rows or none.
- **Assessment policies** (left the menus with raw quiz scores in 0.60.0; grades are entered as subject averages from the ECR): record the school's policy as an unapproved draft of components and weights, record the school's adoption of one exact revision for a year, and bind it to a section's subjects. The weights are typed from the school's documents; nothing supplies a default and nothing computes from them.
- **Raw score entry**: add a named assessment under a component of the policy bound to a subject, then type a class's marks and record them in one reviewed batch. A blank stays unrecorded, and no total, average or grade appears anywhere.
- **The privacy access log**: every read that returned a learner or enrollment record — who, when, what kind of read and which record IDs — narrowed to one staff member or one record. A learner's own panel links straight to the reads of that learner. It shows IDs, not names, because resolving a name would itself be a read.
- **Staff invitations**: request an invitation, record the operator-provisioned identity, or cancel, with the state of every outstanding request.
- **Section 2A learner registry**: scoped search by name, exact LRN or birth date; managers register learners, correct details, fill a pending LRN, and read each learner's annual enrollment records.
- **Enrollment and movements**: enrol a learner into a section, then record dated reassignment, withdrawal with a recorded reason, and re-entry, with immutable movement history.
- **Reviewed corrections**: correct a recorded timeline or a year's grade, void or restore an annual record, correct an assigned LRN, and link or unlink duplicate registry entries for the same child. Each shows the server's own review of the change before it is confirmed, and every original stays on file.

**A record that does not exist is drawn, not left blank.** An unmarked attendance session and an unentered score are null, never zero and never "present", so a missing value carries a ruled diagonal mark and says what is missing — "LRN not issued", "No adviser". The same mark, at panel size, is what the Overview uses to name the general average, attendance rate, academic standing and class ranking this system may not state, and what each of them waits on. An em dash would read as a value somebody typed.

**Ctrl+K opens a command palette** onto every screen. It searches their names, sections and descriptions, and since 0.68.0 the help and FAQ, and nothing else: every learner and enrollment list writes an access-log row naming the exact records returned, so a palette that searched the registry would write one per keystroke.

**Errors sit beside the field that caused them.** A rejected save marks each field, prints the server's own message under it, and focuses a summary that lists every problem and jumps to each one. Creating a record opens a side panel rather than a second form parked under the list, and anything irreversible is confirmed in a dialog that states the consequence rather than asking "are you sure".

**The workspace prints.** A section list is carried to a classroom on paper, so printing drops the navigation and the chrome, keeps the register, and repeats table headings across pages.

Sessions are held in `sessionStorage`, so a refresh keeps you signed in and closing the tab ends the session. Sign-in, invitation completion, password recovery and changing your own password from the profile menu all run against Supabase from the browser; a change asks for the current password first.

Role-aware navigation hides what a staff member cannot use, but the API remains the authority. Teachers receive only their currently assigned learners. Reviewed learner corrections — an LRN, a timeline, a duplicate identity, a voided record, a grade placement — are manager-only and each goes through a review before it is confirmed. Advisers read the subjects offered to their own sections; only managers change the catalog or an offering. Attendance does not: an adviser marks and monitors their own sections and reads their own section's calendar, while consolidation, calendar changes and every change history are manager-only.

A screen states what it is in one line and names the DepEd form its records end up on, because staff navigate by form name rather than by module. Identifiers are set in a monospaced face throughout, so a twelve-digit LRN can be checked against paper a digit at a time.

The rail groups the twenty screens and each group folds away; the rail itself collapses to an icon strip, and both preferences end with the tab rather than following a person around a shared staffroom machine. The top bar carries the page title, the active school year — the scope every record is filed under — the palette and the signed-in identity. There is no notification bell: nothing in this system may raise an alert yet, so a badge would imitate a signal that does not exist.

Read [frontend integration](docs/frontend-handoff.md) before extending it.

## Release history

[CHANGELOG.md](CHANGELOG.md) lists every released increment, its manuscript section and its database migration. The current release is **0.28.0**.

## Development

Operating the live system — removing someone's access, rolling back a release, restoring into an isolated project, rotating a leaked credential — is in [the runbooks](docs/runbooks.md), none of which has been drilled yet.

Requirements: Node.js 24, npm, and a dedicated Supabase development project. The workspace is a Vite + React app in `web/`, built into `public/` and served by the API at `/app`. Automated database tests use PGlite and do not need Docker or cloud credentials.

```powershell
rtk proxy npm.cmd ci --ignore-scripts
rtk proxy npm.cmd run check
rtk proxy npm.cmd run api:export
```

`npm run demo` starts the real API and workspace over an in-memory database of synthetic records, with a choice of synthetic principal, officer or adviser in place of sign-in, at http://127.0.0.1:5173/demo.html. It needs no `.env`, listens on the loopback address only, forgets everything when stopped, and is never part of the production build. Use it to look at a screen, take a screenshot for a guide, or let staff practise.

`npm run seed:demo-registry` prepares a database for a live demonstration to the school: learner profiles, one class per grade, and the source school year those classes sit in, and nothing beyond it — the next school year, promotion, enrollment and the adviser pull are left for the school to perform. Rehearse it with `-- --rehearse`, and add `--prove` to walk those five operations against a throwaway database first. It refuses unless the database holds no school year, section, learner or enrollment, so run `RESET_CONFIRM=wipe-seeded-data npm run reset:seeded-data` before it. Why it seeds a school year and classes at all, and why the source year is 2025–2026, are in [docs/demo-registry.md](docs/demo-registry.md).

For an API connected to Supabase, copy `.env.example` to `.env` and complete the deployment setup below. Do not use a privileged database URL as `DATABASE_URL`.

```powershell
rtk proxy npm.cmd run db:migrate
rtk proxy npm.cmd run db:credentials
rtk proxy npm.cmd run db:bootstrap
rtk proxy npm.cmd run dev
```

Run `npm run dev:web` alongside `npm run dev` for a hot-reloading frontend on Vite's port, proxying the API to 3001. `npm run build` produces the bundle the API serves at `/app`.

The local API listens on `http://127.0.0.1:3001`. `npm run build` compiles the backend; `npm start` runs that build. The live runtime uses PostgreSQL, never the PGlite test fixture.

## API

The machine-readable contract is [docs/openapi.json](docs/openapi.json) and is served at `/openapi.json`. [Frontend integration](docs/frontend-handoff.md) explains authentication, response envelopes, dates, pagination, and version conflicts.

All business endpoints are under `/api/v1` and require `Authorization: Bearer <Supabase access token>`. `/`, `/health/live`, `/health/ready`, `/openapi.json`, `/app`, and the account setup/configuration endpoints are public and return no personal records. `/`, `/app` and `/account/setup` all open the workspace described above, sharing the same password sign-in. Readiness checks the database, restricted runtime role, school bootstrap, and rate-limit function; it does not certify an end-to-end Supabase login.

## Repository layout

```text
src/core/                 Authentication, configuration, database, errors
src/modules/foundation/   Section 1 contracts and business operations
src/modules/registry/     Section 2A learner and enrollment operations
src/modules/registry-review/ Roster import review and LRN corrections
src/modules/enrollment-timeline/ Effective timelines and reviewed corrections
src/modules/learner-identity/ Reviewed duplicate links and reversals
src/modules/enrollment-records/ Reviewed annual-record void and restoration
src/modules/grade-placement/ Reviewed whole-year grade corrections
src/modules/calendar/    Reviewed school/section instructional schedules
src/modules/attendance/  Dated sheets and reviewed classroom AM/PM marks
src/modules/attendance-months/ Monthly completeness, snapshots and locks
src/modules/attendance-monitor/ Scoped absence and completion evidence
src/modules/attendance-followups/ Manual managerial cases and evidence history
src/modules/subjects/    Explicit subject metadata and revision history
src/modules/section-subjects/ Pinned section offerings and revision history
src/modules/assessment-policies/ Non-operational managerial assessment drafts
src/modules/assessment-adoptions/ Reviewed immutable assessment-policy adoption
src/modules/assessment-bindings/ Adopted policy scoped to section subject offerings
src/modules/staff-invitations/ Tracked staff invitations and operator linking
src/modules/assessment-scores/ Named assessments and raw learner marks
src/operations.ts         Combined versioned route catalog
src/http-app.ts           HTTP boundary and route registration
web/                     Vite + React workspace (built into public/)
database/migrations/     Ordered, immutable SQL migrations
scripts/                 Migration, operator setup, API export
tests/                   PostgreSQL, API, and signed-token tests
AGENTS.md                Working contract for agents and contributors
docs/status.md           Where the last session stopped and what is next
docs/constraints.md      Standing rules, blocking gates and settled decisions
docs/erd.md              Entity relationship diagram of all 44 tables
docs/school-information-requests.md  What to ask the school, in priority order
docs/school-forms.md     What the school's own SF2, SF4 and SF9 specify
docs/                    Requirements, decisions, deployment, API handoff
CHANGELOG.md             Released increments, sections and migrations
```

Passwords, tokens, database URLs, and manuscript extracts belong only in ignored `.env`/`.local` files. The manuscript remains in its original location and is not committed into this repository.
