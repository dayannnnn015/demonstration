# Development deployment and operations

## Current development deployment

**0.30.0 was released on 21 September 2026** as `edunexus-5knbr4sjv-joshs-projects-47d7b071.vercel.app`, aliased to https://edunexus-balili.vercel.app. It is an interface release: the Section 3A instructional calendar now has a manager screen. No migration, endpoint or permission changed.

**The account service was configured the same day**, and redeployed as `edunexus-c3hpagrtj-joshs-projects-47d7b071.vercel.app` — same code, new environment. A signed-in principal had met `IDENTITY_SERVICE_DISABLED`, which is what the API answers when no provisioning function is configured. `create-staff-identity` is now deployed to the Supabase project with `--no-verify-jwt`, holding `EDUNEXUS_PROVISION_SECRET` and `EDUNEXUS_INVITE_REDIRECT`; the runtime holds `PROVISION_FUNCTION_URL` and the matching `PROVISION_FUNCTION_SECRET`. The service-role key is still only ever inside that function, injected by the platform. See [staff invitations](staff-invitations.md) for the commands and for rotation.

The deployed function was probed directly: no secret and a wrong secret both answer 401, a valid secret with a malformed address or an unknown role answers 400, and `GET` answers 405. No identity was created by those probes. **The API-to-function hop is not verified**, because it needs a signed-in manager and would create a real Auth identity and send a real email; a mismatched secret would surface distinctly as `IDENTITY_SERVICE_REJECTED` rather than as the disabled message.

Live checks: `/openapi.json` reports 0.30.0, `/health/live`, `/health/ready` and `/app` return 200, and the deployed bundle was checked for the new screen's own strings, because a workspace change that builds locally and is missing from the served bundle looks identical to a working deploy from the API's side.

**0.29.0 was released on 21 September 2026** as `edunexus-gtui0kzkp-joshs-projects-47d7b071.vercel.app`. It carried migration `0022`, the authorized corrective migration for the score defects in the [20 September review](backend-review-2026-09-20.md). The migration was applied to the hosted database **before** the application deploy, because 0.29.0's score reads write `record_access_events` rows the old check constraint would have rejected.

Its live checks passed: version 0.29.0, health, readiness and app responses, and all 109 documented protected operations rejecting an anonymous request with 401. The migration's effect was separately verified against the hosted catalog: both score columns are `numeric(7,2)`, the `scoped_read` policy on `assessment_scores` applies `can_read_enrollment`, the audit resource constraint admits `scoreSheet`, `scoreRecord` and `scoreHistory`, the entry function requires the `raw_score` key, and both writers take the shared lock before their first read.

None of this is school acceptance. No authenticated session has ever been exercised, so no screen's data path — including the calendar's — has run in a browser.

## The hosted environment

This section is the durable record of where EDUNEXUS runs. It was lost when the release narrative was trimmed on 20 September and is restored here without the per-release history, which belongs in [the changelog](../CHANGELOG.md).

- **Supabase** project `edunexus`, reference `eszhhtxzrplknrmzozwr`, created 9 September 2026 in the existing account organization, in Singapore.
- **Vercel** project `edunexus` under `joshs-projects-47d7b071`, public address https://edunexus-balili.vercel.app. The shorter name belongs to another project; the previous address forwards for existing bookmarks.
- **GitHub**: the private repository https://github.com/bustamante-j/edunexus.

Applied Supabase auth configuration, verified through `supabase config diff` against `supabase/config.toml`:

1. Public signup disabled, minimum password length 12, access-token lifetime 15 minutes. The public JWKS advertises ES256.
2. The auth callback is `https://edunexus-balili.vercel.app/account/setup`. Allowed redirects are that exact URL and `http://127.0.0.1:3001/account/setup`.
3. Nine runtime variables are configured in the **production environment of the development Vercel project** — Vercel's stable environment name, not the school's production rollout. Database TLS is required and verified. `PROVISION_FUNCTION_URL` and `PROVISION_FUNCTION_SECRET` are the two added on 21 September; `readConfig` refuses one without the other.
4. Edge Function `create-staff-identity`, deployed `--no-verify-jwt`, with its own `EDUNEXUS_PROVISION_SECRET` and `EDUNEXUS_INVITE_REDIRECT`. An environment change reaches the API only through a new deployment.

**Never run `supabase config push`.** The pull deliberately skipped settings it cannot represent, so a push would write local defaults over them, including disabling Twilio. The Email provider toggle is not in that schema at all.

Credentials: the restricted database credential is held in ignored local files and in Vercel's runtime environment. The privileged migration connection and the Supabase service-role key stay local and never reach the API runtime — the service-role key is confined to the isolated `create-staff-identity` Edge Function, which can only invite one address. Scratch scripts that need any of these run from `.local/` and are deleted afterwards.

## Releasing

1. `npm run check` — typecheck, tests and build must pass.
2. `npm run db:migrate` if the release adds a migration. The runner is checksummed and refuses a modified applied file; it applies pending files in one transaction.
3. `npx vercel --prod --scope joshs-projects-47d7b071`.
4. Live checks: `npm run smoke`. It confirms that `/health/live`, `/health/ready`, `/app` and every script and stylesheet `/app` references return 200, that `/openapi.json` reports the version in `package.json`, and that every documented operation rejects an anonymous request with 401. It sends only anonymous requests, so it cannot read or change a record. `npm run smoke -- http://127.0.0.1:3001` runs it against a local server.

## What the hosted checks do and do not establish

Hosted read-only metadata checks have confirmed that every applied migration checksum matches, that the domain tables carry RLS and are not owned by the runtime role, that no domain table grants SELECT to `anon` or `authenticated`, and that security-definer functions have fixed empty search paths and no PUBLIC execute. Synthetic hosted fixtures have exercised the restricted role, date serialization, teacher isolation, version checks, concurrent transaction contexts and audit writes, and every one was rolled back.

**A local load measurement on 25 September found the morning register failing at the school's own peak**: with 27 advisers at once, more than half were refused before seeing their register. Migration `0023` (0.38.0) fixed it — no refusals, and the morning wave in about 1.3 s. See [the measurement](load-measurement-2026-09-25.md). A hosted run with real sign-ins is still owed.

None of that is school-production acceptance. **Still unverified:** the account function's full path from the API, SMTP for broad onboarding, realistic multi-session load, backup restoration into an isolated project, privilege revocation and deployment rollback drills. The procedures for those drills are written in [the runbooks](runbooks.md), which record when each was last exercised. A real staff sign-in is no longer among them: on 21 September the user reported being signed in as the school principal, and the refusal they met is one only an authenticated manager can reach. No learner record has ever been imported, and none may be until the privacy owner in [the information requests](school-information-requests.md) is named.
