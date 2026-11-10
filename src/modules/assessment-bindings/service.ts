import type {z} from 'zod';
import type {Context} from '../foundation/service.js';
import {AppError} from '../../core/errors.js';
import {bindingSchemas as s,type BindingOperationId} from './contracts.js';
const columns='id,offering_id,adoption_id,section_id,academic_year_id,status,version,created_at,updated_at';
export async function executeBinding(id:BindingOperationId,ctx:Context,input:{id?:string;body:unknown;query:unknown}) {
  const {tx}=ctx;
  if(id==='bindingList'){
    const q=input.query as z.infer<typeof s.list>;
    const rows=await tx.query(`select ${columns} from edunexus.assessment_policy_bindings where ($1='all' or status=$1)
      and ($2::uuid is null or academic_year_id=$2) and ($3::uuid is null or section_id=$3) and ($4::uuid is null or offering_id=$4)
      and ($5::uuid is null or adoption_id=$5) and ($6::uuid is null or id>$6) order by id limit $7`,
      [q.status,q.academic_year_id??null,q.section_id??null,q.offering_id??null,q.adoption_id??null,q.after_id??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_after_id:rows.length>q.limit?rows[q.limit-1]!.id:null}};
  }
  if(id==='bindingGet'||id==='bindingHistory'){
    const [row]=await tx.query(`select ${columns} from edunexus.assessment_policy_bindings where id=$1`,[input.id]);
    if(!row)throw new AppError(404,'NOT_FOUND','The policy binding was not found.');
    if(id==='bindingGet')return row;
    const q=input.query as z.infer<typeof s.history>;
    const rows=await tx.query(`select id,binding_id,binding_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id,recorded_at
      from edunexus.assessment_policy_binding_events where binding_id=$1 and ($2::integer is null or binding_version<$2) order by binding_version desc limit $3`,
      [input.id,q.before_version??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_before_version:rows.length>q.limit?rows[q.limit-1]!.binding_version:null}};
  }
  if(id==='bindingCreate'){
    const b=input.body as z.infer<typeof s.bind>;
    const [row]=await tx.query(`select ${columns} from edunexus.bind_assessment_policy($1,$2,$3,$4,$5)`,
      [b.offering_id,b.offering_version,b.adoption_id,b.adoption_version,b.reason]);
    return row;
  }
  const b=input.body as z.infer<typeof s.release>;
  const [row]=await tx.query(`select ${columns} from edunexus.release_assessment_policy_binding($1,$2,$3)`,[input.id,b.version,b.reason]);
  return row;
}
