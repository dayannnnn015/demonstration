import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
const version=z.number().int().min(1).max(2147483646);
const fields={canonical_id:uuid,duplicate_id:uuid,canonical_version:version,duplicate_version:version,action:z.enum(['link','unlink']),reason:z.string().trim().min(10).max(500).regex(/^[^\u0000-\u001f\u007f]*$/)};
// The same record on both sides is a slip of the picker, said beside the second record rather than as a rule violation.
const distinct={path:['duplicate_id'],message:'Choose the other record: a record cannot be linked to itself.'};
export const identitySchemas={preview:z.strictObject(fields).refine(v=>v.canonical_id!==v.duplicate_id,distinct),reconcile:z.strictObject({...fields,review_hash:z.string().regex(/^[a-f0-9]{64}$/),reviewed:z.literal(true)}).refine(v=>v.canonical_id!==v.duplicate_id,distinct),history:z.strictObject({limit:z.coerce.number().int().min(1).max(20).default(10),offset:z.coerce.number().int().min(0).max(100000).default(0)})};
export const identityOperations=([
  {id:'identityPreview',method:'post',path:'/api/v1/learner-reconciliations/preview',summary:'Review a non-destructive identity link or reversal and detect enrollment/LRN conflicts',body:identitySchemas.preview},
  {id:'identityReconcile',method:'post',path:'/api/v1/learner-reconciliations',summary:'Confirm the unchanged reviewed identity link or reversal; preserve original records',body:identitySchemas.reconcile},
  {id:'identityHistory',method:'get',path:'/api/v1/learners/:id/identity-history',summary:'Read protected identity-link and reversal snapshots',query:identitySchemas.history},
] as const).map(op=>({...op,module:'learner-identity' as const,manager:true as const}));
export type IdentityOperationId=typeof identityOperations[number]['id'];
const profile=z.object({id:uuid,lrn:z.string().nullable(),first_name:z.string(),middle_name:z.string().nullable(),last_name:z.string(),name_extension:z.string().nullable(),birth_date:z.iso.date(),sex:z.enum(['male','female']),version:z.number().int(),merged_into:uuid.nullable(),identity_revision:z.number().int()});
const event=z.object({id:uuid,canonical_id:uuid,duplicate_id:uuid,action:z.enum(['link','unlink']),canonical_version:z.number().int(),duplicate_version:z.number().int(),before_canonical:profile,before_duplicate:profile,enrollment_ids:z.array(uuid),reason:z.string(),review_hash:z.string(),actor_user_id:uuid,request_id:uuid,recorded_at:z.iso.datetime()});
export const identityResponses:Record<string,z.ZodType>={
  identityPreview:z.object({canonical:profile,duplicate:profile,action:z.enum(['link','unlink']),reason:z.string(),actor_user_id:uuid,member_ids:z.array(uuid),can_commit:z.boolean(),review_hash:z.string().nullable(),issues:z.array(z.string()),conflicting_year_ids:z.array(uuid),school_years:z.array(z.object({id:uuid,start_year:z.number(),status:z.enum(['draft','active','closed']),version:z.number()})),enrollments:z.array(z.object({id:uuid,recorded_learner_id:uuid,academic_year_id:uuid,record_state:z.enum(['valid','voided']),grade_level:z.number(),section_id:uuid,status:z.enum(['enrolled','withdrawn']),enrolled_on:z.iso.date(),effective_on:z.iso.date(),version:z.number()}))}),
  identityReconcile:event,identityHistory:z.object({items:z.array(event),pagination:z.object({limit:z.number(),offset:z.number(),has_more:z.boolean()})}),
};
