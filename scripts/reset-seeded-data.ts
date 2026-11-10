import { operatorDatabase, operatorFailure } from './operator-db.js';
import { resetSeeded, syntheticAccounts } from './seed/reset.js';

/**
 * Wipes a seeded hosted database before it holds real records. Irreversible.
 *
 *   npm run reset:seeded-data
 *     Dry run: says what would be removed, removes nothing.
 *
 *   RESET_CONFIRM=wipe-seeded-data npm run reset:seeded-data
 *     Empties every school record, journal and audit row; keeps the real staff
 *     accounts and the school profile; removes every identity under
 *     the synthetic domains (see `syntheticDomains`). Refuses on a database that carries no seeded-data
 *     notice, because there the records may be real.
 *
 * Take a backup first if anything entered since seeding should be kept: this
 * cannot tell a real record typed into the seeded database from a seeded one.
 */
const sql = operatorDatabase();
const reserved = await sql.reserve();
const op = { async query(text: string, params: unknown[] = []) { return [...await reserved.unsafe(text, params as never[])] as Record<string, unknown>[]; } };
try {
  const [marker] = await op.query("select to_regclass('edunexus.seeded_data_notice') is not null as ready");
  const [seeded] = marker?.ready ? await op.query('select count(*)::int n from edunexus.seeded_data_notice') : [{ n: 0 }];
  if (!Number(seeded?.n)) throw new Error('No seeded-data notice: refusing to wipe a database whose records may be real.');
  const synthetic = (await op.query(`select id from auth.users where ${syntheticAccounts('email')}`)).map(r => String(r.id));
  const [counts] = await op.query(`select (select count(*) from edunexus.learners)::int learners, (select count(*) from edunexus.enrollments)::int enrollments,
    (select count(*) from edunexus.attendance_marks)::int marks, (select count(*) from edunexus.assessment_scores)::int scores, (select count(*) from edunexus.staff)::int staff`);
  console.log(`Would wipe: ${JSON.stringify(counts)}, and remove ${synthetic.length} synthetic identities with their staff rows.`);
  if (process.env.RESET_CONFIRM !== 'wipe-seeded-data') {
    console.log('Dry run only. Set RESET_CONFIRM=wipe-seeded-data to wipe for real.');
  } else {
    await resetSeeded(op, synthetic, console.log);
    const [after] = await op.query('select (select count(*) from edunexus.learners)::int learners, (select count(*) from edunexus.staff)::int staff, (select name from edunexus.school_profile) school');
    console.log(`Wiped. Remaining: ${JSON.stringify(after)}. Hard-refresh the workspace; the seeded banner is gone.`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); operatorFailure(error); }
finally { reserved.release(); await sql.end({ timeout: 5 }); }
