import type { Guide } from '../types';

/**
 * One guide per screen, in the rail's order. Written from the screens
 * themselves and from docs/guides/staff-guide.md; where the two differed, the
 * screen won. No guide says how a grade, an average or an attendance rate is
 * worked out, because nothing in EDUNEXUS works one out.
 */
export const guides: Guide[] = [
  {
    route: 'overview',
    summary: 'Where the school year stands: the year and term today falls in, the sections at each grade, how many learners are enrolled, who has access and the latest recorded change.',
    steps: [
      'The top bar names the school year that every record on screen belongs to. When it says *No active school year*, the principal or administrative officer activates one on {years}.',
      'Every figure here is counted from what is recorded. None is a grade, an average or an attendance rate.',
      '**Where the figures on the school forms come from** says, for each figure the SF2, SF4, SF9 and SF10 print, whether it is entered from the ECR, counted by the school’s attendance rule, or not computed at all.',
    ],
  },
  {
    route: 'settings',
    summary: 'How the workspace looks and behaves for you. Open it from your name at the top right, beside **My profile**. Everything here is yours alone: it changes nothing any other person sees, and nothing on a printed form.',
    steps: [
      'Under *Preferences*, choose the screen EDUNEXUS opens on, a larger text size, the spacing between rows, less motion, and a light or dark theme or the one your device uses. Each takes effect at once and follows you to any computer you sign in on; printed forms are unchanged.',
      'Under *Accessibility*, choose higher contrast (or your device’s own setting), links always underlined, a thicker outline around what the Tab key has reached, larger buttons and boxes, more line spacing, and Atkinson Hyperlegible, a typeface drawn for low vision. **Put these back** returns them all to the standard design.',
      'Under *Learning EDUNEXUS*, take any guided tour for your role again, and read what changed lately.',
      'Who you are, your picture, your password and where you are signed in are on {profile}, in the same menu. Ctrl+K reaches either screen by name.',
    ],
    refuses: [
      'If your settings were changed in another window, the save stops and the page reads them again, so nothing you chose there is overwritten unseen.',
    ],
  },
  {
    route: 'profile',
    summary: 'Your own page: how the school has you recorded, how you appear in the workspace, how you sign in and what you have done. Open it from your name at the top right. How the workspace looks and behaves — text size, theme, accessibility — is on {settings}, in the same menu.',
    steps: [
      'Your name, position and specialization print on the SF2, SF4 and SF9, so the principal or the administrative officer keeps them.',
      'Under *Your picture*, choose initials, an icon or your photo, and a colour, then **Save picture**. **Undo changes** puts back what was saved.',
      '**Upload a photo** (or **Change photo**) opens it on this computer first: drag it, or use the arrow keys, to frame your face in the circle, zoom in with the slider, and **Turn a quarter** if it is on its side. **Use this photo** saves it.',
      'Only the framed square is sent. Where and on what device the photo was taken is never kept. **Remove photo** deletes it for good.',
      'Your photo is seen by you, the principal and the administrative officer, never by other teachers. A manager may take down a photo that is not a suitable picture of you; you can upload another.',
      'If your name or position is wrong, **Ask for a correction** with a note saying why. The principal or the administrative officer decides; until then, **Withdraw the request** takes it back.',
      'Under *Your activity*, *Changes you made* lists what you recorded and *Records you were shown* each list or page of learner records you opened, from the same logs the principal reads.',
      '**Change password** asks for the one you use now first.',
      'Under *Where you are signed in*, each browser that opened EDUNEXUS lately is listed. **Sign out everywhere else** ends every session but this one, after a shared computer was left signed in or a phone was lost.',
      'To stop signing in each time on your own computer, tick **Keep me signed in on this computer** on the sign-in page. Leave it off on a shared staffroom computer; signing out ends it and forgets the choice.',
    ],
    refuses: [
      'A photo must be a picture at least 128 pixels on each side. A PDF, a document or a very small image is refused before anything is sent.',
      'If your profile was changed in another window, the save stops and the page reads it again, so nothing you did there is overwritten unseen.',
    ],
  },
  {
    route: 'help',
    summary: 'This guide: what each screen is for, the steps in order, and when a screen will stop you and why.',
    steps: [
      'Start with *Start here* for your role, then open the guide for the screen you are working on.',
      'Press **Ctrl K** on any screen to jump to another by typing its name.',
    ],
  },
  {
    route: 'public-site',
    summary: 'What the school’s front page shows. Nothing appears there until you publish it, and nothing about any learner ever does.',
    steps: [
      '**Write an announcement** saves a draft that only staff see. Choose *News*, *Event* (it needs a date) or *Advisory*, write a title and a one- or two-sentence summary, and the full notice if needed.',
      'Open a draft and choose **Publish on the front page** when it is ready. **Take it off the front page** returns it to a draft; **Archive** retires it for good. **Pin to the top** shows a notice first.',
      'Under **Questions for parents**, **Write a question** and its answer in the school’s own words, and publish it the same way. The front page’s Questions page, and its link in the menu, appear once one is published.',
      'Under **School details**, write the tagline, introduction, mission, vision, phone, e-mail, office hours and Facebook page. Whatever you leave empty, the page leaves out.',
      'The school’s name, ID and address come from {school}, and its holidays from the {calendar}.',
    ],
  },
  {
    route: 'school',
    for: 'manager',
    summary: 'The school’s name, six-digit school ID and address, printed on every official form, with the heading those forms carry and the history of every change to it.',
    steps: [
      'Check the name, the school ID and the address. Fill in the region, division, district, school head and position: every form prints them.',
      'The principal records the school’s attendance rule: under **Attendance rule for the school forms**, choose **Record the rule** and answer the two questions from the school’s own practice, saying where the school approved it.',
      'Until the rule is recorded, the SF2 and SF4 show what was marked but no totals or percentages. Changing it later leaves every form already issued as it was.',
    ],
    refuses: [
      'EDUNEXUS offers no default answer to the rule’s two questions, because the rule is the school’s and a guessed one would print wrong figures on real forms.',
    ],
  },
  {
    route: 'years',
    for: 'manager',
    summary: 'Each school year from draft to closed, the terms it is divided into, and its sections.',
    steps: [
      '**Add a school year** with its first and last day. It starts as a draft.',
      'Add its reporting periods below the years, each with its dates, or for 2026–2027 add DepEd’s three terms in one step. Periods can change only while the year is a draft.',
      '**Create sections** starts from the SF4’s layout, Kindergarten A–F and A–D for every grade. Change any list, review it, and create. Sections the year already has are skipped. **Add a section** adds one, with its adviser if you know them.',
      'Each section’s adviser is set on {staff}: open a teacher’s row and choose the sections they advise, or use **Assign advisers** there for every section in one table.',
      'When the periods are right, **Activate year**. Only one year is active at a time, and it is the one the top bar names.',
      '**Close year** at the very end, once its forms are issued. A closed year cannot be corrected through the ordinary screens.',
    ],
    refuses: [
      'A year’s periods cannot change once it is active, because report cards and forms are filed under them.',
    ],
  },
  {
    route: 'learners',
    for: 'manager',
    summary: 'One permanent record per learner, carried from year to year, with each learner’s SF9 and SF10.',
    steps: [
      '**Register a learner** with their name, sex, birth date and twelve-digit LRN. Every new learner needs an LRN; an older record without one reads *LRN missing* until it is completed with **Assign LRN**.',
      'Search by name or LRN, or filter by sex, by **Grade level this year** or by **Class**; the last two apply as soon as they are chosen. Names are found in any order and without their accents, so *juan dela cruz*, *Dela Cruz, Juan* and *Pena* for Peña all work; an LRN may be typed with spaces or dashes. Opening a list of learners is written to the {access}, so search for who you need rather than paging through everyone.',
      'Before registering, EDUNEXUS looks for a learner with the same surname and birth date. If one is on file it says so beside the name: open them from the search instead, or press **Register learner** again if this is a different child.',
      'On a learner’s row, **SF9** opens that year’s report card and **SF10** every year EDUNEXUS holds.',
      'Opening a learner shows who they are at the top — name, LRN, and grade and class this year — then two parts. **Learner profile** holds their personal information, address and parent or guardian, which is everything EDUNEXUS holds about a child. **Enrollment** is where they are this year and every year they have been enrolled. The school years from before EDUNEXUS are on {prior-records}.',
      '**Edit profile** fixes a spelling, a birth date, an extension or the address. There is one record per learner, so what you save there is what the registry, the class list, the register and the forms show from then on — it never makes a second learner.',
      'Open a learner, then **Enrollment** and **School years**, and **View the year** for their attendance month by month. **Print this year** prints it for a parent conference.',
      'If two records are the same child, **This is the same child as another record** links them after a review. Nothing is merged automatically. The extra entry is kept as a *duplicate entry*, hidden from the list unless you tick **Show duplicate entries**.',
    ],
    refuses: [
      'A learner without a twelve-digit LRN is refused. EDUNEXUS never invents an LRN.',
    ],
  },
  {
    route: 'learners',
    for: 'teacher',
    summary: 'The learners you currently advise, with their SF9 and SF10.',
    steps: [
      'You see your own learners only. A learner who moves out of your section leaves your list.',
      '**Add learner** builds your class from the learners the office has already registered. Choose the class, and the learners registered for your grade with no class yet are listed; tick the ones who are yours and take them in.',
      'Each class under **My class** names its school year, because you may advise one in more than one. A class is built only once the principal has activated that year and it has begun — until then the sheet says so and offers nothing, since a learner is taken into a class from a day that has come.',
      'An empty list in a year that has just started usually means nobody has been registered into it yet, not that your class is full: the office carries last year’s learners over on **Next year’s classes** first.',
      'Taking a learner in never makes a second record for them — it is the record the office already holds, given your class. A learner already in somebody else’s class is not offered: a principal or administrative officer moves a learner between classes.',
      'The search there also finds a learner with no enrolment this school year, such as one returning to the school, so they need not be keyed in again.',
      'A child the school has never held a record for goes on a list for the office to approve, like any other: use **Add learner** on {imports}, which puts them on a list of one. An adviser no longer adds a learner straight to the registry — creating a learner record is the office’s.',
      'On a learner’s row, **SF9** opens this year’s report card and **SF10** their record across the years.',
      'Opening a learner shows who they are at the top, then two parts: **Learner profile**, their details; and **Enrollment**, where they are this year and every year they have been enrolled. The school years from before EDUNEXUS are on {prior-records}.',
      'If you advise more than one class, **Class** shows one of them at a time.',
      'Open a learner, then **Enrollment** and **School years**, and **View the year** for their attendance month by month. **Print this year** prints it for a parent conference.',
      'Only the principal and the administrative officer change a learner’s details, so the profile shows them to you and offers nothing to edit. If something is wrong, tell the office what it says and what it should say.',
    ],
    refuses: [
      'A learner already in a class cannot be taken into yours. Ask the office to move them.',
      'A learner registered at another grade cannot be taken in: the class’s grade is the grade they are enrolled at.',
      'Registering is refused when a learner with the same name and birth date is already on the registry, so one child keeps one record. Take that learner in instead, or ask the office if it is a different child with the same name.',
      'You can register a learner only into a class you advise, and only while its school year is open.',
    ],
  },
  {
    route: 'enrollment',
    summary: 'Putting a learner in a section for a school year, and every movement after: transfer, withdrawal and re-entry.',
    steps: [
      'Class lists advisers have submitted wait in **Class lists from advisers**, at the top. **Review** one to read every row exactly as the adviser sent it, then **Approve and import** — that one action creates the learner records, enrols them into the adviser’s class, and tells the adviser their list went in.',
      'The number beside Admissions in the sidebar is how many lists are waiting, so you can see one has arrived from any screen. Promotion and Staff access carry the same kind of number for endorsed outcomes and name corrections waiting on you.',
      'A list is a file until you approve it: nothing of it is on the registry, and nothing of it counts on any form, so a list left waiting is learners the school does not yet hold.',
      '**Decline** a list instead, with a reason the adviser reads, and they correct it and send it again.',
      'Open an enrolment to record a movement. Each movement is a dated event with its reason, and the SF2 and SF4 count from it.',
      'A wrong date or section is fixed with **Correct the timeline**, and a wrong grade with **Correct the grade**. Both show the record before and after and keep what was first recorded.',
    ],
    refuses: [
      'A movement cannot be dated in the future or outside the school year.',
      'A voided enrolment is read only until it is restored.',
      'Approving writes the whole list or none of it, so a class never goes in half done.',
      'A row that may be a learner already on file stops the approval and writes nothing. EDUNEXUS never guesses which learner a row means: the row is pointed at the right record on **Roster import**, or the list is declined and sent again.',
    ],
  },
  {
    route: 'imports',
    for: 'manager',
    summary: 'Bringing in a whole class list, reviewing the lists advisers submit, and enlisting one late learner.',
    steps: [
      'Lists advisers have submitted wait at the top. Open one, preview and confirm the import, and the adviser’s list is marked imported.',
      'To import a list yourself, **Download the template (Excel)**, fill it in, and upload it. The file names every column, says which are required and shows a worked row on its second sheet. **Template as CSV** is the same columns for anyone who prefers one.',
      'Fill the **grade_level** column and one file can register several year groups at once — 0 for Kindergarten, then 1 to 6. A row that leaves it empty uses the **Enrol at grade** chosen here, and a row with neither is refused on its own line. Every import registers its learners with *no class yet*; each adviser then takes in the ones who are theirs.',
      'With no class yet, the learners are enrolled for the year and count on the totals but belong to no section. Give them a class afterwards on {enrollment}, which changes the enrolment they already have rather than adding another. Import the registry list *or* the class lists, not both.',
      'One file holds up to 50 learners, so a class list is one file and a whole grade is several. Each row is checked and shown before anything is written.',
      'Fill the **address** column where the school has one recorded; leave it empty where it has none, and the learner is registered without one. A class list saved from the earlier template, which had no address column, still imports.',
      '**Enlist one late learner** finds a record already on file or creates one, and enrols them in one step. Registering a single child on {learners} is the other way, and is unchanged.',
    ],
    refuses: [
      'The whole import is refused if any row is wrong, so a class list never goes in half done.',
      'A preview expires, and an import that differs from the preview you reviewed is refused: preview again.',
      'An import never overwrites a learner already on file. Correct their details on {learners} instead.',
      'A learner who already has an enrolment this year cannot be enrolled again, so the same child cannot land on the registry list and on a class list.',
      'An adviser’s submitted list is a class list, so it is always imported into their section.',
    ],
  },
  {
    route: 'imports',
    for: 'teacher',
    summary: 'Submitting your class list for the office to approve. You prepare it; the principal or administrative officer approves it on Enrollment, and only then are the learners on the registry.',
    steps: [
      'Choose your section, the first day in it and how the learners join. **Download the template**, fill it in, and upload or paste it. The Excel file names every column on its second sheet and shows a worked row.',
      'Every learner carries their own grade level — chosen on **Add learner**, or filled into the grade_level column of the template — so one list can hold several grades and there is nothing to choose for the list as a whole. A row with no grade is named on its own line when you check the list. Its learners are registered at their grade with *no class yet*, and the advisers of that grade — you included — then take in the ones who are theirs from **Add learner** on {learners}.',
      'Until the office approves it, none of these learners is on the registry and none counts on any form. A list left waiting is learners the school does not yet hold.',
      '**Check the list** shows any problem beside its row. Fix them and check again, then give a reason and submit.',
      'Until it is imported, the list shows as *Waiting for review*, and you may **Withdraw** it. You can send another list without withdrawing this one — several may wait at once.',
      'A learner who arrives later needs no file: **Add learner** puts them on your list as one more row, with their own grade level if it differs from the rest.',
      'Took in the wrong learner? Open them on {learners}, go to **Enrollment**, and **Take out of this class**. They stay on the registry and stay enrolled at their grade — only the class is given back, so any adviser of that grade can take them in. Their marks and history are untouched.',
    ],
  },
  {
    route: 'prior-records',
    summary: 'Typing in the school years a learner finished before EDUNEXUS, so their SF10 is one complete record rather than one that starts the day the school began using it. Done once per learner, for every learner from Kindergarten to Grade 6.',
    steps: [
      'A principal or administrative officer sees **Across the school** at the top: for every class, how many of its learners have a previous school year or the Grade 1 credential typed in, how many have neither, and who the adviser is. It is how the office sees which classes still have work without opening anybody’s record.',
      'That view counts only — it names no learner and records no access to anyone’s records — so it can be checked as often as it is useful. A class reading *Not started* has no learner with any encoded history yet.',
      'Learners registered at a grade with no class yet are counted on their own below the classes, because every other count there is by class. They are somebody’s work too.',
      'Search for the learner by **Name or LRN** and **Open the history**. The history belongs to the learner, not to a class, so it starts from the learner.',
      'Under *School years*, every year on their SF10 is listed in order. A year marked *Recorded in EDUNEXUS* is one EDUNEXUS holds itself: its grades are entered on {report-cards}, not here. Only a year marked *Copied from a document* is typed here.',
      '**Add a school year** for the earliest year the school still holds a document for, then work forwards. Give the year it began, the grade, and the school that taught it — this school, or the previous school for a learner who transferred in.',
      'Fill the learning areas as the document lists them. *List the Grade 4 learning areas* — with whichever grade is chosen — offers the areas this school’s own report cards print; check them against the document in front of you and change whatever differs.',
      'Copy each quarter, the final rating and the remark exactly as the document carries them. A quarter the document does not carry is left empty: EDUNEXUS never reads an empty box as a zero.',
      'The **General average** is the one already written on the document. EDUNEXUS computes no average, here or anywhere.',
      'Say in **Document this was copied from** which spreadsheet, form or photocopy the year was read out of, so the transcription can be checked against it later.',
      'Under *Eligibility for Grade 1*, record the credential the learner presented when they entered Grade 1 — the Kinder progress report, the ECCD checklist, the Kindergarten certificate, a PEPT rating or another — and the school that issued it. *This is where a Kindergarten record goes*: the SF10 has no grades box for Kinder, and EDUNEXUS records no Kindergarten grade.',
      'A learner still in Kindergarten has nothing to encode and no SF10 yet, and the screen says so. Their records are the SF5-K and the ECCD checklist, which the school keeps. Record the credential once they are enrolled in Grade 1.',
      'The result is one SF10, with the typed years and the recorded years in a single series. From then on EDUNEXUS adds each new year itself, and no year is ever typed in twice.',
      '**Correct** reopens a typed year against its document. **Remove** takes a year off the record; what it said is kept in the journal.',
    ],
    refuses: [
      'A school year EDUNEXUS already holds is refused rather than printed twice. Its grades are entered on {report-cards}.',
      'A school year already typed in is refused. Open that year and correct it instead of adding it again.',
      'Kindergarten is refused as a year with grades, because the SF10 has no grades box for it. Record it under *Eligibility for Grade 1*. Never enter a Kindergarten year’s marks as Grade 1 grades: they are not the same record.',
      'A learner whose only school year is Kindergarten has no SF10 at all, and the registry says *SF10 begins at Grade 1* in place of the button. The SF10 starts when they enter Grade 1.',
      'The same learning area twice in one year is refused, however it was capitalised.',
      'A grade outside 0 to 100, or with a third decimal place, is refused rather than rounded — exactly as grade entry refuses it.',
      'An adviser encodes only the learners currently in the sections they advise. A principal or administrative officer encodes for anyone.',
      'Nothing typed here changes a learner’s current grade, section or register. A typed year is a copy of a document, not an enrolment, and it reaches no SF2, SF4 or SF9.',
    ],
  },
  {
    route: 'next-year',
    summary: 'Carrying this year’s learners into next year’s grades from their approved outcomes; classes are assigned afterwards.',
    steps: [
      'First approve every outcome on {report-cards}, and create next year on {years}. The three steps at the top say where you are.',
      'Each grade next year has a card with how many move into it, boys and girls. Press a card to see only that grade’s learners; press it again for every grade.',
      'Below, the learners are grouped by the grade they move to. Promoted learners go up a grade and retained learners stay. Under *Not carried forward*, Grade 6 completers, learners who left, and anyone waiting on an approved outcome are grouped by why.',
      'Nobody is given a class here. Each learner is enrolled at their next grade with no section, and sits in the registry that way until a class is assigned — which is a change to that enrolment, not a second one.',
      '**Print the list** to check, then **Enrol** them with a reason. Everyone is enrolled at once, or nobody is. Do it outside register hours.',
    ],
    refuses: [
      'A learner with no approved outcome is not placed, because EDUNEXUS never decides an outcome from grades.',
      'No class size is enforced or suggested: the school has set no capacity.',
    ],
  },
  {
    route: 'calendar',
    for: 'manager',
    summary: 'Which days hold classes, how each session runs, and the school’s attendance rule. Attendance can be taken only on a configured day.',
    steps: [
      '**Fill a date range** sets a whole stretch at once. Say how Monday to Friday runs and what Saturday and Sunday are, then type each holiday on its own line, date first, from the school’s approved calendar.',
      'Review the counts, then set the dates. Pick single dates in the month view to change them one at a time.',
      'A date you leave out stays *Not configured*. It is not a school day, a holiday or an absence, and no attendance can be taken on it.',
      'Below the calendar, **Record the rule** sets the school’s attendance rule: how a learner present for one session and absent for the other is counted, and whether a date with only one classroom session is a day of classes. Only the principal records it. Every attendance figure on the SF2, SF4 and report card is counted by it, and until it is recorded they show the marks but no totals.',
    ],
    refuses: [
      'EDUNEXUS adds no holiday, weekend or suspension by itself. The school’s approved calendar is the only source.',
      'A holiday or suspension over a date whose register is already marked is stopped at the review, which names the date and the section. Clear those marks through the section’s register first.',
    ],
  },
  {
    route: 'calendar',
    for: 'teacher',
    summary: 'Which days hold classes for your section. You can take attendance only on a configured day.',
    steps: [
      'If a class day is shown as *Not configured*, tell the principal or the administrative officer: they set the calendar.',
    ],
  },
  {
    route: 'attendance',
    summary: 'Your section’s morning and afternoon register, and the month’s SF2 it makes.',
    steps: [
      'The register opens on your section and today, or your last class day. Each learner has a morning and an afternoon mark: present, absent or not marked.',
      'Mark as you go. When most of the class is in, mark the absences first, then **Mark every learner not yet marked present** for the morning, the afternoon or both.',
      'Or type the register. On a learner’s morning or afternoon, press *x* for absent all day, *p* for present all day, *m* for absent in the morning only or *a* for absent in the afternoon only. Each letter marks the whole day and moves to the next learner, so a class can be taken without the mouse. They are the same letters the SF2 takes.',
      'Press **Review these marks**, read the review, and **Confirm this review**. Nothing is saved until you confirm.',
      'Marks not yet confirmed are kept until you leave them. Moving to another day or section asks first, and so does closing or refreshing the page.',
      'If the same date was recorded meanwhile, from your phone or by someone else, EDUNEXUS reads the register again with those marks, keeps yours, and asks you to review once more.',
      'Switch to **School Form 2 (the month)** under the page title to see the month as the SF2 prints it, edit it on the form, and issue it.',
      '**Class list**, **SF2 (Excel)** and **Raw marks (Excel)** save spreadsheets of your section.',
    ],
    refuses: [
      'A date the school has not configured as a class day cannot be marked.',
      'If another adviser or the office saved first, you are told the record changed. Read it again and redo your change; nothing is overwritten.',
      'A submitted or locked month cannot change until it is returned to you.',
    ],
  },
  {
    route: 'attendance-today',
    summary: 'Every section’s register for one day, in counts: taken, not taken, or no class.',
    steps: [
      'Move between days with **Previous day** and **Next day**. A section shows *Not taken* until its adviser confirms a register for that day.',
      'It names no learner, so opening it writes nothing to the privacy access log.',
      '**Print this day** prints the list.',
    ],
  },
  {
    route: 'months',
    summary: 'Reviewing a section’s month once it has ended, then submitting and locking it.',
    steps: [
      'Choose the section and the month. The month is ready when it has ended and every class day is marked.',
      '**Submit this month** after reviewing it. After the principal’s check, **Lock this month**. A locked month cannot change.',
      'If a correction is needed, **Reopen this month** with a reason; the adviser can then correct the register.',
    ],
    refuses: [
      'A month with an unmarked session cannot be submitted, because an unmarked session is unknown, not present.',
    ],
  },
  {
    route: 'monitor',
    summary: 'Recorded absences and gaps in recording, over a window of dates you choose.',
    steps: [
      'Choose the section and **Adjust the window** to the dates you want to look at.',
      'Each learner shows the sessions recorded absent and the sessions nobody marked, which are kept apart: a gap is not an absence.',
    ],
    refuses: [
      'It raises no alert and names no threshold, because the school has no approved rule for when absences need action.',
    ],
  },
  {
    route: 'followups',
    summary: 'Cases opened by hand for learners whose absences or gaps in recording need following up.',
    steps: [
      '**Open a case** for a learner, with a reason, an owner and a due date if there is one.',
      'Open a case to **Update or add a note**, hand it to another manager, or change its due date. **Resolve** it when the follow-up is done.',
      'Resolving a case records a decision about the case. It does not correct or change any attendance mark.',
    ],
    refuses: [
      'EDUNEXUS opens no case by itself and sends no reminder or message: whether a pattern needs following up is the manager’s decision.',
    ],
  },
  {
    route: 'subjects',
    for: 'manager',
    summary: 'The school’s subject catalog, and what each section is taught, in the order its report card prints them.',
    steps: [
      '**Add from the report cards** lists the learning areas printed on the school’s Grades 1 to 6 cards. Untick anything the school has not agreed, and add them. The change history records what was added, by whom and when, so no reason is asked for.',
      'Choose a section and **Offer the report-card set** to offer its grade’s card in printed order. In Grade 6, EPP and TLE start unticked: choose the one the section takes.',
      'A subject can also be added or offered one at a time with **Add a subject** and **Offer this subject**.',
    ],
  },
  {
    route: 'subjects',
    for: 'teacher',
    summary: 'The subjects your section is taught, as the principal and administrative officer offered them.',
    steps: ['If a learning area your card needs is missing, tell the principal or the administrative officer.'],
  },
  {
    route: 'report-cards',
    for: 'teacher',
    summary: 'Your section’s report-card entries, copied from the DepEd class record (ECR), and each learner’s end-of-year outcome.',
    steps: [
      'Choose your section. On **Report card**, open each learner’s card and type their term grades, subject averages and remarks exactly as the ECR shows them. **Review**, check each change, and record the card.',
      'Record the **General average**, the **Observed values** of each term on Grades 4 to 6, and your **Comments** on Grades 2 and 3. A Grade 1 section records each term’s **Narratives** instead of numeric grades. Each section is offered only what its card prints, so nothing you record goes unprinted.',
      'Moving to another learner, term, tab or section with boxes not yet recorded asks first. If someone recorded the same boxes meanwhile, the table is read again and what you typed is kept: review it once more.',
      '**Report card** shows one learner’s card as it prints: type into any box and review. The whole card is recorded together, or nothing is.',
      '**Class summary** lays the section’s entries side by side, to check against the ECR.',
      'At the end of the year, endorse each learner’s outcome on **Promotion**, as the school decided it. The principal or administrative officer approves it or returns it to you.',
    ],
    refuses: [
      'EDUNEXUS does not compute or round a grade. A grade with three decimal places is refused: copy it as the ECR displays it.',
      'EDUNEXUS does not decide an outcome. The general average and failed learning areas you entered are shown beside each learner only to check against.',
    ],
  },
  {
    route: 'report-cards',
    for: 'manager',
    summary: 'Every section’s report-card entries, and approving the outcomes advisers endorse.',
    steps: [
      'Choose a section to read what its adviser has entered, under the same tabs the adviser uses.',
      'On **Promotion**, **Approve or return endorsements**: **Approve** each outcome after checking the promotion report, or **Return to the adviser** with a reason.',
      'Endorsements also wait for you on the {overview} under *End-of-year outcomes*: **Review and approve** opens that section here with its approval ready. Once every learner going into a grade next year has an approved outcome, the Overview offers to prepare that grade’s classes, still as a draw you check before anyone is enrolled.',
      'Only an approved outcome prints on the SF9 and SF10, and only approved outcomes place learners in {next-year}.',
      '**Print the section’s SF9s** prints a whole section’s cards: **Print as they stand** to check them, or **Issue and print** to record them as issued.',
    ],
    refuses: [
      'EDUNEXUS computes no grade or general average and suggests no outcome. Every figure was entered from the ECR.',
    ],
  },
  {
    route: 'grade-entry',
    summary: 'How far each section’s report cards have come: grades, general averages and outcomes recorded, as counts.',
    steps: [
      'Each section shows how many grades its adviser has recorded for each term, how many final grades and general averages, and how many outcomes are approved.',
      'Open a section to see which learning area is behind. It counts only; it shows no grade.',
    ],
  },
  {
    route: 'sf2',
    summary: 'A section’s month on the School Form 2, counted from its register by the school’s attendance rule.',
    steps: [
      'Choose the section and the month. A session nobody marked shows **?** and keeps the totals empty until it is marked.',
      'During the month, the SF2 counts to date and says to which date. It is issued only once the month is over.',
      'While the month is not submitted, correct it on the form itself: click a day to go round present, absent all day, absent in the morning and absent in the afternoon, or type **x**, **p**, **m** or **a** on it. Arrow keys move between days. Changed cells are outlined, and **Review and record** records them in the register with your reason.',
      '**Issue this SF2** records it with an issue number, and prints it for the adviser and the school head to sign. **Excel file** saves it.',
      'A correction after issue means issuing again with a reason.',
    ],
    refuses: [
      'With no attendance rule recorded on {calendar}, the SF2 shows the marks but no totals.',
      'A submitted or locked month is read only. The principal returns or reopens it on {months} before it can be corrected.',
      'Days still to come, and days with no classes, cannot be marked.',
    ],
  },
  {
    route: 'sf4',
    summary: 'The school’s month on the School Form 4, from every section’s register.',
    steps: [
      'Choose the month. The SF4 shows learners registered and their movements by sex, and the attendance figures counted by the school’s rule.',
      'Once every section’s month is submitted and every day is marked, **Issue this SF4**: it is recorded and printed with its issue number. **Excel file** saves it.',
      '**Edit school details** and **Edit positions** correct the heading and the advisers’ positions where the form prints them.',
    ],
    refuses: [
      'The averages and percentages wait on the school’s attendance rule. EDUNEXUS does not estimate them.',
    ],
  },
  {
    route: 'staff',
    summary: 'Who can use EDUNEXUS, and at what permission level.',
    steps: [
      'Each person is a principal, an administrative officer or a teacher. A teacher sees only the sections they advise.',
      'Give each adviser their position and specialization: the SF4 prints them.',
      'Setting someone’s access to *Suspended* blocks them at once and deletes nothing they recorded.',
      '**Grant access** links an account that already exists, for example one the operator made by hand.',
      'Under *Corrections asked for*, staff ask for their name or position to be corrected. **Approve** changes their record, and every form printed from then on, with your reason; **Decline** leaves it and tells them why. Nobody decides their own, and only the principal decides an administrative officer’s.',
      'Opening a person’s row shows their photo, if they uploaded one. **Take down photo** deletes one that is not a suitable picture of them, with a reason.',
      'Opening a teacher’s row shows the sections of the active year, or of the year being set up. Tick the ones they advise and **Save sections**. A section that has another adviser says so, and moving it asks first: the other adviser stops seeing that class at once.',
      '**Assign advisers** puts every section in one table instead. The number beside a name is how many sections that teacher would hold.',
      'While next year is being set up beside this one, **Advisers for** chooses whose sections both of these show: this year’s, or next year’s.',
      'An adviser sees only the sections they currently advise, so this decides what each teacher can open.',
    ],
  },
  {
    route: 'invitations',
    summary: 'Asking for a staff account, and linking it to EDUNEXUS once it exists.',
    steps: [
      '**Request an invitation** for one person, or **Request from a list** to paste a staff list: one person per line, with name, email and role if not *teacher*.',
      'No email is sent by a request. Open each request and choose **Create the account**, which sends that one person their email.',
    ],
    refuses: [
      'Accounts are created one at a time because the mail service is rate limited.',
    ],
  },
  {
    route: 'activity',
    summary: 'Every change EDUNEXUS has recorded: what changed, who changed it, when and why. Nothing in it can be edited or deleted.',
    steps: [
      'Filter by staff member or record to find a change. Each entry keeps the record as it was before and after.',
    ],
  },
  {
    route: 'access',
    summary: 'Who was shown which learner records, and when. It holds record IDs only, never a name or a search term.',
    steps: [
      'Filter by staff member to see what one person opened, or by record to see who opened one learner’s file.',
      'From a learner in the {learners}, **Who has opened this record** opens this log for that learner.',
    ],
  },
];
