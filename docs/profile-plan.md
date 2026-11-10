# The profile plan — superseded

**This was a plan, and the thing it planned is built.** It is kept as a stub
because [the changelog](../CHANGELOG.md) links to it from the 0.81.1 entry, and a
link that resolves to an explanation is better than a dead one.

The plan covered My profile, avatars and photos, sessions, preferences and name
corrections, together with the test pass of 0.81.1 that walked every feature as
staff use it, mistakes included, under the production content policy at both
widths.

All of it shipped across 0.78.0–0.86.0. The original document was lost with the
rest of `docs/` in the 0.86.1 recovery and exists in no branch and no commit.
There is nothing left to plan, so it has not been reconstructed as a plan.

**What is built, and why each part is the way it is, is written up in
[staff profiles](staff-profiles.md)** — including the parts a plan would not have
recorded: why a photo is drawn on a canvas rather than loaded as an image, what
`checkJpeg` strips and what each of its refusals is for, why the device label is
deliberately coarse, and why a person cannot change their own name.

The 0.81.1 pass itself found three faults, all fixed and all recorded in
[staff profiles](staff-profiles.md): a person whose photo a manager took down
found their initials with no explanation; a version conflict blamed another tab
when the principal had changed the profile; and the preferences' segmented
switches stretched across the row, with a hard-coded white that hid their text in
the dark theme.

That last one is the concrete origin of a standing frontend rule — **a colour is
always a token** outside `.paper` — so it is worth keeping even though the bug is
gone.
