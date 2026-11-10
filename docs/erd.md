# Entity relationship diagram

Originally generated from the live `edunexus` schema through 21 migrations. On 28 September 2026, a clean local rebuild through migration 0024 still contained 44 tables. The [paper-ready Figures 7-9](diagrams/paper/README.md) are the current, schema-verified process views, with corrected optionality and historical cardinalities. The Mermaid diagrams below and their older renders are retained as earlier reference material; use the paper guide's constraint notes where they differ. A single diagram at this size is unreadable, so this document provides a general view in two parts, followed by domain and process views.

For a document rather than a screen, use the rendered figures in [diagrams/](diagrams/): each diagram as SVG and as a double-resolution PNG, with suggested captions.

## General view

The whole system in two figures, showing only the entities that hold current state. They omit the 14 change journals, the two audit logs and the rate limiter, which together account for most of the table count and none of the meaning. Those appear in the domain diagrams below.

The cut is along the seam the school already works to: what is recorded about a learner day to day, and what is recorded about their academic work. Each part repeats the entities it needs, so each stands on its own, the same way the process views do. Between them they carry all 20 entities and all 24 relationships.

One figure for all twenty comes out almost square, at 2188 x 1881, because the entity boxes are wider than they are tall and six of them are roots with no parent. Mermaid's ER renderer offers no way to change that: `layoutDirection`, `nodeSpacing`, `rankSpacing` and `minEntityWidth` are all accepted and then ignored, a `direction LR` statement makes it wider still, and dropping the attribute blocks makes it wider again. A near-square figure has to be shrunk to illegibility to fit a portrait page, which is why this is two.

### Records

School, staff, the school year and its sections; learners and their annual enrollment; the instructional calendar and everything recorded against it.

```mermaid
erDiagram
  STAFF ||--o{ SECTIONS : advises
  ACADEMIC_YEARS ||--o{ SECTIONS : contains
  ACADEMIC_YEARS ||--o{ REPORTING_PERIODS : divides
  LEARNERS ||--o{ ENROLLMENTS : "enrolled each year"
  ACADEMIC_YEARS ||--o{ ENROLLMENTS : scopes
  SECTIONS ||--o{ ENROLLMENTS : places
  ACADEMIC_YEARS ||--o| INSTRUCTIONAL_CALENDARS : "one per year"
  INSTRUCTIONAL_CALENDARS ||--o{ INSTRUCTIONAL_DAYS : defines
  SECTIONS ||--o{ ATTENDANCE_DAYS : "sheet per date"
  ATTENDANCE_DAYS ||--o{ ATTENDANCE_MARKS : holds
  ENROLLMENTS ||--o{ ATTENDANCE_MARKS : "marked learner"
  SECTIONS ||--o{ ATTENDANCE_MONTHS : consolidates
  ENROLLMENTS ||--o{ ATTENDANCE_FOLLOWUPS : "case against"

  SCHOOL_PROFILE {
    text name
    text school_code
    text address
  }
  STAFF {
    uuid user_id PK
    text display_name
    enum role
    boolean active
  }
  ACADEMIC_YEARS {
    uuid id PK
    integer start_year UK
    date starts_on
    date ends_on
    enum status
  }
  REPORTING_PERIODS {
    uuid id PK
    integer ordinal
    text name
    date starts_on
    date ends_on
  }
  SECTIONS {
    uuid id PK
    integer grade_level
    text name
    uuid adviser_user_id FK
  }
  LEARNERS {
    uuid id PK
    text lrn UK
    text last_name
    text first_name
    date birth_date
    text sex
  }
  ENROLLMENTS {
    uuid id PK
    integer grade_level
    date enrolled_on
    text status
    text record_state
  }
  INSTRUCTIONAL_CALENDARS {
    uuid id PK
    integer version
  }
  INSTRUCTIONAL_DAYS {
    uuid id PK
    date day_on
    text am
    text pm
  }
  ATTENDANCE_DAYS {
    uuid id PK
    date day_on
    integer version
  }
  ATTENDANCE_MARKS {
    uuid id PK
    text am
    text pm
  }
  ATTENDANCE_MONTHS {
    uuid id PK
    date month_on
    text status
  }
  ATTENDANCE_FOLLOWUPS {
    uuid id PK
    text category
    text status
    date due_on
  }
```

### Academics

The subject catalog and section offerings, the assessment policy chain from draft to binding, and the tasks and raw marks recorded against an annual enrollment.

```mermaid
erDiagram
  ACADEMIC_YEARS ||--o{ SECTIONS : contains
  ACADEMIC_YEARS ||--o{ REPORTING_PERIODS : divides
  ACADEMIC_YEARS ||--o{ ENROLLMENTS : scopes
  SECTIONS ||--o{ ENROLLMENTS : places
  SUBJECTS ||--o{ SECTION_SUBJECTS : "offered as"
  SECTIONS ||--o{ SECTION_SUBJECTS : takes
  ASSESSMENT_POLICY_DRAFTS ||--o{ ASSESSMENT_POLICY_ADOPTIONS : "adopted as"
  ACADEMIC_YEARS ||--o{ ASSESSMENT_POLICY_ADOPTIONS : scopes
  ASSESSMENT_POLICY_ADOPTIONS ||--o{ ASSESSMENT_POLICY_BINDINGS : governs
  SECTION_SUBJECTS ||--o| ASSESSMENT_POLICY_BINDINGS : "bound to"
  ASSESSMENT_POLICY_BINDINGS ||--o{ ASSESSMENT_TASKS : "component source"
  SECTION_SUBJECTS ||--o{ ASSESSMENT_TASKS : assesses
  REPORTING_PERIODS ||--o{ ASSESSMENT_TASKS : "falls within"
  ASSESSMENT_TASKS ||--o{ ASSESSMENT_SCORES : "raw marks"
  ENROLLMENTS ||--o{ ASSESSMENT_SCORES : "marked learner"

  ACADEMIC_YEARS {
    uuid id PK
    integer start_year UK
    date starts_on
    date ends_on
    enum status
  }
  REPORTING_PERIODS {
    uuid id PK
    integer ordinal
    text name
    date starts_on
    date ends_on
  }
  SECTIONS {
    uuid id PK
    integer grade_level
    text name
    uuid adviser_user_id FK
  }
  ENROLLMENTS {
    uuid id PK
    integer grade_level
    date enrolled_on
    text status
    text record_state
  }
  SUBJECTS {
    uuid id PK
    text code UK
    text name
    text kind
  }
  SECTION_SUBJECTS {
    uuid id PK
    jsonb subject_snapshot
    boolean active
  }
  ASSESSMENT_POLICY_DRAFTS {
    uuid id PK
    text code UK
    jsonb components
    text status
  }
  ASSESSMENT_POLICY_ADOPTIONS {
    uuid id PK
    jsonb policy_snapshot
    date adopted_on
    text status
  }
  ASSESSMENT_POLICY_BINDINGS {
    uuid id PK
    text status
  }
  ASSESSMENT_TASKS {
    uuid id PK
    text component_code
    integer sequence
    numeric max_score
  }
  ASSESSMENT_SCORES {
    uuid id PK
    numeric raw_score
  }
```

Read left to right and it is the school year: a year holds sections and reporting periods, a learner is enrolled into a section for that year, attendance is marked against that enrollment, and scores are recorded against it too. Everything downstream hangs off the annual enrollment rather than off the learner, which is what lets one child carry six years of records without their history being rewritten each August.

## How to read these

Two patterns repeat throughout and explain most of the table count.

**Every record that can change has a journal beside it.** A table named `x` usually has a partner named `x_events` holding an immutable before/after snapshot of each change, with the actor, a reason, and the request ID. The journals are written in the same transaction as the change: if the journal cannot be written, the change rolls back. They are shown in the diagrams because they are half the schema, but they always hang off their parent in the same way.

**Every changeable record carries a `version`.** A write supplies the version it last read, and the database refuses the write if that no longer matches. This is what stops two staff overwriting each other silently.

Three tables are global and left out of the domain diagrams to keep them legible:

- `audit_events` — append-only change audit for every table. Records actor, request ID, table, row and the names of changed fields. Never values, learner names or credentials.
- `record_access_events` — append-only log of successful learner and enrollment reads. Records who read which record IDs, never search terms or profile values.
- `request_buckets` — persistent per-staff rate limiting.

Every `*_events` table also references `staff` as the actor. Those edges are omitted from the diagrams; assume them everywhere.

## Overview

```mermaid
flowchart TB
  F["<b>Foundation and people</b><br/>school profile, staff, invitations,<br/>school years, reporting periods, sections"]
  R["<b>Learner registry</b><br/>learners, annual enrollment,<br/>movement history, identity links"]
  C["<b>Reviewed corrections</b><br/>roster import, LRN, timeline,<br/>record void, grade placement"]
  A["<b>Calendar and attendance</b><br/>instructional days, daily marks,<br/>monthly consolidation, follow-up"]
  X["<b>Academics</b><br/>subjects, offerings, assessment<br/>policy chain, raw scores"]

  F --> R
  F --> A
  F --> X
  R --> C
  R --> A
  R --> X
  A -.->|"SF2, SF4"| O["Official forms<br/><i>not built</i>"]
  X -.->|"SF9, SF10"| O
```

Foundation defines the school year, its sections and who may act. The registry places learners into those sections. Attendance and academics both record against an annual enrollment. Corrections sit beside the registry rather than inside it, because a correction never rewrites the original record.

## Foundation and people

```mermaid
erDiagram
  AUTH_USERS ||--o| STAFF : authorizes
  STAFF ||--o{ SECTIONS : advises
  STAFF ||--o{ STAFF_INVITATIONS : requests
  STAFF_INVITATIONS ||--o| STAFF : "links once provisioned"
  STAFF_INVITATIONS ||--o{ STAFF_INVITATION_EVENTS : journals
  ACADEMIC_YEARS ||--o{ REPORTING_PERIODS : divides
  ACADEMIC_YEARS ||--o{ SECTIONS : contains

  SCHOOL_PROFILE {
    smallint id PK
    text name
    text school_code "six digits, nullable"
    integer version
  }
  STAFF {
    uuid user_id PK "auth.users"
    text display_name
    enum role "principal, administrative_officer, teacher"
    boolean active
    integer version
  }
  STAFF_INVITATIONS {
    uuid id PK
    text email "normalized lowercase"
    enum role
    text status "requested, provisioned, cancelled"
    uuid linked_user_id FK
    uuid requested_by FK
  }
  ACADEMIC_YEARS {
    uuid id PK
    integer start_year UK
    date starts_on
    date ends_on
    enum status "draft, active, closed"
  }
  REPORTING_PERIODS {
    uuid id PK
    uuid academic_year_id FK
    integer ordinal
    date starts_on
    date ends_on
  }
  SECTIONS {
    uuid id PK
    uuid academic_year_id FK
    integer grade_level "0 is Kindergarten"
    text name
    uuid adviser_user_id FK
  }
```

Sections are unique by year, grade and normalized name. An adviser must be an active teacher. A composite key of `(id, academic_year_id, grade_level)` lets later tables reference a section and inherit its year and grade, which is how cross-year mistakes are made impossible rather than merely checked.

## Learner registry and enrollment

```mermaid
erDiagram
  LEARNERS ||--o{ ENROLLMENTS : "enrolled each year"
  LEARNERS ||--o| LEARNERS : "merged into retained record"
  LEARNERS ||--o{ LEARNER_IDENTITY_EVENTS : journals
  ACADEMIC_YEARS ||--o{ ENROLLMENTS : scopes
  SECTIONS ||--o{ ENROLLMENTS : "current placement"
  ENROLLMENTS ||--o{ ENROLLMENT_EVENTS : "movement history"
  SECTIONS ||--o{ ENROLLMENT_EVENTS : "section at the time"

  LEARNERS {
    uuid id PK
    text lrn UK "12 digits, null while pending"
    text last_name
    text first_name
    text middle_name "nullable"
    date birth_date
    text sex "male, female"
    uuid merged_into FK "set when linked as duplicate"
    integer version
  }
  ENROLLMENTS {
    uuid id PK
    uuid learner_id FK
    uuid academic_year_id FK
    integer grade_level
    uuid section_id FK
    date enrolled_on
    date effective_on "start of the current state"
    text status "enrolled, withdrawn"
    text last_reason
    text record_state "valid, voided"
    integer version
  }
  ENROLLMENT_EVENTS {
    uuid id PK
    uuid enrollment_id FK
    integer enrollment_version
    text event_type "enrolled, reassigned, withdrawn, reentered"
    date effective_on
    uuid section_id FK
    text reason
  }
```

One learner record persists across school years; the annual enrollment sits underneath it. A partial unique index enforces one **valid** enrollment per learner per year, so a voided record stays as evidence without occupying the slot. `effective_on` is the first day of the new state, not the last day of the old one.

## Reviewed corrections

```mermaid
erDiagram
  LEARNERS ||--o{ LRN_CORRECTIONS : "assigned LRN changed"
  ENROLLMENTS ||--o{ ENROLLMENT_CORRECTIONS : "timeline or grade repaired"
  ENROLLMENT_CORRECTIONS ||--o{ ENROLLMENT_CORRECTION_SECTIONS : "corrected entries"
  SECTIONS ||--o{ ENROLLMENT_CORRECTION_SECTIONS : "replacement section"
  ENROLLMENTS ||--o{ ENROLLMENT_RECORD_EVENTS : "voided or restored"

  IMPORT_PREVIEWS {
    uuid id PK
    uuid actor_user_id FK
    text input_hash "binds the reviewed file"
    text plan_hash "binds the reviewed plan"
    integer row_count "1 to 50"
    timestamptz expires_at "30 minutes"
    timestamptz committed_at "null until committed"
  }
  LRN_CORRECTIONS {
    uuid id PK
    uuid learner_id FK
    text previous_lrn
    text corrected_lrn
    text reason
  }
  ENROLLMENT_CORRECTIONS {
    uuid id PK
    uuid enrollment_id FK
    integer revision
    text correction_kind "timeline, placement"
    integer previous_grade_level "nullable"
    integer corrected_grade_level "nullable"
    text review_hash
  }
  ENROLLMENT_CORRECTION_SECTIONS {
    uuid id PK
    uuid correction_id FK
    uuid section_id FK
    date effective_on
    text action
  }
```

Corrections are additive. The original `enrollment_events` rows are never rewritten; the effective timeline is the latest correction snapshot plus any ordinary movements recorded after it. Import and correction commits bind a hash of exactly what was reviewed, so a changed file or a stale preview is refused rather than silently applied.

## Calendar and attendance

```mermaid
erDiagram
  ACADEMIC_YEARS ||--o| INSTRUCTIONAL_CALENDARS : "one per year"
  INSTRUCTIONAL_CALENDARS ||--o{ INSTRUCTIONAL_DAYS : defines
  SECTIONS ||--o{ INSTRUCTIONAL_DAYS : "section override"
  INSTRUCTIONAL_CALENDARS ||--o{ CALENDAR_REVIEW_EVENTS : journals
  SECTIONS ||--o{ ATTENDANCE_DAYS : "one sheet per date"
  ATTENDANCE_DAYS ||--o{ ATTENDANCE_MARKS : holds
  ENROLLMENTS ||--o{ ATTENDANCE_MARKS : "marked learner"
  ATTENDANCE_DAYS ||--o{ ATTENDANCE_REVIEW_EVENTS : journals
  SECTIONS ||--o{ ATTENDANCE_MONTHS : consolidates
  SECTIONS ||--o{ ATTENDANCE_MONTH_SNAPSHOTS : "frozen at each submission"
  ATTENDANCE_MONTHS }o--|| ATTENDANCE_MONTH_SNAPSHOTS : "current frozen state"
  ATTENDANCE_MONTHS ||--o{ ATTENDANCE_MONTH_EVENTS : journals
  ENROLLMENTS ||--o{ ATTENDANCE_FOLLOWUPS : "case opened against"
  ATTENDANCE_FOLLOWUPS ||--o{ ATTENDANCE_FOLLOWUP_EVENTS : journals

  INSTRUCTIONAL_DAYS {
    uuid id PK
    uuid academic_year_id FK "the calendar"
    uuid section_id FK "null means school-wide"
    date day_on
    boolean configured "false means the date is unconfigured"
    text am "classroom, alternative_delivery, no_class, suspended"
    text pm
  }
  ATTENDANCE_MARKS {
    uuid id PK
    uuid attendance_day_id FK
    uuid enrollment_id FK
    text am "present, absent; null means not recorded"
    text pm "present, absent; null means not recorded"
  }
  ATTENDANCE_MONTHS {
    uuid id PK
    uuid section_id FK
    date month_on "first of month"
    text status "draft, submitted, locked"
    uuid snapshot_id FK
    integer version
  }
  ATTENDANCE_FOLLOWUPS {
    uuid id PK
    uuid enrollment_id FK
    uuid section_id FK
    text category "absence, recording_gap"
    text status "open, resolved, cancelled"
    uuid assignee_user_id FK
    date due_on "nullable, open cases only"
  }
```

A date with no calendar row is **unconfigured**, not a school day, and a session with no mark is **unknown**, not present. Both are deliberate: inferring either would corrupt an SF2. Submitting a month freezes an immutable snapshot of who was enrolled and what was marked, and a deferred constraint trigger blocks any later edit that would contradict a frozen month.

## Academics

```mermaid
erDiagram
  SUBJECTS ||--o{ SUBJECT_EVENTS : journals
  SUBJECTS ||--o{ SECTION_SUBJECTS : "offered to a section"
  SECTIONS ||--o{ SECTION_SUBJECTS : takes
  SECTION_SUBJECTS ||--o{ SECTION_SUBJECT_EVENTS : journals
  ASSESSMENT_POLICY_DRAFTS ||--o{ ASSESSMENT_POLICY_DRAFT_EVENTS : journals
  ASSESSMENT_POLICY_DRAFTS ||--o{ ASSESSMENT_POLICY_ADOPTIONS : "school adopts a revision"
  ACADEMIC_YEARS ||--o{ ASSESSMENT_POLICY_ADOPTIONS : scopes
  ASSESSMENT_POLICY_ADOPTIONS ||--o{ ASSESSMENT_POLICY_ADOPTION_EVENTS : journals
  ASSESSMENT_POLICY_ADOPTIONS ||--o{ ASSESSMENT_POLICY_BINDINGS : governs
  SECTION_SUBJECTS ||--o| ASSESSMENT_POLICY_BINDINGS : "bound offering"
  ASSESSMENT_POLICY_BINDINGS ||--o{ ASSESSMENT_POLICY_BINDING_EVENTS : journals
  ASSESSMENT_POLICY_BINDINGS ||--o{ ASSESSMENT_TASKS : "component source"
  SECTION_SUBJECTS ||--o{ ASSESSMENT_TASKS : assesses
  REPORTING_PERIODS ||--o{ ASSESSMENT_TASKS : "falls within"
  ASSESSMENT_TASKS ||--o{ ASSESSMENT_SCORES : "raw marks"
  ENROLLMENTS ||--o{ ASSESSMENT_SCORES : "marked learner"
  ASSESSMENT_TASKS ||--o{ ASSESSMENT_TASK_EVENTS : journals
  ASSESSMENT_TASKS ||--o{ ASSESSMENT_SCORE_EVENTS : "batched score journal"

  SUBJECTS {
    uuid id PK
    text code UK "immutable"
    text name
    text kind "learning_area, domain"
    int_array grade_levels
    boolean active
  }
  SECTION_SUBJECTS {
    uuid id PK
    uuid section_id FK
    uuid subject_id FK
    jsonb subject_snapshot "catalog revision pinned"
    boolean active
    integer display_order
  }
  ASSESSMENT_POLICY_DRAFTS {
    uuid id PK
    text code UK
    jsonb components "codes and basis points totalling 10000"
    int_array grade_levels "1 to 6, excludes Kindergarten"
    text status "draft, archived"
  }
  ASSESSMENT_POLICY_ADOPTIONS {
    uuid id PK
    uuid academic_year_id FK
    uuid policy_id FK
    integer policy_version
    jsonb policy_snapshot "frozen revision"
    date adopted_on
    text adoption_reference "the school's own record"
    text status "adopted, withdrawn"
  }
  ASSESSMENT_TASKS {
    uuid id PK
    uuid offering_id FK
    uuid binding_id FK
    uuid reporting_period_id FK
    text component_code "from the adopted revision"
    integer sequence
    numeric max_score
  }
  ASSESSMENT_SCORES {
    uuid id PK
    uuid task_id FK
    uuid enrollment_id FK
    numeric raw_score "null means not recorded"
    integer version
  }
```

The chain runs draft → adoption → binding → task → score, and each link protects the one below it: an adopted draft cannot be archived, a bound adoption cannot be withdrawn, and a bound offering cannot be retired, until the thing depending on it is released first. An adoption freezes the whole draft revision, so revising the draft afterwards never changes what the school decided.

**Nothing in this domain computes a grade.** There is no table, column or endpoint for a total, average, percentage, MPS, GWA or transmuted mark. Those wait on the school's grading enclosure, recorded as a gate in [constraints](constraints.md).

## Process views

The five domain diagrams above are cut by how the system is built, and are meant to be read in order: each assumes the one before it. The three below are cut by the school processes the manuscript names, and each one is **standalone** — it repeats the upstream entities it depends on, so a single figure can carry a section of a document without the others beside it.

Same schema and the same tables, sliced a second way. These are not separate databases, and an entity appearing in two views is one table.

### Class preparation

```mermaid
erDiagram
  STAFF ||--o{ SECTIONS : advises
  ACADEMIC_YEARS ||--o{ SECTIONS : contains
  ACADEMIC_YEARS ||--o{ REPORTING_PERIODS : divides
  ACADEMIC_YEARS ||--o{ ENROLLMENTS : scopes
  LEARNERS ||--o{ ENROLLMENTS : "one record per school year"
  SECTIONS ||--o{ ENROLLMENTS : "class placement"
  ENROLLMENTS ||--o{ ENROLLMENT_EVENTS : "movement history"
  SECTIONS ||--o{ ENROLLMENT_EVENTS : "section at the time"
  STAFF ||--o{ IMPORT_PREVIEWS : "stages a class list"

  STAFF {
    uuid user_id PK
    text display_name
    enum role
    boolean active
    integer version
  }
  ACADEMIC_YEARS {
    uuid id PK
    integer start_year UK
    date starts_on
    date ends_on
    enum status
    integer version
  }
  REPORTING_PERIODS {
    uuid id PK
    uuid academic_year_id FK
    smallint ordinal
    text name
    date starts_on
    date ends_on
  }
  SECTIONS {
    uuid id PK
    uuid academic_year_id FK
    smallint grade_level "0 is Kindergarten"
    text name "unique per year and grade"
    uuid adviser_user_id FK "nullable, must be an active teacher"
    integer version
  }
  LEARNERS {
    uuid id PK
    text lrn UK "12 digits, null while pending"
    text last_name
    text first_name
    text middle_name "nullable"
    date birth_date
    text sex "male, female"
    uuid merged_into FK "set when linked as a duplicate"
    integer version
  }
  ENROLLMENTS {
    uuid id PK
    uuid learner_id FK
    uuid academic_year_id FK
    smallint grade_level
    uuid section_id FK
    date enrolled_on
    date effective_on "start of the current state"
    text status "enrolled, withdrawn"
    text last_reason "regular, transfer_in, section_change, transfer_out, ..."
    text record_state "valid, voided"
    integer version
  }
  ENROLLMENT_EVENTS {
    uuid id PK
    uuid enrollment_id FK
    integer enrollment_version
    text event_type "enrolled, reassigned, withdrawn, reentered"
    date effective_on
    uuid section_id FK
    text reason
  }
  IMPORT_PREVIEWS {
    uuid id PK
    uuid actor_user_id FK
    text input_hash "binds the reviewed file"
    text plan_hash "binds the reviewed plan"
    integer row_count "1 to 50"
    timestamptz expires_at "30 minutes"
    timestamptz committed_at "null until committed"
  }
```

Preparing classes is one pass per school year: open the year, divide it into reporting periods, create its sections, give each an adviser, then place learners.

A section is unique by year, grade and normalized name, and it carries a second key of `(id, academic_year_id, grade_level)`. Every table that references a section references that composite key, which is why a learner cannot be placed into a section belonging to another year or another grade — it is impossible rather than merely checked. An adviser must be an active teacher, and may be null while the section is still being set up.

One **valid** enrollment per learner per school year is enforced by a partial unique index, so a voided record stays as evidence without occupying the slot. The learner record itself persists across years; only the enrollment underneath it is annual, which is what lets a child carry six years of history without any year being rewritten.

A class list imported from a file is staged as a preview first. The preview stores a hash of the exact file and of the plan that was reviewed, and the commit must present both, so an edited file or an expired preview is refused instead of being applied quietly.

### Attendance record

```mermaid
erDiagram
  ACADEMIC_YEARS ||--o| INSTRUCTIONAL_CALENDARS : "one per year"
  INSTRUCTIONAL_CALENDARS ||--o{ INSTRUCTIONAL_DAYS : defines
  SECTIONS ||--o{ INSTRUCTIONAL_DAYS : "section override"
  SECTIONS ||--o{ ATTENDANCE_DAYS : "one sheet per date"
  ATTENDANCE_DAYS ||--o{ ATTENDANCE_MARKS : holds
  ENROLLMENTS ||--o{ ATTENDANCE_MARKS : "marked learner"
  SECTIONS ||--o{ ATTENDANCE_MONTHS : consolidates
  SECTIONS ||--o{ ATTENDANCE_MONTH_SNAPSHOTS : "frozen at each submission"
  ATTENDANCE_MONTHS }o--|| ATTENDANCE_MONTH_SNAPSHOTS : "current frozen state"
  ENROLLMENTS ||--o{ ATTENDANCE_FOLLOWUPS : "case opened against"
  STAFF ||--o{ ATTENDANCE_FOLLOWUPS : "assigned to"

  ACADEMIC_YEARS {
    uuid id PK
    integer start_year UK
    enum status
  }
  STAFF {
    uuid user_id PK
    text display_name
    enum role
    boolean active
  }
  SECTIONS {
    uuid id PK
    uuid academic_year_id FK
    smallint grade_level
    text name
    uuid adviser_user_id FK
  }
  ENROLLMENTS {
    uuid id PK
    uuid learner_id FK
    uuid section_id FK
    text status
    text record_state
  }
  INSTRUCTIONAL_CALENDARS {
    uuid id PK
    integer version
  }
  INSTRUCTIONAL_DAYS {
    uuid id PK
    uuid academic_year_id FK
    uuid section_id FK
    date day_on
    boolean configured
    text am
    text pm
    text day_type
    text label
  }
  ATTENDANCE_DAYS {
    uuid id PK
    uuid section_id FK
    date day_on
    integer version
  }
  ATTENDANCE_MARKS {
    uuid id PK
    uuid attendance_day_id FK
    uuid enrollment_id FK
    date day_on
    text am
    text pm
    integer version
  }
  ATTENDANCE_MONTHS {
    uuid id PK
    uuid section_id FK
    uuid academic_year_id FK
    date month_on
    text status
    uuid snapshot_id FK
    integer version
  }
  ATTENDANCE_MONTH_SNAPSHOTS {
    uuid id PK
    uuid section_id FK
    date month_on
    jsonb payload
    text data_hash
  }
  ATTENDANCE_FOLLOWUPS {
    uuid id PK
    uuid enrollment_id FK
    uuid section_id FK
    date from_on
    date to_on
    text category
    text status
    uuid assignee_user_id FK
    date due_on
    jsonb opening_evidence
  }
```

The figure carries no note column, so the values it leaves out are here. An instructional day records `am` and `pm` as one of `classroom`, `alternative_delivery`, `no_class` or `suspended`, and a `day_type` of `regular`, `holiday`, `school_break`, `weekend`, `makeup`, `suspension` or `other`; `configured` is false exactly when the date has never been described. A day row with a null `section_id` is school-wide, and one with a section is that section's override. A mark records `am` and `pm` as `present` or `absent`, with null meaning not recorded. A month is `draft`, `submitted` or `locked`, keyed to the first of the month. A follow-up case has a `category` of `absence` or `recording_gap`, a `status` of `open`, `resolved` or `cancelled`, a due date only while open, and a window of at most 31 dates.

Two absences of a record are meaningful here, and neither is a zero.

A date with no configured calendar row is **unconfigured** — it is not a school day, and it is not a non-school day either; nothing is known about it. A session with no mark is **unknown**, not a presence and not an absence. Inferring either would put an invented figure on an SF2, so both stay null and the workflows refuse to proceed until a human resolves them.

Marks attach to the annual enrollment rather than to the learner, so a child who changes section mid-year keeps one continuous attendance history and the old section's records stay as they were recorded. `day_on` is duplicated onto the mark to carry the unique constraint that stops the same enrollment being marked twice for one date.

Submitting a month writes an immutable snapshot of exactly who was enrolled and what was marked, and the month row points at the current one. Resubmitting writes a new snapshot rather than editing the old one, so every submission the school made remains reconstructable. A deferred constraint trigger blocks any later edit to attendance, calendar or roster that would contradict a frozen month.

Counts produced here are **raw session counts**, not official attendance credits. The conversion to SF2 and SF4 arithmetic waits on the school's approved mark meanings and half-day rules.

### Academic record

```mermaid
erDiagram
  ACADEMIC_YEARS ||--o{ REPORTING_PERIODS : divides
  SECTIONS ||--o{ SECTION_SUBJECTS : takes
  SUBJECTS ||--o{ SECTION_SUBJECTS : "offered as"
  ASSESSMENT_POLICY_DRAFTS ||--o{ ASSESSMENT_POLICY_ADOPTIONS : "a revision is adopted"
  ACADEMIC_YEARS ||--o{ ASSESSMENT_POLICY_ADOPTIONS : scopes
  ASSESSMENT_POLICY_ADOPTIONS ||--o{ ASSESSMENT_POLICY_BINDINGS : governs
  SECTION_SUBJECTS ||--o| ASSESSMENT_POLICY_BINDINGS : "one standing binding"
  SECTION_SUBJECTS ||--o{ ASSESSMENT_TASKS : assesses
  ASSESSMENT_POLICY_BINDINGS ||--o{ ASSESSMENT_TASKS : "component source"
  REPORTING_PERIODS ||--o{ ASSESSMENT_TASKS : "falls within"
  ASSESSMENT_TASKS ||--o{ ASSESSMENT_SCORES : "raw marks"
  ENROLLMENTS ||--o{ ASSESSMENT_SCORES : "marked learner"

  ACADEMIC_YEARS {
    uuid id PK
    integer start_year UK
    enum status "draft, active, closed"
  }
  REPORTING_PERIODS {
    uuid id PK
    uuid academic_year_id FK
    smallint ordinal
    text name
  }
  SECTIONS {
    uuid id PK
    uuid academic_year_id FK
    smallint grade_level
    text name
  }
  ENROLLMENTS {
    uuid id PK
    uuid learner_id FK
    uuid section_id FK
    text record_state "valid, voided"
  }
  SUBJECTS {
    uuid id PK
    text code UK "immutable once created"
    text name
    text kind "learning_area, domain"
    int_array grade_levels
    boolean active
    integer version
  }
  SECTION_SUBJECTS {
    uuid id PK
    uuid section_id FK
    uuid subject_id FK
    jsonb subject_snapshot "catalog revision pinned at this offering"
    boolean active
    integer display_order
    integer version
  }
  ASSESSMENT_POLICY_DRAFTS {
    uuid id PK
    text code UK
    jsonb components "codes and basis points totalling 10000"
    int_array grade_levels "1 to 6, excludes Kindergarten"
    text status "draft, archived"
    integer version
  }
  ASSESSMENT_POLICY_ADOPTIONS {
    uuid id PK
    uuid academic_year_id FK
    uuid policy_id FK
    integer policy_version "the revision frozen below"
    jsonb policy_snapshot "frozen copy of that revision"
    date adopted_on
    text adoption_reference "the school's own record of the decision"
    text status "adopted, withdrawn"
  }
  ASSESSMENT_POLICY_BINDINGS {
    uuid id PK
    uuid offering_id FK
    uuid adoption_id FK
    text status "bound, released"
    integer version
  }
  ASSESSMENT_TASKS {
    uuid id PK
    uuid offering_id FK
    uuid binding_id FK
    uuid reporting_period_id FK
    text component_code "from the adopted revision"
    integer sequence "1 to 99, unique per component and period"
    text title
    numeric max_score "a sanity bound, not a grading rule"
    text status "open, archived"
  }
  ASSESSMENT_SCORES {
    uuid id PK
    uuid task_id FK
    uuid enrollment_id FK
    numeric raw_score "null means not recorded"
    integer version
  }
```

The chain runs draft → adoption → binding → task → score, and each link protects the one below it. An adopted draft cannot be archived, a bound adoption cannot be withdrawn, and a bound offering cannot be retired, until whatever depends on it is released first.

Two snapshots do the real work. A section offering pins the subject catalogue revision it was created from, so renaming a subject later never rewrites what a past section was taught. An adoption freezes the entire policy revision it was made from, so revising the draft afterwards never changes what the school actually decided. `adoption_reference` is the school's own record of that decision; it is not treated as evidence that the content is correct.

**Nothing in this view computes a grade.** There is no table, column or endpoint for a total, average, percentage, MPS, GWA or transmuted mark, and `raw_score` left null means a mark was never recorded, never a zero. Those calculations wait on the school's current DepEd grading enclosure and its own ECR examples, recorded as a gate in [constraints](constraints.md). Until that gate opens, this view stores what a teacher wrote down and nothing derived from it.

## What is not here yet

The schema has no tables for promotion and next-year assignment (Section 5) or for released official forms and their signatories (Section 6). Both are blocked on school decisions rather than on design. When they arrive, promotion will reference `enrollments` across two school years, and released forms will hold immutable snapshots rather than regenerating from live records, for the same reason monthly attendance already does.
