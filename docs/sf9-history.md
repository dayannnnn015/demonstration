# One SF9 per grade level, and the history of them

Migration `0070`, release 0.104.0, asked for on 2026-11-09.

**Read this part first, because it is most of the answer.** The school asked for
five things. Four were already true, and true structurally rather than by a
feature that could be switched off. What was missing was the fifth: a way to
*see* it.

## What was already true, and why

### The SF9 is derived per enrollment, not stored per learner

`sf9Get` is `GET /api/v1/enrollments/{id}/forms/sf9`, and it calls
`edunexus.read_sf9_source(p_enrollment)`. Every record the card prints —
`report_grades`, `report_summaries`, `report_values`, `report_notes` — has
`enrollment_id` as its key. An enrollment is one learner in one school year at
one grade level (`enrollments_valid_learner_year_idx`, 0008, makes it at most one
per learner per year).

So the card is **derived on every read**, the way the SF10 is. There is no stored
SF9 document anywhere in the schema. That single fact settles four of the five
requirements at once:

| Asked for | Why it already held |
|---|---|
| The issued SF9 is associated with the learner, school year, grade level and that year's records | It *is* an enrollment's card; all four are properties of the enrollment |
| After promotion the learner starts a new, blank SF9 | Promotion creates a new enrollment (0069). It has no report records, so its card is blank — there is nothing to reset |
| The new SF9 carries none of the previous grade's grades or general average | Those records name the *other* enrollment. Nothing joins them |
| The new SF9 is populated only from the new grade level's records | Same reason, from the other direction |

### An issuance is scoped to the enrollment too, and is append-only

`form_issuances` (0029) carries a CHECK that an `sf9` row names **both** an
`academic_year_id` and an `enrollment_id`:

```sql
when 'sf9' then academic_year_id is not null and enrollment_id is not null
  and section_id is null and month_on is null and learner_id is null
```

And the prior that `record_form_issuance` looks for before writing is keyed on
that same scope — `(form, academic_year_id, section_id, enrollment_id,
learner_id, month_on)`. A Grade 2 SF9 therefore **cannot find** a Grade 1 one:
it is a new row with `supersedes_id` null.

Nothing in that table is ever `UPDATE`d or `DELETE`d. Issuing the same content
again returns the existing row (`reprint: true`) and writes nothing. Issuing
different content for the same enrollment is a correction: it needs a reason
(`P1802`) and **appends** a row naming the one it replaces. So every issue a
learner has ever had is still there, in `serial` order.

### Why it is now tested

None of the above is visible from any one file, and all of it would break
silently. A later change to the issuance scope key, or an inner join added to
`read_sf9_source`, would pass every test that existed before this work.
`tests/sf9-per-grade.test.ts` asserts each step of a learner's Grade 1 → Grade 2
year: the card read, the issuance, the approval, the new blank card, the old card
unchanged, a second issuance that supersedes nothing, a reprint that duplicates
nothing, and a correction that supersedes only its own year.

## What did not exist: the history

Nothing could answer *"which of this learner's years have an issued card?"*

Two reasons, both worth recording because both look like they should have worked:

- `formIssuanceList` takes a `learner_id` filter, but an `sf9` row has
  `learner_id` **NULL** by the CHECK above — it is keyed by enrollment. So that
  filter matches no SF9 at all.
- `form_issuances`' row policy is `is_manager() or actor_user_id =
  actor_id()`: a teacher sees only the forms **they themselves** issued, not the
  ones the office issued for their learners.

So the profile's school-years table showed no card status, and a reader had no
way to tell a preserved card from one that was never made.

### `GET /api/v1/learners/{id}/sf9-history`

`edunexus.read_sf9_history(p_learner)`. One row per school year the learner was
enrolled:

```json
{ "enrollment_id": "…", "start_year": 2025, "grade_level": 1,
  "section_name": "Sampaguita", "card": "issued", "issued_count": 1,
  "issuance": { "serial": 7, "issued_at": "…", "data_hash": "…",
                "corrected": false, "reason": null } }
```

`card` is one of:

| Value | Means |
|---|---|
| `issued` | That year's SF9 has been issued; `issuance` carries its serial and fingerprint |
| `in_progress` | The year's card exists and has not been issued |
| `no_card` | **Kindergarten.** The school has supplied no Kindergarten card, so `sf9Get` refuses it. The history says so rather than offering a card that cannot be read; a Kinder learner's records are the SF5-K and the ECCD checklist, which EDUNEXUS neither holds nor replaces |
| `voided` | The enrollment record was voided in review |

Four decisions in it, each of which could have gone wrong:

- **The join to `sections` is outward.** A learner enrolled at a grade with no
  class yet is *exactly* what a promoted learner is between the approval and
  their new adviser's pull. An inner join would drop the very row the school
  wants to see as "In progress" — which is the mistake `0049` and `0051` each
  had to fix in their own readers.
- **`can_read_enrollment` decides every row, so no read scope widens.** A
  manager sees every year; a teacher sees the years of the classes they advise
  while the year is not closed — the same answer the SF10 gives them, which a
  test asserts by comparing the two.
- **It bypasses `form_issuances`' policy, deliberately and narrowly.** The
  function is `security definer`, so it can say that a card was issued even when
  somebody else issued it. What it discloses is the serial and the fingerprint,
  both printed on the card the caller may already print. It discloses **no staff
  member at all** — no name, no id. A staff name is the part 0.92.0 refused to
  widen for, and 0.101.0 opened only through a function that names one person on
  one of your own notifications. A test asserts no staff name appears in the
  response.
- **It reads no grade.** Whether a card was issued is not a grade.

The read names the learner and the enrollments it returned, so it writes a
`record_access_events` row under the new resource `sf9History`.

## On the learner's profile

The **Enrollment** part of a learner's panel already listed every school year
with its grade, class and status, and already had an **SF9** button per row —
*"the only way to reach a past year's"*. That access was never missing. What is
new is a **Report card** column on the same table, reading the history above:
*Issued no. 7* with its date, *In progress*, *No Kindergarten card*, or nothing
shown for a voided record. A corrected year says so and how many issues are
kept.

The table's note now says the thing the school wanted stated: an issued SF9
stays as it was issued, the next grade starts a card of its own, and neither
overwrites the other.

## A defect this found and fixed

**The SF9 of a learner enrolled at a grade with no class yet.** `Sf9Source`
typed `enrollment.section_name` as `string`, and `read_sf9_source` returns
`null` for it when the enrollment has no section — so the type lied, and
`computeSf9` passed the null straight through to a card that printed an empty
Section box with nothing saying why. The SF10's own source had been honest about
this since `0051`; the SF9's was not.

It is now nullable in `cards.ts`, in the Zod contract and in `web/forms/types.ts`,
and the card's own `warnings` list carries *"This learner is enrolled at this
grade but is not in a class yet, so the section and adviser are blank."* The
printed `.paper` box stays blank, which is what an official form expects of an
unknown; the screen above it names the absence, which is what the `Unrecorded`
rule is for.

This mattered more after `0069` than before it: every promoted learner is in
exactly that state between the approval and their new adviser's pull.

## A defect this found and did not fix

**`sf10Get` answers 500 on a database with no school profile row.**
`edunexus.form_school_heading()` returns NULL when `school_profile` holds no row,
and `computeSf10` dereferences `school.name` at
[`cards.ts:230`](../src/modules/forms/cards.ts#L230) — so the request fails with
a bare *"The request could not be completed."* and no SQLSTATE, because the throw
is in JavaScript rather than the database.

It is pre-existing, unrelated to this request, and narrow: the live database has
the real school profile, and `scripts/bootstrap.ts` writes one. It was found
because `tests/sf9-per-grade.test.ts` did not seed a profile at first. **It is
reported rather than fixed** because the right behaviour is a decision — an SF10
with a blank heading, or a refusal naming the missing profile — and because this
request said not to change unrelated functionality. The test now seeds a profile
and says why.

## Tests

`tests/sf9-per-grade.test.ts` — 17 cases: the Grade 1 card and its issuance; the
Kindergarten refusal; the approval and the new Grade 2 enrollment; the Grade 2
card blank with no Grade 1 grade on it; the "no class yet" warning; the Grade 1
card and issuance byte for byte unchanged after promotion; the adviser's pull and
the Grade 2 grades; a second issuance superseding nothing; a reprint that
duplicates nothing; a correction superseding only its own year; the history
listing both years; a Kindergarten year reading `no_card`; the teacher's scope
matching the SF10's; no staff member named; the privacy row; and the SF10 still
reading both years as separate blocks.

`tests/web-learner-profile.test.ts` — one added case: the profile's school-years
table carries the Report card column and says a year is in progress rather than
leaving a blank.
