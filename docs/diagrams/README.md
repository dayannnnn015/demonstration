# Diagram figures

**For the capstone's Figures 7, 8 and 9, use [the paper-ready redraws](paper/README.md), verified on 28 September 2026 against migrations through 0024.** These provide readable portrait layouts, corrected optionality/history cardinalities, 600-dpi PNGs, editable SVGs and a captioned PDF. The older process renders below are retained as legacy artwork and should not be inserted into the paper. Their filenames `06`, `07` and `08` are asset numbers, not the manuscript's figure numbers.

Rendered from the Mermaid sources in [../erd.md](../erd.md), which are generated from the live `edunexus` schema. Regenerate these whenever a migration changes the schema, so a figure in the paper never disagrees with the database.

Each diagram exists twice. Use the **SVG** in anything that accepts it — it stays sharp at any size and prints cleanly. Use the **PNG** where SVG is awkward, such as some Word and Google Docs workflows; they are rendered at double resolution so they hold up in print.

The general view comes in two parts, and the middle six are cut by implementation domain and meant to be read as a set. The last three are cut by the school processes the manuscript names. The general parts and the process views are each standalone: they repeat the upstream entities they need, so one figure can carry a section of the paper on its own. They describe the same tables, not a second database.

| File | Figure | Shows |
|---|---|---|
| `general-erd-1-records` | **Entity relationship diagram (1 of 2)** | School, staff, years and sections; learners and annual enrollment; the instructional calendar and everything recorded against it — 13 entities |
| `general-erd-2-academics` | **Entity relationship diagram (2 of 2)** | Subjects and offerings, the assessment policy chain, tasks and raw marks — 11 entities, four of them repeated from part 1 |
| `00-overview` | Domain map | How the five domains depend on each other, and which feed which official form |
| `01-foundation-and-people` | Foundation and people | School profile, staff, invitations, school years, reporting periods, sections |
| `02-learner-registry-and-enrollment` | Learner registry | Learners, annual enrollment, movement history, identity links |
| `03-reviewed-corrections` | Reviewed corrections | Roster import, LRN, timeline, record void, grade placement |
| `04-calendar-and-attendance` | Calendar and attendance | Instructional days, daily marks, monthly consolidation, follow-up |
| `05-academics` | Academics | Subjects, offerings, the assessment policy chain, raw scores |
| `06-class-preparation` | **Class preparation** | Process view: the school year, its sections and advisers, and how learners are placed into classes |
| `07-attendance-record` | **Attendance record** | Process view: the instructional calendar, daily AM/PM marks, monthly consolidation and follow-up |
| `08-academic-record` | **Academic record** | Process view: subjects and offerings, the assessment policy chain, tasks and raw scores |

## Suggested captions

Wording you can lift directly, each stating what the figure is evidence of rather than repeating its title.

- **General ERD (1 of 2), records.** *Entity relationship diagram of EDUNEXUS, part 1. Attendance attaches to the annual enrollment rather than to the learner, so a child carries several years of records without any year being rewritten. Change journals, audit logs and the rate limiter are omitted for legibility.*
- **General ERD (2 of 2), academics.** *Entity relationship diagram of EDUNEXUS, part 2. Raw marks attach to the same annual enrollment as attendance, and an adoption freezes the draft revision it was made from. The school year, its sections and reporting periods are repeated from part 1 so this figure stands on its own.*
- **Overview.** *Domain dependencies in EDUNEXUS. Attendance and academic records both attach to an annual enrollment, and corrections sit beside the registry rather than inside it.*
- **Foundation and people.** *Foundation entities. A composite key on sections carries the school year and grade level into every record that references a section.*
- **Learner registry.** *One permanent learner record per child, with annual enrollment beneath it. A partial unique index permits one valid enrollment per learner per school year.*
- **Reviewed corrections.** *Correction entities. Original movement records are never rewritten; the effective timeline is the latest correction snapshot plus any later movements.*
- **Calendar and attendance.** *Attendance entities. An unconfigured date is not a school day and an unmarked session is not a presence; both remain unknown by design.*
- **Academics.** *The assessment chain. An adoption freezes the draft revision it was made from, so later revisions never change what the school adopted.*
- **Class preparation.** *Entities behind class preparation. A section carries its school year and grade into every record that references it, so a learner cannot be placed into a section from another year or grade.*
- **Attendance record.** *Entities behind attendance recording and consolidation. An unconfigured date is not a school day and an unmarked session is not a presence; both stay unknown rather than being inferred.*
- **Academic record.** *Entities behind academic records. Raw marks are stored against the annual enrollment, and no total, average, MPS or GWA is derived from them anywhere in the schema.*

## Regenerating

There is no npm script, because this needs a browser and runs rarely. Regenerate the Mermaid in `../erd.md` from the database first; never edit these files by hand.

The recipe, written down because the first pass was not reproducible and the figures drifted from the schema:

1. `npm install mermaid --no-save` if it is absent, and use a Playwright Chromium.
2. Extract every fenced `mermaid` block from `../erd.md`, in document order. There are eleven, and they map onto the table above in that order. `erd.md` has CRLF endings, so match `` ```mermaid
?
 `` and normalize the captured block before rendering.
3. Render each with `mermaid.render(id, code)`, where `id` is the figure's numeric prefix (`m0`…`m8`). Both general parts also use `m0`, each in its own file; the id only affects element ids inside that file.
4. Initialize with `theme: 'base'` and these `themeVariables`. They are the pine and paper values the interface used up to 0.25.1; the workspace was redesigned in 0.26.0 and its tokens no longer match. Keep these values anyway unless you are regenerating **all** the figures at once, because the ten have to agree with each other before they agree with the app: `fontFamily: 'Source Sans 3,system-ui,sans-serif'`, `fontSize: '15px'`, `primaryColor: '#eef5f1'`, `primaryBorderColor: '#1b5643'`, `primaryTextColor: '#16231f'`, `textColor: '#16231f'`, `lineColor: '#5d6d67'`, `mainBkg: '#eef5f1'`, `background: '#f5f6f4'`, and both `attributeBackgroundColorOdd` and `attributeBackgroundColorEven` set to `#eef5f1`.
5. Write the returned `svg` string out unchanged. It keeps `width="100%"`, which is what makes it scale in a document.
6. For the PNG, put that same markup in a white container with 16px of padding, set the `svg` element's `width` and `height` from its `viewBox` and clear its `max-width`, then screenshot the container in a context with `deviceScaleFactor: 2`.

The three process views are portrait because of what their note column carries, not because of any layout setting. That fourth column — enum values and constraints beside an attribute — is what makes a figure wide, since Mermaid never wraps it. Each view was handled on its own evidence:

- **06 class preparation** dropped notes on `STAFF`, `ACADEMIC_YEARS` and `REPORTING_PERIODS` only. Those three are repeated for context and are documented in figures 01 and 02; the five entities the process is actually about keep every note. 1910 x 1845 became 1791 x 1865.
- **07 attendance record** dropped all of them, because its longest notes are on its own core entities and nothing short of removing them reaches portrait: dropping only the context notes leaves it at 1.41, capping every note at 34 characters leaves it at 1.40, and a two-way split is worse still — the calendar half reaches 0.99 but the consolidation half stays landscape at 1.31. 2624 x 1618 became 1524 x 1618. The values it no longer prints are written out in the prose under that figure in `../erd.md`, so the document keeps them.
- **08 academic record** was already portrait at 1612 x 2029 and is unchanged.

Each process view stays a single standalone figure. Do not split one to save width.

The general view is two figures rather than one because Mermaid's ER renderer gives no control over layout. All twenty entities in a single diagram come out 2188 x 1881 — almost square, because the entity boxes are wider than they are tall and six of them are roots with no parent — and a near-square figure has to be shrunk to illegibility to fit a portrait page. `layoutDirection`, `nodeSpacing`, `rankSpacing` and `minEntityWidth` are all accepted by the config and then ignored (in Mermaid 11 and 12 alike); a `direction LR` statement does work but makes it wider still, at 2412 x 2035; dropping the attribute blocks makes it wider again, at 1999 x 1076; and the ELK layout engine is not wired to ER diagrams. Reducing type and padding shrinks both axes together and leaves the shape alone. Splitting was the only thing that produced portrait figures: 1252 x 1349 and 1047 x 1943. Do not spend another session rediscovering this.

Step 6 is the part that changed. The earlier figures were screenshotted inside a fixed-width box, so a wide diagram such as `04-calendar-and-attendance` was scaled **down** from its natural 2547px to 1600px — the opposite of the double resolution this file claimed. Rendering at natural size first means every figure is genuinely 2×, at the cost of larger files.
