# Staff invitations and account recovery

Authorizing a colleague used to mean an operator inviting them in the Supabase dashboard, then someone pasting the returned UUID into a form. Nothing recorded who asked for the account, what permission level was intended, or whether a pending request had been fulfilled. That record was added first. A manager can now also create the account from the same screen.

## Why the account service is a separate deployment

The manuscript's first functional requirement is that the Principal or Administrative Officer can *manage authorized teacher accounts*. Creating one requires a Supabase service-role key, and such a key in the Vercel runtime could create, alter or delete **any** identity in the project, principals included — a much larger blast radius than the restricted database login the runtime holds.

So the key does not go there. It lives in [one Edge Function](../supabase/functions/create-staff-identity/index.ts) whose only reachable action is "invite this address". The function has no update path, no delete path, and no read path over other identities. It takes the redirect target from its own configuration rather than from the caller, so a compromised caller cannot redirect invitation links. It authenticates the caller with a shared secret compared in constant time.

The runtime boundary is unchanged and still enforced: [`readConfig`](../src/core/config.ts) rejects a secret or service key for `SUPABASE_PUBLISHABLE_KEY`, and now also rejects one supplied as `PROVISION_FUNCTION_SECRET`. A deployment that configures no function keeps the operator workflow exactly as it was and answers `IDENTITY_SERVICE_DISABLED` to the new endpoint.

## Configuring it, which the development deployment now has

The function was deployed and wired on 21 September 2026, after a signed-in principal met `IDENTITY_SERVICE_DISABLED` trying to create an account. Both halves are needed and neither is in this repository:

```bash
supabase secrets set EDUNEXUS_PROVISION_SECRET=<64 random characters>   EDUNEXUS_INVITE_REDIRECT=https://edunexus-balili.vercel.app/account/setup --project-ref <ref>
supabase functions deploy create-staff-identity --no-verify-jwt --project-ref <ref>
```

Then set `PROVISION_FUNCTION_URL` (`https://<ref>.supabase.co/functions/v1/create-staff-identity`) and the **same** `PROVISION_FUNCTION_SECRET` in the API runtime, and redeploy — an environment change does not reach a running deployment. `readConfig` refuses one of the pair without the other, so a half-finished configuration fails at boot rather than at the first invitation.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into the function by the platform; they are never set by hand and never leave it. The redirect must already be in the Auth allowlist, or the invitation link will be refused when it is opened.

Rotating the secret means setting it in both places and redeploying. Until the redeploy, the API presents the old secret and the function answers 401, which surfaces as `IDENTITY_SERVICE_REJECTED` — the error that distinguishes a mismatched secret from an unconfigured deployment.

**Email delivery is the next limit.** Invitations go through whatever mail the Supabase project is configured with. The built-in service is rate limited and intended for testing, so onboarding thirty-three staff needs the school's own SMTP configured first; a rate-limited attempt answers `IDENTITY_SERVICE_UNAVAILABLE` and leaves the invitation untouched.

This is narrower than the decision recorded in [constraints](constraints.md) as the service-role gate. That gate asks the school to accept that a compromised **runtime** could alter any identity. Here it still cannot, so the gate's risk is avoided rather than accepted.

### What is not rolled back

An Auth identity is created by an HTTP call, and no database transaction can undo it. EDUNEXUS therefore checks everything it can *before* that call: the invitation exists, is still `requested`, matches the version the manager read, and carries a permission level this manager may grant. The database re-checks the permission level afterwards, because a security-definer function bypasses row policies.

If the call succeeds and the database write then fails, the transaction rolls back and the address holds an Auth identity with no `edunexus.staff` row — which grants access to nothing. After a timeout or ambiguous upstream response, the operator must first check whether the identity exists. A later create may return `IDENTITY_EXISTS`; an existing identity is reconciled through the ordinary provision endpoint.

## The workflow

1. **Request.** A manager records the intended email, display name and permission level, with a reason. The invitation is `requested`.
2. **Create.** A manager creates the account against the current invitation version. EDUNEXUS asks the account service to invite the address, then writes the `edunexus.staff` row and marks the invitation `provisioned`. The colleague receives an email and chooses their own password; no credential passes through EDUNEXUS.
3. **Or link.** Where the operator created the identity in Supabase by hand, a manager submits its UUID instead. Either route creates the `edunexus.staff` row and completes the invitation **in one transaction**, so school access and the invitation record can never disagree.
4. **Cancel.** An outstanding request can be cancelled with a reason instead, leaving the history intact.

Both `provisioned` and `cancelled` are terminal. Correcting a mistake means cancelling and requesting again; the same email may be requested again afterwards.

## Rules

- Emails are normalized to lowercase and trimmed. Validation is deliberately permissive — Supabase, not EDUNEXUS, decides deliverability — but a single address with no whitespace or control characters is required, at both the API and the database.
- One **open** request per email, enforced by a partial unique index. Cancelled and provisioned rows do not occupy that slot.
- One invitation per linked identity, and `edunexus.staff.user_id` is a primary key, so an identity already holding school access cannot be linked again.
- The Auth identity must already exist. A UUID that is not in `auth.users` fails the foreign key and the whole transaction rolls back, leaving no staff row, no status change and no journal entry.
- Permission levels follow the rule already in the `staff_insert` policy: a principal may request any level, an administrative officer only `teacher`. The check runs on request, provision and cancel, because a security-definer function bypasses row policies. `assert_may_grant_role` mirrors that policy and is not runtime-callable.
- Every action requires a reason of 10–500 single-line characters and writes an immutable before/after journal entry with actor and request ID.

## API

| Operation | Contract |
|---|---|
| `GET /api/v1/staff-invitations` | `status=requested\|provisioned\|cancelled\|all` (default requested), `role`, `after_id`, `limit` default 50/max 100. Filters precede pagination. |
| `GET /api/v1/staff-invitations/:id` | One invitation. |
| `POST /api/v1/staff-invitations` | Email, display name, permission level and reason. |
| `POST /api/v1/staff-invitations/:id/identity` | Current version and a reason. Creates the account through the account service, then completes the invitation. |
| `POST /api/v1/staff-invitations/:id/provision` | Current version, the provisioned Auth `user_id`, and a reason. |
| `POST /api/v1/staff-invitations/:id/cancellation` | Current version and a reason. |
| `GET /api/v1/staff-invitations/:id/events` | Newest-first history, `limit` default 5/max 10, `before_version`. |

`/identity` additionally answers `IDENTITY_SERVICE_DISABLED` (501) where no function is configured, `IDENTITY_EXISTS` (409) where the address already has an identity, `IDENTITY_SERVICE_UNAVAILABLE` (503) on a timeout or rate limit, and `IDENTITY_SERVICE_FAILED` (502) otherwise. Every operation requires an active manager. A completed or cancelled target returns `INVITATION_STATE` (409); a duplicate open email or an already-authorized identity returns `ALREADY_EXISTS` (409); an unknown Auth identity returns `INVALID_REFERENCE` (409). The isolated identity endpoint can initiate an invitation email; it accepts and returns no credential.

## Personal data

An invitation stores a staff email address, which the rest of the schema does not. It is the minimum needed to tell the operator who to invite, it is manager-only under RLS, and it is never copied into change-audit rows. It is staff contact information for provisioning, not learner data.

## Account recovery

The sign-in page now offers "Email me a recovery link", which calls Supabase's `resetPasswordForEmail` from the browser with the publishable key, exactly as any visitor's client would, and returns to `/account/setup` to set a new password. The API is not involved and holds no credential that could send it.

The reply is identical whether or not the address has an account, so an unauthenticated visitor cannot use the form to discover which addresses are registered.

That sameness has to include the rate limit. Supabase answers 200 for an unknown address but throttles a registered one to a link a minute, so surfacing a throttle as its own message would confirm the account exists. A throttled request therefore gets the same reply as a successful one, and only a project-wide failure such as a disabled Email provider, which behaves identically for every address, is named.

Supabase built-in mail also caps the whole project at a few messages an hour, which will not survive staff onboarding: configure a real SMTP provider first. An operator can issue a single link without mail through the Auth admin generate_link endpoint, which is not rate limited.

Sign-in is email and password only. The manuscript specifies no second authentication factor, and none is enforced.
