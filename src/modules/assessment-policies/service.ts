import type {z} from 'zod';
import type {Context} from '../foundation/service.js';
import {AppError} from '../../core/errors.js';
import {policySchemas as s,type PolicyOperationId} from './contracts.js';
const columns='id,code,name,source_reference,grade_levels,components,status,version,created_at,updated_at';
export async function executePolicy(id:PolicyOperationId,ctx:Context,input:{id?:string;body:unknown;query:unknown}) {
  const {tx}=ctx;
  if(id==='policyList'){
    const q=input.query as z.infer<typeof s.list>;
    const rows=await tx.query(`select ${columns} from edunexus.assessment_policy_drafts where ($1='all' or status=$1)
      and ($2::text is null or strpos(lower(code||' '||name),lower($2))>0) and ($3::uuid is null or id>$3) order by id limit $4`,[q.status,q.q??null,q.after_id??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_after_id:rows.length>q.limit?rows[q.limit-1]!.id:null}};
  }
  if(id==='policyGet'||id==='policyHistory'){
    const [row]=await tx.query(`select ${columns} from edunexus.assessment_policy_drafts where id=$1`,[input.id]);if(!row)throw new AppError(404,'NOT_FOUND','The policy draft was not found.');
    if(id==='policyGet')return row;
    const q=input.query as z.infer<typeof s.history>;
    const rows=await tx.query(`select id,policy_id,policy_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id,recorded_at
      from edunexus.assessment_policy_draft_events where policy_id=$1 and ($2::integer is null or policy_version<$2) order by policy_version desc limit $3`,[input.id,q.before_version??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_before_version:rows.length>q.limit?rows[q.limit-1]!.policy_version:null}};
  }
  if(id==='policyCreate'){
    const b=input.body as z.infer<typeof s.create>;
    const [row]=await tx.query(`select ${columns} from edunexus.create_assessment_policy_draft($1,$2,$3,$4::integer[],$5::jsonb,$6,$7)`,[b.code,b.name,b.source_reference,b.grade_levels,JSON.stringify(b.components),b.status,b.reason]);return row;
  }
  const b=input.body as z.infer<typeof s.update>;
  const [row]=await tx.query(`select ${columns} from edunexus.update_assessment_policy_draft($1,$2,$3,$4,$5::integer[],$6::jsonb,$7,$8)`,[input.id,b.version,b.name,b.source_reference,b.grade_levels,JSON.stringify(b.components),b.status,b.reason]);return row;
}
