import type {z} from 'zod';
import type {Context} from '../foundation/service.js';
import {offeringSchemas as s,type OfferingOperationId} from './contracts.js';
const columns='id,section_id,academic_year_id,subject_id,subject_snapshot,active,display_order,version,created_at,updated_at';
export async function executeOffering(id:OfferingOperationId,ctx:Context,input:{id?:string;body:unknown;query:unknown}) {
  const {tx}=ctx;
  if(id==='offeringList'){
    const q=input.query as z.infer<typeof s.list>;
    const [row]=await tx.query('select edunexus.read_section_subjects($1,$2,$3,$4) result',[input.id,q.active,q.limit,q.after_id??null]);return row!.result;
  }
  if(id==='offeringGet'||id==='offeringHistory'){
    const [row]=await tx.query('select edunexus.read_section_subject($1) result',[input.id]);if(id==='offeringGet')return row!.result;
    const q=input.query as z.infer<typeof s.history>;
    const rows=await tx.query(`select id,offering_id,offering_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id,recorded_at
      from edunexus.section_subject_events where offering_id=$1 and ($2::integer is null or offering_version<$2) order by offering_version desc limit $3`,[input.id,q.before_version??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_before_version:rows.length>q.limit?rows[q.limit-1]!.offering_version:null}};
  }
  if(id==='offeringCreate'){
    const b=input.body as z.infer<typeof s.create>;
    const [row]=await tx.query(`select ${columns} from edunexus.create_section_subject($1,$2,$3,$4,$5)`,[input.id,b.subject_id,b.subject_version,b.display_order,b.reason]);return row;
  }
  const b=input.body as z.infer<typeof s.update>;
  const [row]=await tx.query(`select ${columns} from edunexus.update_section_subject($1,$2,$3,$4,$5,$6,$7)`,[input.id,b.version,b.active,b.display_order,b.refresh_subject,b.subject_version,b.reason]);return row;
}
