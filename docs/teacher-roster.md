# An adviser's own class roster, and school-wide encoding oversight

Phase 2 steps 6 and 7, shipped together in 0.90.0 (migration `0054`). Two
separate features; they share nothing but the academic lock and this file.

Step 8, the batch SF10, is **deferred** by instruction and untouched.

---

## Step 7 — an adviser builds their own class

### This reverses a settled rule, and the reversal is the decision

Since `0004` the rule has been: managers change learner records, teachers read
only the learners in the classes they advise. One exception was added on
2026-11-03 for historical encoding. The 0.42.0 `constraints.md` additionally
recorded that *"a teacher-accessible unassigned pool is not implemented"*, and
the roadmap's own step 7 said a pull **must stay a request** that a manager
approves, reusing `roster-submissions`.

The user decided on 2026-11-05 that the adviser does it directly. That is
recorded in [constraints.md](constraints.md) with its date and its limits, and
`roster-submissions` remains for an adviser who prefers to submit a list.

### What widened, exactly

| | |
|---|---|
| Always **a section they advise**, in a year that is not closed | `may_advise_section` is the single predicate, and every new path goes through it. A manager passes it for any section |
| Taking a learner in only ever **gives a class to an enrolment that has none** | Moving a learner out of a colleague's class, withdrawing and re-entering stay a manager's movement |
| Registering refuses a **name and birth date already on the registry** | An adviser cannot search the registry to check, and two records for one child means two SF10s with no way to tell which is the record |
| **Nothing else** | No profile correction, no LRN, no grade change, no withdrawal, no deletion |
| **The read scope never widened** | Row security is untouched. A teacher still reads only their own classes |

```
GET  /api/v1/sections/:id/pullable-learners   who is waiting; logged
POST /api/v1/sections/:id/pulls               take one in
POST /api/v1/sections/:id/learners            register a new one into this class
```

### There is no second enrolment path

Both writes go through `place_enrollment` and `move_enrollment` — the same two
writers the registry form, the roster import and next year's placement use. Each
was replaced in `0054` with **one authorisation line changed** and its `0048`
signature intact, so the LRN rule, the date rules, the one-enrolment-a-year
index, the version check and the `enrollment_events` journal are the same ones,
not a set written for teachers.

`place_enrollment` allows an adviser when a section is given and they advise it;
with no section it stays manager-only, because an enrolment with no class
belongs to no adviser. `move_enrollment` allows an adviser only
`action='reassigned'` into a section they advise, on an enrolment whose
`section_id` **is null**.

### Who is offered, and why so narrowly

`read_pullable_learners` lists the learners registered for that section's school
year **at its grade, with no class yet** — which is exactly what the
registry-first import of 0.89.0 produces. An optional search of two characters
or more additionally finds a learner with **no enrolment this year at all**, so a
returning learner can be taken in without the office keying them again; without
a search that group is not listed, because a bare list of every learner the
school has ever held is not an adviser's to read.

This names learners outside the adviser's own class. That is the feature's cost,
so every call writes a `record_access_events` row (`pullableList`) naming exactly
the records it returned, as does every write here (`learnerPull`,
`learnerRegister`). The oversight read of step 6 appears nowhere in that log
because it names nobody.

### The trap: a branch on records the caller cannot read

Deciding *which* of the two writes applies cannot be done in the service layer,
and the first test run proved it.

An adviser **cannot see** an unplaced learner's enrolment —
`visible_learner_identity` answers null for exactly that caller, which is
correct. So a service-layer lookup under row security found nothing, took the
"not enrolled" branch, and asked `place_enrollment` to create a **second
enrolment for the same learner in the same school year**. Only the unique index
caught it.

The decision now lives in `pull_learner_into_section`, a security-definer
function that re-checks the policy it bypasses, and reads which write applies
**from the records rather than from what the caller says** — so a stale list
cannot turn an assignment into a second enrolment either. The general rule is in
`constraints.md`: when a write must branch on records the caller may not read,
the branch belongs in the definer function, and a service-layer lookup that
returns nothing for an authorised caller is a symptom, not a null case.

### Refusals

| Code | |
|---|---|
| `P2600` `NOT_YOUR_CLASS` | Not a section the caller advises |
| `P2601` `LEARNER_ALREADY_ON_REGISTRY` | A learner of that name and birth date is on the registry already — take them in instead |
| `P2602` `LEARNER_IN_CLASS` | Already in a class this year; a manager moves a learner between classes |
| `P2603` `LEARNER_OTHER_GRADE` | Registered at another grade this year |
| `P2604` `VERSION_CONFLICT` | The list was stale: read it again and take them in from it. This is what stops two advisers both claiming one unplaced learner |

### A school year that is not running yet (0.95.2)

The school reported that **no learner appeared after the principal created the
new school year**, and the verification separated three things that looked like
one.

**The empty list was right.** With no search, `read_pullable_learners` offers
only learners who already hold an enrolment *in that school year*, at that
section's grade, with no class. A year just created holds no enrolments at all,
so the list is empty until the office carries last year's learners over
(`POST /academic-years/:source/next-year-classes`, which needs approved
end-of-year outcomes) or registers them. A search of two characters or more does
find a learner with no enrolment that year, and answers `how: 'enrol'` — that
path was never broken.

**The writes behind the sheet were not right.** The sheet sets the first day to
`clamp(today, starts_on, ends_on)`, which for a year that has not begun is its
`starts_on` — a future date. The two writes then disagree about it:

- taking in a learner the office has registered is a `move_enrollment`, which
  refuses a future-dated movement, so every such take-in came back
  `409 RULE_VIOLATION`;
- registering, or taking in a learner who holds no enrolment that year, is a
  `place_enrollment`, which has **no** future-date check, so the same date
  succeeded and wrote a future-dated enrolment.

One refusal and one silent success for the same first day on the same sheet.
**The school builds its classes only once the year is activated** (decided
2026-11-06), so `web/screens/MyClass.tsx` refuses up front instead: `barrier()`
names the reason — not activated, closed, or not yet begun — and while it holds,
neither write is offered and **nothing is read**, because the list names
learners outside the adviser's own class and naming one writes a
`record_access_events` row.

The backend is untouched. `move_enrollment`'s rule stands as `0048` wrote it;
if advisers are meant to section a year in advance, that is a migration and a
decision, not a screen change.

**And the class picker named no year.** It listed every section the adviser
advises — `/sections` has no year filter — ordered by `order by
academic_year_id`, a uuid and so not chronological, and opened on whichever
sorted first. An adviser advising in two years could not tell which class they
were looking at. The sheet now reads `/academic-years` with `/sections`, prints
the year in each option, sorts newest year first, and opens on a class that can
actually be built. The empty state no longer claims the class is full: it says
what an empty list means and names the office step that fills it.

`tests/web-teacher-roster.test.ts` covers all three in a real DOM against the
real API: the year named on every option and the opening choice, the unactivated
year refused with no take-in offered and no access row written, and an activated
year that has not begun refused with its start date.

### The three capabilities coexist

Required explicitly, and tested: an adviser may take learners in, register new
ones, **and** encode the historical academic records of the learners in their
classes (the 2026-11-03 exception, now reachable through a pull —
`tests/teacher-roster.test.ts` walks exactly that path and then checks the
adviser still cannot read a colleague's learner).

---

## Step 6 — the office oversees the historical encoding

The one unmet requirement of the 4 November brief: administrators must *"oversee
historical encoding progress across the entire school"*, while Academic history
was per-learner only — reached by searching for one child, with no way to see
which of 30 classes still had work.

`GET /academic-years/:id/encoding-progress` (`read_encoding_progress`) counts,
for every section of a year: the learners it holds, how many have an encoded
previous school year, how many have the Grade 1 credential, how many have
**neither** — the work left — the years encoded, and the adviser's name.
Learners registered at a grade with no class yet are counted on their own, so
the school total is the whole school rather than only its placed part, for the
same reason the SF4 reports its unplaced learners (`0052`).

It is **Across the school** above the learner finder on Academic history, for
managers only (`web/screens/EncodingProgress.tsx`).

### Counts only, and that is the design

It **mirrors `read_grade_entry` (0035) deliberately**: no learner named, no
rating read, and **no `record_access_events` row written**.

Every list under `/learners` and `/enrollments` writes an access row naming the
exact records it returned. A school-wide progress view built by paging the
registry would therefore write one such row per section per refresh, and bury
the privacy audit in its own noise — the rule the Overview has followed since
0.27.0. So this view trades names for frequency: it can be watched as often as it
is useful, and a manager who needs a name opens the learner, which logs that read
as it should.

`tests/web-teacher-roster.test.ts` asserts the access-event count **does not
move** when a manager opens it, because that is the property that would rot
silently.

## An adviser whose class is empty, and what the registry says then

Reported 2026-11-06 as "the Learner registry shows nothing for a teacher", with
the reading that the pullable query was requiring a `section_id` before a learner
could be taken in. **It was not, and it never has been.** The join in `0054` is

```sql
left join edunexus.enrollments e on e.learner_id=l.id and e.academic_year_id=y.id
  and e.record_state='valid' and e.status='enrolled'
  and e.section_id is null and e.grade_level=s.grade_level
```

so a learner **with no class** is precisely what the list returns, and an
enrolment that already has one is excluded rather than required. The whole
workflow was re-run end to end against the API to be sure: the unplaced learners
at the grade of a class the teacher advises are listed with LRN and birth date
and marked *Give them this class*; another grade's are not listed and that
section is refused `P2600`; taking one in calls `move_enrollment` and so assigns
the enrolment the office already holds, leaving one learner row and one enrolment
row; the learner then leaves the available list and a second take-in is refused
`P2602`; and a manager still reads every learner, placed or not.

**The live cause was the data.** On the demonstration database every one of the
69 enrolments in the active school year already held a class — `section_id is
null` matched nothing — so no learner was pullable, which is the list being
right rather than wrong.

**Re-measured later the same day, after the adviser assignments were changed,
and the picture is worth keeping because the first reading of it was wrong.**
The real teacher account does now advise an active-year class — Grade 2 **B**,
which holds **nobody** — along with seven classes in the **closed** 2025 year
holding ten learners each, and one in the **draft** 2027 year. So the registry is
empty for a reason that is nothing to do with the pull: the only class they
advise in the running year has no learners in it, and the ten-learner classes
they do hold are in a year that is closed, which row security does not show and
`may_advise_section` refuses outright.

Both are fixed from the office, not in code: the office enrols a learner at that
grade **without** a section (or carries last year's over on **Next year's
classes**), and a manager moves learners into the class or makes the teacher the
adviser of a class that has some, on **Staff access**.

### The sheet that loaded for ever

Reported with a screenshot on 2026-11-06, against the **deployed 0.95.1** build.
`Add learner` sat on its skeleton rows and never resolved. The cause is the
version, not the data: 0.95.1 has no `barrier()`, and it opened on
`page.items[0]` of `/sections` — which orders by `academic_year_id`, a uuid, so
it is not chronological and could land on a **closed** 2025 class. The list read
then raised `P2600` through `may_advise_section`, and the fetch's only `catch`
set the status line while leaving `answer` null, so `candidates` stayed null and
`BatchSheet` drew its skeleton for ever. 0.95.2 fixed both halves — the picker
sorts newest year first and opens on a class that can actually be built, and a
closed, draft or not-yet-started year is stated as a refusal that renders no list
at all. `tests/web-teacher-roster.test.ts` now holds the closed-year case
directly, asserting the refusal appears and that no skeleton, no checkbox and no
take-in button are rendered; disabling the barrier fails it.


What *was* wrong was the sentence the adviser read. The empty table said "No
learners are currently assigned to your sections." and stopped — true of their
class, silent about the learners waiting at that grade, and so read as "there is
nobody, and the system is withholding them". An empty table for an adviser now
names what it is describing, does not call the registry empty (it is not, and an
adviser cannot see it), and carries **Add learner** inside it. The read scope is
untouched.
