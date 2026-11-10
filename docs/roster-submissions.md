# Roster submissions

How an adviser prepares their class list and a manager turns it into learner
records. Section 2B's reviewed hand-off between the two roles.

> **Written 2026-11-04 from the code.** The original of this document was lost
> with the rest of `docs/` in the 0.86.1 recovery and exists in no branch and no
> commit, so this is written from `src/modules/roster-submissions/`,
> `web/screens/` and the [changelog](../CHANGELOG.md), in that order of
> authority. Where this file and [constraints.md](constraints.md) disagree, that
> file wins.

## The shape, and why it is this shape

> **A teacher prepares and submits; only a manager turns a list into learner
> records, through the reviewed import.**

This module exists because of the standing rule that managers change learner
records. An adviser knows their class and holds the paper; they are the right
person to prepare the list. But creating a learner record is a manager's act, so
the adviser's work ends in a **request**, not a write.

That makes `roster_submissions` (migration `0028`) the reference shape for every
"a teacher proposes, a manager approves" workflow in EDUNEXUS — and the roadmap's
[teacher pull](roadmap.md#7-teacher-pull--an-adviser-retrieves-their-own-learners-into-their-class)
is told to reuse it rather than invent a second review workflow.

## The operations

```
POST /api/v1/roster-submissions/check          format only, saves nothing
POST /api/v1/roster-submissions                submit a checked list
GET  /api/v1/roster-submissions                every one for a manager, your own for a teacher
GET  /api/v1/roster-submissions/:id            one list, including the list itself
POST /api/v1/roster-submissions/:id/withdrawal while it is still waiting
POST /api/v1/roster-submissions/:id/decision   manager: accept with an import, or decline
```

One is manager-only: `rosterSubmissionDecide`.

A submission carries the section, the `enrolled_on` date, an `entry_kind` of
`regular` or `transfer_in`, and the list itself as CSV (to 24,000 characters).

## The check reads no learner, and that is the point

```ts
/** Format only. It never reads the registry, so a teacher learns nothing about learners outside their section. */
```

`rosterSubmissionCheck` parses the CSV through the shared `readCsv`, adds one
rule of its own, and returns the parsed rows with every problem found. It does
**not** search the registry for a matching learner, and it saves nothing.

That restraint is a privacy decision, not an optimisation. A check that looked
each row up would let an adviser type a name and learn whether the school holds
a record for it — a lookup over 897 learners that the row policies otherwise
refuse them, and one that would write an access row per keystroke if it were
interactive. Deduplication happens later, in the manager's reviewed import,
where the person running it may read the registry anyway.

The one added rule:

```ts
if (p && p.birth_date >= b.enrolled_on) issues.push({ row: i+1, field: 'birth_date',
  code: 'INVALID_BIRTH_DATE', message: 'Birth date must precede enrollment.' });
```

Each issue carries its **row number and field**, so the screen can point at the
cell rather than report that the file is bad.

## Submitting re-checks, and refuses the whole list

`rosterSubmissionCreate` runs the same `check` again server-side and refuses on
any problem at all:

```ts
if (result.issues.length) throw new AppError(422, 'ROSTER_ROWS',
  `${result.issues.length} problem${…} in the class list. Check the file and fix every row first.`);
```

**Every row, not the valid ones.** A partially-accepted class list is a class
list nobody can reconcile against the paper it was typed from, and the adviser
would have no way to tell which rows arrived. The check endpoint exists precisely
so this refusal is never a surprise.

Re-checking on submit rather than trusting the earlier check is the ordinary
rule: the API is the authority, the check is a convenience over it.

## The four states

`submitted` → `accepted` | `declined` | `withdrawn`

| | |
|---|---|
| `withdrawn` | The adviser's own, **while it is still waiting**. With a reason |
| `accepted` | A manager's, **carrying the `import_id` of the import they committed for it** |
| `declined` | A manager's, with a reason |

Every transition is versioned and takes a reason of 10–500 single-line characters
(`subjectReason`), and goes through a database writer —
`submit_roster`, `withdraw_roster_submission`, `decide_roster_submission` — so the
version check, the row policy and the journal row all happen in SQL rather than
in the service.

### Acceptance points at the import, rather than performing it

```ts
decide: z.strictObject({ version, decision: z.enum(['accepted','declined']),
                         import_id: uuid.nullable().default(null), reason: subjectReason })
```

This is the design decision worth understanding. Accepting a submission does
**not** create learner records. The manager runs the reviewed registry import
separately — which has its own review, its own refusals and its own journal — and
then records *which* import answered *which* submission.

So there is one path that creates a learner, not two. The submission is the
request and the receipt; the import is the act.

## What the list does and does not include

`rosterSubmissionList` returns the submissions **without their CSV**:

> List class lists: every one for managers, your own for a teacher; **the lists
> themselves are not included**.

Reading one list — `rosterSubmissionGet` — returns the `csv`. A list of
submissions is a work queue; the names in it are a disclosure, and the two should
not arrive together just because one screen shows both.

A teacher sees only their own, by row policy, not by a filter in the service.

## Late learners

Two routes in, both deliberate:

| Who | Where | What |
|---|---|---|
| The administrative officer | **Roster import → Enlist one late learner** | Choose the section, the first day and how the learner joins, then type their details. The registry is searched first for the same surname and birth date, so a learner already on file is enrolled rather than created twice; if the enrollment is refused, the record is kept and enrolled again from the same form |
| An adviser | **their class-list screen → Add one late learner** | Adds **one row to the list they submit** |

The asymmetry is the rule again: **an adviser never creates a learner record.**
They add a row; the office imports it as usual.

## Where it sits in the year

1. The adviser prepares the class list and **checks** it.
2. They **submit** it, with a reason.
3. A manager reads it, runs the **reviewed registry import**, and **accepts** the
   submission with that import's ID — or **declines** it with a reason.
4. Enrolment follows. Note that the enrollment screen and roster import enrol
   **straight into a section**, which is correct for an adviser building a class
   — and is worth confirming against the planned teacher pull, which comes at the
   same problem from the other end.

Since 0048 a learner can also be enrolled at a grade with **no section**, which
is what Next year's classes does. The two are different situations, not a
duplicate: a class list is a class, and a carried-forward learner has no class
yet.

## Privacy

The submission records and their CSV are learner data in transit, and the
reviewed import that acts on them writes the access rows for the registry reads
it performs. The check itself reads no learner record, so there is nothing for it
to log.

## What is deliberately absent

- **No registry lookup in the check.** A teacher learns nothing about learners
  outside their section from it.
- **No partial acceptance.** Every row is fixed, or none is submitted.
- **No learner created by this module.** Acceptance records an import; it does
  not perform one.
- **No CSV in the list response.**
- **No teacher-accessible pool of unplaced learners** — yet. That is
  [step 7 of the roadmap](roadmap.md#7-teacher-pull--an-adviser-retrieves-their-own-learners-into-their-class),
  and it must stay a request, not a grant.

## Where to look

| | |
|---|---|
| Contracts, states, response shapes | `src/modules/roster-submissions/contracts.ts` |
| Service, the check, the refusals | `src/modules/roster-submissions/service.ts` |
| The shared CSV reader and issue shape | `src/modules/registry-review/` |
| Error codes | `src/core/errors.ts`, range `P17xx` |
| Migration | `0028` |
| The reviewed import that acts on a list | [registry-review.md](registry-review.md), [learner-registry.md](learner-registry.md) |
