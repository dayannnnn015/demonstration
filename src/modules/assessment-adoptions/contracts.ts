import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
import {policyRecord} from '../assessment-policies/contracts.js';
const version=z.number().int().min(1).max(2147483646);
export const adoptionSchemas={
  adopt:z.strictObject({academic_year_id:uuid,policy_id:uuid,policy_version:version,adopted_on:z.iso.date(),
    adoption_reference:subjectReason.describe('The school record that carries this decision. Supplied text, not proof that DepEd or the school approved it.'),reason:subjectReason}),
  withdraw:z.strictObject({version,reason:subjectReason}),
  list:z.strictObject({academic_year_id:uuid.optional(),policy_id:uuid.optional(),status:z.enum(['adopted','withdrawn','all']).default('adopted'),
    limit:z.coerce.number().int().min(1).max(100).default(50),after_id:uuid.optional()}),
  history:z.strictObject({limit:z.coerce.number().int().min(1).max(10).default(5),before_version:z.coerce.number().int().min(1).max(2147483647).optional()})
};
export const adoptionOperations=([
  {id:'adoptionList',method:'get',path:'/api/v1/assessment-policy-adoptions',summary:'List school-recorded assessment-policy adoptions',query:adoptionSchemas.list},
  {id:'adoptionGet',method:'get',path:'/api/v1/assessment-policy-adoptions/:id',summary:'Read one adoption and its frozen policy revision'},
  {id:'adoptionCreate',method:'post',path:'/api/v1/assessment-policy-adoptions',summary:'Record that the school adopted an exact draft revision for a school year; this binds no section and computes no grade',body:adoptionSchemas.adopt},
  {id:'adoptionWithdraw',method:'post',path:'/api/v1/assessment-policy-adoptions/:id/withdrawal',summary:'Withdraw a standing adoption; the frozen revision and history are preserved',body:adoptionSchemas.withdraw},
  {id:'adoptionHistory',method:'get',path:'/api/v1/assessment-policy-adoptions/:id/events',summary:'Read protected adoption and withdrawal history',query:adoptionSchemas.history}
] as const).map(op=>({...op,module:'assessment-adoptions' as const,manager:true as const}));
export type AdoptionOperationId=typeof adoptionOperations[number]['id'];
const time=z.iso.datetime({offset:true});
export const adoptionRecord=z.object({id:uuid,academic_year_id:uuid,policy_id:uuid,policy_version:z.number().int().positive(),
  policy_snapshot:policyRecord.omit({created_at:true,updated_at:true}).describe('The exact draft revision recorded at adoption. Later draft revisions never change it.'),
  grade_levels:z.array(z.number().int()),adopted_on:z.string(),adoption_reference:z.string(),status:z.enum(['adopted','withdrawn']),
  version:z.number().int().positive(),created_at:time,updated_at:time});
export const adoptionResponses:Record<string,z.ZodType>={adoptionGet:adoptionRecord,adoptionCreate:adoptionRecord,adoptionWithdraw:adoptionRecord,
  adoptionList:z.object({items:z.array(adoptionRecord),pagination:z.object({limit:z.number().int(),next_after_id:uuid.nullable()})}),
  adoptionHistory:z.object({items:z.array(z.object({id:uuid,adoption_id:uuid,adoption_version:z.number().int(),action:z.enum(['adopt','withdraw']),
    before_snapshot:adoptionRecord.nullable(),after_snapshot:adoptionRecord,reason:z.string(),actor_user_id:uuid,request_id:uuid,recorded_at:time})),
    pagination:z.object({limit:z.number().int(),next_before_version:z.number().int().nullable()})})
};
