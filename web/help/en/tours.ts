import type { Tour } from '../../components/tour';

/**
 * Tours over the live interface. Each step points at a control by its
 * `data-tour` name and says what it does; none of them presses anything. The
 * words follow the same marks as the rest of help, and a test finds every
 * **Label** and every `data-tour` name in the screens' source.
 */
export const tours: Tour[] = [
  {
    id: 'workspace',
    title: 'The workspace',
    summary: 'The parts of EDUNEXUS that are on every screen: your screens, the school year, finding a screen, help and your account.',
    steps: [
      {
        title: 'A tour of the workspace',
        body: 'This shows the parts of EDUNEXUS that stay the same on every screen. It only points: nothing changes until you do it yourself. Use **Next** and **Back**, or the arrow keys, and **End tour** at any time.',
      },
      {
        target: 'rail|rail-open',
        title: 'Your screens',
        body: 'The screens your role uses, grouped by the work they hold. Fold a group away by its name, and **Collapse sidebar** for more room. On a phone, the menu button opens the same list.',
      },
      {
        target: 'scope',
        title: 'The school year',
        body: 'Every record on screen belongs to the school year named here. When it says *No active school year*, nothing new can be recorded until the principal or the administrative officer activates one.',
        absent: 'On a narrow screen the year is left out of the top bar. The Overview names it.',
      },
      {
        target: 'palette',
        title: 'Go to a screen',
        body: 'Press **Ctrl K** on any screen and type a few letters of where you want to go, or a question. It searches screens and help, and never learner records.',
      },
      {
        target: 'nav-help',
        title: 'Help and frequently asked questions',
        body: 'Help & FAQ in the sidebar has a guide for every screen, the questions staff ask, and these tours. On any screen the ? key opens that screen’s guide over the page, so nothing you are typing is lost. When a save is refused, **What does this mean?** beside the message explains why.',
        absent: 'On a narrow screen the sidebar folds away: the menu button at the top left opens it.',
      },
      {
        target: 'profile',
        title: 'Your account',
        body: 'Your name opens **My profile**, **Settings**, **Change password** and **Sign out**. Settings is where the text size, the theme and the accessibility choices live. Sign out before leaving a shared computer; closing the tab also ends your session.',
      },
      {
        title: 'Where to begin',
        body: 'Help and FAQ starts with *Start here*, the work of your role in order, and each screen’s guide offers its own tour where one exists.',
      },
    ],
  },

  // Advisers' daily and termly work. None of these opens the learner registry, because
  // every list of learners writes a row to the privacy access log, and a tour should
  // not cause a read the adviser did not ask for.
  {
    id: 'register',
    title: 'Taking the register',
    summary: 'Marking a class morning and afternoon, the review that saves it, and the month’s SF2 beside it.',
    roles: ['teacher'],
    route: 'attendance',
    steps: [
      {
        title: 'Taking the register',
        body: 'Twice a day you mark each learner present or absent, review the marks, and confirm them. This tour points at each part; it marks nobody.',
      },
      {
        target: 'att-views',
        title: 'The register and its SF2',
        body: '**Daily register** is where you mark. **School Form 2 (the month)** shows the same marks as the SF2 prints them, counted by the school’s rule.',
      },
      {
        target: 'att-pick',
        title: 'Your section and the date',
        body: 'The register opens on your section and today, or your last class day. Change the date here, or step a day at a time with the arrows beside it.',
        absent: 'This is on the Daily register. Choose Daily register under the page title after the tour to see it.',
      },
      {
        target: 'att-mark',
        title: 'Marking one learner',
        body: 'Each learner has a morning and an afternoon mark: Present, Absent or Not marked. *Not marked* is never counted as present or absent, so a day you have not taken stays visibly unknown.',
        absent: 'Marks appear on a class day with learners enrolled in the section. A date the school has not set up as a class day cannot be marked.',
      },
      {
        target: 'att-fill',
        title: 'When most of the class is in',
        body: 'Mark the absences first, then **Mark every learner not yet marked present** for the morning, the afternoon or **Both sessions**. It fills in only the learners you have not marked, and still waits for your review.',
        absent: 'These buttons appear on a class day with learners to mark.',
      },
      {
        target: 'att-review',
        title: 'Nothing is saved until you confirm',
        body: 'Your marks are held on screen. Press this, read the review, and **Confirm this review**. The class is saved together, so two people can never overwrite each other half-way through a register.',
        absent: 'The review button appears on a day you can mark.',
      },
      {
        target: 'att-files',
        title: 'Spreadsheets of your section',
        body: '**Class list**, **SF2 (Excel)** and **Raw marks (Excel)** save Excel files, every cell saying what is there and nothing counted.',
        absent: 'These buttons appear on the Daily register once a section is chosen.',
      },
      {
        target: 'att-views',
        title: 'At the end of the month',
        body: 'Open **School Form 2 (the month)** to check the month. A session nobody marked shows ?, and keeps the totals empty until it is marked. While the month is a draft, its cells take marks where they print, clicked or typed, and **Issue this SF2** records it once the month is over.',
      },
    ],
  },
  {
    id: 'class-list',
    title: 'Submitting your class list',
    summary: 'Preparing your section’s list from the template, checking it and sending it to the office to import.',
    roles: ['teacher'],
    route: 'imports',
    steps: [
      {
        title: 'Your class list',
        body: 'You prepare your section’s list; the principal or the administrative officer imports it. Learner records are changed only by the office, so this is how your list reaches them.',
      },
      {
        target: 'roster-template',
        title: 'Start from the template',
        body: '**Download the template**, an Excel file with the columns the import reads. Fill in one learner per row, each with their twelve-digit LRN.',
      },
      {
        target: 'roster-form',
        title: 'Your section, the date and the file',
        body: 'Choose your section, the first day the learners are in it and how they join, then upload the file or paste it.',
      },
      {
        target: 'roster-check',
        title: 'Check before you submit',
        body: '**Check the list** shows any problem beside its row. Fix them in the file and check again. When every row is in order, give a reason and submit.',
        absent: 'The check appears once you have a section to submit for.',
      },
      {
        target: 'roster-late',
        title: 'A learner who arrives later',
        body: '**Add learner** puts one more row on your list, with no file needed.',
        absent: 'This appears once you have a section to submit for.',
      },
      {
        target: 'roster-sent',
        title: 'What you have sent',
        body: 'A list waits for review until the office imports it. While it waits you may **Withdraw** it and send a corrected one; only one list per section waits at a time.',
        absent: 'Your submitted lists are listed below the form once you have a section.',
      },
    ],
  },
  {
    id: 'report-cards',
    title: 'Report cards and promotion',
    summary: 'Copying the ECR’s grades onto the report cards, checking them, and endorsing each learner’s outcome.',
    roles: ['teacher'],
    route: 'report-cards',
    steps: [
      {
        title: 'Report cards and promotion',
        body: 'Each term you copy grades from the DepEd class record (ECR) exactly as it shows them. EDUNEXUS keeps and prints them; it computes and rounds no grade.',
      },
      {
        target: 'rc-pick',
        title: 'Your section',
        body: 'Choose the section you advise. Everything below is for that section.',
      },
      {
        target: 'rc-tabs',
        title: 'What you record',
        body: '**Promotion** is where you endorse outcomes. **Report card** shows one learner’s card as it prints, to type box by box: term grades, subject averages and remarks. **General average**, **Observed values** and **Comments** take one thing for the whole class at a time; a Grade 1 section records **Narratives** instead of grades. **Class summary** lays the entries side by side to check against the ECR.',
        absent: 'The tabs appear once the section has learners and learning areas. Kindergarten has no card yet, only its outcomes.',
      },
      {
        target: 'rc-review',
        title: 'Review, then record',
        body: 'Type the entries, press the review button, read every change, and **Record these** with a reason. A grade with more than two decimal places is refused: copy it as the ECR displays it.',
        absent: 'The review button appears under a table you can type into.',
      },
      {
        target: 'rc-print',
        title: 'Endorsing outcomes',
        body: 'At the end of the year, on **Promotion**, choose each learner’s outcome as the school decided it, and record it. The principal or administrative officer approves it, or returns it to you to change. **Print the promotion report** prints the section’s list.',
        absent: 'This is on the Promotion tab.',
      },
      {
        title: 'The card itself',
        body: 'In the Learner registry, **SF9** on a learner’s row opens their card as it prints. It only shows what is recorded: grades are entered on **Promotion** → **Report card**, and attendance is counted from your register, never typed.',
      },
    ],
  },

  // The principal's and administrative officer's work. The year's setup crosses screens
  // in the order the work is done; it stops short of the learner screens, which it names.
  {
    id: 'setup-year',
    title: 'Setting up a school year',
    summary: 'The six setup screens in the order the work is done, each step depending on the one before.',
    roles: ['principal', 'administrative_officer'],
    route: 'years',
    steps: [
      {
        title: 'Setting up a school year',
        body: 'A new year is set up in order, because each step depends on the one before. This tour moves through the screens in that order and points at where each step starts. It changes nothing.',
      },
      {
        route: 'school',
        target: 'school-edit',
        title: '1. The school’s details',
        body: 'Check the name, the six-digit school ID and the address, and fill in the region, division, district, school head and position. Every form prints them. **Edit details** opens them.',
        absent: 'Only the principal and the administrative officer edit the school’s details.',
      },
      {
        route: 'years',
        target: 'year-add',
        title: '2. The school year',
        body: '**Add a school year** with its first and last day. It starts as a draft, and its terms can change only while it is one.',
      },
      {
        route: 'years',
        target: 'year-periods',
        title: '3. Its terms, then activate it',
        body: 'Add each term with its dates, or for 2026–2027 DepEd’s three terms in one step. When they are right, **Activate year** on the year above. Only one year is active at a time.',
        absent: 'The terms are listed below the years once a year exists.',
      },
      {
        route: 'calendar',
        target: 'calendar-fill',
        title: '4. The calendar',
        body: '**Fill a date range** sets the whole year at once: how Monday to Friday runs, what weekends are, and each holiday from the school’s approved calendar. A date left out cannot have attendance taken on it.',
        absent: 'The calendar is filled once a year exists.',
      },
      {
        route: 'invitations',
        target: 'invite-list',
        title: '5. Accounts for the staff',
        body: '**Request from a list** turns a pasted staff list into invitation requests. No email is sent until you open each request and choose **Create the account**.',
      },
      {
        route: 'years',
        target: 'sections-create',
        title: '6. The sections',
        body: '**Create sections** starts from the SF4’s layout. Change any list, review it, and create.',
        absent: 'Sections are created once a year exists.',
      },
      {
        route: 'staff',
        target: 'staff-assign',
        title: '7. Their advisers',
        body: '**Assign advisers** puts every section in one table; a teacher’s own row sets theirs too. An adviser sees only the sections assigned to them, so this decides what each teacher can open.',
        absent: 'Advisers are assigned once the year has sections.',
      },
      {
        route: 'subjects',
        target: 'subjects-cards',
        title: '8. The learning areas',
        body: '**Add from the report cards** lists the learning areas the school’s cards print. Then choose each section and **Offer the report-card set**.',
      },
      {
        title: '9. Then the learners',
        body: 'Learners are registered in the Learner registry, or brought in from class lists on Roster import, and enrolled in their sections on Enrollment. Each of those screens has its own guide in Help and FAQ.',
      },
    ],
  },
  {
    id: 'attendance-rule',
    title: 'The school’s attendance rule',
    summary: 'The two questions the principal answers, which every attendance figure on the forms is counted by.',
    roles: ['principal'],
    route: 'calendar',
    steps: [
      {
        title: 'The school’s attendance rule',
        body: 'The SF2, the SF4 and the report card count attendance only by the rule you record here. Until it is recorded they show the marks but no totals, and EDUNEXUS offers no default.',
      },
      {
        target: 'school-rule',
        title: 'Two questions from the school’s practice',
        body: 'How a learner present for one session and absent for the other is counted, and whether a date with only one classroom session is a day of classes. **Record the rule** asks both, and where the school approved the answer.',
      },
      {
        target: 'school-rule',
        title: 'Changing it later',
        body: 'Forms already issued keep what they said. Forms prepared from then on follow the new rule, and the change is kept with your reason.',
      },
    ],
  },
  {
    id: 'month-close',
    title: 'Closing a month',
    summary: 'Reviewing each section’s month, submitting and locking it, then preparing and issuing the school’s SF4.',
    roles: ['principal', 'administrative_officer'],
    route: 'months',
    steps: [
      {
        title: 'Closing a month',
        body: 'At the end of each month, every section’s register is reviewed and locked, and the school’s SF4 is issued from them.',
      },
      {
        target: 'month-pick',
        title: 'One section’s month',
        body: 'Choose the section and the month. The readiness check below says whether every class day is marked.',
      },
      {
        target: 'month-submit|month-lock|month-reopen',
        title: 'Submit, lock, or reopen',
        body: '**Submit this month** once it is complete, then **Lock this month** after the principal’s check. A locked month cannot change; a correction needs **Reopen this month** with a reason.',
        absent: 'These appear once the month can be acted on. A month with an unmarked session cannot be submitted.',
      },
      {
        route: 'sf4',
        target: 'sf4-prepare',
        title: 'The school’s SF4',
        body: '**Prepare the SF4** counts every section’s month by sex, in the form’s own columns.',
      },
      {
        route: 'sf4',
        target: 'sf4-issue',
        title: 'Issuing it',
        body: 'Once every section’s month is submitted and every day is marked, **Issue this SF4** records it with an issue number and prints it. **Excel file** saves it in the workbook’s layout.',
        absent: 'Issue this SF4 appears once the SF4 is prepared.',
      },
    ],
  },
  {
    id: 'approve-outcomes',
    title: 'Approving outcomes',
    summary: 'Checking the outcomes advisers endorse, and approving each or returning it.',
    roles: ['principal', 'administrative_officer'],
    route: 'report-cards',
    steps: [
      {
        title: 'Approving outcomes',
        body: 'At the end of the year each adviser endorses every learner’s outcome as the school decided it. Only an approved outcome prints on the SF9 and SF10, and only approved outcomes place learners in next year’s classes.',
      },
      {
        target: 'rc-waiting',
        title: 'What is waiting',
        body: 'Sections whose advisers have endorsed outcomes are listed first. Open one to decide them.',
        absent: 'No endorsement is waiting now. Sections appear here once their advisers endorse.',
      },
      {
        target: 'rc-pick',
        title: 'One section',
        body: 'Choose the section. Its **Promotion** tab shows each learner’s endorsed outcome beside the general average and failed learning areas the adviser entered.',
      },
      {
        target: 'rc-approve',
        title: 'Approve or return',
        body: '**Approve** each outcome after checking the promotion report, or **Return to the adviser** with a reason. EDUNEXUS suggests no outcome.',
        absent: 'This appears on a section’s Promotion tab while its endorsements wait.',
      },
      {
        target: 'rc-print',
        title: 'The promotion report',
        body: '**Print the promotion report** prints the section’s list to check on paper.',
        absent: 'This is on a section’s Promotion tab.',
      },
    ],
  },
  {
    id: 'public-site',
    title: 'The school’s front page',
    summary: 'Writing and publishing notices, and the school’s details, on the public front page.',
    roles: ['principal', 'administrative_officer'],
    route: 'public-site',
    steps: [
      {
        title: 'The school’s front page',
        body: 'The front page shows only what you publish here, and never anything about a learner.',
      },
      {
        target: 'site-write',
        title: 'A notice',
        body: '**Write an announcement** saves a draft only staff see. Open it in the list and **Publish on the front page** when it is ready; **Take it off the front page** returns it to a draft. **Pin to the top** shows it first.',
      },
      {
        target: 'site-tabs',
        title: 'Questions and the school’s details',
        body: '**Questions for parents** holds the questions and answers the front page’s Questions page shows, each published as a notice is. **School details** holds the tagline, introduction, mission, vision and contact details. Whatever you leave empty, the page leaves out.',
      },
    ],
  },
  {
    id: 'people',
    title: 'Staff, invitations and the logs',
    summary: 'Who can use EDUNEXUS, how a new account is made, and the two logs that keep every change and every read.',
    roles: ['principal', 'administrative_officer'],
    route: 'staff',
    steps: [
      {
        target: 'staff-list',
        title: 'Who has access',
        body: 'Each person is a principal, an administrative officer or a teacher. Setting someone’s access to *Suspended* blocks them at once and deletes nothing they recorded.',
      },
      {
        target: 'staff-grant',
        title: 'An account that already exists',
        body: '**Grant access** links an account the operator made by hand. A new teacher usually comes through an invitation instead.',
      },
      {
        route: 'invitations',
        target: 'invite-table',
        title: 'Invitations',
        body: '**Request an invitation** for one person, or from a list. A request sends nothing; **Create the account** sends that one person their email.',
      },
      {
        route: 'activity',
        target: 'activity-list',
        title: 'Every change, kept',
        body: 'The activity log keeps every change with who made it, when, why, and the record before and after. Nothing in it can be edited or deleted.',
      },
      {
        title: 'Every read, kept',
        body: 'The privacy access log keeps who was shown which learner records, by record ID. From a learner in the Learner registry, **Who has opened this record** opens it for that learner.',
      },
    ],
  },
];
