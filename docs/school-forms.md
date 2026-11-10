# What the school's own forms specify

> **Restored 2026-11-03 from `80d8d7c^`.** This is the 0.42.0 copy. The whole
> `docs/` tree was deliberately left out of the 0.86.1 recovery commit, because
> `.vercelignore` kept it out of the deployment the source was rescued from.
> This is the only part brought back so far, since it is the only record of
> what the school's SF2, SF4 and SF9 specify. It describes the forms, not the
> system, so it has not gone stale the way the other 65 files had — but nothing
> in it has been re-checked against releases 0.43.0 to 0.86.1.

The school supplied three documents. This file records what they establish, what they leave open, and what must not be copied out of them. The documents themselves are **not in this repository**: they hold real staff names, and one of them holds other schools' staff names too, so they stay in the ignored local working area under the same rule as the manuscript.

Nothing here is a settled decision. It is evidence. A decision drawn from it belongs in the settled-decisions table in [constraints](constraints.md), and the gates in that file stay shut until it is recorded there.

## The three documents

| Document | What it is | State |
|---|---|---|
| SF9 Progress Report Card, Grades 4–6 | The school's own report card, Word | Blank. Face reads School Year 2024–2025; last modified 2026-08-26 |
| SF2 Daily Attendance Report, Grade 3 Section A | LIS-generated, form version `2014.2.1.1` | Blank of learners. School Year 2026–2027 |
| SF4 Monthly Learner's Movement and Attendance | The DepEd workbook | **Filled** for Balili, July, School Year 2026–2027 |

The SF2 carries no learner name and no LRN. The SF4 carries 33 named staff. Neither was redacted, so request 6 in [school information requests](school-information-requests.md) governs both.

## The school, as the SF4 states it

School ID **135617**, Balili Elementary School, La Trinidad District, Schools Division Office of Benguet, Cordillera Administrative Region.

There is a second Balili Elementary School in the same division — **135642**, Mankayan. Pin the ID, never the name.

**Thirty sections**, Kinder lettered A–F and every graded level A–D:

| Level | Sections | Section sizes | Registered |
|---|---|---|---|
| Kinder | A–F | 18–20 | 116 |
| Grade 1 | A–D | 32–33 | 130 |
| Grade 2 | A–D | 30–32 | 126 |
| Grade 3 | A–D | 30–32 | 123 |
| Grade 4 | A–D | 29–37 | 133 |
| Grade 5 | A–D | 32–34 | 131 |
| Grade 6 | A–D | 32–34 | 134 |
| | **30** | | **893** |

Daily average attendance for July was 859 of 893. These are the school's own observed figures, not a capacity policy: the class-capacity gate stays shut, and 37 in Grade 4 A is what happened, not what is permitted.

**Thirty-three staff**, which is the figure the project already carried:

| Role | Count |
|---|---|
| Advisers | 27 |
| Subject teachers without advisory | 3 |
| School Principal I | 1 |
| Administrative Officer II | 1 |
| Administrative Aide I (on leave) | 1 |

Twenty-seven advisers hold thirty sections because **three Kinder advisers each hold two sections**. One adviser per section remains true; one section per adviser does not, and placement must not assume it.

Positions in use: Teacher I, II, III, IV, V and VI, Master Teacher II, School Principal I, Administrative Officer II, Administrative Aide I. Specializations in use: General Education, English, Filipino, Mathematics, Science, ESP/Values Education, TLE/EPP, Agriculture and Fishery.

**Three teachers teach across sections they do not advise** — one covering Science and MAPEH in Grade 4, two covering Araling Panlipunan with GMRC and with MAPEH across Grades 5 and 6. EDUNEXUS models no subject-teacher access at all, by the settled decision that it must not be invented. This is the first evidence that the school actually runs on it, and it should be put to the school rather than designed around.

## SF2 — what the form specifies

One row per learner, males then females, each block numbered from 1 and closed by a per-day total row, with a combined total beneath. The generated sheet is sized to the section: fourteen male rows and seventeen female rows for Grade 3 A. **Twenty-five day columns**, five weeks of Monday to Friday, then a month total split into ABSENT and PRESENT.

### Marks

| Mark | Meaning |
|---|---|
| *(blank)* | Present |
| `x` | Absent |
| Half-shaded, upper | Tardy — late comer |
| Half-shaded, lower | Tardy — cutting classes |

**One mark per day.** The form has no AM and no PM. EDUNEXUS records two independently nullable session marks, and nothing in these documents says how a pair becomes one daily mark. Tardiness is not a value the `present | absent | null` enum can hold, and the form distinguishes two kinds of it.

### Arithmetic

```
Percentage of Enrolment   = registered learners as of end of the month
                            ÷ enrolment as of 1st Friday of the school year   × 100

Average Daily Attendance  = total daily attendance
                            ÷ number of school days in the reporting month

Percentage of Attendance  = average daily attendance
  for the month             ÷ registered learners as of end of the month      × 100
```

The beginning-of-year cut-off is the first Friday of the school year. Enrolment after it is reported separately as late enrolment beyond cut-off, which is why the two denominators above are different numbers and must not be collapsed into one. The supplied SF2 shows Grade 3 A at 31 on the first Friday while the SF4 shows it registered at 32 at the end of July; that is the two denominators working, not an error.

### Monthly summary block

Month, number of days of classes, then male, female and total for: enrolment as of the first Friday; late enrolment during the month beyond cut-off; registered learners as of end of month; percentage of enrolment as of end of month; average daily attendance; percentage of attendance for the month; **number of students absent for 5 consecutive days**; dropped out; transferred out; transferred in.

### Reasons recorded against non-attendance

The form groups them and does not expand its own acronym; do not invent an expansion for `NLS` or for the SF4's `NLPA`.

- **Domestic** — had to take care of siblings; early marriage or pregnancy; parents' attitude toward schooling; family problems
- **Individual** — illness; overage; death; drug abuse; poor academic performance; lack of interest or distractions; hunger or malnutrition
- **School** — teacher factor; physical condition of classroom; peer influence
- **Geographic or environmental** — distance between home and school; armed conflict including tribal wars and clan feuds; calamities and disasters
- **Financial** — child labor, work
- **Others**, specified free-hand

### Process the form states

Attendance is taken daily. At the end of each month the adviser submits the form to the office of the principal so its summary can be recorded into SF4; once the principal signs it, it returns to the adviser. Attendance is reflected in Form 137 and Form 138 every grading period.

Guideline 5 obliges the adviser to intervene — home visitation among other things — for a learner **absent five consecutive days** or otherwise at risk of dropping out.

Signed by the adviser, attested by the school head.

## SF4 — what the form specifies

One row per section: grade level, section, adviser, position, major or specialization, then five column groups, every one split male, female and total.

| Group | Columns |
|---|---|
| Registered learners | as of end of the month |
| Attendance | daily average; percentage for the month |
| NLPA / dropout | cumulative as of previous month (A); for the month (B); A+B as of end of month |
| Transferred out | A; B; A+B |
| Transferred in | A; B; A+B |

The percentage is the daily average over registered learners, computed per sex and for the total, and stored as a fraction rather than a percentage. Sections roll up per level, then to Non-Graded, then to a school total. A separate **Mortality (Death)** block carries previous months, for the month, and cumulative. A second table lists subject teachers, non-teaching personnel and staff on leave, with the subject or task area in place of counts.

The workbook's own hidden `Data Entry` sheet flattens all of this to one row per section per month, which is the shape a later SF4 renderer should target: month, grade, section, adviser, position, registered male and female, attendance male and female, NLPA for the month, transferred out male and female, transferred in male and female.

## SF9 — what the form specifies

Headed for the Republic, the Department, the region, the division, the district and the school, titled PROGRESS REPORT CARD, with school year, and learner fields: name, LRN, age, gender, grade, section.

**Attendance record** — academic months July through March and a total, over three rows: number of school days, number of school days present, number of times tardy.

**Report on learning progress and achievement** — eight learning areas by four quarters, a final grade and a remark, with MAPEH split into two reported lines and a **General Average** row beneath:

Filipino · English · Mathematics · Science · Araling Panlipunan · GMRC · Edukasyong Pantahanan at Pangkabuhayan (EPP) · MAPEH → Music & Arts; Physical Education & Health

**Descriptors**

| Description | Grading scale | Remarks |
|---|---|---|
| Outstanding | 90–100 | Passed |
| Very Satisfactory | 85–89 | Passed |
| Satisfactory | 80–84 | Passed |
| Fairly Satisfactory | 75–79 | Passed |
| Did Not Meet Expectations | Below 75 | Failed |

**Report on the learner's observed values** — Maka-Diyos with two behavior statements, Makatao with two, Makakalikasan with one, Makabansa with two, each marked per quarter as AO always observed, SO sometimes observed, RO rarely observed, NO not observed.

Then a parent or guardian signature per quarter, a Certificate of Transfer naming the grade the learner is eligible for, a Cancellation of Eligibility for Transfer, and signatures for Teacher-Adviser and Principal I.

**The General Average box does not authorize computing one.** The form gives descriptors, a passing mark and four quarters. It gives no component weights, no transmutation table, no rounding rule, no treatment of a missing score, and names no DepEd issuance. The grading gate is unchanged, and the rule that nothing computes a grade is unchanged with it.

## What must not be copied out of these files

- **The SF9's school-day totals.** It lists nine months — 11, 23, 20, 23, 21, 14, 21, 19, 23 — against a printed total of **197**. They sum to **175**. April, May and June are absent entirely. Neither number is usable, and the calendar must come from the school's approved calendar, not from this row.
- **The SF9's school year.** The face says 2024–2025 while the SF2 and SF4 say 2026–2027. It is a reused template and its header is stale.
- **The learner count.** The SF4 says 893 registered in July. Other project documents say roughly 897. Both are point-in-time, and neither is a roster.
- **Any figure as a stored value.** The SF4's daily averages and percentages are precisely what EDUNEXUS declines to compute. Importing them would put derived numbers into a system built to hold only what was observed.
- **The other schools.** The SF4 workbook's hidden template sheets carry sample returns for Piminggan, Kapangan Central, Adoyunan and Taba-ao, with those schools' teachers named, plus the full Benguet school directory. It was handed over for one school and covers several.

## What these documents move, and what they do not

| Gate | Effect |
|---|---|
| Official form templates | **Partly open.** Blank SF2 and the SF4 workbook in hand, SF9 for Grades 4–6, signatories named. **The SF10 workbook arrived later and is what the built form follows** — four scholastic blocks to a side on long bond, and the footer citation ([report-card-forms.md](report-card-forms.md)); this row said it was missing until 2026-11-05. Still missing: SF9 for Kinder and Grades 1–3, and the process for correcting an already-issued form. |
| Mark meanings and conversion rules | **Shut, and sharper.** The official arithmetic and the mark vocabulary are now known. The AM/PM-to-day rule, half-day credit, single-session days, transfer effective dates and alternative-delivery conversion are not, and the form's single daily column raises a new question: whether the school keeps two-session registers at all. |
| Learner fields and class capacity | **Shut.** Observed section sizes are known; an approved maximum is not. |
| Grading enclosure and ECR examples | **Shut.** Descriptors and a passing mark are not weights, transmutation or rounding. |
| Kindergarten assessment policy | **Shut.** The card covers Grades 4–6. The SF4 confirms six Kinder sections exist. |
| Absence-alert rule | **Contested.** The settled record is that the school has no approved threshold. The SF2 obliges intervention at five consecutive absences and counts those learners in its monthly summary. Put the contradiction to the school; do not resolve it here. |
| Privacy owner and approved purposes | **Shut, and now urgent.** Real staff records are in the local working area. |

## What could be entered today, once there is a manager to enter it

Three things in these documents are structural rather than personal, carry no learner or staff identity, and need no gate opened. None has been entered, because no real staff account has completed sign-in and so no authenticated manager exists; see the next action in [status](status.md).

**The school profile.** `school_code` takes exactly six digits and the SF2 and SF4 both give **135617**. The name is Balili Elementary School. The forms give the district, division and region but no street address, which `schoolUpdate` also requires, so ask for one line of address before writing this.

**Thirty sections** — grade level and name only, no adviser. Kinder A–F, and A–D for each of Grades 1 to 6. Two things gate this beyond the manager. A section belongs to an academic year, and creating the 2026–2027 year needs its start and end dates, which appear nowhere in these documents; the school calendar has to come first. Attaching the advisers is a separate step again, and waits on staff accounts, which wait on email addresses the school has not supplied.

**Eight learning areas for Grades 4–6**, from the SF9's own table, as `kind=learning_area` against `grade_levels=[4,5,6]`. Codes are the catalog's to choose and are immutable once set, so agree them before the first write:

| Proposed code | Name | Grades |
|---|---|---|
| `FILIPINO` | Filipino | 4, 5, 6 |
| `ENGLISH` | English | 4, 5, 6 |
| `MATHEMATICS` | Mathematics | 4, 5, 6 |
| `SCIENCE` | Science | 4, 5, 6 |
| `AP` | Araling Panlipunan | 4, 5, 6 |
| `GMRC` | GMRC | 4, 5, 6 |
| `EPP` | Edukasyong Pantahanan at Pangkabuhayan | 4, 5, 6 |
| `MAPEH` | MAPEH | 4, 5, 6 |
| `MUSIC_ARTS` | Music & Arts | 4, 5, 6 |
| `PE_HEALTH` | Physical Education & Health | 4, 5, 6 |

MAPEH appears three times because the report card does: one graded line and two reported beneath it. Whether those are three subjects or one with two reported parts is the school's to say, and the catalog should not guess. The Kinder and Grades 1–3 lists are not in any supplied document.

This one has no dependency on the calendar or on staff accounts. It is the single thing in all three documents that can be entered the moment somebody can sign in as a manager.

A fourth thing is half known. The SF9 reports four quarters, so the year has four reporting periods rather than three terms — but `periodCreate` takes each one's start and end dates, and those are in the school calendar, not on any of these forms.

Listing a subject for a grade defines no assessment behavior. Seeding any of this through a migration would bypass the version check and the change journal that every write carries, so it goes in through the API as a manager, with a reason, or not at all.

### Why the operator credential is not a way around the missing manager

It is worth writing down, because it looks like a shortcut and is only one for two of the three.

`edunexus.audit_events.actor_user_id` is nullable, so the school profile and the sections *can* be written by the operator directly — the row lands and the audit entry simply records nobody. `edunexus.subject_events.actor_user_id` is `not null` and references `edunexus.staff`, so `create_subject` **cannot** run without naming an active manager who did it. The catalog refuses an unattributed write by design, and that is the correct behavior rather than an obstacle: naming the invited principal as the actor for ten rows they never entered would put a false name in the journal of a system whose point is that the journal is true.

So the honest options are a real sign-in, or an operator write that leaves the actor null and enters no subjects. `.local/apply-school-facts.ts` does whichever it is given, dry-runs by default, is idempotent, and invents no academic year: if 2026–2027 does not exist it skips the sections and says so, because the year needs term dates that no supplied form carries.
