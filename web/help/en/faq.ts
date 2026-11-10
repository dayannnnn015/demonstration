import type { Faq, FaqGroup } from '../types';

export const faqGroups: FaqGroup[] = [
  { id: 'account', title: 'Signing in and your account' },
  { id: 'register', title: 'The daily register' },
  { id: 'forms', title: 'Months, the SF2 and the SF4' },
  { id: 'cards', title: 'Report cards, the SF9 and the SF10' },
  { id: 'learners', title: 'Learners, enrolment and class lists' },
  { id: 'refused', title: 'Why won’t it let me?' },
  { id: 'privacy', title: 'Privacy and the logs' },
  { id: 'seeded', title: 'The seeded test data' },
];

/**
 * The questions staff ask, answered in the screens' own words. An answer names
 * the error codes it explains, so a refusal can link straight to it, and the
 * screens it concerns, so each screen's help can list them.
 */
export const faq: Faq[] = [
  // Signing in and your account
  {
    id: 'forgot-password', group: 'account',
    question: 'I forgot my password. What do I do?',
    answer: ['On the sign-in page, type your school email and choose **Email a recovery link**. The link lets you set a new password. If no email arrives, ask the principal or the administrative officer to check your invitation on {invitations}.'],
  },
  {
    id: 'change-password', group: 'account',
    question: 'How do I change my password?',
    answer: ['Open your name at the top right and choose **Change password**. You will be asked for the one you use now. A new password needs at least 12 characters.'],
  },
  {
    id: 'save-password', group: 'account',
    question: 'Can my browser remember my password?',
    answer: [
      'Yes. After you sign in, your browser offers to save your email and password; choose to save, and next time it fills them in for you. EDUNEXUS itself never keeps your password.',
      'You are still signed out when you close the tab, so on a computer other staff use, close the tab when you are done, and do not let the browser save your password there.',
    ],
  },
  {
    id: 'easier-to-read', group: 'account', routes: ['profile'],
    question: 'The screens are hard for me to read. What can I change?',
    answer: [
      'Open {profile} from your name at the top right. Under *Preferences*, choose a larger text size or the dark theme. Under *Accessibility*, choose higher contrast, underlined links, a thicker focus outline, larger buttons, more line spacing or the Atkinson Hyperlegible typeface. Each takes effect at once and follows you to any computer you sign in on. Printed forms are not changed.',
    ],
  },
  {
    id: 'stay-signed-in', group: 'account', routes: ['profile'],
    question: 'Do I have to sign in every time?',
    answer: [
      'Only if you want to. On the sign-in page, tick **Keep me signed in on this computer** and EDUNEXUS stays signed in after you close the browser, until you sign out.',
      'Leave it off on a shared staffroom computer. With it off — which is how it starts — you stay signed in only until the tab is closed, so the next person who opens the browser is not holding your account.',
      'Signing out always ends it, and forgets the choice, so the next person at that computer starts with the box empty. **Sign out everywhere else** under *Where you are signed in* on {profile} ends every other browser too, if one was left signed in.',
    ],
  },
  {
    id: 'left-signed-in', group: 'account', routes: ['profile'],
    question: 'I left myself signed in on a school computer. What do I do?',
    answer: ['Sign in anywhere, open {profile}, and choose **Sign out everywhere else**. Every other computer and phone signed in as you must sign in again; the one you are using stays signed in. Under *Where you are signed in* you can see which browsers have been used lately.'],
    codes: ['SESSION_UNKNOWN'],
  },
  {
    id: 'photo', group: 'account', routes: ['profile', 'staff'],
    question: 'Who can see my photo, and why was it refused or taken down?',
    answer: [
      'You, the principal and the administrative officer. Other teachers never see it. Only the square you framed is kept, without where or on what phone it was taken.',
      'A photo must be a picture at least 128 pixels on each side; a document, a very small image or a damaged file is refused before it is sent. The principal or administrative officer may take down a photo that is not a suitable picture of you, with a reason. Upload another at any time.',
    ],
    codes: ['PHOTO_INVALID', 'PHOTO_MISSING'],
  },
  {
    id: 'name-wrong', group: 'account', routes: ['profile', 'staff'],
    question: 'My name or position is wrong on the forms. How do I fix it?',
    answer: ['Open {profile} and choose **Ask for a correction**. Type it as it should print and say why, for example what your PRC ID shows. The principal or the administrative officer approves it, and every form printed afterwards shows the correction; a form already issued keeps what it said. You cannot change it yourself, because it prints on official forms.'],
    codes: ['NAME_REQUEST_DECIDED', 'OWN_NAME_REQUEST'],
  },
  {
    id: 'signed-out', group: 'account',
    question: 'Why was I signed out when I closed the tab?',
    answer: ['Your session lives only as long as the browser tab, so a shared staffroom computer does not keep you signed in after you leave. Sign in again; nothing you saved is lost. Anything not yet confirmed or recorded is.'],
    codes: ['STAFF_ACCESS_REQUIRED'],
  },
  {
    id: 'missing-screen', group: 'account',
    question: 'A colleague has a screen I do not see. Why?',
    answer: [
      'Each role sees its own work. The principal and the administrative officer see the setup, learner and form screens; an adviser sees the sections they advise and the screens for that work.',
      'If you think you have the wrong role, ask the principal: it is set on {staff}.',
    ],
    codes: ['FORBIDDEN', 'PRINCIPAL_ONLY'],
  },
  {
    id: 'updated', group: 'account',
    question: 'A banner says EDUNEXUS has been updated. What should I do?',
    answer: ['Finish what you are typing, record or confirm it, then choose **Reload now**. The page you have open is older than the one the school now runs, and a form printed from it could be out of date.'],
  },
  {
    id: 'new-staff', group: 'account', roles: ['principal', 'administrative_officer'],
    question: 'How do I give a new teacher an account?',
    answer: [
      'On {invitations}, **Request an invitation** with their name, school email and role. Then open the request and choose **Create the account**, which sends them their email.',
      'Once they have set a password, open their row on {staff} and tick the section they advise.',
    ],
    routes: ['invitations', 'staff'],
    codes: ['INVITATION_STATE'],
  },
  {
    id: 'leaving-staff', group: 'account', roles: ['principal', 'administrative_officer'],
    question: 'A teacher has left. How do I stop their access?',
    answer: ['On {staff}, open them and set their access to *Suspended*. It takes effect at once and deletes nothing they recorded, so their marks and grades stay on file with their name.'],
    routes: ['staff'],
  },

  // The daily register
  {
    id: 'not-marked', group: 'register',
    question: 'What is the difference between *Not marked* and present?',
    answer: [
      '*Not marked* means nobody has recorded that session. It is never counted as present and never as absent: the SF2 shows it as **?** and keeps its totals empty until it is marked.',
      'So a day you forgot does not quietly become a day of perfect attendance.',
    ],
    routes: ['attendance', 'sf2'],
  },
  {
    id: 'saved', group: 'register', roles: ['teacher'],
    question: 'I marked the whole class but nothing was saved. Why?',
    answer: ['Marks are held on screen until you press **Review these marks** and then **Confirm this review**. Saving the class together means two people can never overwrite each other half-way through a register.'],
    routes: ['attendance'],
    codes: ['ATTENDANCE_UNCHANGED'],
  },
  {
    id: 'cannot-mark-date', group: 'register',
    question: 'Why can’t I take attendance on this date?',
    answer: [
      'Attendance can be taken only on a date the school has configured as a class day, in an active school year, and not in the future.',
      'If a class day is missing, the principal or the administrative officer sets it on the {calendar}.',
    ],
    routes: ['attendance', 'calendar'],
    codes: ['ATTENDANCE_SESSION', 'ATTENDANCE_YEAR', 'ATTENDANCE_DATE'],
  },
  {
    id: 'learner-not-listed', group: 'register',
    question: 'A learner is missing from my register, or one is there who left.',
    answer: [
      'The register lists who was enrolled in your section on that date. A learner who joined late, transferred or withdrew is listed only for the days they were enrolled.',
      'If the dates are wrong, the administrative officer corrects the enrolment on {enrollment}. An adviser cannot, because only managers change learner records.',
    ],
    routes: ['attendance', 'enrollment'],
    codes: ['ATTENDANCE_ENROLLMENT', 'NOT_IN_SECTION'],
  },
  {
    id: 'record-changed', group: 'register',
    question: 'It says the record changed. Did I lose my work?',
    answer: [
      'No. Someone else saved the same record after you opened it, so EDUNEXUS refused to write over their change. Read the record again, look at what they did, and redo yours if it is still needed.',
      'Nothing in EDUNEXUS is ever silently overwritten.',
    ],
    codes: ['VERSION_CONFLICT', 'ATTENDANCE_REVIEW_CHANGED', 'RETRY_REQUIRED'],
  },
  {
    id: 'correct-past', group: 'register', roles: ['teacher'],
    question: 'How do I correct a mark from last week?',
    answer: [
      'Go to that date on the register, change the mark, and review and confirm it with a reason saying why. The change is kept beside the original.',
      'If the month has been submitted or locked, ask the principal or the administrative officer to return it first.',
    ],
    routes: ['attendance'],
  },

  // Months, the SF2 and the SF4
  {
    id: 'sf2-empty', group: 'forms',
    question: 'Why does the SF2 show the marks but no totals?',
    answer: [
      'Either the school’s attendance rule is not recorded yet, or a session in the month is still unmarked.',
      'The rule says how a learner present for one session and absent for the other is counted, and the principal records it on {calendar}. EDUNEXUS does not guess it. An unmarked session shows **?**: mark it and the totals appear.',
    ],
    routes: ['sf2', 'school'],
  },
  {
    id: 'sf2-to-date', group: 'forms',
    question: 'Why does this month’s SF2 say *to date*?',
    answer: ['While a month still has class days to come, the SF2 counts the days held so far and says to which date. It is issued only once the month is over and every day is marked.'],
    routes: ['sf2'],
  },
  {
    id: 'reissue', group: 'forms',
    question: 'I issued a form and then found a mistake.',
    answer: ['Correct the record, then issue the form again. EDUNEXUS keeps a fingerprint of every issued form, so a reissue that says something different asks for the reason it is being corrected, and both issues stay on file.'],
    routes: ['sf2', 'sf4'],
    codes: ['REISSUE_REASON'],
  },
  {
    id: 'month-submit', group: 'forms', roles: ['principal', 'administrative_officer'],
    question: 'Why can’t I submit this month?',
    answer: ['A month can be submitted once it has ended and every class day in it is marked, in every session. Open the month on {months}: its review names each date or learner still missing.'],
    routes: ['months'],
    codes: ['MONTH_INCOMPLETE', 'MONTH_TRANSITION', 'MONTH_YEAR'],
  },
  {
    id: 'month-locked', group: 'forms',
    question: 'A month is locked, and a mark in it is wrong.',
    answer: ['A locked month cannot change, so that the SF4 built from it stays true. The principal or the administrative officer chooses **Reopen this month** on {months} with a reason; the adviser corrects the register; the month is submitted and locked again.'],
    routes: ['months'],
    codes: ['MONTH_FROZEN', 'MONTH_DEPENDENCY'],
  },
  {
    id: 'sf4-percent', group: 'forms', roles: ['principal', 'administrative_officer'],
    question: 'Why are the SF4’s averages and percentages empty?',
    answer: ['They are counted only by the attendance rule the principal records on {calendar}, and only from months with every session marked. Until both hold, EDUNEXUS leaves them empty rather than estimating them.'],
    routes: ['sf4', 'school'],
  },
  {
    id: 'excel', group: 'forms',
    question: 'Can I get the SF2 or SF4 as an Excel file?',
    answer: ['Yes. On the form, **Excel file** saves it in the workbook’s layout. An adviser also has **SF2 (Excel)** on the register.'],
    routes: ['sf2', 'sf4', 'attendance'],
  },

  // Report cards, the SF9 and the SF10
  {
    id: 'sf9-per-grade', group: 'cards',
    question: 'Does promoting a learner wipe their old report card?',
    answer: [
      'No. Each school year has its own SF9, because a card belongs to that year’s enrolment — so the Grade 1 card keeps its grades, its general average and its issue number for good, and the Grade 2 card starts empty.',
      'Open a learner from {learners}, then **Enrollment**: every year they have been enrolled is listed with its own **SF9** button and a **Report card** column saying whether that year’s card has been issued. Issuing the new year’s card never replaces the old one.',
      'Correcting an issued card does not replace it either: the correction is recorded beside it with its reason, and both are kept.',
    ],
    routes: ['learners', 'report-cards'],
  },
  {
    id: 'sf9-no-class-yet', group: 'cards',
    question: 'Why is the Section box on an SF9 blank?',
    answer: [
      'Because the learner is enrolled at that grade but is not in a class yet, which is where every promoted learner sits until an adviser takes them in. The card says so above it.',
      'Take them into a class from {learners} and the section and adviser fill in. The printed box is left blank rather than filled with a note, because it is an official form.',
    ],
    routes: ['learners'],
  },
  {
    id: 'promotion-not-open', group: 'cards',
    question: 'Why can’t I endorse or approve the outcomes yet?',
    answer: [
      'Promotion opens for a class only once that class’s report cards are complete: every learning area’s grade in every term, each subject average and remark, and every learner’s general average. **Promotion** lists exactly what is still missing, term by term.',
      'A Grade 1 section is judged on its term **Narratives** instead, because its card carries no numeric grade, and a Kindergarten section waits for nothing — it prints no card, and its outcome is the credential presented for Grade 1.',
      'It is counted per class and against the learners enrolled now, so a learner who joins late closes it again until their own records are in.',
    ],
    routes: ['report-cards', 'grade-entry'],
    codes: ['PROMOTION_NOT_OPEN'],
  },
  {
    id: 'period-not-started', group: 'cards',
    question: 'Why won’t it take grades for the next term?',
    answer: [
      'A term accepts grades from the day it starts, which the school set when it configured the school year. Finishing one term does not open the next: the next opens on its own date.',
      'A term that has already started stays open while the school year is open, so a grade can still be entered or corrected after the term is over — which is when the ECR’s figures usually arrive.',
      'The subject average, the general average and the remarks belong to no single term and can be entered at any time.',
    ],
    routes: ['report-cards'],
    codes: ['PERIOD_NOT_STARTED'],
  },
  {
    id: 'promotion-advances', group: 'cards',
    question: 'What happens to a learner after their outcome is approved?',
    answer: [
      'Approving a **promotion** enrols them into next school year straight away, at the next grade and with no class yet. Next year’s adviser then takes them into their class from {learners}.',
      'If next school year has not been created yet, the outcome is recorded and the enrolment follows the moment a manager creates that year.',
      'This year is untouched. The learner keeps their class, their grades, their general average and their outcome, and the SF9 and SF10 still read them. Nobody is enrolled twice, and approving the same outcome again changes nothing.',
      'A **retained** learner is not enrolled for next year by the approval: the outcome is recorded as the school’s decision and nothing else, so enrol them with everyone else when next year’s classes are set up. A learner given **Remedial** is not carried forward either, and a Grade 6 learner promoted has completed elementary school.',
    ],
    routes: ['report-cards', 'next-year', 'learners'],
  },
  {
    id: 'no-grade-math', group: 'cards',
    question: 'Why doesn’t EDUNEXUS compute the grades?',
    answer: [
      'The rules that turn scores into a grade (the weights, the transmutation and the rounding) are DepEd’s and the school’s, and the school’s class record (ECR) already applies them. A second calculation here could disagree with the ECR without anyone noticing, and the wrong one would be printed on a real report card.',
      'So EDUNEXUS records the grades exactly as the ECR shows them and checks only that each is a number from 0 to 100.',
    ],
    routes: ['report-cards'],
  },
  {
    id: 'grade-refused', group: 'cards', roles: ['teacher'],
    question: 'Why was my grade refused?',
    answer: ['A grade is a number from 0 to 100 with at most two decimal places, as the ECR displays it. Copy it as the ECR shows it rather than its full unrounded value.'],
    routes: ['report-cards'],
    codes: ['GRADE_RANGE'],
  },
  {
    id: 'observed-values', group: 'cards', roles: ['teacher'],
    question: 'What can I type for the observed values?',
    answer: ['Each behaviour statement takes one of the card’s four marks: AO, SO, RO or NO.'],
    routes: ['report-cards'],
    codes: ['VALUE_MARK'],
  },
  {
    id: 'grade-1', group: 'cards', roles: ['teacher'],
    question: 'Why does my Grade 1 section have no grades tab?',
    answer: ['Grade 1 is graded descriptively in 2026–2027 (DepEd Order No. 15, s. 2026). A Grade 1 section records each term’s **Narratives** instead.'],
    routes: ['report-cards'],
  },
  {
    id: 'kinder-card', group: 'cards',
    question: 'Where is the Kindergarten report card?',
    answer: [
      'Not in EDUNEXUS yet. The school has not supplied its Kindergarten card or assessment policy, and EDUNEXUS does not grade Kindergarten numerically without one.',
      'A learner’s Kindergarten record still reaches their SF10, as the *credential presented for Grade 1*. Record it under *Eligibility for Grade 1* on {prior-records}. That box carries the credential and the school that issued it, and no grade — which is what the form itself asks for.',
    ],
    routes: ['report-cards', 'prior-records'],
    codes: ['NO_KINDERGARTEN_CARD', 'PRIOR_GRADE_RANGE'],
  },
  {
    id: 'history-one-sf10', group: 'cards',
    question: 'Do I make a new SF10 each school year?',
    answer: [
      'No. A learner has one SF10 for their whole time in elementary school, and EDUNEXUS adds a block to it each year. There is no per-year SF10 to create, and none to carry forward.',
      'When the school started using EDUNEXUS, the years before it were typed in once on {prior-records}. After that, each new year reaches the same SF10 by itself: enrol the learner, and enter the year’s grades on {report-cards}.',
    ],
    routes: ['prior-records', 'learners', 'report-cards'],
  },
  {
    id: 'history-encode', group: 'cards',
    question: 'Which learners’ old records do we have to type in?',
    answer: [
      'Every learner the school already has, from Kindergarten to Grade 6 — not Grade 6 alone. A learner in Grade 1 gets their Kindergarten credential; a learner in Grade 3 gets Kinder to Grade 2; a learner in Grade 6 gets everything the school still holds a document for.',
      'It is done once per learner. Type in only the years EDUNEXUS does not already hold: a year it holds is refused rather than printed twice, because its grades are entered on {report-cards}.',
      'A year with no surviving document is left out. EDUNEXUS invents no grade, no school year and no general average, and the SF10 prints that year blank.',
    ],
    routes: ['prior-records'],
    codes: ['PRIOR_YEAR_IN_SYSTEM'],
  },
  {
    id: 'kinder-no-sf10', group: 'cards',
    question: 'Why has my Kindergarten learner no SF10?',
    answer: [
      'Because the SF10 begins when a learner enters Grade 1. The form has no grades box for Kindergarten at all: Kinder is the *credential* that admits a learner to Grade 1, which is what the SF10’s eligibility block carries.',
      'A Kindergarten learner’s records are the SF5-K and the ECCD checklist, which the school keeps. EDUNEXUS neither holds them nor replaces them, and it will not print a blank SF10 in their place. The registry says *SF10 begins at Grade 1* instead of offering the button.',
      'Once they are enrolled in Grade 1, record the credential they presented under *Eligibility for Grade 1* on {prior-records}, and their SF10 starts from that year.',
    ],
    routes: ['learners', 'prior-records'],
    codes: ['SF10_NOT_YET'],
  },
  {
    id: 'history-who', group: 'cards',
    question: 'Whose old records may I type in?',
    answer: [
      'If you are an adviser, the learners currently in the sections you advise — because the spreadsheets and class records the history is copied from are yours. A principal or administrative officer may type in any learner’s.',
      'Nothing typed there changes a learner’s current grade, section or register. A typed year is a copy of a document, not an enrolment: it reaches the SF10 and nothing else.',
    ],
    routes: ['prior-records'],
    codes: ['PRIOR_RECORD_FORBIDDEN'],
  },
  {
    id: 'sf9-attendance', group: 'cards',
    question: 'Can I type the attendance on the SF9?',
    answer: ['No. The SF9’s days present and absent are counted from the register by the school’s attendance rule, so the card cannot disagree with the SF2 and SF4. Correct the register, and the card follows.'],
    routes: ['report-cards', 'learners'],
  },
  {
    id: 'outcome-change', group: 'cards',
    question: 'An outcome was approved, and it is wrong.',
    answer: ['An approved outcome cannot change while it is approved. The principal or the administrative officer returns it to the adviser on **Promotion**; the adviser endorses the right outcome, and it is approved again.'],
    routes: ['report-cards'],
    codes: ['PROMOTION_APPROVED', 'PROMOTION_MISSING'],
  },
  {
    id: 'outcome-decided', group: 'cards',
    question: 'Does EDUNEXUS decide who is promoted?',
    answer: ['No. The adviser endorses the outcome the school decided, and the principal or the administrative officer approves it. The general average and failed learning areas are shown beside each learner only to check against.'],
    routes: ['report-cards'],
  },
  {
    id: 'find-sf9', group: 'cards',
    question: 'Where do I find a learner’s SF9 or SF10?',
    answer: ['On the learner’s row in the {learners}: **SF9** and **SF10**. A whole section’s cards print together with **Print the section’s SF9s** on {report-cards}.'],
    routes: ['learners', 'report-cards'],
  },

  // Learners, enrolment and class lists
  {
    id: 'teacher-edit-learner', group: 'learners', roles: ['teacher'],
    question: 'A learner’s name or birth date is wrong. Can I fix it?',
    answer: ['No: only the principal and the administrative officer change learner records. Tell the administrative officer, who corrects it with a reason. You can see the change once it is made.'],
    routes: ['learners'],
  },
  {
    id: 'lrn', group: 'learners',
    question: 'Why is an LRN required?',
    answer: [
      'The LRN is how DepEd identifies a learner from school to school, and every form prints it. Every new learner needs the twelve digits, and EDUNEXUS never invents one.',
      'An older record without one reads *LRN missing* until a manager completes it with **Assign LRN**.',
    ],
    routes: ['learners', 'imports'],
    codes: ['LRN_MISSING_ON_FILE'],
  },
  {
    id: 'late-learner', group: 'learners',
    question: 'A learner arrived after the class list went in.',
    answer: [
      'An adviser adds them with **Add learner** on {imports}, as one more row on their list.',
      'The administrative officer uses **Enlist one late learner** on the same screen, which finds a record already on file or creates one, and enrols them in one step.',
    ],
    routes: ['imports'],
  },
  {
    id: 'list-waiting', group: 'learners', roles: ['teacher'],
    question: 'I submitted my class list. What happens now?',
    answer: ['It waits for the principal or the administrative officer, who previews and imports it. While it waits you may **Withdraw** it and submit a corrected one, but only one list per section can wait at a time.'],
    routes: ['imports'],
    codes: ['SUBMISSION_WAITING', 'SUBMISSION_CLOSED', 'NOT_SECTION_ADVISER'],
  },
  {
    id: 'import-refused', group: 'learners', roles: ['administrative_officer'],
    question: 'Why was the whole import refused?',
    answer: ['A class list goes in whole or not at all, so a section is never left half imported. Fix the rows the preview marks and preview again. A preview also expires, and an import that differs from the preview you reviewed is refused.'],
    routes: ['imports'],
    codes: ['PREVIEW_CHANGED', 'PREVIEW_EXPIRED', 'PREVIEW_LIMIT'],
  },
  {
    id: 'same-child', group: 'learners', roles: ['principal', 'administrative_officer'],
    question: 'The same child is in the registry twice.',
    answer: ['Open one record in the {learners} and choose **This is the same child as another record**. The review shows both records and what is kept; nothing is merged automatically, and the link can be reversed.'],
    routes: ['learners'],
    codes: ['IDENTITY_CONFLICT', 'LINKED_LEARNER_READ_ONLY'],
  },
  {
    id: 'movement-dates', group: 'learners', roles: ['principal', 'administrative_officer'],
    question: 'Why was a transfer or withdrawal date refused?',
    answer: ['Movements must follow one another in order, inside the school year and not in the future. A movement before attendance that was already marked also needs those marks reviewed first.'],
    routes: ['enrollment'],
    codes: ['TIMELINE_DATES', 'TIMELINE_TRANSITION', 'ATTENDANCE_DEPENDENCY'],
  },

  // Why won't it let me?
  {
    id: 'closed-year', group: 'refused',
    question: 'Why can’t I change anything in last year?',
    answer: ['A closed school year’s records are read only, so the forms issued from it stay true.'],
    codes: ['RECORD_YEAR_CLOSED', 'YEAR_CLOSED', 'OFFERING_YEAR_CLOSED'],
  },
  {
    id: 'reason', group: 'refused',
    question: 'Why does every change ask for a reason?',
    answer: ['The reason is kept with the change in the activity log, so anyone reading the record later can see why it changed, not only that it did. Write one line of 10 to 500 characters that a colleague would understand next year.'],
  },
  {
    id: 'nothing-changed', group: 'refused',
    question: 'It says nothing has changed.',
    answer: ['What you are saving is already recorded that way, so there is nothing to keep. Check you changed the box you meant to.'],
    codes: ['NO_CHANGES', 'CALENDAR_UNCHANGED', 'TIMELINE_UNCHANGED', 'SUBJECT_UNCHANGED', 'RULE_UNCHANGED'],
  },
  {
    id: 'review-again', group: 'refused',
    question: 'It says the review changed. Preview and review again?',
    answer: ['Something the review showed you changed before you confirmed it, usually because a colleague saved meanwhile. Open the review again: it shows the records as they are now.'],
    codes: ['CALENDAR_REVIEW_CHANGED', 'MONTH_REVIEW_CHANGED', 'TIMELINE_REVIEW_CHANGED', 'FOLLOWUP_REVIEW_CHANGED', 'ENROLLMENT_RECORD_REVIEW_CHANGED', 'IDENTITY_REVIEW_CHANGED'],
  },
  {
    id: 'no-alerts', group: 'refused',
    question: 'Why doesn’t EDUNEXUS warn me when a learner is often absent?',
    answer: ['The school has no approved rule for when absences need action, so EDUNEXUS raises no alert of its own. The {monitor} shows recorded absences and gaps over the dates you choose, and a manager can open a case by hand on {followups}.'],
    routes: ['monitor', 'followups'],
  },

  // Privacy and the logs
  {
    id: 'who-saw', group: 'privacy',
    question: 'Who can see a learner’s records?',
    answer: ['The principal and the administrative officer see every learner. An adviser sees only the learners currently in the sections they advise. Every list that shows a learner is recorded in the privacy access log.'],
  },
  {
    id: 'access-log', group: 'privacy', roles: ['principal', 'administrative_officer'],
    question: 'How do I see who opened a learner’s record?',
    answer: ['From the learner in the {learners}, **Who has opened this record**, or on the {access} by record. It lists record IDs, never names, because looking a name up would itself be a read.'],
    routes: ['access', 'learners'],
  },
  {
    id: 'history', group: 'privacy', roles: ['principal', 'administrative_officer'],
    question: 'Can a change be deleted from the history?',
    answer: ['No. The {activity} is append-only: every change is kept with what the record was before and after, who made it, when and why. A mistake is corrected by a new change, never by erasing the old one.'],
    routes: ['activity'],
  },

  // The seeded test data
  {
    id: 'seeded-real', group: 'seeded',
    question: 'Are these real learners?',
    answer: ['Not while the amber *Seeded test data* banner shows. Every record is invented for practice, and all of them are wiped before the school uses EDUNEXUS for real.'],
  },
  {
    id: 'seeded-safe', group: 'seeded',
    question: 'Can I change anything while I am practising?',
    answer: ['Yes. Mark, record, issue and approve freely while the banner shows. Nothing you do reaches a real learner, and the go-live wipe clears it.'],
  },
];
