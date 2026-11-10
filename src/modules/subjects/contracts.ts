import {z} from 'zod';
import {firstCapital,plainName,plainNameMessage,shortCode,shortCodeMessage} from '../../core/text.js';
import {uuid} from '../foundation/contracts.js';
// Capitalised on save since 2026-11-07, at the school's request. A reason is
// read back in journals and in the message an adviser is sent, so it is
// writing rather than a field value.
export const subjectReason=z.string().trim().overwrite(firstCapital).min(10).max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
const metadata={name:z.string().trim().min(1).max(120).regex(plainName,plainNameMessage),kind:z.enum(['learning_area','developmental_domain']),grade_levels:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v=>new Set(v).size===v.length,'Choose each grade level once'),active:z.boolean()};
export const subjectSchemas={
  create:z.strictObject({code:z.string().trim().regex(shortCode,shortCodeMessage),...metadata,reason:subjectReason}),
  update:z.strictObject({version:z.number().int().min(1).max(2147483646),...metadata,reason:subjectReason}),
  list:z.strictObject({active:z.enum(['true','false','all']).default('true'),q:z.string().trim().min(1).max(60).optional(),limit:z.coerce.number().int().min(1).max(100).default(50),after_id:uuid.optional()}),
  history:z.strictObject({limit:z.coerce.number().int().min(1).max(10).default(5),before_version:z.coerce.number().int().min(1).max(2147483647).optional()})
};
export const subjectOperations=([
  {id:'subjectList',method:'get',path:'/api/v1/subjects',summary:'List explicit subject metadata; no curriculum or grading policy is implied',query:subjectSchemas.list},
  {id:'subjectGet',method:'get',path:'/api/v1/subjects/:id',summary:'Read a subject catalog record'},
  {id:'subjectCreate',method:'post',path:'/api/v1/subjects',summary:'Create a subject with an immutable code and explicit grade applicability',body:subjectSchemas.create,manager:true},
  {id:'subjectUpdate',method:'patch',path:'/api/v1/subjects/:id',summary:'Replace subject metadata with version protection and preserved history',body:subjectSchemas.update,manager:true},
  {id:'subjectHistory',method:'get',path:'/api/v1/subjects/:id/events',summary:'Read protected subject revision history',query:subjectSchemas.history,manager:true},
] as const).map(op=>({...op,module:'subjects' as const}));
export type SubjectOperationId=typeof subjectOperations[number]['id'];
const time=z.iso.datetime({offset:true});
export const subjectSnapshot=z.object({id:uuid,code:z.string(),...metadata,version:z.number().int().positive()});
export const subjectRecord=subjectSnapshot.extend({created_at:time,updated_at:time});
export const subjectResponses:Record<string,z.ZodType>={
  subjectList:z.object({items:z.array(subjectRecord),pagination:z.object({limit:z.number().int(),next_after_id:uuid.nullable()})}),subjectGet:subjectRecord,subjectCreate:subjectRecord,subjectUpdate:subjectRecord,
  subjectHistory:z.object({items:z.array(z.object({id:uuid,subject_id:uuid,subject_version:z.number().int(),action:z.enum(['create','update']),before_snapshot:subjectRecord.nullable(),after_snapshot:subjectRecord,
    reason:z.string(),actor_user_id:uuid,request_id:uuid,recorded_at:time})),pagination:z.object({limit:z.number().int(),next_before_version:z.number().int().nullable()})})
};
