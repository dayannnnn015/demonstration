import type { Article } from '../types';

export const articles: Article[] = [
  {
    id: 'start-principal',
    title: 'Start here',
    roles: ['principal'],
    summary: 'You see every screen. The first work of a school year is setting it up, in order, because each step depends on the one before.',
    body: [
      'Before the first day of classes, work down the list below. Each screen’s guide says what to do there.',
      'Two things only the principal does: record the school’s attendance rule on {calendar}, which every attendance figure on the forms is counted by, and approve the outcomes advisers endorse on {report-cards}.',
      'Every month, check {attendance-today}, then review and lock each section’s month on {months} and issue the {sf4}.',
    ],
    path: ['school', 'years', 'calendar', 'invitations', 'staff', 'subjects', 'learners', 'enrollment', 'months', 'sf4', 'report-cards'],
    tours: ['workspace', 'setup-year'],
  },
  {
    id: 'start-administrative_officer',
    title: 'Start here',
    roles: ['administrative_officer'],
    summary: 'You keep the learner records: registering learners, importing class lists, enrolling them and recording their movements.',
    body: [
      'Learner records are changed only by the principal and the administrative officer; advisers read their own learners. So a late learner, a transfer or a wrong birth date comes to you.',
      'Class lists advisers submit wait on {imports}. Open each one, preview it and import it.',
      'You also see the setup screens the principal uses, and can do the same work there.',
    ],
    path: ['learners', 'imports', 'enrollment', 'calendar', 'months', 'sf2', 'sf4', 'next-year'],
    tours: ['workspace', 'setup-year'],
  },
  {
    id: 'start-teacher',
    title: 'Start here',
    roles: ['teacher'],
    summary: 'You see the sections you advise this year, and nothing else. Most days, that means the register twice a day.',
    body: [
      'Every class day, take the morning and afternoon register on {attendance}. At the end of the month, check your SF2 there too.',
      'At the start of the year, submit your class list on {imports}. The office imports it.',
      'Each term, copy your entries from the ECR onto {report-cards}. At the end of the year, endorse each learner’s outcome there.',
    ],
    path: ['attendance', 'imports', 'learners', 'report-cards', 'monitor'],
    tours: ['workspace', 'register'],
  },
  {
    id: 'account',
    title: 'Signing in and your account',
    summary: 'Sign in with your school email and password. What you see depends on your role.',
    body: [
      'If you forget your password, type your school email on the sign-in page and choose **Email a recovery link**.',
      'Change your password at any time from your name at the top right, then **Change password**.',
      'Your session ends when you close the browser tab, so a shared staffroom computer does not keep you signed in. Sign out from your name at the top right when you leave it.',
      'If a banner says EDUNEXUS has been updated, finish what you are typing and choose **Reload now**.',
    ],
  },
  {
    id: 'changes',
    title: 'Reasons, versions and the change history',
    summary: 'Every change asks for a reason and is kept with your name. Nothing is ever silently overwritten.',
    body: [
      'A reason is one line of 10 to 500 characters. It is kept with the change in the activity log, so write what a colleague reading it next year would need.',
      'If a screen says *the record changed*, someone else saved first. Read it again, look at what they did, and redo your change.',
      'A batch, such as creating sections or assigning advisers, sends one record at a time. If a row is refused, use **Read again and retry**: it reads the records afresh and sends only the rows that did not go in.',
      'Anything that cannot be undone asks you to confirm first, and says what it costs.',
    ],
  },
  {
    id: 'never',
    title: 'What EDUNEXUS will not do, and why',
    summary: 'It computes no grade, average, percentage, attendance rate or ranking, and sends no automatic absence alert. This is deliberate.',
    body: [
      'The rules that turn marks and attendance into official figures come from DepEd and the school: the weights, the transmutation, the rounding, how a half day counts. A rule guessed by the system would print wrong numbers on real report cards without anyone noticing.',
      'So grades are copied from the ECR exactly as it shows them, and attendance figures on the forms are counted only by the attendance rule the principal records.',
      'An unmarked session is unknown, never present and never absent. An unentered grade is empty, never zero. The screens draw these as hatched boxes that name what is missing.',
      'There is no absence alert because the school has no approved rule for one.',
    ],
  },
  {
    id: 'seeded',
    title: 'The seeded test data',
    summary: 'While every screen shows an amber *Seeded test data* banner, the records are invented for practice, and all of them are wiped before real use.',
    body: [
      'Click and change anything while the banner shows. No record in it belongs to a real learner.',
      'Files you save while it shows have names starting SEEDED-, and printed pages say so.',
    ],
  },
];
