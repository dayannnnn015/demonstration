import type { ReactNode } from 'react';
import type { Api, Row } from './api';
import type { IconName } from './components/icons';
import type { Status } from './components/primitives';
import type { SessionAuth } from './api';
import { School, SchoolYears } from './screens/Setup';
import { Activity, Invitations, Staff } from './screens/Staff';
import { Learners } from './screens/Learners';
import { PriorRecords } from './screens/PriorRecords';
import { Upcoming } from './screens/Upcoming';
import { Enrollment } from './screens/Enrollment';
import { Calendar } from './screens/Calendar';
import { SchoolAttendance } from './screens/SchoolAttendance';
import { Sf2Screen } from './screens/Sf2';
import { SchoolForm4 } from './screens/SchoolForms';
import { AttendanceAndSf2 } from './screens/AttendanceViews';
import { Months } from './screens/Months';
import { Monitor } from './screens/Monitor';
import { Followups } from './screens/Followups';
import { Subjects } from './screens/Subjects';
import { Imports } from './screens/Imports';
import { RosterSubmit } from './screens/RosterSubmissions';
import { Policies } from './screens/Policies';
import { Overview } from './screens/Overview';
import { Access } from './screens/Access';
import { Scores } from './screens/Scores';
import { ReportCards } from './screens/ReportCards';
import { NextYear } from './screens/NextYear';
import { GradeEntry } from './screens/GradeEntry';
import { PublicSite } from './screens/PublicSite';
import { Help } from './screens/Help';
import { Profile } from './screens/Profile';
import { Settings } from './screens/Settings';

export type Role = 'principal' | 'administrative_officer' | 'teacher';

/**
 * What the shell lends a screen about the signed-in account. Optional, because a
 * screen rendered outside the shell (a test, the demo) has no sign-in service;
 * a screen says so rather than offering an action it cannot take.
 */
export type AccountTools = {
  /** Merges a change into the shell's own copy of `/me`, so the top bar follows a saved profile at once. */
  updateMe: (patch: Row) => void;
  changePassword?: (() => void) | undefined;
  /** The sign-in service, for signing out elsewhere. */
  auth?: SessionAuth | undefined;
  /** The address this person signed in with, and when they last did, from the
   *  session itself. Read, never stored: both live on `auth.users`, which the
   *  API cannot read. */
  signedInAs?: { email: string | null; lastSignIn: string | null } | undefined;
};

export type ScreenProps = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route; account?: AccountTools | undefined };

export type Route = {
  id: string;
  nav: string;
  icon: IconName;
  title: string;
  /** One clause. If a screen needs more than this to be understood, the screen
   *  is wrong, not the sentence. */
  lede: string;
  /** Which tables this screen writes. Not printed — it maps a screen to the
   *  table names the activity log reports, which is otherwise guesswork. */
  record: string;
  /** The DepEd form these records end up on. Staff navigate by form name, so
   *  this is the one piece of provenance the page header carries. */
  feeds?: string;
  group: string;
  /** The screen draws its own heading, so the shared page header is skipped. */
  ownHeader?: boolean;
  manager?: boolean;
  /**
   * Roles whose navigation leaves this screen out because it is not their
   * work (the group leader's notes, 9 October). It hides the screen only: the
   * API still decides what each role may read and write.
   */
  hiddenFor?: Role[];
  /** Reached from the profile menu and the palette rather than the rail. */
  offRail?: boolean;
  built?: boolean;
  render: (props: ScreenProps) => ReactNode;
};

const soon = (summary: string, detail: string, blocked?: string) =>
  (props: ScreenProps) => <Upcoming {...props} summary={summary} detail={detail} blocked={blocked} />;

export const routes: Route[] = [
  {
    id: 'overview', nav: 'Overview', icon: 'overview', group: 'Workspace', built: true, ownHeader: true,
    title: 'Overview',
    lede: 'Where the school year stands, and what is set up so far.',
    record: 'academic_years, sections, staff',
    render: p => <Overview {...p} />,
  },

  {
    id: 'profile', nav: 'My profile', icon: 'user', group: 'Workspace', built: true, offRail: true, ownHeader: true,
    title: 'My profile',
    lede: 'How the school has you recorded, how you appear, how you sign in, and what you have done.',
    record: 'staff_profiles, staff_photos',
    render: p => <Profile {...p} />,
  },

  {
    /*
     * Split from My profile on the user's instruction of 2026-11-05. The two
     * were one screen; the specification they were reviewed against in 0.90.9
     * already called them *My profile* and *Settings & Accessibility*, so this
     * follows a line that was already drawn. No preference moved, changed or
     * was added — the same cards read and write the same `staff_profiles`
     * columns through the same `save_my_profile`, so no migration was needed.
     *
     * `offRail`, in the account menu beside **My profile**, by the user's
     * instruction of 2026-11-06. It shipped on the rail for half a day on the
     * reasoning that someone hunting for the text size should find it in the
     * navigation; the instruction settles it the other way, and the better
     * reason is the one the grouping already makes: the rail is the school's
     * records, and these are one person's own choices, which is exactly what
     * that menu holds. Ctrl+K still finds it — the palette searches the whole
     * route table and does not care that a route is `offRail`.
     */
    id: 'settings', nav: 'Settings', icon: 'settings', group: 'Workspace', built: true, offRail: true, ownHeader: true,
    title: 'Settings & accessibility',
    lede: 'How the workspace looks and behaves for you, on every computer you sign in on.',
    record: 'staff_profiles',
    render: p => <Settings {...p} />,
  },

  {
    id: 'help', nav: 'Help & FAQ', icon: 'help', group: 'Workspace', built: true,
    title: 'Help and frequently asked questions',
    lede: 'What each screen is for, the steps in order, and when a screen will stop you and why.',
    record: 'none: help is fixed text and reads no record',
    render: p => <Help {...p} />,
  },
  {
    id: 'public-site', nav: 'Public site', icon: 'school', group: 'Workspace', manager: true, built: true, ownHeader: true,
    title: 'Public site',
    lede: 'Announcements, events and school details on the school’s front page, published only when you say so.',
    record: 'announcements, site_settings',
    render: p => <PublicSite {...p} />,
  },
  {
    id: 'school', nav: 'School profile', icon: 'school', group: 'Setup', built: true, ownHeader: true,
    title: 'School profile',
    // An adviser has nothing to do here and nothing to read that their own
    // screens do not already tell them: the heading is printed on the forms
    // they issue, and the attendance rule moved to the calendar in 0.90.5.
    hiddenFor: ['teacher'],
    lede: 'Name and address printed on every official form.',
    record: 'school_profile', feeds: 'SF2, SF4, SF9, SF10',
    render: p => <School {...p} />,
  },
  {
    id: 'years', nav: 'School years & sections', icon: 'years', group: 'Setup', built: true, ownHeader: true,
    title: 'School years, terms and sections',
    // Every control on it is a manager's. The year an adviser works in is named
    // in the top bar, and the sections they advise are on their own screens.
    hiddenFor: ['teacher'],
    lede: 'Draft, activate and close a school year, divide it into its terms, and create its classes.',
    record: 'academic_years, reporting_periods, sections', feeds: 'SF2, SF9, SF10',
    render: p => <SchoolYears {...p} />,
  },

  {
    id: 'learners', nav: 'Learner registry', icon: 'learners', group: 'Learners', built: true, ownHeader: true,
    title: 'Learner registry',
    lede: 'One permanent record per learner, carried across years.',
    record: 'learners', feeds: 'SF9, SF10',
    render: p => <Learners {...p} />,
  },
  {
    // Renamed from "Enrollment" on 2026-11-07: the screen's first job is now
    // approving the class lists advisers send, and the old name described only
    // what came after. The route id is unchanged, so every link, guide and
    // test that names it still finds it.
    id: 'enrollment', nav: 'Admissions', icon: 'enrollment', group: 'Learners', manager: true, built: true, ownHeader: true,
    title: 'Admissions and movements',
    lede: 'Approve the class lists advisers send, then move, withdraw and re-enter a learner.',
    record: 'enrollments', feeds: 'SF2, SF4',
    render: p => <Enrollment {...p} />,
  },
  {
    id: 'imports', nav: 'Roster import', icon: 'imports', group: 'Learners', built: true, ownHeader: true,
    title: 'Roster import',
    lede: 'Bring in a class list from a reviewed CSV, or submit yours for review.',
    record: 'import_previews, roster_submissions',
    // An adviser submits their section's list; only a manager imports it, and on
    // the school's division of work that is the administrative officer. Opened to
    // the principal in 0.95.4 and closed again in 0.95.5 at the school's word:
    // the API has always allowed either manager (`decide_roster_submission`
    // checks `is_manager()` only), so this stays a menu, not a permission.
    hiddenFor: ['principal'],
    render: p => (p.manager ? <Imports {...p} /> : <RosterSubmit {...p} />),
  },
  {
    // Not manager-only: an adviser encodes the history of the learners currently
    // in the sections they advise, because that is where the school's own
    // spreadsheets are (decided 2026-11-03). The API decides it, not this flag.
    id: 'prior-records', nav: 'Academic history', icon: 'learners', group: 'Learners', built: true, ownHeader: true,
    title: 'Academic history',
    lede: 'Type in the previous school years the school still holds on paper, onto the learner’s one permanent record.',
    record: 'learner_prior_years, learner_prior_grades, learner_eligibility', feeds: 'SF10',
    render: p => <PriorRecords {...p} />,
  },
  {
    id: 'next-year', nav: 'Next year’s classes', icon: 'forward', group: 'Learners', manager: true, built: true, ownHeader: true,
    title: 'Next year’s classes',
    lede: 'Carry this year’s learners into next year’s grades from their approved outcomes; classes are assigned afterwards.',
    record: 'enrollments, next_year_placements', feeds: 'SF2, SF4',
    render: p => <NextYear {...p} />,
  },

  {
    id: 'calendar', nav: 'Instructional calendar', icon: 'calendar', group: 'Attendance', built: true, ownHeader: true,
    title: 'Instructional calendar',
    lede: 'Which days hold classes, and how each session runs.',
    record: 'instructional_days', feeds: 'SF2',
    render: p => <Calendar {...p} />,
  },
  {
    id: 'attendance', nav: 'Daily attendance', icon: 'attendance', group: 'Attendance', built: true, ownHeader: true,
    title: 'Daily attendance',
    lede: 'Morning and afternoon marks for one section, and the month’s SF2 they make.',
    record: 'attendance_marks, form_issuances', feeds: 'SF2',
    // The advisers keep the register; the principal and administrative officer read it through Attendance today and the forms.
    hiddenFor: ['principal', 'administrative_officer'],
    render: p => <AttendanceAndSf2 {...p} />,
  },
  {
    id: 'attendance-today', nav: 'Attendance today', icon: 'attendance', group: 'Attendance', manager: true, built: true, ownHeader: true,
    title: 'Attendance across the school',
    lede: 'Every section’s register for one day, in counts.',
    record: 'attendance_marks', feeds: 'SF2',
    render: p => <SchoolAttendance {...p} />,
  },
  {
    id: 'months', nav: 'Monthly consolidation', icon: 'months', group: 'Attendance', manager: true, built: true, ownHeader: true,
    title: 'Monthly consolidation',
    lede: 'Review a section month, then submit or lock it.',
    record: 'attendance_months', feeds: 'SF4',
    render: p => <Months {...p} />,
  },
  {
    id: 'monitor', nav: 'Absence monitor', icon: 'monitor', group: 'Attendance', built: true, ownHeader: true,
    title: 'Classroom absence monitor',
    lede: 'Recorded absences and gaps in recording, inside a window you choose.',
    record: 'attendance_marks',
    render: p => <Monitor {...p} />,
  },
  {
    id: 'followups', nav: 'Follow-up cases', icon: 'followups', group: 'Attendance', manager: true, built: true, ownHeader: true,
    title: 'Attendance follow-up',
    lede: 'Cases opened by hand against absences and gaps in recording.',
    record: 'attendance_followups',
    render: p => <Followups {...p} />,
  },

  {
    id: 'subjects', nav: 'Subjects & offerings', icon: 'subjects', group: 'Academics', built: true, ownHeader: true,
    title: 'Subjects and section offerings',
    lede: 'The subject catalog, and what each section takes.',
    record: 'subjects, section_subjects',
    render: p => <Subjects {...p} />,
  },
  {
    id: 'policies', nav: 'Assessment policies', icon: 'policies', group: 'Academics', manager: true, built: true, ownHeader: true,
    // Retired from the menu with the quiz scores they govern (the group leader's notes, 10 October): grades come in as
    // subject averages from the ECR. The API and any records stay, for the day the school's grading rule is adopted.
    hiddenFor: ['principal', 'administrative_officer'],
    title: 'Assessment policies',
    lede: 'Draft, adopt and bind the school’s assessment policy.',
    record: 'assessment_policy_drafts, adoptions, bindings',
    render: p => <Policies {...p} />,
  },
  {
    id: 'scores', nav: 'Quiz and test scores', icon: 'scores', group: 'Academics', built: true, ownHeader: true,
    title: 'Quiz and test scores',
    lede: 'An adviser’s raw marks for each quiz, task and test, kept as entered; nothing is totalled or graded here.',
    hiddenFor: ['principal', 'administrative_officer', 'teacher'],
    record: 'assessment_tasks, assessment_scores', feeds: 'SF9',
    render: p => <Scores {...p} />,
  },
  {
    id: 'report-cards', nav: 'Promotion', icon: 'scores', group: 'Academics', built: true, ownHeader: true,
    title: 'Promotion',
    lede: 'Advisers endorse each learner’s promotion and the principal approves it; the report card entries from the ECR are kept here too.',
    record: 'report_grades, report_summaries, report_values, report_notes', feeds: 'SF9, SF10',
    render: p => <ReportCards {...p} />,
  },
  {
    id: 'grade-entry', nav: 'Grade entry', icon: 'monitor', group: 'Academics', manager: true, built: true, ownHeader: true,
    title: 'Grade entry',
    lede: 'How far each section’s report cards have come: grades, general averages and outcomes recorded.',
    record: 'report_grades, report_summaries, promotion_decisions', feeds: 'SF9, SF10',
    render: p => <GradeEntry {...p} />,
  },

  {
    id: 'sf2', nav: 'School Form 2', icon: 'months', group: 'School forms', built: true, ownHeader: true,
    title: 'School Form 2 · Daily attendance report',
    lede: 'A section’s month on the SF2, computed from the register by the school’s rule.',
    record: 'form_issuances', feeds: 'SF2',
    // An adviser finds the SF2 inside Daily attendance.
    hiddenFor: ['teacher'],
    render: p => <Sf2Screen {...p} />,
  },
  {
    id: 'sf4', nav: 'School Form 4', icon: 'months', group: 'School forms', manager: true, built: true, ownHeader: true,
    title: 'School Form 4 · Monthly learner’s movement and attendance',
    lede: 'The school’s month on the SF4, from every section’s register.',
    record: 'form_issuances', feeds: 'SF4',
    render: p => <SchoolForm4 {...p} />,
  },
  {
    id: 'staff', nav: 'Staff access', icon: 'staff', group: 'People', manager: true, built: true, ownHeader: true,
    title: 'Staff access',
    lede: 'Who can use EDUNEXUS, and at what permission level.',
    record: 'staff',
    render: p => <Staff {...p} />,
  },
  {
    id: 'invitations', nav: 'Invitations', icon: 'invitations', group: 'People', manager: true, built: true, ownHeader: true,
    title: 'Staff invitations',
    lede: 'Request an account, then link it once it exists.',
    record: 'staff_invitations',
    render: p => <Invitations {...p} />,
  },
  {
    id: 'activity', nav: 'Activity log', icon: 'activity', group: 'People', manager: true, built: true,
    title: 'Activity log',
    lede: 'Every change this system has recorded. Append-only.',
    record: 'audit_events',
    render: p => <Activity {...p} />,
  },
  {
    id: 'access', nav: 'Privacy access log', icon: 'eye', group: 'People', manager: true, built: true, ownHeader: true,
    title: 'Privacy access log',
    lede: 'Who was shown which learner records, and when.',
    record: 'record_access_events',
    render: p => <Access {...p} />,
  },
];

export const groups = ['Workspace', 'Setup', 'Learners', 'Attendance', 'Academics', 'School forms', 'People'];

/** Whether a role's navigation offers a screen. */
/**
 * Screens a person's own assignments rule out, beyond what their role decides.
 *
 * Academic history transcribes the school years a learner finished *before*
 * EDUNEXUS, and an SF10 scholastic block is Grade 1 to Grade 6 — Kindergarten
 * is never one, it is the credential presented for Grade 1. So an adviser whose
 * classes are all Kindergarten or Grade 1 has no previous year to encode for
 * anybody in them, and the screen could only refuse them.
 *
 * Their classes decide this, not their role, which is why it cannot be
 * `hiddenFor`. A manager is never narrowed: theirs is the school-wide view.
 * Nor is an adviser with no sections yet — someone between assignments keeps
 * the screen rather than silently losing it.
 */
export const hiddenByAssignment = (role: unknown, grades: number[]) =>
  (role === 'teacher' && grades.length > 0 && grades.every(g => g <= 1) ? ['prior-records'] : []);

export const available = (route: Route, role: unknown) => (!route.manager || role !== 'teacher') && !route.hiddenFor?.includes(role as Role);

// The SF9 and SF10 screens became buttons on each learner in the registry (0.58.0), and the reporting periods
// joined School years (0.60.0); an old link lands where the work now is.
// Sections & advisers left the rail in 0.84.0 (decision D2a): a year's sections are on School years, a teacher's on Staff access.
const moved: Record<string, string> = { sf9: 'learners', sf10: 'learners', periods: 'years', sections: 'years' };

export const routeFor = (id: string, role: unknown) => {
  const route = routes.find(r => r.id === (moved[id] ?? id));
  if (route && available(route, role)) return route;
  return routes[0]!;
};
