import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
import {monitorDay,monitorDate} from '../attendance-monitor/contracts.js';
const date=z.iso.date(),time=z.iso.datetime({offset:true}),count=z.number().int().nonnegative(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const status=z.enum(['open','resolved','cancelled']),category=z.enum(['absence','recording_gap']);
const reason=z.string().trim().min(10).max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
const common={assignee_user_id:uuid,due_on:date.nullable(),reason};
const open={section_id:uuid,from:date,to:date,category,...common};
const change={version:z.number().int().min(1).max(2147483646),action:z.enum(['update','resolve','cancel','reopen']),...common};
export const followupSchemas={
  openPreview:z.strictObject(open),open:z.strictObject({...open,review_hash:hash,reviewed:z.literal(true)}),
  changePreview:z.strictObject(change),change:z.strictObject({...change,review_hash:hash,reviewed:z.literal(true)}),
  list:z.strictObject({academic_year_id:uuid,status:z.enum(['open','resolved','cancelled','all']).default('open'),section_id:uuid.optional(),assignee_user_id:uuid.optional(),
    overdue_only:z.enum(['true','false']).default('false'),limit:z.coerce.number().int().min(1).max(100).default(50),after_id:uuid.optional()}),
  history:z.strictObject({limit:z.coerce.number().int().min(1).max(10).default(5),before_version:z.coerce.number().int().min(1).max(2147483647).optional()})
};
export const followupOperations=([
  {id:'followupList',method:'get',path:'/api/v1/attendance-follow-ups',summary:'List managerial follow-up work by school year, owner, status and due date',query:followupSchemas.list},
  {id:'followupGet',method:'get',path:'/api/v1/attendance-follow-ups/:id',summary:'Read opening evidence alongside current evidence and change indication'},
  {id:'followupOpenPreview',method:'post',path:'/api/v1/enrollments/:id/attendance-follow-ups/preview',summary:'Review a manual follow-up from matching attendance evidence',body:followupSchemas.openPreview},
  {id:'followupOpen',method:'post',path:'/api/v1/enrollments/:id/attendance-follow-ups',summary:'Confirm the reviewed evidence and open one case for this annual enrollment',body:followupSchemas.open},
  {id:'followupChangePreview',method:'post',path:'/api/v1/attendance-follow-ups/:id/preview',summary:'Review a case update, resolution, cancellation or reopening with current evidence',body:followupSchemas.changePreview},
  {id:'followupChange',method:'post',path:'/api/v1/attendance-follow-ups/:id/events',summary:'Confirm a case action and preserve its reason and evidence atomically',body:followupSchemas.change},
  {id:'followupHistory',method:'get',path:'/api/v1/attendance-follow-ups/:id/events',summary:'Read immutable case action history',query:followupSchemas.history},
] as const).map(op=>({...op,module:'attendance-followups' as const,manager:true as const}));
export type FollowupOperationId=typeof followupOperations[number]['id'];
const section=z.object({id:uuid,academic_year_id:uuid,grade_level:count,name:z.string(),adviser_user_id:uuid.nullable(),version:count});
const year=z.object({id:uuid,start_year:count,starts_on:date,ends_on:date,status:z.enum(['draft','active','closed']),version:count});
const member=z.object({enrollment_id:uuid,enrollment_version:count,recorded_learner_id:uuid,learner_id:uuid,learner_version:count,
  first_name:z.string(),middle_name:z.string().nullable(),last_name:z.string(),name_extension:z.string().nullable(),dates:z.array(monitorDate)});
const evidence=z.object({evidence_version:z.literal(1),available:z.boolean(),enrollment_version:count,record_state:z.enum(['valid','voided']),
  snapshot:z.object({section,school_year:year,visibility:z.literal('full_historical_roster'),source:z.literal('live'),from:date,to:date,calendar_version:count,days:z.array(monitorDay),member:member.nullable()}),
  summary:z.object({absent_sessions:count,missing_sessions:count,unsupported_sessions:count,unconfigured_dates:count})});
const fields={id:uuid,enrollment_id:uuid,section_id:uuid,academic_year_id:uuid,from_on:date,to_on:date,category,status,assignee_user_id:uuid,due_on:date.nullable(),created_by:uuid,version:count,created_at:time,updated_at:time};
const record=z.object({...fields,opening_evidence:evidence,opening_hash:hash});
const plan=z.object({action:z.enum(['open','update','resolve','cancel','reopen']),version:count,before:record.nullable(),enrollment_id:uuid,section_id:uuid,academic_year_id:uuid,
  from_on:date,to_on:date,category,target_status:status,assignee:z.object({user_id:uuid,display_name:z.string(),role:z.enum(['principal','administrative_officer']),version:count}),
  due_on:date.nullable(),reason:z.string(),actor_user_id:uuid,current_evidence:evidence,issues:z.array(z.string()),can_commit:z.boolean()});
const event=z.object({id:uuid,case_id:uuid,case_version:count,action:z.enum(['open','update','resolve','cancel','reopen']),review_snapshot:plan,review_hash:hash,reason:z.string(),actor_user_id:uuid,request_id:uuid,recorded_at:time});
export const followupResponses:Record<string,z.ZodType>={
  followupList:z.object({items:z.array(z.object({...fields,overdue:z.boolean(),learner:z.object({id:uuid,first_name:z.string(),middle_name:z.string().nullable(),last_name:z.string(),name_extension:z.string().nullable()})})),pagination:z.object({limit:count,next_after_id:uuid.nullable()})}),
  followupGet:z.object({record,current_evidence:evidence,evidence_changed:z.boolean(),overdue:z.boolean()}),
  followupOpenPreview:plan.extend({review_hash:hash.nullable()}),followupChangePreview:plan.extend({review_hash:hash.nullable()}),followupOpen:event,followupChange:event,
  followupHistory:z.object({items:z.array(event),pagination:z.object({limit:count,next_before_version:count.nullable()})})
};
