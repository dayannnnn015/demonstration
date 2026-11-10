import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { operatorDatabase, operatorFailure } from './operator-db.js';

// Run once with the UUID of a school-controlled Supabase Auth user.
try {
  const userId = z.uuid().parse(process.env.BOOTSTRAP_PRINCIPAL_ID);
  const displayName = z.string().trim().min(1).max(150).parse(process.env.BOOTSTRAP_PRINCIPAL_NAME);
  const sql = operatorDatabase();
  try {
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(82412001)`;
      const existing = await tx`select user_id from edunexus.staff limit 1`;
      if (existing.length) throw new Error('Bootstrap is only for an empty staff registry');
      const users = await tx`select id from auth.users where id=${userId} and (email_confirmed_at is not null or invited_at is not null) and (banned_until is null or banned_until < now()) and deleted_at is null`;
      if (!users.length) throw new Error('Invite or confirm the principal identity in Supabase Auth first');
      await tx`select set_config('edunexus.actor_id',${userId},true),set_config('edunexus.request_id',${randomUUID()},true)`;
      await tx`insert into edunexus.staff (user_id,display_name,role) values (${userId},${displayName},'principal')`;
      await tx`insert into edunexus.school_profile (name,address) values ('Balili Elementary School','Tebteb, Balili, La Trinidad, Benguet')`;
    });
    console.log('School and initial principal bootstrapped. No sample learners or invented school ID were inserted.');
  } finally { await sql.end({ timeout: 5 }); }
} catch (error) { operatorFailure(error); }
