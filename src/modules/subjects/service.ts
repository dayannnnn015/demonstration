import type {z} from 'zod';
import type {Context} from '../foundation/service.js';
import {AppError} from '../../core/errors.js';
import {subjectSchemas as s,type SubjectOperationId} from './contracts.js';
const columns='id,code,name,kind,grade_levels,active,version,created_at,updated_at';
export async function executeSubject(id:SubjectOperationId,ctx:Context,input:{id?:string;body:unknown;query:unknown}) {
  const {tx}=ctx;
  // Catalog metadata contains no learner data. Writes have protected revision and change audits.
  if(id==='subjectList'){
    const q=input.query as z.infer<typeof s.list>;
    const rows=await tx.query(`select ${columns} from edunexus.subjects where ($1='all' or active=($1='true'))
      and ($2::text is null or strpos(lower(code||' '||name),lower($2))>0) and ($3::uuid is null or id>$3) order by id limit $4`,[q.active,q.q??null,q.after_id??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_after_id:rows.length>q.limit?rows[q.limit-1]!.id:null}};
  }
  if(id==='subjectGet'||id==='subjectHistory'){
    const [row]=await tx.query(`select ${columns} from edunexus.subjects where id=$1`,[input.id]);if(!row)throw new AppError(404,'NOT_FOUND','The subject was not found.');
    if(id==='subjectGet')return row;
    const q=input.query as z.infer<typeof s.history>;
    const rows=await tx.query(`select id,subject_id,subject_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id,recorded_at
      from edunexus.subject_events where subject_id=$1 and ($2::integer is null or subject_version<$2) order by subject_version desc limit $3`,[input.id,q.before_version??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_before_version:rows.length>q.limit?rows[q.limit-1]!.subject_version:null}};
  }
  if(id==='subjectCreate'){
    const b=input.body as z.infer<typeof s.create>;
    const [row]=await tx.query(`select ${columns} from edunexus.create_subject($1,$2,$3,$4::integer[],$5,$6)`,[b.code,b.name,b.kind,b.grade_levels,b.active,b.reason]);return row;
  }
  const b=input.body as z.infer<typeof s.update>;
  const [row]=await tx.query(`select ${columns} from edunexus.update_subject($1,$2,$3,$4,$5::integer[],$6,$7)`,[input.id,b.version,b.name,b.kind,b.grade_levels,b.active,b.reason]);return row;
}
