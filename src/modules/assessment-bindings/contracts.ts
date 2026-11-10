import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
const version=z.number().int().min(1).max(2147483646);
export const bindingSchemas={
  bind:z.strictObject({offering_id:uuid,offering_version:version,adoption_id:uuid,adoption_version:version,reason:subjectReason}),
  release:z.strictObject({version,reason:subjectReason}),
  list:z.strictObject({academic_year_id:uuid.optional(),section_id:uuid.optional(),offering_id:uuid.optional(),adoption_id:uuid.optional(),
    status:z.enum(['bound','released','all']).default('bound'),limit:z.coerce.number().int().min(1).max(100).default(50),after_id:uuid.optional()}),
  history:z.strictObject({limit:z.coerce.number().int().min(1).max(10).default(5),before_version:z.coerce.number().int().min(1).max(2147483647).optional()})
};
export const bindingOperations=([
  {id:'bindingList',method:'get',path:'/api/v1/assessment-policy-bindings',summary:'List which section subject offerings an adopted revision governs',query:bindingSchemas.list},
  {id:'bindingGet',method:'get',path:'/api/v1/assessment-policy-bindings/:id',summary:'Read one policy binding'},
  {id:'bindingCreate',method:'post',path:'/api/v1/assessment-policy-bindings',summary:'Record that a standing adoption governs one section subject offering; no score or grade is computed',body:bindingSchemas.bind},
  {id:'bindingRelease',method:'post',path:'/api/v1/assessment-policy-bindings/:id/release',summary:'Release a standing binding; the adoption and its frozen revision are preserved',body:bindingSchemas.release},
  {id:'bindingHistory',method:'get',path:'/api/v1/assessment-policy-bindings/:id/events',summary:'Read protected binding and release history',query:bindingSchemas.history}
] as const).map(op=>({...op,module:'assessment-bindings' as const,manager:true as const}));
export type BindingOperationId=typeof bindingOperations[number]['id'];
const time=z.iso.datetime({offset:true});
export const bindingRecord=z.object({id:uuid,offering_id:uuid,adoption_id:uuid,section_id:uuid,academic_year_id:uuid,
  status:z.enum(['bound','released']),version:z.number().int().positive(),created_at:time,updated_at:time});
export const bindingResponses:Record<string,z.ZodType>={bindingGet:bindingRecord,bindingCreate:bindingRecord,bindingRelease:bindingRecord,
  bindingList:z.object({items:z.array(bindingRecord),pagination:z.object({limit:z.number().int(),next_after_id:uuid.nullable()})}),
  bindingHistory:z.object({items:z.array(z.object({id:uuid,binding_id:uuid,binding_version:z.number().int(),action:z.enum(['bind','release']),
    before_snapshot:bindingRecord.nullable(),after_snapshot:bindingRecord,reason:z.string(),actor_user_id:uuid,request_id:uuid,recorded_at:time})),
    pagination:z.object({limit:z.number().int(),next_before_version:z.number().int().nullable()})})
};
