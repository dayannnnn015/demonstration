/**
 * What changed for staff, newest first, in their words rather than the
 * changelog's. Fixed text bundled with the workspace, like the rest of help;
 * an entry names only controls the screens have, which `tests/web-help.test.ts`
 * checks as it does for the guides.
 */
export type Release = { version: string; date: string; items: string[] };

export const whatsNew: Release[] = [
  {
    version: '0.111.6', date: '2026-11-10',
    items: [
      'Under the greeting on {overview}, the workspace now says who you are here: **Principal** or **Administrative officer**, and for an adviser the classes they advise this school year, such as “Adviser of Grade 3 – A”.',
    ],
  },
  {
    version: '0.111.5', date: '2026-11-10',
    items: [
      'On the school’s public front page, only Home has the large picture banner. Announcements, Calendar, Questions and About now open on a plain title at the top of the page.',
    ],
  },
  {
    version: '0.111.4', date: '2026-11-10',
    items: [
      'The filters above **Grade offerings** on {subjects} sit in one line again. The number of classes at the grade now appears beside **Grade level** instead of under it.',
    ],
  },
  {
    version: '0.111.3', date: '2026-11-10',
    items: [
      'The long notes on **Add the report-card learning areas** and the sheet that offers a grade’s card are now folded away, like every page’s description: press **Show the notes on these learning areas** to read them. Opening descriptions anywhere opens them everywhere for the rest of the tab. Neither sheet asks for a reason.',
    ],
  },
  {
    version: '0.111.2', date: '2026-11-09',
    items: [
      '**Create sections** on {years} no longer takes a list separated by commas. Each section is its own tag: remove one with its ×, type a name and press Enter to add one, or press the button that adds the next letter.',
    ],
  },
  {
    version: '0.111.1', date: '2026-11-09',
    items: [
      'When a form refuses something, the message now appears once, beside the box it is about, and the cursor is put there. A box listing the problems appears only when one of them is out of sight, and then it just names the boxes to jump to.',
    ],
  },
  {
    version: '0.111.0', date: '2026-11-09',
    items: [
      'A notification now takes you to what it is about: press it, and the screen opens at that school year and class, marking it read. A class list waiting for approval opens straight into its review on {enrollment}.',
      '{report-cards} no longer has a **Subject averages** tab. Type each learner’s term grades, subject averages and remarks on **Report card**, one card at a time, and check the whole class on **Class summary**.',
    ],
  },
  {
    version: '0.107.0', date: '2026-11-09',
    items: [
      '{next-year} is easier to read: three steps at the top say where the year stands, each grade next year has a card with its boys and girls, and the learners are grouped by the grade they move to.',
      'The learners not carried forward are grouped by why, and the ones waiting on an outcome point you to {report-cards}.',
    ],
  },
  {
    version: '0.106.0', date: '2026-11-09',
    items: [
      'On the school’s front page, **Staff portal** now opens the sign-in over the page instead of leaving it. Signing in takes you straight into EDUNEXUS, and **Keep me signed in** and your browser’s saved password work as before.',
      'Opening a colleague on {staff} now shows who they are first: their picture, permission level, position and the classes they advise.',
      'On {profile}, your picture and your sign-in details sit side by side on a wide screen.',
    ],
  },
  {
    version: '0.105.0', date: '2026-11-08',
    items: [
      'Principals and administrative officers: a number beside **Admissions** in the sidebar says how many class lists from advisers are waiting for you, from any screen. **Promotion** shows the endorsed outcomes waiting for approval, and **Staff access** the name or position corrections you may decide.',
      'The numbers go away as the work is done. They count only what waits on you, and nothing about attendance.',
    ],
  },
  {
    version: '0.104.0', date: '2026-11-08',
    items: [
      'Advisers with more than one class: {learners} has a **Class** filter that shows one of your classes at a time. Principals and administrative officers can filter by any class too.',
      'Records of a child registered twice are now called *duplicate entries*: tick **Show duplicate entries** to see them in the list.',
      'Opening a learner now shows who they are at the top — name, LRN, and grade and class this year — with their details grouped underneath.',
    ],
  },
  {
    version: '0.103.0', date: '2026-11-08',
    items: [
      'Adding, revising or offering a subject on {subjects} no longer asks for a reason, and neither does adding a school year or a Grade 1 credential on {prior-records}. The change history still records what was done, who did it and when. Correcting a year already on record still asks why.',
      'A list being read again stays on screen, dimmed, instead of disappearing, so a row you opened stays open after you save it.',
      'Boxes, notes and folds across the screens now have the same corners and spacing.',
      'On the school’s front page, opening an announcement or another page no longer slides or fades the page.',
    ],
  },
  {
    version: '0.95.3', date: '2026-11-06',
    items: [
      'On {learners}, when none of your classes holds a learner yet, the table no longer just says that none is assigned to your sections. It now tells you that the learners the office has registered at your grade, with no class yet, are waiting under **Add learner** — and offers the button there, so you do not have to know where to look.',
      'Nothing changed about who you may read. You still see the learners in the classes you advise, and **Add learner** still offers only the learners registered at the grade of a class you advise.',
    ],
  },
  {
    version: '0.95.2', date: '2026-11-06',
    items: [
      'On {learners}, **Add learner** now names the school year of each of your classes under **My class**, and opens on the year the school is running rather than on whichever class happened to be first.',
      'A class in a school year the principal has not activated yet, or one that has not begun, now says so and offers nothing — instead of showing an empty list and then refusing the take-in when you clicked it.',
      'When no learner is waiting, the sheet no longer claims your class is full. It says what an empty list actually means: either everybody registered at that grade is in a class, or nobody has been registered into that school year yet, which the office does on **Next year’s classes**.',
    ],
  },
  {
    version: '0.93.0', date: '2026-11-06',
    items: [
      'There is now a **bell** in the top bar, with the number of notifications you have not read. It opens a popout without leaving the screen.',
      'You are told when a class list is submitted, imported, declined or withdrawn. Advisers hear about their own list; the office hears that one is waiting.',
      'Your notifications are yours alone — nobody else can read them, and *no learner is ever named in one*. A notification links to the screen where the records are, because opening a learner’s record is what belongs in the privacy log.',
      'Nothing notifies anyone about a learner’s absences. The school has no approved alert rule for attendance and EDUNEXUS will not invent one.',
    ],
  },
  {
    version: '0.91.0', date: '2026-11-05',
    items: [
      '{profile} has two new settings under *Preferences*. **Spacing** — Compact, Comfortable or Spacious — changes how much room each row and card is given: Compact fits more of a long register or learner list on a screen, Spacious is easier to hit on a tablet.',
      '**Text size** now offers *Small* as well. Like every other setting here it is yours alone, it follows your account to any computer, and printed forms are unchanged.',
      'On {prior-records}, arrows now step between the learners your search found, with a count, and the magnifier beside them goes back to the list.',
      'Also on {prior-records}: a learner whose only earlier year is Kindergarten no longer offers **Add a school year**, because a record there starts at Grade 1. Record what they presented under *Eligibility for Grade 1* instead.',
      'On {learners}, the button that builds your class from the learners the office has registered is now simply **Add learner**. It does the same thing as before.',
    ],
  },
  {
    version: '0.90.9', date: '2026-11-05',
    items: [
      '{profile} now shows the address you signed in with, under *Signing in*, along with when this sign-in began. On a shared staffroom computer it is the quickest way to check whose account you are in before you record anything.',
      'Nothing about it is stored by EDUNEXUS: it is read from the sign-in service’s own session, which is also why nobody at the school can read your password back to you.',
    ],
  },
  {
    version: '0.90.8', date: '2026-11-05',
    items: [
      'Kindergarten and Grade 1 advisers: {prior-records} is no longer in your sidebar. A learner’s record there starts at Grade 1, and Kindergarten is carried as the credential presented for Grade 1 rather than as a school year — so there is nothing there for your classes. Advisers of Grade 2 and above keep it.',
      'The boxes for typing a grade are wider, and no longer have the little up-and-down arrows that were eating the space. A mark like *88.5* now fits and stays visible.',
      'Typing a past school year: the hint said *2024 for 2024 – 2025*, which read like a limit. Any year from 1990 to this one has always been accepted, and the hint now says so.',
      'On the report card, **Previous learner** and **Next learner** are now arrows, which leaves the learner’s name more room.',
    ],
  },
  {
    version: '0.90.7', date: '2026-11-05',
    items: [
      'Advisers: **School profile** and **School years & sections** are no longer in your sidebar. Nothing on either was yours to change, the school year you are working in is named at the top of every screen, and the classes you advise are on your own screens.',
      'If something printed at the top of your SF2 or SF9 is wrong, tell the principal or the administrative officer — that is where it is kept.',
      'Principals and administrative officers keep both screens exactly as before.',
    ],
  },
  {
    version: '0.90.6', date: '2026-11-05',
    items: [
      '{school} now shows **How this prints on the forms**: the heading the SF2, SF4, SF9 and SF10 all carry, exactly as it will print. Anything not filled in is named there — the forms leave a missing line out rather than printing it blank, so this is the way to see it without printing one.',
      'It also says whether the school head’s name will appear over the signature line on those forms.',
      'Principals and administrative officers get **Change history** there too: who changed the school’s details and when. These changes were always recorded; now they can be read.',
    ],
  },
  {
    version: '0.90.5', date: '2026-11-05',
    items: [
      'Advisers: {prior-records} now opens on your own learners, and there is no grade level to choose. You were only ever shown the learners in the classes you advise.',
      'Fixed: a principal or administrative officer who chose *Any grade* there saw no learners at all. Searching with *Any grade* now lists the school, as it reads.',
      'The school’s attendance rule has moved from {school} to the {calendar}, next to the dates it works with. It is the same card and the same rule — only the principal records it, and nothing already recorded changed.',
      '{school} now carries the school’s own details only: its name, ID, address and the heading its forms print.',
    ],
  },
  {
    version: '0.90.4', date: '2026-11-05',
    items: [
      'The Grade 1 progress report card prints better. The two remark boxes for each term are now a fixed size, so the card looks the same whether a remark is one sentence or several, and the three terms are spread down the page instead of bunched at the top.',
      'A remark much longer than about 350 characters will not all fit in the printed box. What you typed is kept in full and is still shown in full where you enter it — it is only the printed box that has a fixed size, so keep a printed remark brief.',
      'The Grades 2-3 and Grades 4-6 cards are unchanged.',
    ],
  },
  {
    version: '0.90.2', date: '2026-11-05',
    items: [
      'Advisers: your {learners} now opens on your own learners, and the grade-level filter is gone from it. You were only ever shown the learners in the classes you advise, so choosing a grade could only narrow your own class — and a grade you do not teach would have come back empty.',
      'Nothing changed about who you can see. Searching by name or LRN, and by sex, works exactly as before.',
      'Principals and administrative officers keep the grade-level filter and the whole school, unchanged.',
      'The link to the years before EDUNEXUS has been taken off the learner’s panel, because {prior-records} is in the sidebar and holds the same thing. The records and the typing-in are untouched — open that screen and find the learner there.',
    ],
  },
  {
    version: '0.90.1', date: '2026-11-05',
    items: [
      'Every button now tells you when it is working. A button you have pressed says *Working…*, *Saving…* or *Recording…* while it waits, and stays dark rather than greying out — a greyed button looked switched off, and there was nothing to tell you the school’s connection was simply taking a moment.',
      'When a click opens a sheet or reloads a list instead, *Working…* appears at the top of the screen beside the school year, so there is always something saying the system is busy rather than stuck. It only appears when the wait is long enough to notice.',
      'You do not need to press anything twice. If a button looks greyed and says nothing, it is genuinely unavailable — the screen will say what it is waiting for.',
      'Buttons for the smaller actions now have a visible edge, so it is clearer what can be pressed.',
    ],
  },
  {
    version: '0.90.0', date: '2026-11-05',
    items: [
      'Advisers can now build their own class. On {learners}, **Add learner** lists the learners the office has registered for your grade who are in no class yet, and takes as many as you tick into your class.',
      'It never makes a second record for a child: it is the record the office already holds, given your class. A learner already in somebody’s class is not offered — a principal or administrative officer moves a learner between classes.',
      'A search there also finds a learner with no enrolment this school year, such as one returning to the school, so they can be taken in without being keyed again.',
      'Registering a child the school has never held a record for was, at the time, done straight from your class. Since 0.99.0 it goes on a list for the office to approve, like any other list.',
      'You can still only see the learners in the classes you advise, and correcting a learner’s details is still the office’s.',
      'Principals and administrative officers get **Across the school** at the top of {prior-records}: for every class, how many of its learners have a previous school year or the Grade 1 credential typed in, how many have neither, and who the adviser is — so the classes with work left are visible without opening anybody’s record.',
      'That view counts only. It names no learner and records no access to anyone’s records, so it can be checked as often as it is useful.',
    ],
  },
  {
    version: '0.89.0', date: '2026-11-05',
    items: [
      'A class list can now be imported onto the registry at a grade, with no class yet, on {imports}. It is how the school puts every learner on the registry first and settles the classes afterwards.',
      'Those learners are enrolled for the year and count on the totals, but belong to no section. Give them a class later on {enrollment}: that is a change to the enrolment they already have, not a second one.',
      'They are listed as *not in a class* on the SF4, and the SF4 cannot be issued until every registered learner is in one — so nobody is quietly left off the figure the division reads.',
      'Importing a class list into a section still works exactly as before, and is what an adviser’s submitted list is imported as. Import the registry list *or* the class lists, not both: a learner already enrolled this year is refused the second time.',
    ],
  },
  {
    version: '0.88.0', date: '2026-11-04',
    items: [
      'A learner’s **Address** can now be recorded, on one line, beside their name, LRN, birth date and sex — on **Register a learner** and on the correction form on {learners}. It is optional: a learner you have no address for is registered without one, and the record says it is not recorded rather than showing an empty box.',
      'It is the only new learner detail. Anything further about a child or their family waits on the school’s own list of the fields EDUNEXUS should keep.',
      '{imports} now offers **Download the template (Excel)** as well as the CSV. The Excel file carries the address column, keeps the LRN and birth-date columns as text so no digits are lost, names every column and says which are required on a second sheet, and shows one worked row.',
      'A class list you already saved from the earlier template still imports. Those learners are simply recorded with no address.',
      'Registering learners one at a time is unchanged, and so is everything about {prior-records}: a previous school year is typed in there, one year at a time, whenever the school is ready. The school can start using EDUNEXUS with no previous school years recorded at all.',
    ],
  },
  {
    version: '0.87.0', date: '2026-11-03',
    items: [
      'A new screen, {prior-records}, for typing in the school years a learner finished before EDUNEXUS. Search for the learner, **Add a school year**, and copy the grades from the school’s own spreadsheet or form.',
      'Those years go onto the learner’s existing SF10, in order, beside the years EDUNEXUS recorded itself. A learner has one SF10 for their whole time in elementary school: there is no new one to make each year, and from now on EDUNEXUS adds each year itself.',
      'It is a one-off, for every learner from Kindergarten to Grade 6. A year EDUNEXUS already holds is refused rather than printed twice — its grades are entered on {report-cards}.',
      'A Kindergarten record goes under *Eligibility for Grade 1*, as the credential presented when the learner entered Grade 1. That box carries no grade, which is what the SF10 itself asks for.',
      'A learner still in Kindergarten has no SF10, and no longer gets a blank one: the registry says *SF10 begins at Grade 1*, and their records stay the SF5-K and the ECCD checklist the school keeps.',
      'An adviser can type in any previous grade level for a learner in the classes they advise, not only the grade they teach.',
      'Nothing typed there is computed. The general average is the one already written on the document, and a quarter the document leaves empty stays empty.',
      'A learner enrolled at a grade but not yet in a class now appears on their own SF10. They were being left off it.',
    ],
  },
  {
    version: '0.86.0', date: '2026-10-29',
    items: [
      'Make the screens easier to see, read and press under *Accessibility* on {profile}: higher contrast, links always underlined, a thicker focus outline, larger buttons, more line spacing and a typeface drawn for low vision. **Put these back** undoes them all.',
    ],
  },
  {
    version: '0.85.0', date: '2026-10-29',
    items: [
      'Your browser now offers to save your password when you sign in, so you need not type it each time. You are still signed out when the tab closes, so close it on a shared computer.',
    ],
  },
  {
    version: '0.84.0', date: '2026-10-29',
    items: [
      'A year’s sections are created on {years}. A teacher’s sections are ticked on their own row on {staff}, then **Save sections**.',
    ],
  },
  {
    version: '0.81.0', date: '2026-10-28',
    items: [
      'Choose the screen EDUNEXUS opens on, a larger text size, less motion or a dark theme under *Preferences* on {profile}. They follow you to any computer you sign in on.',
      'Restart any guided tour for your role from {profile}.',
    ],
  },
  {
    version: '0.80.0', date: '2026-10-28',
    items: [
      'If your name or position is wrong on the forms, **Ask for a correction** on {profile}. The principal or the administrative officer approves it.',
      '*Your activity* on {profile} lists what you recorded and which learner records you were shown.',
    ],
  },
  {
    version: '0.79.0', date: '2026-10-28',
    items: [
      // Kept rather than deleted: the release happened. The note says it was undone, so nobody hunts for a control that is gone.
      '*Turn on two-step sign-in* on {profile} so that a password someone else learns is not enough to sign in as you. *(Taken out again on 3 November 2026: signing in is an email and a password.)*',
      'See where you are signed in, and **Sign out everywhere else** if you left yourself signed in on a school computer.',
    ],
  },
  {
    version: '0.78.0', date: '2026-10-28',
    items: [
      '{profile} is new: open it from your name at the top right. Show your initials, an icon or your photo; only you, the principal and the administrative officer see it.',
    ],
  },
];
