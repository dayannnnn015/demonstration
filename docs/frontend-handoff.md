Current direction (26 September 2026): every module has a screen, including raw score entry since 0.41.0 and the privacy access log since 0.39.0. Backend review findings are in [the review](backend-review-2026-09-20.md). **Nothing may total, average, weight or convert a raw mark** on any screen; that arithmetic is still behind the grading gate.

# Frontend integration contract

The workspace is a Vite + React + TypeScript application in `web/`, built into `public/` and served by the API at `/app`; `/app` and `/account/setup` are the same page. Keep calculation, permission, finalization, and record-transition rules in the backend. Read `docs/openapi.json` or `GET /openapi.json` for the current contract. Every section the API implements has a screen; see the roadmap for what each section covers.

## How the app is put together

The workspace is organized as a route table in `web/routes.tsx`. A route carries its navigation label, its icon, title, one-line explanation, the record class it holds, the official form it feeds, its permission level and whether an interface exists yet. Adding a screen means adding a route and a component; the shell, navigation grouping and page header follow from the table, and a module with no screen yet renders an honest placeholder rather than disappearing.

Keep `lede` to one clause. It is the only sentence a screen gets, and the page header shows nothing else but the title and the form the records end up on. Everything a screen used to restate in its header — the table it writes, who is allowed to open it — is either developer detail or already answered by the navigation, so it is not printed.

`web/styles/tokens.css` holds colour, type, spacing and elevation. Use the tokens rather than literal values: the palette carries meaning, with ochre for "needs attention" and red reserved for blocked actions, so a red control in a new screen should mean something is genuinely stopped. Fonts are self-hosted in `web/fonts`; do not switch to a font CDN, because the policy is same-origin and staff addresses should not reach a third party.

The interface is drawn as a register. Every form these records end up on — SF2, SF4, SF9, SF10 — is a ruled sheet: names down the left, dated columns across, a rule under the heading and a hairline between every row. That is why the corners are square, why separation is a line rather than a shadow, and why a table's column-head rule is heavier than its row rules. Match it rather than inventing a second visual language.

The interface is a deep navy rail against white working surfaces. The rail is the only dark region on screen, because it carries navigation, which is furniture; everything that holds a record stays white on a near-white canvas, separated by hairlines rather than shadow. Navy and the blue accent are one hue at different depths, so the chart ramp, the current navigation item and the primary button read as one colour rather than four decisions.

Rail colours are a separate set of tokens — `--rail-900` through `--rail-600`, with `--rail-ink`, `--rail-dim` and `--rail-faint` for text on them — checked for contrast against the rail, not against white. `--rail-ink` and `--rail-dim` are both white: rail hierarchy is size and weight, not dimmed text. `--rail-faint` is a step down and is for icons and rules only, never for a label. Do not use `--ink-*` inside the rail or `--rail-*` outside it. The sign-in card is the one place the wordmark sits on white, and it overrides those two values explicitly.

Type is Inter throughout, with JetBrains Mono reserved for identifiers — LRNs, school IDs, audit table names, dates in a figure's axis — because a twelve-digit LRN is transcribed from paper and `0`/`O` and `1`/`l` have to be told apart. Do not set body text in the mono face, and do not introduce a third family.

Two constraints come from the content policy, which is `default-src 'none'` with a single `img-src 'self'`, added for `/favicon.svg` and for nothing else:

- **No images, and no `data:` URLs.** A CSS `background-image: url(...)` is dropped silently. This is why every `<select>` goes through the `Select` primitive, which wraps it in `.select-wrap` and draws the chevron as an inline SVG. Use `Select`, never a bare `<select>`. It is also why the EDUNEXUS mark is a redrawn SVG rather than the supplied PNG. The favicon is the one image file the origin serves, cut as `web/public/favicon.svg`; do not widen `img-src` past `'self'`, and do not reach for it to make an interface job easier.
- **No inline `style` attributes.** `style-src 'self'` covers them, so a `style={{ … }}` prop does nothing in the deployed app even though it works under `npm run dev:web`. Add a class instead. There is a `.rule` class for a divider and a `.field.inline` modifier for a control that sits in a header row.

Both are now asserted in `tests/web-shell.test.ts`, which renders the shell and every route and fails on any `style="` attribute, any `data:` URL and any `<img>`. That test exists because each of these shipped once and neither was visible in development.

**The workspace prints, and a new screen should print too.** This school runs on paper: a section list is printed and carried to a classroom, and an undated printout of learner records is exactly the artefact nobody can account for later. The `@media print` block at the foot of `app.css` drops the rail, the top bar, the filter row, the pager and every action, keeps the register, repeats `thead` across pages and avoids breaking a row. The hatch is replaced by its words there, because a diagonal rule does not survive a greyscale laser. If a screen adds furniture, add it to that block.

Icons live in `web/components/icons.tsx`, drawn inline on a 24px grid with a 1.75 stroke. They sit beside their own visible label, so they are decorative and are hidden from the accessibility tree. The collapsed rail is the one place that label is hidden, and there the button carries an `aria-label` — an icon never becomes the accessible name by itself. Add to that file rather than reaching for an icon package; the set is small on purpose.

The EDUNEXUS mark is `web/components/brand.tsx` — one component, `BrandMark`, a vector redraw of the artwork the school supplied as a PNG, which the content policy cannot load. Its three colours are literals, not tokens, because they belong to the logo and must not move when the interface palette is retuned. It carries its own navy, so it needs a light ground: `.brand-mark` is a white tile, which reads as one in the rail and disappears on the sign-in card. The original artwork and an export of the redraw are in `docs/brand/`.

Corners are square everywhere. `--r-sm`, `--r`, `--r-md` and `--r-lg` are all `0`; do not write a `border-radius` or an `rx` that bypasses them, including a `999px` pill or a rounded bar end in a figure.

`web/components/primitives.tsx` holds `Editor`, `FormSheet`, `Finder`, `Table`, `TableSkeleton`, `Task`, `Cell`, `Select`, `Badge`, `Callout`, `EmptyState`, `Unrecorded`, `Pager`, `Button`, `PrintButton`, `PageHeader`, `StatusLine` and the shared `localToday`; a `Column` may carry a `className` for a column the print stylesheet has to drop, which is how the calendar's selection boxes stay off paper; `web/dates.ts` holds plain-calendar-date arithmetic; `web/components/overlay.tsx` holds `Sheet`, `Confirm` and the `useTrap` hook they share. Prefer them over new markup so screens stay consistent, and give every table a real empty state: an empty screen is where a staff member decides whether the system is broken or simply new.

**A missing record gets the `Unrecorded` mark, never an em dash and never a blank cell.** This is the rule the system exists to hold: an unmarked attendance session and an unentered score are null, never zero and never "present". An em dash reads as a value somebody typed and an empty cell reads as a page that failed to load, so `Unrecorded` draws a ruled diagonal hatch and names what is missing: `<Unrecorded label="LRN not issued" />`. The hatch is `--hatch` in tokens.css, a CSS gradient rather than an image, and it sizes up: `.empty-mark` on an empty state, `.planned-mark` on an unbuilt screen, `.gated-box` for a figure the system may not state. Use the `shown(row, key)` helper where a value may be null.

**Creating a record opens a `Sheet`, not a second form under the list.** A screen is the register it is named after; the primary action lives in `PageHeader`'s `actions` slot and opens a focus-trapped side panel. `FormSheet` is the whole pattern for a single-form case — it carries its own `StatusLine`, because the page's line is behind the panel and a refusal announced there is a refusal nobody reads. Its `onSaved` fires only after the server accepted, so close the sheet and set the page status there. Both overlays render nothing when closed, which `tests/web-screens.test.ts` asserts: one that merely hid itself with CSS would put the text of a destructive action into the page and leave its fields in the tab order.

**Anything irreversible goes through `Confirm`, never `window.confirm`.** Pass `confirm` to `Button` and it opens one. State the consequence in the screen's own words — "Its sections, reporting periods and enrollments become read-only" — not "Are you sure?", and label the buttons with the action rather than OK.

**A rejected save marks its own fields.** `Editor` reads `ApiError.fields[]`, matches each `path` to a field key, marks that control, prints the server's message beneath it, wires `aria-invalid` and `aria-describedby`, and focuses a summary listing every problem with a control that jumps to its field. The summary uses buttons rather than `#id` anchors, because the address bar is this app's router. Editing a marked field clears its mark. Anything the server does not attribute to a field — a version conflict, a refusal, a network failure — goes to the page's `StatusLine` instead. Do not route a field rejection to the page line; that is the defect this replaced.

A `Field` may set `wide: true` to take the whole form row and `type: 'textarea'` for free text. A reason is 10–500 characters and needs both.

`Task` is the disclosure for a panel offering several things to do to one record, so the two nobody wanted are not in the way of the one they did.

`Table` opens one row at a time into a panel that spans the full width of the table, not a disclosure squeezed into the last cell. It has no column sorting, deliberately: sorting would reorder the twenty-five rows on screen and leave the other eight hundred where they are, which looks like an answer and is not one. Narrowing a list is `Finder`'s job. Its loading state is `TableSkeleton`, shaped like the table that is coming. `Cell` stacks a record over the identifier it is filed under — the name on one line, the LRN in mono beneath it — which is how a class list reads on paper and is worth more than a separate identifier column. `Finder` renders as a single filter row inside the card it filters; its fields show their format hint as a placeholder rather than a line underneath, so the row stays on one baseline.

`web/main.tsx` creates the Supabase client from `/account/config` and decides between the account flow and the workspace. `web/api.ts` wraps every call: it attaches the bearer token, unwraps the `{ data, requestId }` envelope, and throws an `ApiError` carrying the server's own `code`, so a screen can react to `VERSION_CONFLICT` or `TASK_COMPONENT` specifically rather than matching on message text. `web/components/primitives.tsx` holds the shared primitives — `Editor` for versioned saves, `Finder` for filters, `Table`, `Badge`, `Callout`, `EmptyState`, `Pager`, `Button` and `StatusLine`. Screens live in `web/screens/` and are declared in `web/routes.tsx`.

`tests/web-screens.test.ts` renders every route once against an API that returns nothing, and asserts that no column or field is labelled with a computed grade. Effects do not run in that pass, so it covers the empty and loading states rather than the data paths behind a fetch. A signed-in browser check is still the only way to exercise those.

Add a screen by writing a component that takes `{ api, me, manager, setStatus, reload, token, route }`, fetching in a `useEffect` keyed on `token` so a save refreshes it, and registering it in the route table in `web/routes.tsx`. A screen with a primary action sets `ownHeader: true` on its route and renders its own `PageHeader` with an `actions` slot; one without lets `web/App.tsx` draw the header. Run `npm run dev:web` next to `npm run dev` for hot reload; the Vite dev server proxies `/api` to port 3001.

Sessions are kept in `sessionStorage` under `edunexus-session`. A refresh keeps the user signed in; closing the tab ends the session. Do not move this to `localStorage` — these are staff tokens for a system holding sensitive learner data, and the exposure window matters more than the convenience.

Static bundle files are served before the CORS middleware, because a `type="module"` script is always fetched in CORS mode and the API origin allowlist would otherwise reject the workspace's own bundle.

**A busy database is retried for reads only.** `createApi` in `web/api.ts` sends a GET again, at most twice and after a short randomized pause, when the server answers `RETRY_REQUIRED`. That code means a lock wait ran out and the transaction rolled back, so nothing was recorded. A write is never retried: a refused change needs a fresh review, and `retryable()` is the one place that decides.

**The build ships the libraries as their own chunk.** `vite.config.ts` puts React and the Supabase client in `vendor-*.js`, which keeps its hash across releases, so the year-long immutable asset cache lets returning staff download only the application after a deploy.

## The shell

`web/components/AppShell.tsx` draws the rail, the top bar and the profile menu; `PageHeader` draws the line under the title and the form chip.

The rail groups routes by `group`, and each group heading is a button that collapses its items. Collapsing the group that holds the current page is allowed — a dot on the heading says where you are, so the rail never loses your position. The whole rail also collapses to a 76px icon strip; in that state the group headings are dropped from the markup *and* hidden in CSS, so a narrow rail is correct either way. Both preferences live in `sessionStorage` beside the session, wrapped in `try`/`catch`, because a private window throws on access and a staffroom machine should not keep one person's layout for the next.

Below 1000px the rail becomes an off-canvas drawer with a scrim, and always shows full labels there: collapsing only means something beside a full-width page.

The rail names the school from the `/school` record rather than a literal, because that is the same name printed on every official form and the School profile screen can change it. The top bar carries the page title, the active school year, the palette trigger and the profile menu, which holds sign-out.

The year is a `.scope` chip rather than an eyebrow, because it is the scope every record in the system is filed under; it turns ochre when no year is active. It is a statement, not a control — a year is activated on the School years screen, where what that means is spelled out.

`web/components/palette.tsx` is the command palette, opened with Ctrl/Cmd+K from a listener held in the shell so it works on any screen. **It searches the route table only.** That is a privacy property: every list under `/learners` and `/enrollments` writes a `record_access_events` row naming the exact records returned, so a palette that searched the registry would write one per keystroke and bury the audit it exists to serve. Its footer says so on screen, and `tests/web-shell.test.ts` asserts that sentence is still there. Both the school and the year are fetched once in `web/App.tsx` and passed down, so a screen never refetches them for its own furniture. A **notification bell** sits only in the top bar since 0.93.0 (`web/screens/Notifications.tsx`, and `unread` on `AppShell`, which only draws it — `web/App.tsx` asks for the count). Clicking it opens a popout and never navigates to a page. The reason there was none until 2026-11-05 still governs what it shows. Nothing in this system may raise an *attendance* alert — the absence-alert gate blocks "any messaging on attendance" — and **no notification names a learner**, because every list under `/learners` and `/enrollments` writes a `record_access_events` row and a bell that previewed names would write one per poll. The count comes from `GET /api/v1/notifications/count`, which names no record and writes no access row, exactly as `GET /enrollment-counts` does for the Overview; only opening the popout lists anything, and a learner is reached by a link to the screen that logs the disclosure. See [notifications.md](notifications.md).

## Figures

`web/components/figures.tsx` holds `StatTile`, `Donut` and `Timeline`. They are hand-drawn inline SVG, and they have to be: a charting library that rasterises to a canvas or injects a background image has nothing to draw into under this content policy, and one that sizes bars with `style={{ width }}` is dropped outright. SVG geometry attributes — `x`, `width`, `r`, `stroke-dasharray` — are not inline styles and are unaffected, so every dimension that depends on data is one of those. Colour comes from `.slice-1` … `.slice-5`, which resolve to the chart ramp in tokens.css.

`Donut` divides a ring with `stroke-dasharray` on concentric circles rather than arc paths, so each slice is one element and a zero-count slice disappears instead of drawing a degenerate wedge. `Timeline` lays dated spans across a 1000-unit track.

None of these may be fed a mark, a score or anything derived from one. See the Overview note below.

## The Overview screen

`web/screens/Overview.tsx` is the landing screen. It reads school years, reporting periods, sections, staff, invitations, the audit log and one count of enrollments — and **reads no learner or enrollment record at all**.

That is deliberate and worth preserving. Every list under `/learners` and `/enrollments` writes a row into `record_access_events` naming the exact records returned. A dashboard that counted 897 enrolments on each load would write nine such rows per visit, each carrying a hundred learner IDs, and bury the privacy audit under its own noise. The learner tile and the *Learners by grade* ring come from `GET /enrollment-counts?academic_year_id=`, added in 0.37.0 for exactly this: it returns valid enrollments counted by grade and status, names no record and writes no access row. Row security still applies, so a teacher's figures are their own learners and the response says `scope: "current_access"`. `tests/web-overview.test.ts` loads the screen as a manager and as a teacher and asserts the access log did not grow. Do not page the registry to count anything.

Nothing on the screen is computed from a mark. The figures are calendar and roster facts — which stretch of the year today falls in, how many sections exist at each grade, who holds access. The screen ends by drawing the four figures it may not state — general average, attendance rate, academic standing, class ranking — as struck-out boxes on the unrecorded hatch, each naming what it waits on, above a heading and a paragraph saying plainly that nothing here computes a grade or a rate. A reader who expects a general average on a school dashboard should see that its absence was decided, not that a tile failed to load. Do not quietly delete those boxes to tidy the screen; deleting them is how the decision gets lost.

## Authentication

Use Supabase's official client to sign in, refresh sessions, and recover accounts. The frontend receives only the Supabase URL and publishable key. The API receives the Supabase access token in the `Authorization` header. Do not use a service-role key, database credential, or custom JWT in the browser.

Account creation is a manager action on the Invitations screen; the screen cannot yet tell whether the deployment configures an account service, so it offers the action and surfaces `IDENTITY_SERVICE_DISABLED` when it is absent. Exposing that flag on `/api/v1/me` would let the screen hide the action instead. There is no public EDUNEXUS registration. A managed Auth identity must also have an active `edunexus.staff` record. On launch, call `/api/v1/me`. Treat `STAFF_ACCESS_REQUIRED` as an unapproved/suspended school account. User metadata does not authorize features. Use API permissions as the final authority even if buttons are hidden.

The account page accepts invitation and recovery fragments, removes them from browser history and sets a password, then opens the workspace once `/api/v1/me` succeeds. It also offers "Email me a recovery link", which calls Supabase from the browser and answers identically whether or not an address is registered. Sign-out clears rendered school records; an expired or suspended session returns to sign-in. Since 0.40.0 the profile menu offers **Change password**, a sheet holding `PasswordChange` from `web/Account.tsx`: it signs in again with the current password before calling `updateUser`, because the project leaves Supabase's secure password change off and a staffroom machine left signed in would otherwise let anyone replace the owner's password. That re-check is a courtesy in the browser, not a control; the control is switching secure password change on, which is an operator step in the Supabase dashboard and must not be done with `supabase config push`. Configure exact Auth redirect allowlists and API CORS origins. Reset links must remain on trusted routes. Follow the current Supabase Auth documentation when implementing session storage for the chosen frontend framework.

The workspace has role-aware navigation, named adviser choices, paginated staff/section lists, cursor-based activity history, loading/retry messages, validation errors, and forms that retain edits after failed saves. PATCH requests include the displayed record version. Closing a year requires a confirmation. All displayed record text is assigned through DOM text properties, never inserted as HTML. UI permissions supplement the existing API and PostgreSQL checks.

## Requests and responses

Successful business responses use `{ "data": ..., "requestId": "uuid" }`. Errors use `{ "error": { "code": "...", "message": "..." }, "requestId": "uuid" }`. Validation errors may include `error.fields` entries with a dotted path and display message. Preserve the request ID when reporting a problem; never attach a token or raw learner data.

```http
PATCH /api/v1/sections/00000000-0000-4000-8000-000000000010
Authorization: Bearer <access-token>
Content-Type: application/json

{"version":1,"name":"Daisy"}
```

The API uses snake_case field names. Send JSON, not form-encoded bodies. Unknown fields are rejected. POST returns 201. PATCH requires the latest `version`. On `VERSION_CONFLICT`/409, reload the record and let the user reconcile their change; do not silently retry it against a newer version. Retried creates may return `ALREADY_EXISTS`; reload the appropriate list to inspect the existing record.

List endpoints for staff and sections return `data.items` and `data.pagination` with `limit`, `offset`, and `has_more`. Maximum page size is 100. Years/periods are naturally bounded lists and return `items`. Audit events use string IDs to avoid JavaScript integer precision loss and a descending `next_before_id` cursor. Pass it as `before_id` for the next page.

Dates are exact `YYYY-MM-DD` calendar dates in the school's Asia/Manila context. Avoid converting them through local timezone `Date` arithmetic. Audit timestamps are UTC ISO timestamps and may be displayed in Asia/Manila. Grade level `0` means Kindergarten.

## Permissions and available flows

| Flow | Principal | Administrative officer | Teacher |
|---|---|---|---|
| Read school profile/years/periods | Yes | Yes | Yes |
| Configure school/years/periods | Yes | Yes | No |
| Manage teacher access | Yes | Yes | No |
| Manage administrative access | Yes | No | No |
| Create/reassign sections | Yes | Yes | No |
| Read sections | All | All | Assigned sections only |
| Read change audit | Yes | Yes | No |
| Read learner profiles | All | All | Currently assigned learners only |
| Read annual enrollment records | All | All | Currently assigned learners only |
| Register learners and record movements | Yes | Yes | No |

Show draft school-year setup before activation. Allow period corrections only in draft years. Explain that closed years are immutable. [Section 2A](learner-registry.md) supports learner profiles, annual enrollment, current rosters, and movement history. Managers edit; teachers only view current assigned open-year rosters. Keep LRNs as strings, display pending for null, and never generate identifiers or silently merge matching names. Movement requests use the enrollment version and first date of the new state. [Section 2B.2](enrollment-timeline.md) supports reviewed historical corrections; classroom attendance is now available through the Section 3B.1 API, while grades, report exports, and in-app invitations remain unavailable.

## Polish carried by 0.42.0

These are rules now, not one-off fixes; a new screen should follow them.

- **A class list reads by surname.** Rosters come back in record-id order so they can be paged; `byLearnerName` in `primitives.tsx` sorts what a screen has loaded, and the register, month, monitor and score sheet use it. The enrollment list is ordered by the API itself.
- **Read a list's names with the list.** `GET /enrollments` carries each learner. Never read learners one by one to label a list: each read is a row in the privacy access log.
- **`Table stack`** turns each row into a labelled block below 640px, so a register filled in on a phone never hides a column off the right edge. The register, the score sheet and the assessment list use it; every cell carries `data-label` for it.
- **The activity log speaks plainly.** `web/activity.ts` names each audited table ("Subject offering", "Attendance mark"), says Added or Changed rather than INSERT or UPDATE, and labels the history row every reviewed change also writes. The Overview's list skips those echoes and names who made each change.
- **A button that can only lead to a refusal is not offered.** Submitting a month that is not ready is disabled, and Invitations hides *Create the account* when `/me` reports `account_service: false`.
- **A screen that draws its own header sets `ownHeader`.** `tests/web-screens.test.ts` fails otherwise; the access log drew two until it did.
- **Every screen passes axe's structural rules** as manager and adviser, in `tests/web-a11y.test.ts`, which also proves axe reports a violation in this environment. Colour contrast cannot be measured without layout and is checked by hand against the tokens.
- **`npm run demo`** is the way to look at a screen: the real API and workspace over synthetic records, at http://127.0.0.1:5173/demo.html. `vite.config.ts` proxies `/api/` rather than `/api`, because the bare prefix also matched `web/api.ts` and broke `npm run dev:web` outright.

## The privacy access log screen

`web/screens/Access.tsx`, manager-only, at `/access` (0.39.0). It reads `GET /record-access-events` 25 at a time with the `before_id` cursor, and narrows by `actor_user_id` and `record_id`. A staff member is named from `GET /staff`; one no longer on that list is drawn as unrecorded rather than as a raw UUID. Each operation code is named in words by `describeResource`, with the code beneath it so an unfamiliar one still reads.

**It shows record IDs, never names.** Turning an ID into a name would be a read of that learner, which would write its own row into the log being reviewed. A row's panel lists the IDs it returned, each with a button that narrows the log to it. The route accepts `?record=<uuid>` after the hash, and `web/App.tsx` strips everything after `?` before choosing a route, so other screens can link into it. `tests/web-access.test.ts` asserts that reading the log writes nothing to it.

## Staff invitation screens to build

[Staff invitations](staff-invitations.md) are manager-only. The workspace still authorizes a bare UUID through `POST /staff`; the tracked flow is API-only so far. A screen should show outstanding requests with their intended permission level, let a manager record a new request, and let them paste the operator's returned identifier into a provision action that carries the current invitation version.

Present provisioning honestly: EDUNEXUS does not send the invitation email and cannot create the identity. The operator does that in Supabase, and `INVALID_REFERENCE` means the identifier does not exist there yet. `INVITATION_STATE` means the request was already completed or cancelled, and `ALREADY_EXISTS` means either an open request for that email or an identity that already holds school access. Administrative officers see requests for any level but may only act on teacher ones.

Recovery is already live on the sign-in page and uses the browser's Supabase client, not the API. Keep its reply identical whether or not an address is registered; a differentiated message would let a visitor probe which addresses exist.

## Learner registry and enrollment screens

Registration, profile correction, LRN assignment, enrollment and movements are built, manager-only, and version-checked. Two rules carried into the interface are worth keeping if these screens are reworked. A pending LRN is left blank rather than given a placeholder, and assignment is offered only while it is still null, because the API accepts it once and never clears it. A movement is a dated event whose fields depend on the action, so it is a form rather than a row of buttons: withdrawal takes a reason and no section, a move or re-entry takes a section and no reason, and the section list is filtered to the same grade and year because nothing else is accepted.

**Still API-only.** These screens deliberately do not offer: correcting an LRN that was already assigned, repairing a recorded movement or its dates, voiding and restoring an annual record, correcting a whole-year grade placement, merging duplicate learner records, or importing a class list from a file. Each is a reviewed workflow with preview, hash and confirmation semantics that a plain form would misrepresent. Both screens end with a note naming them, so a walkthrough does not read a missing screen as a missing capability.

## Learner registry screens

The workspace has a **Learners** tab for every role, built on [Section 2A](learner-registry.md). It searches `GET /learners` with the documented `search`, `lrn` and `birth_date` filters, pages 25 rows at a time by `offset`, and loads a learner's `GET /enrollments?learner_id=` records only when a staff member opens that row, because every successful read appends a record-access event.

Teachers get it read-only. Managers register learners, correct details, fill a pending LRN and reach the reviewed corrections from a learner's panel; each goes through its version, reason and review, and no button skips them. A manager's panel also links to `#/access?record=<id>`, the privacy access log narrowed to that learner. A teacher who opens the tab receives only their currently assigned learners from the API, and the page says so rather than implying the registry is empty. Render pending LRNs as `Pending` instead of a blank cell, show Kindergarten by name rather than grade `0`, and keep `record_state=voided` rows labeled as unusable for reporting. Managers request `record_state=all` to see voided evidence; teachers must not.

Section and school-year names are resolved from `/sections` and `/academic-years` for display only. A missing entry means the row is outside the reader's scope, so it shows as unavailable rather than as a database identifier. Learner names, LRNs and birth dates are rendered as text and cleared on sign-out with the rest of the workspace.

## The roster import screen

[Section 2B.1](registry-review.md) imports have a screen: `web/screens/Imports.tsx`, at `/imports`, manager-only. It takes a section, a first day and an entry kind, then a CSV chosen as a file or pasted as text, and the template is downloadable from the page header.

**The file stays in the page.** It is read into memory, measured the way the API measures it (`csvStats`: UTF-8 bytes, data records after the header) and refused before sending if it is over 24,000 bytes or 50 learners (`csvProblem`). Nothing is uploaded until the preview, and the server keeps only a fingerprint.

**Every row is reviewed where it sits.** The preview lists each normalised row with what will happen to it, and a row the server refused carries the server's own message beside its data. A possible duplicate or an occupied LRN opens a decision in that row: one of the learners already on file, or a different child with a reason that goes into the receipt. Changing a decision marks the preview stale rather than discarding it, because the rows are where decisions are made; nothing can be imported until it is previewed again.

**The commit is the identical payload.** Confirmation sends exactly what was previewed with `confirmed: true`, so the import is all rows or none, and a retry after a lost response returns the original receipt instead of importing twice. `PREVIEW_CHANGED`, `PREVIEW_EXPIRED` and a deleted preview drop the review. The receipt lists each row's result and any reason given.

## The reviewed correction screens

Sections 2B.1 (LRN correction), 2B.2, 2B.3, 2B.4 and 2B.5 are drawn by `web/screens/Reviews.tsx` and hosted where the records already live: an annual record's panel on the **Enrollment** screen offers *Correct the timeline*, *Correct the grade* and *Void this enrollment* (or *Restore* on a voided record), and a learner's panel on the **Learner registry** offers *Correct the assigned LRN* and the identity links. All of them are manager-only, like the endpoints.

**One shape for all five.** Propose, read the server's own review, confirm that exact review: `useReview` holds the preview, sends the unchanged body with `review_hash` and `reviewed: true`, and drops the review on a conflict because its hash is dead. Confirmation is disabled whenever `can_commit` is false or no hash came back, and every `issues` code is rendered as the sentence saying what to do (`identityIssues`, `recordIssues`). LRN correction has no server preview, so its review — old and new numbers side by side — is drawn in the client before `reviewed: true` is sent.

**Timelines are edited whole.** The sheet loads `/timeline`, lets a manager change dates, sections and reasons, remove a movement or add a missed one, and sends the complete sequence. `timelineProblems()` restates the API's rules and marks the offending entry before a request is spent; `normalise()` keeps a withdrawal in the section it left. Sections are limited to the enrollment's own grade and year. The review draws the record as it is beside the record as it would be, with the earliest affected date and both latest states; confirmation sends `after_entries`. The original movements stay on file and are shown separately as *Movements as first recorded*.

**A grade correction maps sections.** Choose the verified grade, then a section in it for every section the year passed through (`sectionsOf`, `remap`); dates, types and reasons are untouched, and the screen says plainly it is not a promotion.

**Voiding is not withdrawal.** The sheet offers *entered in error* or *duplicate of an enrollment that is kept*; the second finds the kept record through a registry search, which reads only when asked. A voided record's panel explains that it counts for nothing and offers only restoration, and the class list marks it.

**Identity links keep both records.** From a learner's panel a manager searches for the other entry, chooses which record is kept, reviews both profiles and every enrollment of both, and confirms. Linked entries are hidden from the registry unless *Include records linked into another* is ticked, and a linked entry's panel offers only *Reverse this link*.

Each record's histories — corrections, void and restore reviews, identity links, LRN corrections — sit under its panel, because a lost response is checked there before anything is tried twice.

## The daily attendance screen

[Section 3B.1](daily-attendance.md) has a screen: `web/screens/Attendance.tsx`, at `/attendance`, open to advisers and managers alike. It is the highest-frequency screen in the system — thirty advisers, twice a day — and the rules it settled are written up in [that section's own document](daily-attendance.md#the-screen).

Four are worth repeating here, because a rebuild would have to honour all four. Marks are held locally and reviewed as one batch, since the API commits atomically against a single shared sheet version. A change sends **both** sessions, because it replaces a learner's AM/PM pair rather than patching half of it — `pending()` does this and is tested for every branch, including the case where an omitted session would have cleared a mark nobody touched. Clearing a mark is one of the three choices, not a missing option, because only an explicit null clears one. And `recording_available` is false for four distinct reasons, each of which the screen names, together with the screen that resolves it.

Change history is manager-only on this screen, deliberately: a teacher's history endpoint could disclose formerly assigned learners, so it does not exist for them. A teacher's sheet is badged `current_access_only` and says in words that it is a current class list, not a historical report.

## The monthly consolidation screen

[Section 3B.2](monthly-attendance.md) has a manager screen: `web/screens/Months.tsx`, at `/months`. Teachers have none, because the `/status` read available to them carries no counts and no learner detail — there is nothing to draw.

It offers only the transitions allowed from the current state, and no edit form, because nothing edits a month in place. Every blocking issue is rendered as the sentence that says what to do next and which screen does it; `issueText` holds that mapping and a test asserts each documented code has one. Every count on the screen is a raw AM/PM classroom session and is labelled as such — not a school day, an attendance credit, a percentage or an SF4 total. It shows neither a member list nor a transition history: both cards were removed on 2026-11-10 and the endpoints behind them are still there, uncalled.

## The classroom absence monitor screen

[Section 3B.3](attendance-monitor.md) has a screen: `web/screens/Monitor.tsx`, at `/monitor`, open to advisers and managers alike. It opens on the fortnight ending today, clamped to the school year.

Two rules carry the weight. The window is validated in the client before a request is spent, because the API returns one `MONITOR_RANGE` code for four different mistakes and a reader needs to know which; `windowProblem()` is a pure function with a test per branch. And a gap in the record is never drawn as an absence: `unconfigured` and `incomplete` carry the unrecorded mark, and a test asserts neither renders the word "absent".

The screen states its window beside every count, says that a run may have started before it, and closes by saying there is no approved absence rule and therefore no threshold here — pointing at the manual follow-up workflow rather than offering to open a case.

## The attendance follow-up screen

[Section 3B.4](attendance-followups.md) has a screen: `web/screens/Followups.tsx`, at `/followups`, manager-only because every case endpoint is. Teachers never see the route, and the API refuses them the queue if they reach it.

**Opening a case starts from evidence, not from a learner.** The sheet asks for a section, a 1–31 date window and a category, then reads the absence monitor filtered the way the database checks the category — `with_absences` for an absence case, `incomplete` for a gap — so the only learners offered are ones a case could be opened for. It reads on request, not as the window changes, because every monitor read writes an access row naming the learners it returned. The window is checked with the monitor's own `windowProblem()` before a request is spent.

**Review, then confirm.** Owner, optional due date and reason go to the preview; the review shows the learner, window, owner, due date, target status and current counts, and lists any blocking issue as the sentence saying what to do (`issueText`). Confirm is disabled whenever the preview returned no hash. A conflict on confirm drops the review, because its hash is dead.

**Due dates are checked the way the API checks them.** `dueProblem()` refuses a new or changed date before today, lets an update keep a date that has already passed, and is skipped for resolve and cancel — whose form has no date field, because `changeBody()` always sends `due_on: null` when closing. The API answers all of these with one `FOLLOWUP_DUE_DATE`, which is why the reason is found in the client first.

**A case shows what it was opened on beside what is there now.** The detail reads `/attendance-follow-ups/:id` when the row is expanded, not with the queue, and draws opening and current counts side by side. `evidence_changed` is explained as *something* the evidence captured having changed — a name, a calendar date or a month status count too — rather than as a change in attendance, and `available: false` is drawn as the learner no longer being enrolled in the window, with the case still actionable.

Owners are named from the whole staff list, so a suspended manager still appears against their cases; only active principals and administrative officers are offered as a new owner. There is no reminder, badge or alert anywhere on the screen, and it says why.

## The subjects and offerings screen

[Subject catalog](subject-catalog.md) and [section offerings](section-subjects.md) share one screen: `web/screens/Subjects.tsx`, at `/subjects`. It is open to advisers, because the API lets them read the catalog and the offerings of the sections they currently advise; the add, offer, edit and history controls appear only for managers, and the API refuses them to anyone else regardless.

**Two tables that are allowed to disagree.** Section offerings come first, because that is what a section is actually taught; the catalog sits beneath. Each offering row shows the subject *as chosen* from `subject_snapshot`, its pinned version, and a "Catalog now" badge comparing it with the current catalog record, so a later rename is visible without being applied. Opening the row explains the difference and, only in a draft year, offers the explicit refresh — which sends `refresh_subject: true` with the current catalog version. Every other offering save sends `refresh_subject: false` and `subject_version: null`.

**Offering a subject** offers only catalog subjects that are available, apply to the section's grade, and are not already offered there — retired ones included, since adding a retired subject again is a reactivation, not a second row. The chosen subject's current version is what gets pinned. Both lists are UUID-paged, so the screen collects every page before sorting offerings by display order, then code, then id (`byDisplay`).

**A class-list file's instructions are drawn, not written out.** `FileRules` in `web/components/filerules.tsx`, shared by Roster submissions and Class-list import since 2026-11-10. It replaced one run-on sentence per screen that carried the nine column names inside it — *“The header must be exactly lrn,first_name,… every LRN with all twelve digits, since each learner needs one; dates as YYYY-MM-DD; sex as male or female”* — where the header's own full stop ended the sentence and left the next one starting lowercase. The columns are now a numbered line, because the order is what a reader has to check, and each cell rule sits against the column it governs. **The header is a prop**: `ROSTER_HEADER` is the workspace's one copy of those columns and `tests/registry-address.test.ts` asserts it matches what `GET /roster-imports/template` publishes, so the component must never grow its own list. Class-list import passes the template the server published and falls back to `ROSTER_HEADER`.

**An option whose wording is a sentence is a `radios` field, not a select.** Added 2026-11-10 for the school’s attendance rule, whose three readings of one mark each have to say what they do to the SF2 — *“Tardy: half-shaded on the SF2 (upper half if the morning was missed, lower half if the afternoon) and counted present”*. A select clipped that at the control’s width and drew its open list at the list’s own width, outside the sheet it belonged to. `radios` stacks the options as lines that wrap, bolds the part before the first colon as the choice’s name, and marks the chosen one with more than the radio itself. Like `choose`, it starts on nothing, so a rule is never recorded because nobody moved a default — and unlike the prompt option it replaced, there is no empty row in the list to pick by accident.

**Grade applicability is a set of checkboxes.** `Editor` gained a `checkboxes` field type for it: held as a comma-joined string like every other value, submitted as the option keys in option order, and marked like any other field when the server rejects it. Grade 0 is always written "Kindergarten" (`gradesText`) and is a grade level, never a numeric grading target. Nothing on this screen carries a weight, component or formula, and it says so.

## The assessment policy screen

Sections [4A.3](assessment-policy-drafts.md), [4A.4](assessment-policy-adoptions.md) and [4A.5](assessment-policy-bindings.md) share one manager-only screen: `web/screens/Policies.tsx`, at `/policies`, in three cards — drafts, adoptions for the chosen school year, and bindings for the chosen section.

**No number is the system's.** A new draft starts with one empty component row and no weights; every code, name and percentage is typed from the school's documents, and a source reference says which. Weights are entered as percentages and sent as integer basis points by `basisPoints()`, which refuses a third decimal place rather than rounding it, because rounding a weight is a rule nobody has supplied. `componentProblem()` restates the API's rules — one to ten components, distinct codes, exactly 100% — and nothing more. The weights total is shown because the API requires it; it is the only sum on the screen and it is not a grade. Every draft is labelled *Unapproved draft*, archived or not.

**An adoption is the school's decision, frozen.** Recording one names the school year, the draft (its current version is the one frozen), an in-year date and the school record carrying the decision. Its panel draws `policy_snapshot`, not the draft, so a later revision of the draft never shows through. Withdrawal is one-way with a reason; `ADOPTION_BOUND` is shown in the sheet with the API's own instruction to release the bindings first.

**A binding scopes, it does not grade.** The bindings card lists the chosen section's active offerings with the adoption governing each, drawn as *No policy bound* where there is none. Binding offers only standing adoptions of that year that cover the section's grade; release is one-way and says to bind again for a different adoption.

## The score entry screen

[Section 4B.1](assessment-scores.md) has a screen since 0.41.0: `web/screens/Scores.tsx`, for every role, at `/scores`. What it settled is worth keeping.

**A raw mark and nothing else.** There is no total, average, percentage, weighting or grade on this screen. `tests/web-scores.test.ts` fails on a column or figure that looks like one. The one count it shows is of learners with no mark recorded, which is about completeness, not performance.

**Blank is not zero.** An unrecorded learner's box is empty and carries `Unrecorded`. Emptying a box against a recorded mark is a clear, labelled *Will be cleared* on the sheet and *Cleared* in the review, and it is sent as an explicit JSON null — the only thing the API accepts as a clear.

**Only what changed is sent.** `pendingEntries()` compares each box with what is stored and includes a learner only if they differ, each at the version it was read. A learner nobody touched can never be rewritten by a batch. `markProblem()` refuses a third decimal place instead of rounding it, and a mark above the task maximum, beside its box.

**A conflict is shown, not retried.** `VERSION_CONFLICT` reloads the sheet, keeps the typing and leaves the review open, where the colleague's newer mark is now *Recorded now*. The sheet is not blanked during that reload, because blanking it unmounts the review and loses the explanation — a defect the DOM test caught.

**Components come from the bound policy.** The add sheet lists `GET /section-subjects/:id/assessment-components`, which returns codes and names but never weights. With no binding, the screen says who binds one and offers nothing to type into.

Component choices come from the bound adopted revision, so fetch them from the binding's adoption rather than hard-coding "WW" and "PT". An offering with no standing binding cannot hold assessments at all, so show that as "no assessment policy is bound to this subject yet" and link to the binding screen rather than presenting an empty form.

Send each learner's own `version`, using `0` for a learner with no mark yet; the batch is 1-100 and commits atomically, so surface a rejected batch as "nothing was saved" rather than implying partial success. **Never render an unrecorded mark as zero** — leave the cell visibly empty, exactly as unmarked attendance sessions are shown. Clearing a mark is sending null, not deleting a row.

Do not compute or display a total, average, percentage or grade anywhere on these screens, even client-side. No endpoint provides one, the weighting rules are not yet confirmed with the school, and a helpfully calculated column would be read as official. Surface `TASK_MAXIMUM` as "lower the recorded scores first", and expect an adviser to be unable to correct a learner who has transferred out; that is a manager action. Since migration `0022` that is enforced rather than merely intended: a departed learner drops out of the adviser's sheet entirely and an entry for them answers 404, while a manager still sees both the learner and the mark. Always send the `raw_score` key — omitting it is rejected, because only an explicit null may clear a mark.

## The instructional calendar screen

[Section 3A](instructional-calendar.md) has a screen: `web/screens/Calendar.tsx`, at `/calendar`. Managers configure it; since 0.39.1 advisers read it. It reads a month, sets or clears dates through the preview-and-confirm workflow, and shows the all-scope change history. What it settled is worth keeping if it is ever rebuilt.

**A month at a time, because the SF2 is a month.** The API reads at most 62 dates, and a manager configuring a calendar is working from one page of the school's own. The month arrows are bounded by the school year, and the window is clamped to `starts_on`/`ends_on`, so a read can never fall outside the year or over the limit.

**An unconfigured date is drawn, never blank.** Both session cells carry `Unrecorded` with "Not configured". This is the whole point of the module: an unconfigured date is not a holiday, not a school day and not an absence, and attendance cannot be recorded against it. `tests/web-calendar.test.ts` asserts the mark is there and that no em dash stands in for it.

**Dates are strings, and stay strings.** `web/dates.ts` holds the month arithmetic. Nothing routes a plain calendar date through a local-time conversion: comparisons are string comparisons, which sort correctly in `YYYY-MM-DD`, and the weekday column reads UTC parts of a UTC-pinned value. At 8am in Benguet a locally parsed date is still the previous UTC day, which would put the wrong weekday beside every row.

**The classification presets are a convenience over the API's rule, not a second rule.** Choosing "Holiday" fills both sessions with "No class" because that is what the API requires of a holiday, and every session stays editable afterwards. The database still decides. If the rules in `instructional-calendar.md` change, change these with them rather than letting the form drift into being the authority.

**The review hash is never reused after a refusal.** Preview returns the hash; confirm sends back the exact proposal that was previewed. A 409 — a version conflict, a changed review, a blocking conflict — throws the hash away and returns the manager to the form. Do not retry a hash against whatever is there now.

**Conflicts are explained, not printed.** `SECTION_OVERRIDES_PRESENT` and `BASE_DAY_UNCONFIGURED` are rendered as the sentence that says what to do next, with the affected sections named. A bare code tells a school head nothing.

Two things this screen does not do. It has no field-level error mapping, because `Editor` cannot express a two-step review; a server rejection goes to the sheet's own status line, and the client enforces the length and required rules so most never reach it. An adviser reads it and changes nothing: the section list is narrowed to the sections they advise, the screen opens on the first of them, and the pick boxes, both schedule actions and the change history are not rendered. The API refuses a section they do not advise with 404 whatever the screen offers.


## My profile and Settings (0.92.0, moved 0.92.1)

`web/screens/Settings.tsx` holds the three cards that are a person's own
choices — `Preferences`, `Accessibility` and `Learning` — and
`web/screens/Profile.tsx` keeps who they are: identity, picture, signing in and
their own activity. Both components live where they did; `Settings` reads
`/me/profile` itself rather than being handed it, because a route is entered
directly from the account menu, from Ctrl+K and from a bookmarked hash.

**Both routes are `offRail`, and the account menu is a fixed list.** That is the
part worth knowing before moving anything else there: `ProfileMenu` in
`web/components/AppShell.tsx` writes its items out by hand — My profile,
Settings, Change password, Sign out — so a route marked `offRail` disappears
from the navigation and appears nowhere else unless an item is added there too.
`tests/web-settings.test.ts` asserts both halves for that reason.

**No preference moved between columns.** The cards read and write the same
`staff_profiles` columns through the same `save_my_profile`, so a choice made
before the split is the choice the screen opens with. A person who has never
chosen anything has **no `staff_profiles` row at all**: `read_my_profile` is
`stable` and answers with the defaults, and the row appears on the first save —
which is why a test that reads that table before the first click finds nothing.

## The learner address and the class-list template (0.88.0)

`profileFields` in `web/record-fields.ts` gained `address`, so it appears on
**Register a learner**, on the registry's correction form and on the SF10's
*Save details* editor at once — those three share the list on purpose, and a
field added to one must be added to all three or the forms edit a different
learner than the registry does. It is optional and `wide`. **A learner with no
address recorded must read as unrecorded, not as an empty cell**: that is
`Unrecorded`'s job wherever the value is shown, exactly as a missing LRN already
is.

`guardian_name` and `guardian_contact` joined it the same way in 0.92.0
(migration 0057), and the same rule applies to them: they are on all three
sheets because the list is shared, and an unrecorded guardian reads as
*No guardian recorded*, never as an empty line — a blank there says *this child
has no guardian*. The contact number is **never reformatted**: a mobile, a
landline with an area code, or both on one line are kept exactly as the school
wrote them.

**A learner `PATCH` replaces the whole profile**, so any sheet that edits a
learner must send every field in `profileFields` or it clears the ones it omits.
That is why all three read their initial values from a full learner row — the
registry list row, or a fresh `GET /learners/:id` in `FormDialogs.tsx` — and why
a new field must be added to the shared list rather than to one screen.

Nothing else about a child or their family goes in this list: no mother tongue,
religion or indigenous group, no relationship field, no second guardian, no
guardian email, occupation or address, and no contact number of the learner's
own. The learner contract is strict, so an extra key is a 422 rather than a
silently dropped field, and which further fields may exist at all is behind the
learner-fields gate in [constraints.md](constraints.md) — a decision, not a line
of code.

**One learner is read in two parts** (`web/screens/LearnerProfile.tsx`, 0.92.0).
`LearnerDetail` is what the registry's row panel renders: a `segmented`
tablist over **Learner profile** and **Enrollment**, with the profile selected
first. The two are two different records, not two views of one — `learners`,
and the annual `enrollments` timeline. Four rules it carries, each the reason
the file exists rather than a preference:

- **It shows only what the record holds**, which is `profileFields`: the name,
  LRN, birth date, sex, the address line (0053) and the guardian pair (0056).
  A profile is where a reader most readily takes a gap for "nothing to report",
  so the fields EDUNEXUS does **not** hold — mother tongue, religion,
  indigenous group, a relationship field, a second guardian, a guardian email
  or address, the learner's own contact number — are named in a `Callout` as
  not collected rather than left out silently. Adding one of them here is the
  learner-fields gate's decision, not a layout change.
- **An unrecorded guardian is drawn, never implied absent.** `No guardian
  recorded` and `No number recorded`, through `Unrecorded`, because a blank
  here reads as *this child has no guardian*.
- **Academic history is not in this panel at all.** The shortcut was removed in
  0.90.2 because the rail already carries that screen; 0.91.1's signpost tab
  was removed too, in 0.92.0. The gate opens **both** parts before asserting no
  `prior-records` link exists, because 0.90.2's gate was vacuous by asserting
  on the closed list.
- **Editing is an action**: **Edit profile** opens a `FormSheet` over the panel,
  rather than sitting folded in a `Task` beside the reviewed LRN and identity
  workflows, where a plain correction read as unavailable. It is the existing
  `PATCH /learners/:id` with `profileFields` on the same row, so there is no
  second learner and no second copy of a field; the request replaces the whole
  profile, so **any screen that edits a learner must send every field** or it
  clears the ones it omits — which is why `profileFields` is shared with
  `FormDialogs.tsx` and the registration sheet. An adviser gets no editor; the
  API refuses theirs anyway, and a test sends one to prove it.

**The class-list template is generated, and its columns are not the workspace's
to choose.** `rosterTemplateWorkbook()` in `web/csv.ts` builds the `.xlsx` from
`ROSTER_HEADER`, the one frontend copy of what `GET /roster-imports/template`
publishes; `tests/registry-address.test.ts` asserts the two are equal. It is a
copy rather than a fetch because that endpoint is manager-only and advisers
prepare class lists too, so **changing the columns means changing both**, and the
test is what stops them drifting.

Three mechanics in the workbook that exist because of how Excel behaves, not
because of how EDUNEXUS behaves:

- **The LRN and birth-date columns are formatted as text before anyone types in
  them, in every empty row.** An unstyled cell is one Excel formats as a number,
  and a twelve-digit LRN typed into it comes back as `1.36512E+11` with its
  digits gone. The empty rows are therefore *written* rather than left absent.
- **Excel's own validation is a courtesy, never the authority.** `allow()` puts
  a `male`/`female` list on the sex column; the API checks every cell again,
  because a file can be filled in anywhere, including in a reader that ignores
  validation.
- **The second sheet says what the first sheet means.** Every column named,
  required or optional *in words* as well as by the heading's shading, and one
  worked row — because the file is opened days later, away from the screen that
  produced it.

`rosterFileText` reads the `Class list` sheet **by name** and accepts either the
current header or the earlier seven-column one, sending whichever it found; the
API accepts both too. It quotes every cell, which matters now that a column holds
commas: an unquoted address makes a row eight columns too wide.

## Where a class list lands (0.89.0)

`Imports.tsx` asks, under *Where this file lands*, whether the file goes **Into a
section** or **Onto the registry at a grade, with no class yet**. The second
sends `section_id: null` with `academic_year_id` and `grade_level`; the first is
unchanged.

Four things the screen owes the person, each of which is why something in it
looks the way it does:

- **It says what the learners will be.** The registry choice carries a `Callout`
  spelling out that they are enrolled and count on the totals, belong to no
  section, appear as *not in a class* on the SF4, and are on no register — and
  that assigning a class afterwards is a change to the enrolment they already
  have. A mode that quietly produces 897 learners in no class would be a trap.
- **It says not to do both.** Import the registry list *or* the class lists. A
  learner already enrolled this year is refused the second time, so doing both
  wastes a review rather than double-enrolling anyone, but the screen says it
  before that happens.
- **An adviser's submitted list forces the section choice.** Their list *is* a
  class list, so opening one sets the mode back and disables the other option.
- **A year with no sections is no longer a dead end.** The old early return said
  "No section to import into" whenever a year had none; now only a year-less
  school stops the screen, because registering onto a grade is exactly what to
  do before the sections exist.

`preview.section` is nullable now, so anything reading it needs the
`grade_level` fallback beside it — the summary line reads *Onto the registry at
Grade 3, with no class yet*. The destination is part of the preview's hash, so
changing the mode, the grade or the section invalidates a reviewed preview on
purpose; the effects that clear `preview` and `chosen` list `into` and `grade`
for that reason.

## An adviser's own class, and the oversight card (0.90.0)

Two screens, both grafted onto existing ones rather than given routes of their
own, because neither is a place you go — they are things you do from where you
already are.

**`MyClassSheet` (`web/screens/MyClass.tsx`)** opens from **Take learners into
my class** in the Learner registry's header, which replaces *Register a learner*
for a teacher. It is a `Sheet`, and the list of candidates is a **`BatchSheet`
with `reasoned={false}`** — one request per ticked learner, which is what that
primitive is for, and enrolment writes take no free-text reason, so the reason
box is turned off rather than asked for and ignored.

Five things it owes the person, each the reason something looks as it does:

- **It names the class, never "the registry" — and names the class's school
  year.** An adviser with two sections chooses which, and the list is that
  class's grade and year. The picker holds the sections `/sections` answered —
  row security, not a filter here — but `/sections` has no year filter and
  orders by `academic_year_id`, a uuid and so not chronological, so the sheet
  reads `/academic-years` alongside it, prints the year in every option, sorts
  newest year first, and opens on a class that can actually be built (0.95.2).
- **It refuses a school year that is not running, before anything is clicked.**
  `barrier()` names the reason — the principal has not activated the year, it is
  closed, or its classes have not begun — and while it holds, neither write is
  offered and no list is fetched, because the list names learners outside the
  adviser's own class and naming one writes a `record_access_events` row. This
  is not politeness: the first day the sheet would send is the year's
  `starts_on`, which `move_enrollment` refuses as future-dated (`409`) while
  `place_enrollment` accepts without checking, so the same date was refused by
  one write and silently taken by the other. The school builds classes once the
  year is activated (decided 2026-11-06); the backend is untouched (0.95.2).
- **It says what will happen to each learner**: *Give them this class* when they
  already hold an enrolment with no class, *Enrol them here* when they hold none
  this year. The two are different writes and the person should know which.
- **A learner already in somebody's class is simply not offered.** The API
  refuses it (`LEARNER_IN_CLASS`), but an option that only ever fails is worse
  than no option.
- **Registering warns before the form.** An adviser cannot search the registry,
  so the duplicate refusal has to be expected rather than a surprise: the sheet
  says the registry is checked and that a child already on it must be taken in
  instead.

The learner form is **`LearnerFields` imported from `LateLearner.tsx`**, with
`blankLearner`, `learnerProblems` and `toLearnerProfile` exported alongside it.
Those were local to that file; they are shared now so the office's enlist form
and the adviser's registration form cannot drift into asking different things
about one child. A field added to one is added to both.

**`EncodingProgress` (`web/screens/EncodingProgress.tsx`)** renders inside
Academic history, above the learner finder, `{manager && !chosen}`. It reads
`/academic-years` and `/academic-years/:id/encoding-progress` and **nothing
else** — no learner, no rating. That is the whole bargain: those two reads name
nobody and write no `record_access_events` row, so the card can be watched as
often as it is useful. **Do not add a learner name, a list or a link that pages
the registry to it**; a manager who needs a name opens the learner, which logs
that read as it should. `tests/web-prior-records.test.ts` asserts the screen
sends only those two kinds of request before a learner is chosen, and
`tests/web-teacher-roster.test.ts` asserts the access-event count does not move
when it is opened.

## Promotion's gate and the term window (0.103.0)

Two rules the API enforces and the screens only report. Both are in
**Promotion** (`web/screens/ReportCards.tsx`) and the card editor
(`web/screens/CardEditor.tsx`).

**The screen asks the API whether promotion is open; it does not work it out.**
`PromotionPanel` fetches `/sections/:id/promotion-readiness` and renders
`NotReady` when `ready` is false — a `Callout` plus one row per thing still
missing, term by term, with each term's own count. While it is closed the
endorsement table is read only and the approve action is not drawn, and an
`?approve=1` link from the Overview's queue says why there is nothing to approve
instead of opening an empty sheet. **Do not compute readiness from
`records.learners`** even though every grade is already on the page: the
requirement differs by grade level and school year (Kindergarten requires
nothing; a descriptively graded grade requires narratives), and a second copy of
that rule in the workspace would be a second thing to get wrong. The endpoint
reads no grade and names no learner, so asking it costs nothing in the privacy
log.

**A term that has not started is shown, not offered.** `termOpen` and
`unstartedTerms` are exported from `CardEditor.tsx` and compare `starts_on`
against `localToday()` — a plain calendar-date comparison, never through local
time. The term and column pickers label such a term *— not started*, the table
for it is drawn read only above a note saying when it begins, and in the card
editor those boxes render as `Shown` values rather than inputs. The subject
average, the general average and the remarks name no term and stay editable,
because the API does not gate them either. A control that would always be
refused is worse than no control, which is the same reason a learner already in
somebody's class is not offered to the pull.

**The approval sheet says what approving does**, before it is pressed and again
afterwards: approving enrols the learner into next school year, and the success
line reports `advanced` and `waiting_for_next_year` from the API's own answer
rather than guessing. That matters because the second case — the outcome
recorded and the enrolment following when a manager creates next year — is
invisible otherwise, and a person who is not told would reasonably conclude
nothing happened.

## The report-card column on a learner's profile (0.104.0)

The **Enrollment** part of a learner's panel (`EnrollmentHistory` in
`web/screens/LearnerProfile.tsx`) already listed every school year with its
grade, class and status, and already carried an **SF9** button per row — which
is still the only way to reach a past year's card. What is new is a **Report
card** column saying whether that year's card has been issued.

**It is a second fetch, not a field on the enrolment.** `/enrollments?learner_id=…`
is shared by five screens, and whether a form was issued is not part of an
enrolment record, so the column reads `/learners/:id/sf9-history` and matches by
`enrollment_id`. Both reads name records and both write a privacy row, which is
correct: they are two reads of the same learner.

The four states it draws, and why none of them is a blank:

| State | Drawn as |
|---|---|
| `issued` | `Issued no. 7` with the date, and `corrected; all N issues kept` when there is more than one |
| `in_progress` | `In progress` — the card exists and has not been issued |
| `no_card` | `No Kindergarten card`. `sf9Get` refuses Kindergarten, so offering a card here would be a button that always fails |
| `voided` | *Not shown for a voided record*, matching the Attendance column beside it |

While the history is still loading the cell says `Reading…`, and a year the
history does not cover draws `Unrecorded`, because a learner's card status is a
record and a blank cell would read as "never issued".

**Do not compute this column from the enrolment rows.** Whether a card was
issued lives in `form_issuances`, whose row policy shows a teacher only the
forms they issued themselves; the endpoint exists precisely because the
workspace cannot know it any other way.

The table's note carries the sentence the school wanted stated — an issued SF9
stays as it was issued, the next grade starts a card of its own, and neither
overwrites the other. A `tests/web-learner-profile.test.ts` case asserts the
column and that sentence are both present.
