# Staff profiles

**My profile**: how the school has a person recorded, their picture, their
interface and accessibility preferences, where their account has been signed in,
their own recorded activity, and the one thing about their staff record they may
ask to have corrected.

> **Written 2026-11-04 from the code.** The original of this document, and
> `profile-plan.md` with it, were lost with the rest of `docs/` in the 0.86.1
> recovery and exist in no branch and no commit, so this is written from
> `src/modules/profiles/`, `web/screens/Profile.tsx`, `web/Account.tsx`,
> `web/components/avatar.tsx`, `web/photo.ts` and the
> [changelog](../CHANGELOG.md), in that order of authority. Where this file and
> [constraints.md](constraints.md) disagree, that file wins.

## What a person may change about themselves, and what they may not

This is the whole shape of the module:

| | Who |
|---|---|
| Avatar, preferences, accessibility | **yourself** |
| Your photo — set, replace, remove | **yourself** |
| Record that other sessions were ended | **yourself** |
| **Your own name or position** | **asked for, decided by a manager** |
| Take down a colleague's photo | **a manager**, with a reason |

**A person cannot change their own name.** The staff record is the school's
record of who works there, so a correction is a *request* a manager approves or
declines — and `nameRequestDecide` is **never your own**.

```
GET   /api/v1/me/profile
PATCH /api/v1/me/profile
POST  /api/v1/me/photo
POST  /api/v1/me/photo/remove
GET   /api/v1/staff/:id/photo
GET   /api/v1/me/sessions
POST  /api/v1/me/sessions/end-others
POST  /api/v1/me/name-requests
POST  /api/v1/me/name-requests/:id/withdraw
GET   /api/v1/name-requests                 manager
POST  /api/v1/name-requests/:id/decide      manager
GET   /api/v1/me/activity
POST  /api/v1/staff/:id/photo/remove        manager
```

Only three are manager-only. Everything else is a person acting on their own
account, which is why most of them need no role check at all.

## A photo loads no image file

This is the part worth understanding before changing anything here.

The workspace's content policy is `default-src 'none'` with a single
`img-src 'self'` covering a short, closed list of files this repository ships. A
staff photo is **not** on that list, and must not be — it is user-supplied, and
`img-src 'self'` would mean serving user-supplied bytes as an image from the
app's own origin.

So a photo is **drawn on a canvas from bytes read through the API**:

| | |
|---|---|
| `web/components/avatar.tsx` | `Avatar` and `PictureCanvas` — draws the photo on a `<canvas>` from bytes |
| `web/photo.ts` | Frames and re-encodes the picture **in the browser**, before sending |
| `GET /api/v1/staff/:id/photo` | The bytes: your own, or a manager reading a colleague's |

No `<img>`, no object URL, no `data:` URL. The same reasoning makes the EDUNEXUS
mark a vector redraw in `web/components/brand.tsx` and every chart hand-drawn
SVG.

### What the API does to a photo before storing it

Two sizes are sent, base64, and **each is decoded and checked as a JPEG before
anything is stored**:

```ts
export const photoLimits = { image: { bytes: 143360, min: 128, max: 1024 },
                             thumb: { bytes: 20480,  min: 64,  max: 256 } };
```

The base64 field accepts **half again over the limit**, deliberately, so an
oversized picture is answered in words beside its field rather than as a bare
length rejection — a `PHOTO_INVALID` with `fields[]`, which `Editor` maps onto
the control.

`checkJpeg` in `jpeg.ts` is the real work. It **rebuilds the file from its
decoding segments only**:

```ts
const kept = new Set([0xc0, 0xc1, 0xc2, 0xc4, 0xdb, 0xdd, 0xe0, 0xee]);
```

Everything a camera or an editor writes is dropped — **EXIF with its GPS position
and device serial**, XMP, ICC profiles, comments and embedded thumbnails —
whatever the browser did before sending. The browser already re-encodes through a
canvas, which carries no metadata; **this is the check that does not depend on
the browser being the one sending it.**

Four refusals in it are worth keeping:

- A JFIF header **longer than its 16 bytes** is carrying an embedded thumbnail,
  which is a second picture nobody checked.
- The scan must run to the end-of-image marker; a file whose last two bytes are
  not `FF D9` is **cut off or carrying a payload** after the image.
- Arithmetic and lossless JPEG frame markers are refused outright — only
  baseline, extended sequential and progressive.
- The picture must be **square** and within the size bounds, or it is not kept.

A staff photo is a photograph of a real member of staff. Stripping its metadata
is not tidiness: an EXIF GPS tag on a teacher's selfie is their home address.

### Taking down a colleague's photo

`staffPhotoRemove` is a manager's, takes a **reason**, and the person is told.
A fault fixed in 0.81.1: someone whose photo a manager took down used to find
their initials back with no explanation, and now sees who took it down, when,
and why.

Both removals go through the same database function,
`edunexus.remove_staff_photo(user, version, reason)` — your own passes `null` for
the reason, a manager's passes theirs. One writer, so the journal row is the same
shape either way.

### The alternative to a photo

An avatar is `initials`, `icon` or `photo`. There are 12 icons (`book`, `pencil`,
`globe`, `leaf`, `sun`, `star`, `music`, `flask`, `ball`, `heart`, `compass`,
`palette`) and 6 tones. Choosing `icon` without an icon is refused **beside the
icon field**:

```ts
.refine(v => v.avatar !== 'icon' || Boolean(v.avatar_icon),
        { path: ['avatar_icon'], message: 'Choose an icon to show.' })
```

Nobody has to put their face in a staffroom system.

## Preferences, and accessibility settings

Saved with the account, so they follow the person to any computer, and applied at
once on every screen. **Signing out puts the defaults back for the next person** —
a shared staffroom machine must not keep one person's settings for the next.

| Preference | Values |
|---|---|
| `landing` | the screen to start on |
| `text_size` | `standard`, `large`, `larger` |
| `theme` | `light`, `dark`, `system` |
| `motion` | `system`, `reduce` |

| Accessibility (0.86.0) | Values |
|---|---|
| `contrast` | `system`, `more` |
| `links` | `standard`, `underline` — always underlined |
| `focus` | `standard`, `strong` — a thicker keyboard outline |
| `targets` | `standard`, `large` — at least 44px |
| `spacing` | `standard`, `relaxed` — more line spacing |
| `typeface` | `standard`, `readable` — **Atkinson Hyperlegible Next**, drawn for low vision, bundled under the SIL Open Font License |

**Printed and on-screen paper forms are unchanged by any of them.** The `.paper`
rules keep the light tokens whichever theme is on, because a printed DepEd return
is a light document. That is why *a colour is always a token* outside `.paper`: a
literal white or black is invisible in one theme or the other.

`.refine(v => Object.keys(v).length > 1, 'Provide a change')` — a save carrying
only its version is refused, rather than writing a journal row that changed
nothing.

Before anyone signs in, the sign-in page follows the **device's** own theme,
contrast and motion, because there is no account yet to read a preference from.

## Sessions

```
GET  /api/v1/me/sessions           where your account has been signed in lately
POST /api/v1/me/sessions/end-others
```

`deviceLabel` turns a user-agent into something a person would recognise — *Edge
on Windows*, *Chrome on Android* — and it is **coarse on purpose**:

> The list of sessions exists so someone can tell their own devices apart and end
> one they don't recognise, and the full string identifies a machine more than
> that needs.

**Never an address.** No IP, no location, no geolocation lookup. The API records
what it saw of the browser and system and nothing more.

`sessionsEndOthers` **records** that the other sessions were ended, after the
sign-in service revoked them. EDUNEXUS is not the session authority; Supabase
Auth is. The ordering matters: the revocation happens at the service, and this
writes the journal row for it.

### Where a session lives

`sessionStorage`, dying with the tab — **unless** the person ticks *Keep me
signed in on this computer* on the sign-in page, which is the one sanctioned
exception (2026-11-03). One storage adapter in `web/api.ts` moves it to
`localStorage`. Three details:

- The choice is set **before** the sign-in call, because the session is written
  as that call returns.
- **Signing out forgets the choice**, so the next person at a staffroom computer
  starts with the box empty rather than inheriting someone else's.
- The box is pre-ticked only for someone who chose it on that computer before.

Interface preferences — the collapsed rail, the folded navigation groups — live
in browser storage too, under `edunexus-ui-*`, **wrapped in `try`/`catch`**,
because a private window throws on access.

### Passwords are the browser's business

`offerToSave` in `web/Account.tsx` tells the browser a password worked —
`navigator.credentials.store` in Chrome and Edge, the submitted form in Firefox
and Safari — so it offers to save it. **EDUNEXUS keeps nothing** (2026-10-28,
D1a). A new account's first password is filed under its email without the person
typing it, and a password changed on My profile updates the saved one.

### There is no two-step sign-in

Removed again on 2026-11-03, restoring the 2026-09-18 decision. **Sign-in is
email and password.** An authenticator had been reinstated somewhere between
0.43.0 and 0.86.1; whatever recorded that is in the lost part of `docs/`.

The **server enforcement was removed first, deliberately**: `src/core/auth.ts`
refused any token at `aal1` when the account had a verified factor, so deleting
only the UI would have **locked out every already-enrolled account** — no form
left to complete the second step, and a permanent 403.

Gone: `web/two-step.tsx`, `web/components/qr.tsx`, the `two-step` sign-in stage,
the *Turn on two-step sign-in* setting, the `TWO_STEP_REQUIRED` branch in the API
client, and the FAQ and guide entries. `SessionAuth` moved to `web/api.ts` and is
now just `signOut`.

Kept on purpose: the sessions list still reads `assurance`, because a factor
enrolled before today still raises a token to `aal2`, and "with a code" should
say what happened.

**`supabase/config.toml` was not touched.** `[auth.mfa.totp] enroll_enabled` is
still `true`. That file mirrors live so `supabase config diff` catches drift, and
editing it would manufacture false drift; `config push` is forbidden outright. If
the service should refuse enrolment, that is a dashboard change by the operator.

## Name and position corrections

```
POST /api/v1/me/name-requests              ask
POST /api/v1/me/name-requests/:id/withdraw withdraw your own open request
GET  /api/v1/name-requests?status=pending  manager
POST /api/v1/name-requests/:id/decide      manager — never your own
```

A request carries a `display_name` (to 150 characters), a `position` (to 120, or
null) and a `note`, which is a reason of 10–500 single-line characters —
`subjectReason`, the same shape every reason in the system takes.

Names go through `plainName` with `singleSpaced` applied by `.overwrite()`, so
double spaces are normalised rather than rejected. A twelve-digit LRN is not the
only thing transcribed from paper; a name is too.

States: `pending`, `approved`, `declined`, `withdrawn`. Approving writes the
correction **into the staff record**, which is why it is a manager's act and why
it is journalled with a reason.

## A person's own activity

```
GET /api/v1/me/activity?kind=changes|reads
```

Two views of the same account:

- `changes` — the mutations recorded under your name.
- `reads` — **the learner record reads logged under your name.**

That second one is the privacy audit, shown to the person it is about. The
operation summary records the constraint: it **names no learner.** Showing
someone the list of learners they looked at would be a fresh disclosure of those
learners every time they opened the screen — the same reasoning that keeps the
Overview and the command palette away from the registry.

Paged newest-first by a `before_id` cursor over an **identity column**, not a
uuid: a uuid cursor is not chronological, and the resulting bug only shows up
under a full test run. See [report-records.md](report-records.md) for the
order-by fault that bit two journals that got this part right and the SQL wrong.

## The screens

| | |
|---|---|
| `web/screens/Profile.tsx` | My profile |
| `web/Account.tsx` | Sign in, account setup, password change, `offerToSave` |
| `web/components/avatar.tsx` | `Avatar`, `PictureCanvas` |
| `web/photo.ts` | Framing and re-encoding in the browser |

*Learning EDUNEXUS* on My profile restarts any tour for the role and lists what's
new — see [help-and-tutorials-plan.md](help-and-tutorials-plan.md).

Two faults from the 0.81.1 test pass: a version conflict used to blame another
tab when it was in fact the principal who had changed the profile, and the
preferences' segmented switches stretched across the row. Both fixed. A
hard-coded white in those switches also hid their text in the dark theme, which
is the concrete reason behind *a colour is always a token*.

## What is deliberately absent

- **No image file for a photo.** Canvas, from bytes, through the API.
- **No metadata kept.** EXIF, GPS, device serial, XMP, ICC and embedded
  thumbnails are stripped by rebuilding the file.
- **No address, IP or location** in the sessions list.
- **No self-service name change.** A manager decides.
- **No deciding your own request.**
- **No two-step sign-in**, and no password kept by EDUNEXUS.
- **No learner named** in a person's own activity log.

## Where to look

| | |
|---|---|
| Contracts, limits, avatar sets, preferences | `src/modules/profiles/contracts.ts` |
| Service and the photo checks | `src/modules/profiles/service.ts` |
| The JPEG rebuild | `src/modules/profiles/jpeg.ts` |
| The device label | `src/modules/profiles/device.ts` |
| Error codes | `src/core/errors.ts`, range `P24xx` |
| Staff accounts and invitations | [staff-invitations.md](staff-invitations.md) |
