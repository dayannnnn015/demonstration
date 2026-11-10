import type {z} from 'zod';
import type {Context} from '../foundation/service.js';
import {AppError} from '../../core/errors.js';
import {identitySchemas as s,type IdentityOperationId} from './contracts.js';
const columns='id,canonical_id,duplicate_id,action,canonical_version,duplicate_version,before_canonical,before_duplicate,enrollment_ids,reason,review_hash,actor_user_id,request_id,recorded_at';
export async function executeIdentity(id:IdentityOperationId,ctx:Context,input:{body:unknown;query:unknown;id?:string}) {
  const {tx}=ctx;
  async function record(ids:string[]) {for(let i=0;i<ids.length;i+=100) await tx.query('select edunexus.record_access($1,$2::uuid[])',[id,ids.slice(i,i+100)]);}
  if(id==='identityHistory') {
    if(!(await tx.query('select id from edunexus.learners where id=$1',[input.id]))[0]) throw new AppError(404,'NOT_FOUND','The learner was not found.');
    const q=input.query as z.infer<typeof s.history>;
    const rows=await tx.query(`select ${columns} from edunexus.learner_identity_events where canonical_id=$1 or duplicate_id=$1 order by recorded_at desc,id desc limit $2 offset $3`,[input.id,q.limit+1,q.offset]);
    await record([...new Set([input.id!,...rows.slice(0,q.limit).flatMap(r=>[String(r.canonical_id),String(r.duplicate_id)])])]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,offset:q.offset,has_more:rows.length>q.limit}};
  }
  const b=input.body as z.infer<typeof s.reconcile>;
  const params=[b.canonical_id,b.duplicate_id,b.canonical_version,b.duplicate_version,b.action,b.reason];
  if(id==='identityPreview') {
    const [row]=await tx.query('select edunexus.preview_learner_identity($1,$2,$3,$4,$5,$6) as preview',params);
    const result=row!.preview as {member_ids:string[]}; await record(result.member_ids);return result;
  }
  const [row]=await tx.query(`select ${columns} from edunexus.reconcile_learner_identity($1,$2,$3,$4,$5,$6,$7)`,[...params,b.review_hash]);
  await record([b.canonical_id,b.duplicate_id]);return row;
}
