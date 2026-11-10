# Acceptance testing and TAM evaluation kit

Printable task scripts, a problem log, the TAM questionnaire and a sign-off
sheet, for user acceptance testing of EDUNEXUS with the staff of Balili
Elementary School.

> **Rewritten 2026-11-04.** The original of this kit was lost in the 0.86.1
> recovery and exists in no branch and no commit. This is rebuilt from the system
> and from the manuscript's own evaluation design, and covers everything up to
> 0.87.0.

---

## Before you run a session

### Gate check

UAT sits behind two gates in [constraints.md](../constraints.md):

- **Real staff sign-in and school acceptance** — *half open*. A manager has
  signed in; school acceptance is outstanding, and that is what this kit
  produces.
- **Privacy owner and approved purposes** — **shut.** Until it opens, the hosted
  database holds **synthetic records only.**

> **Run UAT on seeded synthetic records, never on real learner data**, unless the
> privacy gate has been opened in writing. Everything in this kit works on
> seeded data.

### Set the system up

```bash
npm run seed:test-data -- --rehearse    # a throwaway database first
```

For a hosted rehearsal, `SEED_CONFIRM=seed-production`. The seed writes a
Balili-shaped school through the real API: 30 sections at the SF4's own sizes
(893 learners), three Kinder advisers holding two sections each, a 2026–2027 year
on three terms, a whole-year calendar, the register from 15 June to yesterday,
June–August submitted and locked, follow-up cases, fourteen learning areas, and
report cards. `--fill` fills every box the seed left empty; `--report-cards` tops
up an older seed.

While the database is seeded, an amber **Seeded test data** banner sits above
every screen, in print too, and a **Seeded** tag shows in the sidebar.
Downloaded file names start `SEEDED-`. **If you do not see the banner, stop** —
you may be on real records.

For a purely local walk-through with no account at all:

```bash
npm run demo        # 127.0.0.1:5173/demo.html — four synthetic staff, invented records
```

### What each participant needs

- A device of their own — a school laptop at 1366px, or a phone at 390px. Test
  both across the group.
- Their own account and role: principal, administrative officer, or adviser.
- The paper they normally work from: their class register, an ECR printout, a
  previous year's SF10 or report card.
- The task script for their role, printed.
- No coaching. **Write down where they hesitate**; that is the finding.

### What you need

- The problem log, printed, several copies.
- A watch. Note roughly how long each task takes.
- The TAM questionnaire, one per participant, handed out **after** the tasks.

---

## Task script A — the principal

*Name:* ____________________ *Date:* __________ *Device/width:* ____________

| # | Task | Done | Time | Notes |
|---|---|---|---|---|
| A1 | Sign in. Find your way to **Overview** | ☐ | | |
| A2 | Open **School profile** and check the school's name, **school ID**, district, division, region and school head | ☐ | | |
| A3 | Record the school's **attendance rule**: what a half-present day is, and whether a single-session day counts. Give a reason | ☐ | | |
| A4 | Change the rule, then look at its **history** | ☐ | | |
| A5 | On **Attendance today**, find which sections have not taken the register | ☐ | | |
| A6 | Open **School Form 4** for a submitted month. Read it | ☐ | | |
| A7 | **Issue** that SF4. If it refuses, read the refusal and say what you would do | ☐ | | |
| A8 | Open an SF4 for a month that is **not** finished. Say what the form tells you | ☐ | | |
| A9 | On **Grade entry**, find a section that still has grades to record | ☐ | | |
| A10 | From the **Overview**, open an end-of-year endorsement and **approve** one section's outcomes | ☐ | | |
| A11 | Open **Next year's classes**. Say how many learners each grade receives, and why one named learner is not coming | ☐ | | |
| A12 | On **Privacy access log**, find who has read a particular learner's records | ☐ | | |
| A13 | On **Activity log**, find a change somebody made and the reason they gave | ☐ | | |
| A14 | On **Public site**, write an announcement, save it as a draft, then publish it | ☐ | | |
| A15 | Approve or decline a staff **name correction** request | ☐ | | |
| A16 | Take down a colleague's profile photo, with a reason | ☐ | | |

**Ask afterwards:**
- Which figure on the SF4 would you check first, and did you find it?
- When the form refused, did you know what to do next?
- Is there anything here you would not trust to send to the division?

---

## Task script B — the administrative officer

*Name:* ____________________ *Date:* __________ *Device/width:* ____________

| # | Task | Done | Time | Notes |
|---|---|---|---|---|
| B1 | Sign in and open **Learner registry** | ☐ | | |
| B2 | Find one learner by name, and one by LRN | ☐ | | |
| B3 | Filter the registry to one **grade level** | ☐ | | |
| B4 | Open one learner. Say what their current grade and section are | ☐ | | |
| B5 | Register a **new learner** and enrol them at a grade **with a section** | ☐ | | |
| B6 | Enrol a learner at a grade **with no section** | ☐ | | |
| B7 | On **Roster import**, check a class list file. Find the problems it reports and say which row each is on | ☐ | | |
| B8 | Import a corrected list | ☐ | | |
| B9 | **Enlist one late learner** mid-year | ☐ | | |
| B10 | Read an adviser's submitted **class list**, then accept it with the import you ran | ☐ | | |
| B11 | Record a **transfer out** for one learner, effective on a date this month | ☐ | | |
| B12 | Open **School Form 2** for that learner's section and this month. Find them and read their remark | ☐ | | |
| B13 | Try to **issue** an SF4 while a registered learner is in no class. Read the refusal | ☐ | | |
| B14 | Put that learner in a class, then issue it | ☐ | | |
| B15 | On **Invitations**, request an account for a new staff member | ☐ | | |
| B16 | Open one learner's **SF10** and print a working copy | ☐ | | |
| B17 | Open the SF10 of a learner who is only in **Kindergarten**. Say what EDUNEXUS tells you | ☐ | | |

**Ask afterwards:**
- Was the import's list of problems enough to fix the file?
- Did you ever have to guess what a screen wanted?
- B13 — was the refusal reasonable, or in your way?

---

## Task script C — an adviser

*Name:* ____________________ *Date:* __________ *Section(s):* ____________
*Device/width:* ____________

| # | Task | Done | Time | Notes |
|---|---|---|---|---|
| C1 | Sign in. Open **Daily attendance** for your section, today | ☐ | | |
| C2 | Mark your whole class using the **keyboard** (`p`, `x`, `m`, `a`) | ☐ | | |
| C3 | Leave one learner **not marked** on purpose. Say what that means | ☐ | | |
| C4 | **Review** your marks and **confirm** them | ☐ | | |
| C5 | Change one mark from earlier this week | ☐ | | |
| C6 | Try to mark a date that is not a school day. Say what happened | ☐ | | |
| C7 | **Print this register** for the classroom | ☐ | | |
| C8 | Download the **Class list**, and the **Month's marks**. Open both in Excel | ☐ | | |
| C9 | Open your **School Form 2** for this month. Say which dates it says are missing | ☐ | | |
| C10 | Go back and mark one of them, then look at the SF2 again | ☐ | | |
| C11 | Submit your month on **Monthly consolidation** | ☐ | | |
| C12 | On **Absence monitor**, find your most-absent learner | ☐ | | |
| C13 | Open a **follow-up case** and record what was done | ☐ | | |
| C14 | On **Promotion → Report card**, enter one learning area's grades for a term **for the whole class**, from your ECR | ☐ | | |
| C15 | Enter one learner's **whole card**: grades, final grades and remarks, general average, observed values, comments | ☐ | | |
| C16 | Try to enter a grade with **three decimal places**. Say what happened | ☐ | | |
| C17 | Open **Class summary** and check it against your ECR. Print it | ☐ | | |
| C18 | Open that learner's **SF9**. Confirm the grades match what you entered | ☐ | | |
| C19 | Find the **attendance** on the SF9. Say where those numbers came from | ☐ | | |
| C20 | Record one learner's end-of-year **outcome** | ☐ | | |
| C21 | On **Academic history**, find one of your learners and **add a school year** from a previous grade, copied from your own document | ☐ | | |
| C22 | Add a **Kindergarten** record for a learner. Say where it went and why it has no grade | ☐ | | |
| C23 | Open that learner's **SF10**. Confirm the year you typed is there, in order | ☐ | | |
| C24 | Press **?** on any screen and find the answer to something | ☐ | | |
| C25 | Run a **tour** from My profile | ☐ | | |

**Ask afterwards:**
- C2 — was typing quicker than clicking? Did `a` for *afternoon* confuse you?
- C3 — is *not marked* clearly different from *absent*?
- C14 vs C15 — which way would you actually work?
- C19 — did you expect to be able to type the attendance?
- C21 — how long would one learner's full history take you? Multiply it out.

---

## Accessibility and layout pass

Run once per role, by the facilitator, not the participant.

| # | Check | Pass | Notes |
|---|---|---|---|
| D1 | Every screen at **1366px** — nothing cut off, no sideways scroll | ☐ | |
| D2 | Every screen at **390px** — the rail is a drawer, nothing overflows | ☐ | |
| D3 | **Dark theme** on — no invisible text, no white-on-white | ☐ | |
| D4 | **Higher contrast**, **underlined links**, **strong focus**, **large targets**, **relaxed spacing**, **readable typeface** — each on, every screen still usable | ☐ | |
| D5 | **Keyboard only**, no mouse — reach and use every control; the focus outline is always visible | ☐ | |
| D6 | axe contrast rules, **light and dark** — no violation | ☐ | |
| D7 | The browser **console** and the **content policy** — nothing reported | ☐ | |
| D8 | A printed paper form is the **light** design whatever the theme | ☐ | |

---

## Problem log

One row per problem. Copy as needed.

| # | Who / role | Screen | Task # | What they expected | What happened | Severity | Fixed in |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |

**Severity:** `blocker` — cannot finish the task · `serious` — finished it the
wrong way or needed help · `minor` — finished it, with irritation ·
`cosmetic` — looks wrong, works.

**Record a hesitation even when the task succeeded.** "Looked for Issue in the
header for 20 seconds" is a finding.

### Is it a problem, or a rule?

Before logging, check it is not one of these. Each is deliberate, and
participants will report several of them as faults:

| Reported as | Actually |
|---|---|
| "It won't calculate the average" | Nothing computes a grade. By decision |
| "The attendance box is empty" | No rule recorded, an unmarked session, or an unset date |
| "It won't let me issue the form" | The refusal names what is missing |
| "There's a crossed-out box" | No record. Drawn rather than blanked, on purpose |
| "It doesn't warn me about absences" | The school has no approved threshold |
| "I can't type the attendance on the card" | It is counted from the register, so the two cannot disagree |
| "Kindergarten has no report card" | The school has not supplied one |
| "It rounded nothing / refused my grade" | A third decimal place is refused, never rounded |
| "I can't change my own name" | A manager decides. Ask on My profile |

Log these as **expectation mismatches** instead — they tell you what to say in
training, which is just as useful.

---

## TAM questionnaire

Hand out **after** the tasks. Items adapted from Davis (1989), as the manuscript
describes. One per participant.

*Role:* ☐ principal ☐ administrative officer ☐ adviser
*Date:* __________

For each statement: **1** strongly disagree · **2** disagree · **3** neutral ·
**4** agree · **5** strongly agree.

### Perceived Usefulness

| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| PU1 Using EDUNEXUS would let me do my recording work more quickly | ☐ | ☐ | ☐ | ☐ | ☐ |
| PU2 Using EDUNEXUS would improve my performance in this work | ☐ | ☐ | ☐ | ☐ | ☐ |
| PU3 Using EDUNEXUS would increase how much I get done | ☐ | ☐ | ☐ | ☐ | ☐ |
| PU4 Using EDUNEXUS would make this work easier to do | ☐ | ☐ | ☐ | ☐ | ☐ |
| PU5 Using EDUNEXUS would make my records more accurate | ☐ | ☐ | ☐ | ☐ | ☐ |
| PU6 I would find EDUNEXUS useful in my work | ☐ | ☐ | ☐ | ☐ | ☐ |

### Perceived Ease of Use

| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| PEU1 Learning to use EDUNEXUS would be easy for me | ☐ | ☐ | ☐ | ☐ | ☐ |
| PEU2 I would find it easy to get EDUNEXUS to do what I want | ☐ | ☐ | ☐ | ☐ | ☐ |
| PEU3 My interaction with EDUNEXUS would be clear and understandable | ☐ | ☐ | ☐ | ☐ | ☐ |
| PEU4 I would find EDUNEXUS flexible to work with | ☐ | ☐ | ☐ | ☐ | ☐ |
| PEU5 It would be easy for me to become skilful at using EDUNEXUS | ☐ | ☐ | ☐ | ☐ | ☐ |
| PEU6 I would find EDUNEXUS easy to use | ☐ | ☐ | ☐ | ☐ | ☐ |

### In your own words

1. What was hardest? ______________________________________________

2. What would you change first? ___________________________________

3. Is there anything you would not trust it with? _________________

4. Compared with how you do this now, is this better or worse, and why?
   ____________________________________________________________________

*Signature:* ____________________

### Summarising it

For each construct, per participant and then per role:

- **Mean** of its six items, to two decimal places.
- **Range** — the lowest and highest item.
- **Any item scoring 1 or 2 from anyone**, listed with the participant's role.
  A single strong disagreement is more informative than a mean, and must not be
  averaged away.

Report: PU mean and PEU mean, overall and per role; the count of responses; every
item that drew a 1 or 2; and the free-text answers in full. **Do not compute a
single combined "acceptance score"** — the two constructs are separate by design,
and the manuscript treats them separately.

Note the sample size honestly. With 33 staff, say how many took part.

---

## Sign-off

EDUNEXUS, version __________, tested on __________ at Balili Elementary School.

**Participants:** ______ principal(s), ______ administrative officer(s), ______
adviser(s). Total ______.

**Problems found:** ______ blocker, ______ serious, ______ minor, ______
cosmetic. ______ expectation mismatches.

**Every blocker is fixed, or accepted in writing:** ☐ yes ☐ no — see log rows
____________

**TAM:** Perceived Usefulness mean ______ · Perceived Ease of Use mean ______

### We accept EDUNEXUS for use with the school's records

| | Name | Position | Signature | Date |
|---|---|---|---|---|
| School head | | | | |
| Administrative officer | | | | |
| Adviser representative | | | | |

### Still outstanding at sign-off

List anything accepted as known and unfixed, and anything waiting on a school
decision. The gates in [constraints.md](../constraints.md) belong here — in
particular, **whether the privacy owner and approved purposes have been settled**,
because no real learner record may be imported until they are.

____________________________________________________________________

____________________________________________________________________

---

## After the session

1. Enter every problem in the log into the project's own record, and fix the
   blockers.
2. Record the outcome in [status.md](../status.md) and any decision it produced in
   [constraints.md](../constraints.md), with its date.
3. If a refusal confused somebody, the fix is often the **wording** of the
   refusal or its **FAQ answer**, not the rule. The rules are the point of the
   system; the explanations are ours to improve.
4. Correct [the staff guide](staff-guide.md) wherever reality differed from it.
