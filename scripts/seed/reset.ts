/**
 * The go-live wipe for a seeded database: every school record goes, the real
 * staff accounts and the school profile stay.
 *
 * Every table in the schema except those in `keptTables` is truncated
 * together, journals and audit included, so nothing invented survives as
 * history. The table list is read from the database, so a table added by a
 * later migration is wiped too rather than silently kept. Truncation is the
 * operator's tool, not the runtime's: the API can neither delete nor truncate
 * anything, and this changes none of that. Afterwards the synthetic staff and
 * their sign-in identities are removed, the school name loses its seeded label,
 * and the seeded-data notice is gone with the rest, which is what removes the
 * banner from every screen.
 */
import { seededSchoolHead } from './school.js';

export type Operator = { query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]> };

/** The synthetic accounts' reserved domains: the first seed's, and since 13 October the realistic-looking one. */
export const syntheticDomains = ['seed.edunexus.invalid', 'balili-es.invalid'];
export const syntheticAccounts = (column: string) => `(${syntheticDomains.map(d => `${column} like '%@${d}'`).join(' or ')})`;

/**
 * Kept with the staff: the invitations that brought the real staff in are
 * records about real people, never seeded (synthetic staff are made directly,
 * never invited). They reference only `staff`, so they survive a truncation of
 * everything else; any that names a synthetic account goes with it.
 */
export const keptTables = ['staff', 'school_profile', 'staff_invitations', 'staff_invitation_events',
  // A real person's photo, picture and preferences, and their journal, are theirs and never seeded (0043).
  'staff_profiles', 'staff_photos', 'staff_profile_events'];

export async function resetSeeded(op: Operator, synthetic: string[], log: (message: string) => void) {
  const tables = (await op.query(`select tablename from pg_tables where schemaname='edunexus' and not (tablename = any($1::text[])) order by tablename`, [keptTables]))
    .map(r => `edunexus.${String(r.tablename)}`);
  await op.query('begin');
  try {
    // Before the truncation, so the audit row this update writes is wiped with the rest.
    await op.query("update edunexus.school_profile set name=regexp_replace(name,'\\s*\\(SEEDED TEST DATA\\)$','') where name like '%(SEEDED TEST DATA)'");
    // The seed's invented school head (13 October) goes too; the principal enters the real one.
    await op.query("update edunexus.school_profile set school_head_name=null,school_head_position=null where school_head_name like '%(SEEDED TEST DATA)' or school_head_name=$1", [seededSchoolHead]);
    // The front page's contact details are the school's own: the seed never invents a phone, an e-mail, office hours or a
    // Facebook page, so whatever is there was entered for real, and it survives the wipe that empties the rest of the page.
    const [contact] = await op.query('select phone,email,office_hours,facebook_url from edunexus.site_settings where id=1');
    await op.query(`truncate ${tables.join(', ')} restart identity`);
    log(`Emptied ${tables.length} tables.`);
    // Migration 0037 created the front page's one settings row; without it Public site cannot save the school's details.
    await op.query('insert into edunexus.site_settings(id,phone,email,office_hours,facebook_url) values(1,$1,$2,$3,$4) on conflict(id) do nothing',
      [contact?.phone ?? null, contact?.email ?? null, contact?.office_hours ?? null, contact?.facebook_url ?? null]);
    // As the migration created it, with no history: the audit row its insert writes goes too.
    await op.query('truncate edunexus.audit_events restart identity');
    await op.query(`delete from edunexus.staff_invitation_events where actor_user_id = any($1::uuid[])
      or invitation_id in (select id from edunexus.staff_invitations where requested_by = any($1::uuid[]) or linked_user_id = any($1::uuid[]))`, [synthetic]);
    await op.query('delete from edunexus.staff_invitations where requested_by = any($1::uuid[]) or linked_user_id = any($1::uuid[])', [synthetic]);
    // A synthetic account's profile and photo go with its staff row; its journal rows first, which would hold the row.
    await op.query('delete from edunexus.staff_profile_events where user_id = any($1::uuid[]) or actor_user_id = any($1::uuid[])', [synthetic]);
    const [staff] = await op.query('with gone as (delete from edunexus.staff where user_id = any($1::uuid[]) returning 1) select count(*)::int n from gone', [synthetic]);
    const [users] = await op.query('with gone as (delete from auth.users where id = any($1::uuid[]) returning 1) select count(*)::int n from gone', [synthetic]);
    log(`Removed ${String(staff?.n)} synthetic staff and ${String(users?.n)} synthetic identities.`);
    await op.query('commit');
  } catch (error) { await op.query('rollback'); throw error; }
}
