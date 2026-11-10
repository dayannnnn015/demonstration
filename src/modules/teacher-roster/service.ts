import type {z} from 'zod';
import type {Query} from '../../core/db.js';
import type {Context} from '../foundation/service.js';
import {rosterSchemas as s,type RosterOperationId} from './contracts.js';

/**
 * Thin, like every module here: the database functions do the authorising, the
 * validating and the journalling, in one transaction.
 *
 * The one thing this layer owns is the **privacy log**. Taking a learner in
 * names learners outside the adviser's own class — that is the point of the
 * feature and its cost — so every read and every write here writes a
 * `record_access_events` row naming exactly the records it touched, as every
 * other read that names a learner does.
 */

async function logged(tx:Query,resource:string,ids:string[]){
  const unique=[...new Set(ids)];
  // An access row holds at most 100 identifiers, so a longer disclosure is several rows.
  if(!unique.length){await tx.query('select edunexus.record_access($1,$2::uuid[])',[resource,[]]);return;}
  for(let n=0;n<unique.length;n+=100)await tx.query('select edunexus.record_access($1,$2::uuid[])',[resource,unique.slice(n,n+100)]);
}
const call=async<T>(tx:Query,sql:string,params:unknown[])=>(await tx.query<{r:T}>(`select ${sql} r`,params))[0]!.r;

type Candidate={learner_id:string};
type Enrollment={id:string;learner_id:string;section_id:string|null;version:number};

export async function executeRoster(id:RosterOperationId,ctx:Context,input:{body:unknown;query:unknown;id?:string}){
  const {tx}=ctx;
  switch(id){
    case 'pullableList':{
      const q=input.query as z.infer<typeof s.pullable>;
      const answer=await call<{items:Candidate[]}>(tx,'edunexus.read_pullable_learners($1,$2,$3)',[input.id!,q.search??null,q.limit]);
      await logged(tx,'pullableList',answer.items.map(i=>i.learner_id));
      return answer;
    }
    case 'learnerPull':{
      const b=input.body as z.infer<typeof s.pull>;
      // Which of the two writes applies is decided inside the function, from the
      // records rather than from what the caller says. It has to be: an adviser
      // cannot *see* an unplaced learner's enrolment, so a lookup here under row
      // security would find nothing and quietly enrol them a second time.
      const done=await call<{enrollment:Enrollment;how:'assign'|'enrol'}>(tx,
        'edunexus.pull_learner_into_section($1,$2,$3,$4,$5)',[input.id!,b.learner_id,b.version??null,b.enrolled_on,b.entry_kind]);
      await logged(tx,'learnerPull',[done.enrollment.learner_id]);
      return done;
    }
    case 'learnerRegister':{
      const {enrolled_on,entry_kind,...profile}=input.body as z.infer<typeof s.register>;
      // Stringified and cast, like every other jsonb argument here. It was a
      // bare object, which the driver happens to JSON-encode — the same
      // fragility that broke the academic history when the value was an array.
      const made=await call<{learner:{id:string}}>(tx,'edunexus.register_learner_into_section($1,$2::jsonb,$3,$4)',[input.id!,JSON.stringify(profile),enrolled_on,entry_kind]);
      await logged(tx,'learnerRegister',[made.learner.id]);
      return made;
    }
  }
}
