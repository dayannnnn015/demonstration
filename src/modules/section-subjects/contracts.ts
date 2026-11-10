import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
import {subjectSnapshot,subjectReason} from '../subjects/contracts.js';
const version=z.number().int().min(1).max(2147483646),order=z.number().int().min(1).max(999),time=z.iso.datetime({offset:true});
export const offeringSchemas={
  list:z.strictObject({active:z.enum(['true','false','all']).default('true'),limit:z.coerce.number().int().min(1).max(100).default(50),after_id:uuid.optional()}),
  create:z.strictObject({subject_id:uuid,subject_version:version,display_order:order,reason:subjectReason}),
  update:z.strictObject({version,active:z.boolean(),display_order:order,refresh_subject:z.boolean(),subject_version:version.nullable(),reason:subjectReason})
    .refine(v=>v.refresh_subject===(v.subject_version!==null),{path:['subject_version'],message:'Give the subject’s current version only when refreshing it from the catalog.'}),
  history:z.strictObject({limit:z.coerce.number().int().min(1).max(10).default(5),before_version:z.coerce.number().int().min(1).max(2147483647).optional()})
};
export const offeringOperations=([
  {id:'offeringList',method:'get',path:'/api/v1/sections/:id/subjects',summary:'Read subject offerings of an accessible section',query:offeringSchemas.list},
  {id:'offeringCreate',method:'post',path:'/api/v1/sections/:id/subjects',summary:'Add an applicable subject and pin its current catalog revision',body:offeringSchemas.create,manager:true},
  {id:'offeringGet',method:'get',path:'/api/v1/section-subjects/:id',summary:'Read a section offering and its preserved subject details'},
  {id:'offeringUpdate',method:'patch',path:'/api/v1/section-subjects/:id',summary:'Retire, reactivate, reorder or explicitly refresh a draft-year offering',body:offeringSchemas.update,manager:true},
  {id:'offeringHistory',method:'get',path:'/api/v1/section-subjects/:id/events',summary:'Read protected section-offering revision history',query:offeringSchemas.history,manager:true},
] as const).map(op=>({...op,module:'section-subjects' as const}));
export type OfferingOperationId=typeof offeringOperations[number]['id'];
export const offeringRecord=z.object({id:uuid,section_id:uuid,academic_year_id:uuid,subject_id:uuid,subject_snapshot:subjectSnapshot,active:z.boolean(),display_order:order,version:z.number().int().positive(),created_at:time,updated_at:time});
const context=z.object({section:z.object({id:uuid,academic_year_id:uuid,grade_level:z.number().int(),name:z.string(),adviser_user_id:uuid.nullable(),version:z.number().int()}),
  school_year:z.object({id:uuid,start_year:z.number().int(),starts_on:z.iso.date(),ends_on:z.iso.date(),status:z.enum(['draft','active','closed']),version:z.number().int()})});
export const offeringResponses:Record<string,z.ZodType>={offeringCreate:offeringRecord,offeringUpdate:offeringRecord,offeringGet:context.extend({record:offeringRecord}),
  offeringList:context.extend({items:z.array(offeringRecord),pagination:z.object({limit:z.number().int(),next_after_id:uuid.nullable()})}),
  offeringHistory:z.object({items:z.array(z.object({id:uuid,offering_id:uuid,offering_version:z.number().int(),action:z.enum(['create','update','refresh']),before_snapshot:offeringRecord.nullable(),after_snapshot:offeringRecord,
    reason:z.string(),actor_user_id:uuid,request_id:uuid,recorded_at:time})),pagination:z.object({limit:z.number().int(),next_before_version:z.number().int().nullable()})})};
