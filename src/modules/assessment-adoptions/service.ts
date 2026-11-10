import type {z} from 'zod';
import type {Context} from '../foundation/service.js';
import {AppError} from '../../core/errors.js';
import {adoptionSchemas as s,type AdoptionOperationId} from './contracts.js';
const columns='id,academic_year_id,policy_id,policy_version,policy_snapshot,grade_levels,adopted_on,adoption_reference,status,version,created_at,updated_at';
export async function executeAdoption(id:AdoptionOperationId,ctx:Context,input:{id?:string;body:unknown;query:unknown}) {
  const {tx}=ctx;
  if(id==='adoptionList'){
    const q=input.query as z.infer<typeof s.list>;
    const rows=await tx.query(`select ${columns} from edunexus.assessment_policy_adoptions where ($1='all' or status=$1)
      and ($2::uuid is null or academic_year_id=$2) and ($3::uuid is null or policy_id=$3) and ($4::uuid is null or id>$4) order by id limit $5`,
      [q.status,q.academic_year_id??null,q.policy_id??null,q.after_id??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_after_id:rows.length>q.limit?rows[q.limit-1]!.id:null}};
  }
  if(id==='adoptionGet'||id==='adoptionHistory'){
    const [row]=await tx.query(`select ${columns} from edunexus.assessment_policy_adoptions where id=$1`,[input.id]);
    if(!row)throw new AppError(404,'NOT_FOUND','The policy adoption was not found.');
    if(id==='adoptionGet')return row;
    const q=input.query as z.infer<typeof s.history>;
    const rows=await tx.query(`select id,adoption_id,adoption_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id,recorded_at
      from edunexus.assessment_policy_adoption_events where adoption_id=$1 and ($2::integer is null or adoption_version<$2) order by adoption_version desc limit $3`,
      [input.id,q.before_version??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_before_version:rows.length>q.limit?rows[q.limit-1]!.adoption_version:null}};
  }
  if(id==='adoptionCreate'){
    const b=input.body as z.infer<typeof s.adopt>;
    const [row]=await tx.query(`select ${columns} from edunexus.adopt_assessment_policy($1,$2,$3,$4::date,$5,$6)`,
      [b.academic_year_id,b.policy_id,b.policy_version,b.adopted_on,b.adoption_reference,b.reason]);
    return row;
  }
  const b=input.body as z.infer<typeof s.withdraw>;
  const [row]=await tx.query(`select ${columns} from edunexus.withdraw_assessment_policy_adoption($1,$2,$3)`,[input.id,b.version,b.reason]);
  return row;
}
