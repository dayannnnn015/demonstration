import type {z} from 'zod';
import type {Row} from '../../core/db.js';
import {AppError} from '../../core/errors.js';
import type {Context} from '../foundation/service.js';
import {followupSchemas as s,type FollowupOperationId} from './contracts.js';
const columns='id,case_id,case_version,action,review_snapshot,review_hash,reason,actor_user_id,request_id,recorded_at';
export async function executeFollowup(id:FollowupOperationId,ctx:Context,input:{id?:string;body:unknown;query:unknown}) {
  const {tx}=ctx;
  const record=(ids:unknown[])=>tx.query('select edunexus.record_access($1,$2::uuid[])',[id,ids]);
  if(id==='followupList'){
    const q=input.query as z.infer<typeof s.list>;
    const rows=await tx.query<{item:Row}>(`select (to_jsonb(c)-'opening_evidence'-'opening_hash') || jsonb_build_object(
      'overdue',c.status='open' and coalesce(c.due_on<timezone('Asia/Manila',now())::date,false),
      'learner',jsonb_build_object('id',l.id,'first_name',l.first_name,'middle_name',l.middle_name,'last_name',l.last_name,'name_extension',l.name_extension)) item
      from edunexus.attendance_followups c join edunexus.enrollments e on e.id=c.enrollment_id join edunexus.learners original on original.id=e.learner_id
      join edunexus.learners l on l.id=coalesce(original.merged_into,original.id)
      where c.academic_year_id=$1 and ($2='all' or c.status=$2) and ($3::uuid is null or c.section_id=$3) and ($4::uuid is null or c.assignee_user_id=$4)
        and (not $5::boolean or (c.status='open' and c.due_on<timezone('Asia/Manila',now())::date)) and ($6::uuid is null or c.id>$6) order by c.id limit $7`,
      [q.academic_year_id,q.status,q.section_id??null,q.assignee_user_id??null,q.overdue_only==='true',q.after_id??null,q.limit+1]);
    const items=rows.slice(0,q.limit).map(r=>r.item);await record(items.map(r=>r.id));
    return {items,pagination:{limit:q.limit,next_after_id:rows.length>q.limit?items[q.limit-1]!.id:null}};
  }
  if(id==='followupGet'){
    const [row]=await tx.query('select edunexus.read_attendance_followup($1) result',[input.id]);await record([input.id]);return row!.result;
  }
  if(id==='followupHistory'){
    const q=input.query as z.infer<typeof s.history>;
    const [scope]=await tx.query('select id from edunexus.attendance_followups where id=$1',[input.id]);if(!scope)throw new AppError(404,'NOT_FOUND','The follow-up was not found.');
    const rows=await tx.query(`select ${columns} from edunexus.attendance_followup_events where case_id=$1 and ($2::integer is null or case_version<$2) order by case_version desc limit $3`,[input.id,q.before_version??null,q.limit+1]);
    await record([input.id]);return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_before_version:rows.length>q.limit?rows[q.limit-1]!.case_version:null}};
  }
  const isOpen=id==='followupOpenPreview'||id==='followupOpen',isPreview=id==='followupOpenPreview'||id==='followupChangePreview';
  const b=input.body as z.infer<typeof s.open> & z.infer<typeof s.change>;
  const params=isOpen?[input.id,b.section_id,b.from,b.to,b.category,b.assignee_user_id,b.due_on,b.reason]:[input.id,b.version,b.action,b.assignee_user_id,b.due_on,b.reason];
  const fn=`edunexus.${isPreview?'preview':'commit'}_attendance_followup_${isOpen?'open':'change'}`;
  if(!isPreview)params.push(b.review_hash);
  const args=params.map((_,i)=>`$${i+1}`).join(',');
  const [row]=await tx.query(isPreview?`select ${fn}(${args}) result`:`select ${columns} from ${fn}(${args})`,params);
  await record(isPreview?[input.id]:[row!.case_id]);return isPreview?row!.result:row;
}
