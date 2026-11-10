import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Authenticator, Identity } from './core/auth.js';
import type { IdentityProvisioner } from './core/identities.js';
import { assertRuntimeRole, type Database, type Query } from './core/db.js';
import { AppError, normalizeError } from './core/errors.js';
import { uuid } from './modules/foundation/contracts.js';
import { operations } from './operations.js';
import { executeRegistry } from './modules/registry/service.js';
import { executeReview } from './modules/registry-review/service.js';
import { executeTimeline } from './modules/enrollment-timeline/service.js';
import { executeIdentity } from './modules/learner-identity/service.js';
import { executeEnrollmentRecord } from './modules/enrollment-records/service.js';
import { executePlacement } from './modules/grade-placement/service.js';
import { executeCalendar } from './modules/calendar/service.js';
import { executeAttendance } from './modules/attendance/service.js';
import { executePolicy } from './modules/assessment-policies/service.js';
import { executeAdoption } from './modules/assessment-adoptions/service.js';
import { executeBinding } from './modules/assessment-bindings/service.js';
import { executeInvitation } from './modules/staff-invitations/service.js';
import { executeScore } from './modules/assessment-scores/service.js';
import { executeOffering } from './modules/section-subjects/service.js';
import { executeSubject } from './modules/subjects/service.js';
import { executeFollowup } from './modules/attendance-followups/service.js';
import { executeMonitor } from './modules/attendance-monitor/service.js';
import { executeMonth } from './modules/attendance-months/service.js';
import { executeLearnerRecord } from './modules/learner-record/service.js';
import { executeSchoolReport } from './modules/school-reports/service.js';
import { executeSubmission } from './modules/roster-submissions/service.js';
import { executeForm } from './modules/forms/service.js';
import { executeReport } from './modules/report-records/service.js';
import { executePrior } from './modules/prior-records/service.js';
import { executeRoster } from './modules/teacher-roster/service.js';
import { executeNotification } from './modules/notifications/service.js';
import { executeNextYear } from './modules/next-year/service.js';
import { currentStaff, executeOperation } from './modules/foundation/service.js';
import { openapi } from './openapi.js';
import { appPage, sitePage } from './app-page.js';
import { executeSite, readPublicSite } from './modules/site/service.js';
import { executeProfile } from './modules/profiles/service.js';

export interface Dependencies { database: Database; auth: Authenticator; origins: string[]; logger: Logger; publicAuth?: { url: string; publishableKey: string }; identities?: IdentityProvisioner; }

async function withActor<T>(database: Database, identity: Identity, requestId: string, work: (tx: Query) => Promise<T>) {
  return database.transaction(async tx => {
    await assertRuntimeRole(tx);
    await tx.query(`select set_config('edunexus.actor_id',$1,true), set_config('edunexus.request_id',$2,true),
      set_config('statement_timeout','8000',true),set_config('lock_timeout','3000',true)`, [identity.userId, requestId]);
    return work(tx);
  });
}

export function createApp(deps: Dependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('query parser', 'simple');
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => deps.logger.info({ requestId, method: req.method, route: req.route?.path ?? 'unmatched', status: res.statusCode, durationMs: Math.round(performance.now() - started) }, 'request'));
    next();
  });
  app.use(helmet());
  // Before CORS: a module script is always fetched in CORS mode, and these
  // hashed bundle files are public and carry no credentials, so gating them on
  // the API origin allowlist would only break the workspace. Vercel serves them
  // directly in production; this covers local runs and npm start.
  if (deps.publicAuth) app.use(express.static('public', { index: false, maxAge: '1y', immutable: true }));
  app.use(cors({
    origin(origin, callback) { callback(origin && !deps.origins.includes(origin) ? new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed.') : null, true); },
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    credentials: false,
    maxAge: 600,
  }));
  // Register the two larger, bounded timeline parsers before the default one.
  // Express skips a parsed body, preserving the 32 KiB limit everywhere else.
  for (const operation of operations) {
    if ('bodyLimit' in operation) app[operation.method](operation.path, express.json({ limit: operation.bodyLimit, strict: true, inflate: false }));
  }
  app.use(express.json({ limit: '32kb', strict: true, inflate: false }));
  // With no public auth configuration there is no workspace to serve, so the
  // root stays a machine-readable descriptor. Otherwise it opens the workspace,
  // because a person typing the bare address expects the app, not JSON.
  if (!deps.publicAuth) app.get('/', (_req, res) => res.json({ service: 'EDUNEXUS', health: '/health/live', contract: '/openapi.json' }));
  app.get('/health/live', (_req, res) => res.json({ status: 'ok', version: openapi.info.version }));
  app.get('/health/ready', async (_req, res) => {
    try {
      await deps.database.transaction(async tx => {
        await assertRuntimeRole(tx);
        await tx.query(`select set_config('statement_timeout','3000',true)`);
        const [state] = await tx.query<{ ready: boolean }>(`select edunexus.is_ready()
          and to_regclass('edunexus.learners') is not null
          and to_regclass('edunexus.enrollment_events') is not null
          and to_regclass('edunexus.record_access_events') is not null
          and to_regclass('edunexus.import_previews') is not null
          and to_regclass('edunexus.lrn_corrections') is not null
          and to_regclass('edunexus.enrollment_corrections') is not null
          and to_regprocedure('edunexus.get_enrollment_timeline(uuid)') is not null
          and to_regclass('edunexus.learner_identity_events') is not null
          and to_regclass('edunexus.enrollment_record_events') is not null
          and to_regprocedure('edunexus.preview_enrollment_placement(uuid,integer,integer,jsonb,text)') is not null
          and to_regclass('edunexus.calendar_review_events') is not null
          and to_regclass('edunexus.attendance_review_events') is not null
          and to_regclass('edunexus.attendance_month_events') is not null
          and to_regprocedure('edunexus.read_attendance_monitor(uuid,date,date,text,integer,uuid)') is not null
          and to_regclass('edunexus.attendance_followup_events') is not null
          and to_regclass('edunexus.subject_events') is not null
          and to_regclass('edunexus.section_subject_events') is not null
          and to_regclass('edunexus.assessment_policy_draft_events') is not null
          and to_regclass('edunexus.assessment_policy_adoption_events') is not null
          and to_regclass('edunexus.assessment_policy_binding_events') is not null
          and to_regclass('edunexus.staff_invitation_events') is not null
          and to_regclass('edunexus.assessment_score_events') is not null
          and to_regprocedure('edunexus.read_assessment_components(uuid)') is not null
          and to_regprocedure('edunexus.read_enrollment_attendance(uuid)') is not null
          and to_regprocedure('edunexus.read_sf4_counts(uuid,date)') is not null
          and to_regclass('edunexus.roster_submission_events') is not null
          and to_regprocedure('edunexus.read_sf4_source(uuid,date)') is not null
          and to_regprocedure('edunexus.read_report_records(uuid)') is not null
          and to_regprocedure('edunexus.read_sf10_source(uuid)') is not null
          and to_regprocedure('edunexus.read_promotions(uuid,uuid)') is not null
          and to_regprocedure('edunexus.read_next_year_source(uuid,uuid)') is not null
          and to_regprocedure('edunexus.read_grade_entry(uuid)') is not null
          and to_regprocedure('edunexus.read_public_site()') is not null
          and to_regprocedure('edunexus.read_site_faqs(boolean)') is not null
          and to_regprocedure('edunexus.record_report_card(uuid,jsonb,text)') is not null
          and to_regprocedure('edunexus.read_my_profile()') is not null
          and to_regprocedure('edunexus.read_my_sessions(uuid)') is not null
          and to_regprocedure('edunexus.read_my_activity(text,bigint,integer)') is not null
          and to_regprocedure('edunexus.read_learner_prior_records(uuid)') is not null
          and to_regclass('edunexus.learner_prior_record_events') is not null
          and to_regclass('edunexus.notifications') is not null
          and to_regprocedure('edunexus.read_pullable_learners(uuid,text,integer)') is not null
          and to_regprocedure('edunexus.read_encoding_progress(uuid)') is not null
          and to_regprocedure('edunexus.read_waiting_counts()') is not null
          and to_regprocedure('edunexus.read_promotion_readiness(uuid)') is not null
          and to_regprocedure('edunexus.read_sf9_history(uuid)') is not null as ready`);
        if (!state?.ready) throw new Error('School bootstrap is incomplete');
        await tx.query('select edunexus.consume_request()');
      });
      res.json({ status: 'ready' });
    } catch { throw new AppError(503, 'NOT_READY', 'The service is not ready.'); }
  });
  app.get('/openapi.json', (_req, res) => res.json(openapi));
  // The front page's data, for anyone and without a token: only what the school
  // published, its profile and its school-wide days without classes. A minute's
  // shared cache keeps a busy morning off the database.
  app.get('/api/v1/public/site', async (_req, res) => {
    const data = await deps.database.transaction(async tx => {
      await assertRuntimeRole(tx);
      await tx.query("select set_config('statement_timeout','5000',true)");
      return readPublicSite(tx);
    });
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
    res.json({ data, requestId: res.locals.requestId });
  });
  if (deps.publicAuth) {
    // The public front page. It talks to this origin only: no sign-in service, no third party. Since 0.106.0 it may
    // frame one thing, this origin's own /app, which is how Staff portal opens the workspace's sign-in over the page
    // (the UI notes of 8 November, note 7). The sign-in code and the call to the sign-in service stay in /app.
    app.get(['/', '/announcements', '/announcements/:id', '/calendar', '/faq', '/about', '/contact'], (_req, res) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      // Kept out of search engines until the school goes live with real records (see the runbooks).
      if (process.env.EDUNEXUS_SITE_INDEX !== 'yes') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.type('html').send(sitePage());
    });
    app.get(['/account/setup', '/app'], (_req, res) => {
      // The bundle is hashed and same-origin; styles and fonts ship as files.
      // `img-src 'self'` exists for /favicon.svg, which a browser fetches as an
      // image and default-src would otherwise block. It stays at 'self' with no
      // `data:`. A short, closed list is served under it besides, every one from
      // /images/ and versioned in its name: the front page's hillside, which the
      // sign-in page shows, and the DepEd seal, DepEd wordmark and school seal at
      // the heads of the SF9 and SF10. Past those the workspace renders no image
      // -- a staff photo is drawn on a canvas from bytes read through the API, and
      // the brand mark is a vector redraw, both for this reason. Every file on the
      // list is one this repository ships, and nothing user-supplied is ever
      // served from here. Adding to the list needs a decision in constraints.md.
      // Framed by this origin and no other (0.106.0): the front page's Staff portal panel holds the sign-in, and helmet's
      // X-Frame-Options: SAMEORIGIN says the same for older browsers. Another site still cannot frame the workspace.
      res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self' ${deps.publicAuth!.url}; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.type('html').send(appPage());
    });
    app.get('/account/config', (_req, res) => res.json(deps.publicAuth));
  }

  for (const operation of operations) {
    app[operation.method](operation.path, async (req, res) => {
      const authorization = req.headers.authorization;
      if (!authorization || authorization.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/i.test(authorization)) throw new AppError(401, 'AUTH_REQUIRED', 'A staff bearer token is required.');
      const identity = await deps.auth.verify(authorization.slice(7));
      // Commit the rate counter separately: a failed business transaction must
      // still consume a request. No personal data is stored in the counter.
      const caller = await withActor(deps.database, identity, res.locals.requestId, async tx => {
        const staff = await currentStaff(tx, identity);
        const [bucket] = await tx.query<{ allowed: boolean }>('select edunexus.consume_request() as allowed');
        return { allowed: bucket?.allowed, role: staff.role };
      });
      if (!caller.allowed) { res.setHeader('Retry-After', '60'); throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again in one minute.'); }
      // Refuse before reading the input: an adviser sending a manager's request
      // is told it is not theirs, not which of its fields are wrong. The check
      // inside the transaction stays, since a role can change between the two.
      if ('manager' in operation && caller.role === 'teacher') throw new AppError(403, 'FORBIDDEN', 'A principal or administrative officer account is required.');
      const rawId = (req.params as Record<string, string>).id;
      const id = rawId === undefined ? undefined : uuid.parse(rawId);
      if ('body' in operation && !req.is('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'Send an application/json request body.');
      const body = 'body' in operation ? operation.body.parse(req.body) : undefined;
      const query = 'query' in operation ? operation.query.parse(req.query) : z.strictObject({}).parse(req.query);
      const data = await withActor(deps.database, identity, res.locals.requestId, async tx => {
        const staff = await currentStaff(tx, identity);
        if ('manager' in operation && staff.role === 'teacher') throw new AppError(403, 'FORBIDDEN', 'A principal or administrative officer account is required.');
        const input = { body, query, ...(id ? { id } : {}) };
        const context = { tx, staff, identity, client: { userAgent: req.get('user-agent') }, ...(deps.identities ? { identities: deps.identities } : {}) };
        if (!('module' in operation)) return executeOperation(operation.id, context, input);
        if (operation.module === 'registry') return executeRegistry(operation.id, context, input);
        if (operation.module === 'registry-review') return executeReview(operation.id, context, input);
        if (operation.module === 'enrollment-timeline') return executeTimeline(operation.id, context, input);
        if (operation.module === 'learner-identity') return executeIdentity(operation.id, context, input);
        if (operation.module === 'enrollment-records') return executeEnrollmentRecord(operation.id, context, input);
        if (operation.module === 'grade-placement') return executePlacement(operation.id, context, input);
        if (operation.module === 'assessment-policies') return executePolicy(operation.id, context, input);
        if (operation.module === 'assessment-adoptions') return executeAdoption(operation.id, context, input);
        if (operation.module === 'assessment-bindings') return executeBinding(operation.id, context, input);
        if (operation.module === 'staff-invitations') return executeInvitation(operation.id, context, input);
        if (operation.module === 'assessment-scores') return executeScore(operation.id, context, input);
        if (operation.module === 'learner-record') return executeLearnerRecord(operation.id, context, input);
        if (operation.module === 'school-reports') return executeSchoolReport(operation.id, context, input);
        if (operation.module === 'roster-submissions') return executeSubmission(operation.id, context, input);
        if (operation.module === 'forms') return executeForm(operation.id, context, input);
        if (operation.module === 'report-records') return executeReport(operation.id, context, input);
        if (operation.module === 'prior-records') return executePrior(operation.id, context, input);
        if (operation.module === 'teacher-roster') return executeRoster(operation.id, context, input);
        if (operation.module === 'notifications') return executeNotification(operation.id, context, input);
        if (operation.module === 'next-year') return executeNextYear(operation.id, context, input);
        if (operation.module === 'site') return executeSite(operation.id, context, input);
        if (operation.module === 'profiles') return executeProfile(operation.id, context, input);
        if (operation.module === 'section-subjects') return executeOffering(operation.id, context, input);
        if (operation.module === 'subjects') return executeSubject(operation.id, context, input);
        if (operation.module === 'attendance-followups') return executeFollowup(operation.id, context, input);
        if (operation.module === 'attendance-monitor') return executeMonitor(context, input);
        if (operation.module === 'calendar') return executeCalendar(operation.id, context, input);
        return operation.module === 'attendance' ? executeAttendance(operation.id, context, input) : executeMonth(operation.id, context, input);
      });
      res.status(operation.method === 'post' ? 201 : 200).json({ data, requestId: res.locals.requestId });
    });
  }
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'The endpoint was not found.')));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) return _next(error);
    if (error instanceof z.ZodError) {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Review the request fields.', fields: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }, requestId: res.locals.requestId });
      return;
    }
    const type = (error as { type?: string } | null)?.type;
    const normalized = type === 'entity.parse.failed' ? new AppError(400, 'INVALID_JSON', 'The request body is not valid JSON.')
      : type === 'entity.too.large' ? new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.')
      : type === 'encoding.unsupported' || type === 'charset.unsupported' ? new AppError(415, 'UNSUPPORTED_ENCODING', 'Use uncompressed UTF-8 JSON.')
      : normalizeError(error);
    if (normalized.status >= 500) deps.logger.error({ requestId: res.locals.requestId, code: normalized.code }, 'request failed');
    if (normalized.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(normalized.status).json({ error: { code: normalized.code, message: normalized.message, ...(normalized.fields ? { fields: normalized.fields } : {}) }, requestId: res.locals.requestId });
  };
  app.use(errors);
  return app;
}
