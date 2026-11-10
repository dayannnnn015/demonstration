import type {z} from 'zod';
import type {Query} from '../../core/db.js';
import {AppError} from '../../core/errors.js';
import type {Context} from '../foundation/service.js';
import {priorSchemas as s,type PriorOperationId} from './contracts.js';

// Thin, like every module here: the database function does the validating, the
// version check and the journal, all in the one transaction.

/** Encoded history names a learner, so every read and write of it is logged like the register's. */
async function logged(tx:Query,resource:string,ids:string[]){if(ids.length)await tx.query('select edunexus.record_access($1,$2::uuid[])',[resource,ids]);}
const call=async<T>(tx:Query,sql:string,params:unknown[])=>(await tx.query<{r:T}>(`select ${sql} r`,params))[0]!.r;
/**
 * A jsonb argument, serialised here rather than left to the driver.
 *
 * node-postgres sends a JS **array** as a PostgreSQL array literal, not as
 * JSON, so binding one straight to a `jsonb` parameter fails the cast with
 * `22P02`. A plain object happens to be JSON-encoded, which is why only the
 * learning areas broke — and why the tests did not catch it: PGlite encodes
 * both the same way, so this is one of the few faults that can only be seen
 * against a real server. The school hit it on every attempt to add a school
 * year for three sessions.
 */
const json=(value:unknown)=>JSON.stringify(value);
/** The retained profile behind an id, as every learner read resolves it. Null when the caller may not read it at all. */
async function retained(tx:Query,learner:string){
  const id=await call<string|null>(tx,'edunexus.visible_learner_identity($1)',[learner]);
  if(!id)throw new AppError(404,'NOT_FOUND','The learner was not found.');
  return id;
}

type Block={id:string;learner_id:string};
export async function executePrior(id:PriorOperationId,ctx:Context,input:{body:unknown;query:unknown;id?:string}){
  const {tx}=ctx;
  switch(id){
    case 'encodingProgressGet':{
      // Counts only: no learner is named and no rating is read, so no access
      // row is written, exactly as `gradeEntryGet` does it.
      return await call<unknown>(tx,'edunexus.read_encoding_progress($1)',[input.id!]);
    }
    case 'priorRecordsGet':{
      const records=await call<{learner:{id:string}}>(tx,'edunexus.read_learner_prior_records($1)',[input.id!]);
      await logged(tx,'priorRecordsGet',[records.learner.id]);
      return records;
    }
    case 'priorYearRecord':{
      const b=input.body as z.infer<typeof s.create>;
      const block=await call<Block>(tx,'edunexus.write_learner_prior_year(null,0,$1,$2::jsonb,$3::jsonb,$4)',[input.id!,json(b.year),json(b.subjects),b.reason]);
      await logged(tx,'priorRecordsWrite',[block.learner_id]);
      return block;
    }
    case 'priorYearUpdate':{
      const b=input.body as z.infer<typeof s.update>;
      const block=await call<Block>(tx,'edunexus.write_learner_prior_year($1,$2,null,$3::jsonb,$4::jsonb,$5)',[input.id!,b.version,json(b.year),json(b.subjects),b.reason]);
      await logged(tx,'priorRecordsWrite',[block.learner_id]);
      return block;
    }
    case 'priorYearRemove':{
      const b=input.body as z.infer<typeof s.remove>;
      // The answer is the block as it was, so the screen can say what was removed.
      const block=await call<Block>(tx,'edunexus.delete_learner_prior_year($1,$2,$3)',[input.id!,b.version,b.reason]);
      await logged(tx,'priorRecordsWrite',[block.learner_id]);
      return block;
    }
    case 'eligibilityRecord':{
      const {reason,version,...payload}=input.body as z.infer<typeof s.eligibility>;
      const record=await call<Block>(tx,'edunexus.write_learner_eligibility($1,$2,$3::jsonb,$4)',[input.id!,version,json(payload),reason]);
      await logged(tx,'priorRecordsWrite',[record.learner_id]);
      return record;
    }
    case 'priorRecordHistory':{
      const q=input.query as z.infer<typeof s.history>;
      const learner=await retained(tx,input.id!);
      // Row policy limits the journal to a manager and to an adviser of this
      // learner's current section, exactly as the records themselves are limited.
      // `order by` is qualified with the table, as every other journal here is,
      // and it has to be: `id::text` takes the output name `id`, and a bare `id`
      // in ORDER BY binds to the output column before the input one. That sorts
      // the identity column as text, so row 9 outranks row 10 and a newest-first
      // page silently loses the newest rows -- and the cursor taken from it then
      // skips the rest. Proved in tests/prior-records.test.ts.
      const rows=await tx.query<{id:string}>(`select id::text,prior_year_id,kind,action,before_snapshot,after_snapshot,reason,actor_user_id,recorded_at
        from edunexus.learner_prior_record_events where learner_id=$1 and ($2::bigint is null or id<$2)
        order by edunexus.learner_prior_record_events.id desc limit $3`,
        [learner,q.before_id??null,q.limit+1]);
      const items=rows.slice(0,q.limit);
      // The snapshots carry the learner's grades, so reading them is a read of their records.
      if(items.length)await logged(tx,'priorRecordHistory',[learner]);
      return {items,pagination:{limit:q.limit,next_before_id:rows.length>q.limit?rows[q.limit-1]!.id:null}};
    }
  }
}
