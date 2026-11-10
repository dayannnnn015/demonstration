# Operational runbooks

What to do when something needs doing to the live system, written for whoever is the operator on the day. Each procedure says what it touches, in what order, and how to know it worked.

**None of these has been drilled yet.** They are written from the code and the [hosted environment record](deployment.md), not from a rehearsal. Section 7 of [the roadmap](roadmap.md) requires each to be exercised once against an isolated project before turnover, and the date each was drilled belongs in the table at the end. Until then, treat every step as a plan to be checked, not a proven procedure.

Two rules apply to all of them. **Never run `supabase config push`**, for the reasons in [deployment](deployment.md). **Never paste a credential into a document, a chat or a commit**: credentials live in the ignored `.env` and `.local/` files and in Vercel's environment settings, and scratch scripts that need them run from `.local/` and are deleted afterwards.

## Remove someone's access

For a staff member who has left, changed roles, or whose account may be in the wrong hands.

1. **Reassign their sections first**, if they advise any in an open year. On *Sections and advisers*, give each of their sections a new adviser. The API refuses to suspend a teacher who still advises an open-year section, so that nobody's class is left without an adviser.
2. On *Staff access*, open their row and set **Access** to *Suspended*. This takes effect on their **next request**, not at the end of their session: every API call re-reads `staff.active`, so a suspended person holding a still-valid token is refused from that moment. Nothing they recorded is deleted.
3. **If the account itself may be compromised**, the operator also signs the identity out in the Supabase dashboard (Authentication → Users → the user → sign out, or ban). EDUNEXUS cannot do this itself: the API runtime deliberately holds no service-role key. Suspension in step 2 already stops them reaching any record; step 3 stops the sign-in.
4. **Check what they read.** On *Privacy access log*, choose them under *Staff member*. Every list or record that returned a learner or enrollment to them is there, newest first, with the record IDs it returned. Keep a note of the window you reviewed.

**Done when:** their next request answers `STAFF_ACCESS_REQUIRED`, and *Staff access* shows them suspended.

A principal can suspend anyone but themselves; an administrative officer can suspend teachers only. Reinstating is the same control set back to *Active*.

## Roll back a bad release

For a deploy that breaks the workspace or the API.

1. **Find the last good deployment.** `npx vercel ls edunexus --scope joshs-projects-47d7b071` lists recent deployments; [the changelog](../CHANGELOG.md) says which version each carried.
2. **Check the migration column in the changelog.** Migrations are forward-only and are never reverted — they are checksummed, and editing or undoing one breaks every later deploy. Rolling the application back leaves the database where it is, so the old code runs against the newer schema. That is safe when the migrations in between only **add** things the old code never calls. Some do more: `0018`, `0019`, `0021`, `0022` and `0023` each `create or replace` a function that already existed, so older code calling it gets the newer behaviour. Read the migration you are rolling past before promoting; if the old code depends on what it replaced, the fix is a forward release, not a rollback.
3. **Promote it.** `npx vercel rollback <deployment-url> --scope joshs-projects-47d7b071` points the public address back at that deployment without rebuilding.
4. **Verify.** `npm run smoke -- https://edunexus-balili.vercel.app` must pass, and `/openapi.json` must report the version you rolled back to. The smoke check expects the version in the local `package.json`, so check out the rolled-back version's commit first, or read the version failure as the expected one.
5. **Fix forward.** Correct the defect, release normally with `npm run check`, then deploy. A rollback is a way out of an outage, not a resting state: Vercel promotes the next `--prod` deploy over it.

**Done when:** smoke passes and a staff member confirms the screen they were using works.

## Restore the database into an isolated project

The drill Section 7 requires, and the procedure for a real restore. **Never restore over the live project.** A restore that goes wrong over live data is the incident, not the recovery.

1. **Know what backups exist.** In the Supabase dashboard for project `eszhhtxzrplknrmzozwr`, check Database → Backups: which daily backups are kept and whether point-in-time recovery is enabled depends on the plan. Write the answer, and the retention it implies, into the table below; the school's recovery objectives in [the information requests](school-information-requests.md) are measured against it.
2. **Create a separate Supabase project** for the restore, in the same region (Singapore). Do not reuse a project that holds anything else.
3. **Restore into it**: either the dashboard's restore-to-new-project, where the plan offers it, or a logical copy — `pg_dump` from the live project with the privileged migration connection, into `psql` against the new project's connection. The dump contains every learner record; it is created and deleted inside `.local/`, never anywhere else, and never committed.
4. **Verify the copy, not just its existence.**
   - `npm run db:migrate` pointed at the copy (`MIGRATION_DATABASE_URL` in a scratch `.env` under `.local/`) reports nothing to apply and no checksum mismatch.
   - Row counts of `learners`, `enrollments`, `attendance_marks`, `assessment_scores` and `audit_events` match the live project at the dump time.
   - `select edunexus.is_ready()` is true.
   - Create a runtime credential on the copy with `npm run db:credentials`, run the API locally against it (`npm run dev`), and `npm run smoke -- http://127.0.0.1:3001` passes.
5. **Record the drill**: date, backup age used, time from start to a passing smoke check, anything that did not work. That elapsed time is the honest recovery-time figure to give the school.
6. **Delete the isolated project and the dump.**

For a real restore, steps 2–4 are the same, and pointing the application at the restored project is a change of `DATABASE_URL` in Vercel followed by a redeploy. That is the moment to rotate the runtime credential too.

## A credential may have leaked

For a `.env` shared by mistake, a laptop lost with the repository on it, or a secret seen in a log or screenshot.

| What leaked | Rotate it | Then |
|---|---|---|
| The runtime database credential (`DATABASE_URL`) | `npm run db:credentials` writes a new `edunexus_app` password to `.local/runtime.env` and sets it on the database; it refuses to overwrite an existing file, so move the old one aside first | Put the new value in Vercel's production environment and redeploy. Until the redeploy, the live API is refused by the database |
| The privileged migration credential | Reset the database password in the Supabase dashboard | Update the local `.env` only; it never reaches Vercel |
| `PROVISION_FUNCTION_SECRET` | Set a new value in both the Edge Function's secrets and Vercel, then redeploy — see [staff invitations](staff-invitations.md) | Until the redeploy, account creation answers `IDENTITY_SERVICE_REJECTED` |
| The Supabase service-role key | Rotate the project's API keys in the dashboard | Redeploy the `create-staff-identity` function so it picks up the injected key |
| A staff member's password | They use *Change password* in the profile menu, or a recovery link from the sign-in page | Suspend them first (above) if someone else may have used it |

Then **review the privacy access log** for the window the credential was exposed, and the *Activity log* for changes nobody expected.

## Learner data may have been exposed

For any sign that someone saw learner records they should not have — a leaked credential above, a printout left in the wrong place, a screen shared outside the school.

1. **Contain it** with the steps above: suspend, rotate, roll back.
2. **Establish what was reachable.** The privacy access log names every record returned to each account and when; the activity log names every change. Filter by the account and the window, and keep the record IDs.
3. **Tell the privacy owner at once.** Under the Data Privacy Act, a personal data breach can oblige the school to notify the National Privacy Commission and the affected families within 72 hours of knowing of it. Whether this incident is one is the privacy owner's decision, not the operator's. **No privacy owner is named yet** — request 6 in [the information requests](school-information-requests.md) — which is why no real learner record may be imported until one is.
4. **Write it down**: what happened, when it was noticed, what was reachable, what was done and when. Facts only.

## The morning register is slow or refusing advisers

1. **Is anyone creating staff accounts?** Account creation holds the school-wide lock for up to ten seconds while it calls the account service, and register reads wait behind it. Stop and do it after register hours — see [the load measurement](load-measurement-2026-09-25.md).
2. `npm run smoke` against the live address. A failing `/health/ready` means the API cannot reach the database or a migration is missing.
3. The Supabase dashboard's database report shows connection count and slow queries. The register holds per-section locks since `0023`; a queue there points at something else holding the school-wide lock exclusively — a calendar change, a month lock, a bulk import.

## Standing operator settings

Two dashboard settings the school should have before onboarding. Neither can be set from this repository without `config push`, which is forbidden.

- **Secure password change** (Authentication → Providers → Email). Off at present, which lets anyone holding a signed-in session change its password without knowing the current one. The workspace's *Change password* form asks for the current password as a courtesy, but only this setting makes it a control.
- **The school's own SMTP** (Authentication → SMTP). The built-in mail service is rate limited and meant for testing; thirty-three invitations need the school's own.

## Drill record

| Procedure | Last drilled | By | Result |
|---|---|---|---|
| Remove someone's access | Never | | |
| Roll back a bad release | Never | | |
| Restore into an isolated project | Never | | |
| Rotate the runtime credential | Never | | |
