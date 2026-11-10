# EDUNEXUS staff guide

For the staff of Balili Elementary School: what each screen is for, the order the
work is done in, and what EDUNEXUS will not do for you.

> **Rewritten 2026-11-04.** The original of this guide was lost in the 0.86.1
> recovery and exists in no branch and no commit. This is rebuilt from the
> system itself and covers everything up to 0.87.0.
>
> **The screenshots are missing.** The original had them, taken from the
> synthetic demo (`npm run demo`). They can be retaken the same way, against
> invented records and never against real ones.

---

## Signing in

Go to the school's EDUNEXUS address and choose **Sign in**. It is your school
email and a password — there is no code and no authenticator app.

**Keep me signed in on this computer** is for a machine only you use. Leave it
unticked on a shared staffroom computer: your session then ends when you close
the tab, and signing out always forgets the choice so the next person starts
clean.

When your browser offers to save your password, let it. EDUNEXUS does not keep
passwords, and your browser's password manager is the right place for one.

Forgot it? **Reset your password** on the sign-in page. If your account has not
been set up yet, the office sends you an invitation first.

---

## Finding your way around

| | |
|---|---|
| The **sidebar** | Your screens, grouped by the work they hold. Fold a group away by its name; **Collapse sidebar** for more room. On a phone the menu button opens the same list |
| **Ctrl+K** (⌘K on a Mac) | Jump to any screen by typing its name. It also finds help |
| **?** | Opens help for the screen you are on, over the page, so nothing you have typed is lost |
| **Help & FAQ** in the sidebar | Every guide, every question, and the tours |
| Your name, top right | My profile, your preferences, and sign out |

You only see the screens your role uses. If a guide mentions a screen you cannot
open, that work belongs to someone else — the guide still names it so you know
where to ask.

### Make it comfortable

On **My profile**: the screen to start on, text size, a light or dark theme, and
less motion. Under **Accessibility**: higher contrast, underlined links, a
thicker keyboard outline, bigger buttons, more line spacing, and a typeface drawn
for low vision. Each applies at once and follows your account to any computer.
Signing out puts the defaults back for the next person.

**Learning EDUNEXUS**, also on My profile, restarts any tour and lists what's
new.

---

## For the principal and the administrative officer

### Setting up a school year, in order

Do these in order. Each one needs the one before it.

1. **School profile** — the school's name, its ID (**135617** — check it; there
   is a second Balili Elementary School at 135642), address, district, division,
   region, and the school head. This heading prints on every form.
   - Also here: **the attendance rule**. See below. Nothing counts attendance
     until it is recorded.
2. **School years & sections** — create the year, then its reporting periods
   (terms or quarters), then its sections. **Create sections** starts from the
   SF4's own layout: Kindergarten A–F, and A–D for every graded level. Edit the
   list before it is created.
3. **Staff access** — give each teacher the sections they advise, under
   *Advises in*. Or **Assign advisers** in the header, every section in one
   table. A teacher can hold more than one section: three Kinder advisers hold
   two each.
4. **Instructional calendar** — which dates are school days, and which sessions.
   **Fill a date range** sets a whole stretch: weekdays one way, weekends
   another, then type the holidays and breaks from the school's own approved
   calendar. **EDUNEXUS supplies no holidays.** It is not the authority on the
   school calendar, and a wrong date changes every attendance figure.
5. **Subjects & offerings** — the learning areas, offered to each section.
6. **Learner registry** and **Enrollment** — the learners, and their year.
7. **Academic history** — the school years each learner finished before
   EDUNEXUS. A one-off. See below.

**Getting started** on the Overview tracks this for you. It is worked out from
the records themselves, so it is never out of date — and if it cannot read
something it says so rather than guessing.

### The attendance rule

On **School profile**, and **only the principal** can record it. Two questions:

1. A learner present for one session and absent for the other — is that **tardy**
   (counted present), **absent**, or **half a day** each way?
2. A day with only **one** session of classes — does it count as a day of
   classes?

**Until this is recorded, no attendance figure anywhere is filled in.** Not
estimated, not zero — blank, with the screen saying why. The SF2 and SF4 will
refuse to issue. This is deliberate: EDUNEXUS will not invent the school's own
rule.

Changing it is recorded with a reason, and every form already issued keeps the
rule it was issued under.

### The monthly routine

1. Advisers mark the register each day.
2. Advisers submit their month on **Monthly consolidation**.
3. Read **School Form 4** for the month. It will tell you what is not ready.
4. Issue it.

**Attendance today** shows which sections have taken the register, without
opening anybody's class list.

### Registering and enrolling learners

**Learner registry** holds the learner records. **Enrollment** puts a learner
into a school year at a grade — and, if you know it, a section.

A learner can be enrolled at a grade with **no section yet**. That is normal: a
class is decided later, by someone else. But note that **the SF4 counts every
figure by section**, so a learner in no class is on no row — the SF4 reports them
separately and **refuses to issue until every registered learner is in a class.**
Place them, then issue.

**Roster import** takes a class list as a file, checks every row and shows you
each problem before anything is written. **Enlist one late learner** adds one
learner mid-year: the registry is searched first for the same surname and birth
date, so nobody is created twice.

Advisers can prepare and submit their own class lists. You read the list, run the
import, and accept the submission with the import you ran. **Only you create a
learner record.**

### End of year

1. Advisers record each learner's outcome on **Promotion** — promoted,
   conditionally promoted, retained or remedial, in the SF10 workbook's own
   words.
2. Endorsements wait on your **Overview**. **Review and approve** opens Promotion
   at that section.
3. Once every learner going into a grade next year has an approved outcome, the
   Overview offers **Prepare next year's** that grade.
4. **Next year's classes** shows who is carried into next year, which grade each
   lands in, and **everybody left out with the reason**. Check what each grade
   receives, then enrol them. They arrive at their grade **with no class** — a
   class is given separately.

**Grade entry** shows how far each section has got with its grades: counts per
section, no learner named.

### The school's front page

**Public site**: the tagline, about, mission, vision and contact details, plus
announcements, events, advisories and the questions parents ask. Write a draft,
then publish it. Archiving is for good.

**Nothing about a learner ever appears on the front page.**

### Who did what

| | |
|---|---|
| **Activity log** | Every change anyone recorded, with its reason |
| **Privacy access log** | Every time anyone read a learner's records, and which |

The second one is the point of a lot of the system's design. Keep it readable:
it is how the school can answer "who looked at this child's record".

---

## For advisers

### Your day: the register

**Daily attendance** → your section → today.

Click the chips, or **type**, which is quicker for a whole class:

| Key | Marks the whole day |
|---|---|
| `p` | present |
| `x` | absent |
| `m` | absent in the **morning** only |
| `a` | absent in the **afternoon** only |

These are the SF2's own letters. Each one moves you to the next learner in the
same column — the order you read a paper register in.

> **`a` means *afternoon*, not *absent*.** It matches the SF2 exactly. The hint
> above the table says so.

Three chips, not two: present, absent, and **not marked**. *Not marked* is a real
value and it is not the same as absent. If you do not know whether a child was
there, leave it not marked — EDUNEXUS will leave the month's figures blank and
tell you which dates to go back to, which is the truth. It will never record a
presence nobody saw.

Then **Review N marks** and **Confirm this review**. Marks are held until you
confirm them, and saved together — so a colleague's change cannot half-overwrite
yours.

If a date will not take marks, check **Instructional calendar**: attendance
cannot be recorded on a date nobody has set.

### Each month

**Monthly consolidation** → review your month → submit it. The office compiles
the SF4 from the submitted months.

Read your **School Form 2** first. It tells you exactly what is missing and on
which dates.

### Learners you are worried about

**Absence monitor** shows absences across your sections. **Follow-up cases**
records what was done about one and how it turned out.

> **EDUNEXUS does not alert, message or notify anybody about attendance.** The
> school has no approved threshold, so nothing fires. The SF2's five-consecutive-
> absences box is counted because the form has that box; it is a count, not an
> alarm.

### Report cards

**Promotion** → your section → **Report card**.

Work from the DepEd ECR. Copy one learning area down the whole class — that is
what the class tables are for — or do one learner's whole card at once.

What you enter: each learning area's grade per term, its final grade and remark,
the general average and its remark, the observed values (Grades 4–6), and the
comments or narratives your grade's card has.

> **EDUNEXUS computes nothing.** No total, no average, no percentage, no MPS, no
> GWA, no transmutation. Every figure is the one the ECR already worked out. A
> grade with three decimal places is refused rather than rounded, because
> rounding it would be EDUNEXUS deciding a rule nobody gave it.

Your card is offered only the boxes your grade's card actually prints. A Grade 1
card has narratives and no grades; observed values are Grades 4–6.

**Class summary** shows a whole section side by side for checking against the
ECR, and prints on long bond. Nothing on it is totalled, averaged or ranked.

**Attendance on the report card is counted from your register.** You do not type
it, and you cannot — so the card always agrees with the SF2.

### The school years before EDUNEXUS

**Academic history**. A one-off: the years each of your learners finished before
the school had EDUNEXUS, typed from the school's own spreadsheets and forms.

You may encode the learners **currently in the sections you advise**, at **any
previous grade level** — not only the grade you teach. The documents are yours;
that is the whole reason you and not the office do this.

Search for the learner, **Add a school year**, then copy what the document says:
the grade, the school that taught it, the learning areas and their quarters, and
the general average already written on it. A quarter the document leaves empty
stays empty.

**Kindergarten is different.** It goes under *Eligibility for Grade 1*, as the
credential the learner presented when they entered Grade 1. It carries **no
grade**, because the SF10 has no grade boxes for Kinder.

Each year goes onto the learner's **one** SF10, in order, beside the years
EDUNEXUS recorded itself. There is no new SF10 each year.

### Printing

**Print this register** gives you a headed classroom sheet with a signature line.
**Class list** and **Month's marks** download as spreadsheets — every cell says
what is there, and nothing is counted.

---

## The official forms

| Form | Where | Who |
|---|---|---|
| **SF2** — a section's monthly register | School Form 2 | Advisers and the office |
| **SF4** — the school's monthly consolidation | School Form 4 | The office |
| **SF9** — a learner's report card | Learner registry, per learner | Advisers and the office |
| **SF10** — a learner's permanent record | Learner registry, per learner | Advisers and the office |

### Print, and Issue, are different

**Print a working copy** prints. It records nothing. Use it for checking.

**Issue** is the official act: it records a serial number, a fingerprint of
exactly what the form said, who issued it and when. Re-issuing a form whose
content has changed is a **correction**, and EDUNEXUS asks you to write the
reason.

### Why a form sometimes refuses

A refusal is the system working. It always says what to do:

| | |
|---|---|
| The month is not over | *n* days of classes are still to come. While a month is running the SF2 counts **to date** and says so. Issue it once the month has ended |
| Sessions are not marked | It names how many. Mark them |
| Dates are not set on the calendar | Set them |
| A date has an alternative-delivery session | The school's rule does not cover it, so the figure stays blank |
| Sections have not submitted | The SF4 is built from submitted months |
| Registered learners are not in a class | Name by grade. Put them in a class, then issue |
| No Kindergarten card | The school has not supplied one |
| *SF10 begins at Grade 1* | A Kinder learner's records are the SF5-K and the ECCD checklist |

### A struck-out or hatched box

That is **not** a loading error and not a zero. It means **no record**. EDUNEXUS
draws what is missing rather than leaving a blank, because a blank reads as a
page that failed and an em dash reads as something somebody typed.

---

## What EDUNEXUS will not do, and why

Each of these is deliberate. None is a missing feature.

| | Why |
|---|---|
| **Compute any grade** — no total, average, percentage, MPS, GWA or transmutation | The arithmetic is DepEd's. A wrong rule here would silently corrupt real report cards |
| **Round a grade** | Same reason. A third decimal place is refused |
| **Rank or place learners in order** | Nothing in the system ranks a class |
| **Estimate an attendance figure** | With no rule, an unmarked session or an unset date, the figure is blank |
| **Treat a missing mark as present** | Absence of a record is not evidence |
| **Alert on absences** | The school has no approved threshold |
| **Grade Kindergarten numerically** | The school has not supplied its Kindergarten policy |
| **Enforce a class size** | Observed sizes are known; observation is not policy |
| **Let a teacher change a learner's record** | With one exception: the academic history above |
| **Let you change your own name** | The staff record is the school's. Ask on My profile; a manager decides |

If you need one of these, it needs a written decision from the school, not a
change to the software.

---

## Getting help

- **?** on any screen — that screen's guide, its steps, and what will stop you.
- **What does this mean?** under a refusal — the answer for that exact refusal.
- **Help & FAQ** in the sidebar — everything, searchable.
- **Learning EDUNEXUS** on My profile — the guided tours. They only point;
  nothing changes until you do it yourself.

Help never shows a learner's details. It is fixed text.
