# Notifications

A personal inbox: the things that happened to work this person is responsible
for. Migration `0057`, module `src/modules/notifications/`.

> **This reverses two settled decisions**, on the user's explicit decision of
> 2026-11-05. Read [constraints.md](constraints.md) first — where this file and
> that one disagree, that one wins.

## What changed, and what did not

Two rows in the settled-decisions table said there would be nothing here:

- **2026-09-19** — the workspace has "no notification bell and no alert badge",
  because the absence-alert gate blocks "any messaging on attendance" and "a
  badge would be decoration imitating a signal". It ended: *"Add one when a rule
  exists to fire it."*
- **2026-11-05 (0.90.9)** — notification preferences were declined because
  "EDUNEXUS sends no notifications".

The condition the first decision named is what changed. A submitted class list,
an imported one and a declined one are rules that exist to fire a notification,
and none of them is about attendance.

**The absence-alert gate is untouched.** Nothing here counts, compares or
thresholds an attendance figure, and nothing notifies anyone about a learner's
absences. The user ruled separately, on 2026-11-05, that the gate covers
attendance *figures and thresholds* and not the submit/return/lock workflow
around a monthly consolidation, which is why `month_submitted`,
`month_returned` and `month_locked` are in the vocabulary below. That reading is
recorded as a decision because the gate is still contested.

## The operations

```
GET  /api/v1/notifications/count     unread count; names no record, writes no access row
GET  /api/v1/notifications           your own, newest first
POST /api/v1/notifications/read      mark one read  (the id travels in the body)
POST /api/v1/notifications/read-all  mark every unread one read
```

**None is manager-only, and none has a manager branch.** An inbox is personal.

The id is a `bigint` and travels in the **body**, not the path, because
`src/http-app.ts` parses every `:id` path parameter with `uuid.parse`. Putting a
notification id in the path would have meant weakening that global guard for one
module's convenience. It travels as a *string*, exactly as `recordAccessList`
already sends one.

## The four properties it is built to keep

### No learner is ever named

`payload` admits a closed list of keys — `section_name`, `grade_level`,
`row_count`, `count`, `month`, `year_label`, `decision` — enforced by a check
constraint, not by the care of whoever writes the next emitter. A learner's name
is not among them and cannot be added without a new migration.

This is the rule the Overview and the command palette already turn on. Every
list under `/learners` and `/enrollments` writes a `record_access_events` row
naming the records it returned, so a bell that previewed learner names would
write an access row on every poll and bury the privacy audit in its own noise.
A learner is carried as `learner_id` and rendered as nothing at all: **the
screen that shows a learner is the screen that logs the disclosure**, and the
notification only links to it.

There is a test for this that does not trust the emitters: it inserts a
`learner_name` key directly and expects the database to refuse it.

### A notification is not a record of school fact

It has no `version` and writes no journal row of its own. **This is a deliberate
exception to two of the database conventions in `AGENTS.md`**, and the reasons
are:

- Every row here is *derived* from a change that was already journalled by the
  writer that emitted it. The journal of record is `roster_submission_events`
  and its siblings; a second journal would record only that a copy was
  delivered.
- `read_at` moves `null` → timestamp once and is idempotent, so a version check
  would add a failure mode for someone with two tabs open while preventing no
  lost update.
- Marking one's own inbox item read is not a change to any school record, and
  asking for a 10–500 character reason to do it would be absurd.

The paste that proposed this feature asked for a "full audit record for
important state changes". That already exists, in the journal of the writer that
emitted the notification — which is why it is not duplicated here.

### Nothing may forge one

`notify` and `notify_managers` are revoked from `public` and **never granted to
`edunexus_app`**. The API holds `edunexus_app`, so the API cannot send a
notification; only another `security definer` writer, running inside the same
transaction as the change it reports, can. There are no insert, update or delete
policies on the table at all. A test asserts both functions answer *permission
denied* to the API's own login.

`notify` returns `void` and swallows an undeliverable recipient, because an
emitter must never be able to fail a real school change because a notification
could not be delivered.

### Nobody is notified of their own action

`notify` drops a row addressed to the actor. A manager who submits a class list
is not told about it; the other manager is.

Reaching that case at all takes a detour worth knowing: `0001` refuses a section
adviser who is not an active teacher, so **no manager ever advises a section**,
while `submit_roster` lets a manager submit for any section. The test exercises
it that way round.

## Who is told what

Only the roster emitters exist so far. They are `create or replace` restatements
of 0028's three writers in `0057`, following the pattern of `0018`, `0019` and
`0021`, because 0028 is applied and must never be edited.

| Event | Who is told | Kind |
|---|---|---|
| A class list is submitted | Every active manager, minus whoever submitted it | `roster_submitted` |
| A waiting class list is withdrawn | Every active manager | `roster_withdrawn` |
| A class list is imported | The adviser who submitted it | `roster_imported` |
| A class list is declined | The adviser who submitted it | `roster_declined` |

**"Needs correction" is not a status and none was invented to carry a
notification.** `roster_submissions.status` is `submitted`, `withdrawn`,
`accepted` or `declined` (`0028`). A *declined* list is the correction signal,
and it carries the manager's reason, which is where the correction is actually
described.

### Who did it is not always named

`actor_name` is a left join on `edunexus.staff`, whose `staff_read` policy in
`0001` is own-row-or-manager. So an adviser reading their own inbox gets
`actor_user_id` and a **null** `actor_name`: they are not told which manager
imported or declined their class list.

That is the existing boundary answering, not a gap. Naming the manager would
mean widening a teacher's read of staff so that a notification reads better —
the one trade `AGENTS.md` refuses outright. A manager reading the same column
does get a name, which is how the test shows that the column works and the row
policy is what decides.

## The vocabulary, declared once

`kind` carries every name the approved first release uses, all of it declared in
`0057` even though only the four roster kinds are emitted yet:

```
roster_submitted  roster_imported  roster_declined  roster_withdrawn
learner_placed  learner_moved  learner_withdrawn  learner_reentered  learner_unplaced
month_submitted  month_returned  month_locked
promotion_endorsed  promotion_approved  promotion_returned
adviser_assigned  adviser_removed  calendar_changed
year_activated  year_closed  next_year_placed
```

The whole list is declared up front because **a check constraint cannot be
widened in place** — `0055` learned that about `text_size` and had to replace the
check. A later emitter therefore adds no constraint, only a `create or replace`
of the writer it belongs to.

## What is deliberately not here

- **No attendance alert, threshold or absence message.** The gate is shut and
  stays shut.
- **No notification on routine data entry** — an attendance mark, a score edit,
  an opened learner record, a viewed form, a saved draft. Those stay visible
  through their own screens and through the audit and access logs.
- **No notification on public-site publishing.** Announcements, FAQs and
  school-profile content create no staff work; the manager who published gets a
  confirmation on the screen.
- **No retention or pruning rule.** Rows accumulate. That is an operational
  question for the deployment owner, not a DepEd policy question, and nothing
  was chosen here by default.
## The screen (0.93.0)

A **bell** only in the top bar carries the unread count and opens a **popout**;
there is no Notifications page or rail item.
The count is a number, not a dot, and the number is in the accessible label
too, because a screen reader should not have to infer it from a badge. It
comes from `GET /notifications/count`, refetches on every navigation and once
a minute besides, and goes silent on failure rather than interrupting what
somebody is typing — the count is furniture.

The shell only draws the number; `web/App.tsx` asks for it, which keeps the
shell presentational and `tests/web-shell.test.ts`-shaped tests able to render
it without an API.

**A row links to the screen the work is on — but only when the reader may open
it.** `hiddenFor` hides a screen from a role’s navigation without changing
what the API allows, and `routeFor` answers *Overview* for a screen a role may
not open. Roster import is `hiddenFor: ['principal']`, because on this
school’s division of work the administrative officer imports, and the
principal is still told a list is waiting — so an unconditional link would
have landed them on the Overview with no explanation. The row names the screen
in words instead, and `pointsAt` in the screen is the one place that decides.

The badge borrows the info badge’s three tokens (`--accent-100`,
`--accent-800`, `--accent-200`) rather than inventing a red the design system
does not have, so it retunes under `:root[data-scheme='dark']` with everything
else.

`tests/web-notifications.test.ts` drives it in a real DOM against the real API.
It also stands in for `tests/web-screens.test.ts`, which `AGENTS.md` describes
and which **does not exist in this tree** — it was lost with the rest of
`tests/` in the 0.86.1 recovery, so nothing else renders this route at all.

## Enrollment and class assignment (0058)

**The emission is at the intent boundary, not the row writer.** This is the
most important thing to know before adding another emitter.

The obvious place to notify was `place_enrollment`: every enrolment in the
system goes through it. But it is called **in a loop** — once per row of a
reviewed import by `src/modules/registry-review/service.ts`, and once per
promoted learner by `commit_next_year_placement` (0049). Emitting there would
have sent an adviser fifty notifications for one class list, and the office
several hundred for one year’s promotion.

So `place_enrollment` is left exactly as 0054 wrote it and **emits nothing**,
and the notification is sent by whichever function represents the act a person
took:

| Emitter | Why it, and not the row writer |
|---|---|
| `finish_import` | Called once per commit, and already holds the receipt — so the `count` is a fact it has rather than one to recompute |
| `move_enrollment` | One movement per API call; `registry/service.ts` calls it once per request and nothing calls it in a loop |

| Event | Who is told | Kind |
|---|---|---|
| An import into a class | That class’s adviser, once, with a count | `learner_placed` |
| An import onto the registry with no class | Every manager, once, with a count | `learner_unplaced` |
| A learner moved between classes | The class they joined, and the class they left, each in its own terms, plus managers | `learner_placed` / `learner_moved` |
| A learner withdrawn | The adviser of the class they were in, plus managers | `learner_withdrawn` |
| A learner re-entered | The adviser of the class they joined, plus managers | `learner_reentered` |

An adviser’s own pull reaches `move_enrollment` through
`pull_learner_into_section`, so the office is told and the adviser is not —
`notify` drops the actor’s own row, and they just did it.

A row carries `learner_id` so a screen can link to the record. It still names
nobody: an id is not a name, and following the link is what writes the privacy
access row.

## The monthly consolidation, promotion outcomes and the calendar (0059)

| Event | Who is told | Kind |
|---|---|---|
| A month is submitted | Every manager. `monthCommit` is manager-only, so the office submits and the *other* manager is told | `month_submitted` |
| A month is locked | The adviser whose class it is | `month_locked` |
| A month is returned, or a locked one reopened | The adviser whose class it is | `month_returned` |
| Outcomes are endorsed | Every manager, once for the batch, with a count | `promotion_endorsed` |
| Outcomes are approved or returned | The section’s adviser, with a count | `promotion_approved` / `promotion_returned` |
| The school calendar changes | Every adviser of that year | `calendar_changed` |
| One section’s calendar changes | That section’s adviser | `calendar_changed` |

`reopen` has no kind of its own, deliberately: a locked month reopened is a
month back on the adviser’s desk, which is what `month_returned` says. A mixed
batch of promotion decisions reports as *returned*, for the same reason the
`promotion_events` row’s own `kind` does — something needs doing.

**The attendance three carry no attendance figure.** That is the condition the
user’s 2026-11-05 ruling came with, and it is tested rather than asserted: one
case checks every notification any emitter has written, for payload keys
outside 0057’s closed list and for the words *absent*, *present*, *absence*,
*percent*, *rate*, *average* and *consecutive*. If a future emitter ever puts a
figure in one, that case fails.

The month workflow had **no test at all** in this tree before 0058 — its own
were lost with the rest of `tests/` in the 0.86.1 recovery — so reaching a
submittable month (an active year with reporting periods, a configured June, a
marked register) is most of the fixture in
`tests/workflow-notifications.test.ts`.

## What is deliberately still not here

- **`adviser_assigned` and `adviser_removed` cannot be emitted yet.** A
  section’s adviser is set by plain SQL in `src/modules/foundation/service.ts`
  — `insert into edunexus.sections` and `update edunexus.sections set …
  adviser_user_id=…` — not by a `security definer` function, so there is
  nothing to `create or replace`. The two ways to close it are a new writer
  function for `sections`, which is a change to a core 0001 table’s write path
  and its own increment, or granting `notify` to `edunexus_app` — which would
  destroy the property that only a writer reporting its own change can send a
  notification. **The second is not a trade worth making for a convenience**,
  so the kinds stay declared and unused.
- **`year_activated`, `year_closed` and `next_year_placed` are not emitted.**
  Year status is set by the same plain SQL as the adviser, so it has the same
  blocker. Next year’s placement has a writer and could be done, and it is the
  same loop-shaped problem as the import: it must emit once, not per learner.

- **One known gap in the enrollment group.** An adviser pulling or registering
  a learner who holds *no* enrolment this year reaches `place_enrollment`
  instead of `move_enrollment`, so nothing is emitted and the office is not
  told. Closing it means `create or replace` of `pull_learner_into_section`
  and `register_learner_into_section`, which is its own increment rather than
  a line added here.
- **No emitter for the monthly consolidation, promotion outcomes, adviser
  assignment, the calendar or next year’s placement yet.** Each kind is
  declared in 0057 and emits nothing. Next year’s placement is the same
  loop-shaped problem as the import and must emit once, not per learner.
