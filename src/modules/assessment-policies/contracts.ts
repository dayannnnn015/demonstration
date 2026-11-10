import {z} from 'zod';
import {plainName,plainNameMessage,shortCode,shortCodeMessage} from '../../core/text.js';
import {uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
const code=z.string().trim().regex(shortCode,shortCodeMessage);
const name=z.string().trim().min(1).max(120).regex(plainName,plainNameMessage);
const component=z.strictObject({code,name,weight_basis_points:z.number().int().min(1).max(10000)});
const components=z.array(component).min(1).max(10).refine(c=>new Set(c.map(v=>v.code.toUpperCase())).size===c.length,'Component codes must be distinct')
  .refine(c=>c.reduce((sum,v)=>sum+v.weight_basis_points,0)===10000,'Weights must total 10000 basis points (100%)')
  .describe('Explicit draft weights: distinct codes and integer basis points totaling exactly 10000. No defaults or approval implied.');
const grades=z.array(z.number().int().min(1).max(6)).min(1).max(6).refine(v=>new Set(v).size===v.length,'Grade levels must be distinct');
const metadata={name,source_reference:subjectReason,grade_levels:grades,components,status:z.enum(['draft','archived'])};
export const policySchemas={
  create:z.strictObject({code,...metadata,reason:subjectReason}),
  update:z.strictObject({version:z.number().int().min(1).max(2147483646),...metadata,reason:subjectReason}),
  list:z.strictObject({status:z.enum(['draft','archived','all']).default('draft'),q:z.string().trim().min(1).max(60).optional(),limit:z.coerce.number().int().min(1).max(100).default(50),after_id:uuid.optional()}),
  history:z.strictObject({limit:z.coerce.number().int().min(1).max(10).default(5),before_version:z.coerce.number().int().min(1).max(2147483647).optional()})
};
export const policyOperations=([
  {id:'policyList',method:'get',path:'/api/v1/assessment-policy-drafts',summary:'List managerial assessment drafts; none are approved or operational',query:policySchemas.list},
  {id:'policyGet',method:'get',path:'/api/v1/assessment-policy-drafts/:id',summary:'Read a weighted-assessment policy draft'},
  {id:'policyCreate',method:'post',path:'/api/v1/assessment-policy-drafts',summary:'Create an explicit weighted-assessment draft for Grades 1 to 6',body:policySchemas.create},
  {id:'policyUpdate',method:'patch',path:'/api/v1/assessment-policy-drafts/:id',summary:'Revise, archive or restore draft metadata with version protection',body:policySchemas.update},
  {id:'policyHistory',method:'get',path:'/api/v1/assessment-policy-drafts/:id/events',summary:'Read protected assessment-draft revision history',query:policySchemas.history}
] as const).map(op=>({...op,module:'assessment-policies' as const,manager:true as const}));
export type PolicyOperationId=typeof policyOperations[number]['id'];
const time=z.iso.datetime({offset:true});
export const policyRecord=z.object({id:uuid,code:z.string(),...metadata,version:z.number().int().positive(),created_at:time,updated_at:time});
export const policyResponses:Record<string,z.ZodType>={policyGet:policyRecord,policyCreate:policyRecord,policyUpdate:policyRecord,
  policyList:z.object({items:z.array(policyRecord),pagination:z.object({limit:z.number().int(),next_after_id:uuid.nullable()})}),
  policyHistory:z.object({items:z.array(z.object({id:uuid,policy_id:uuid,policy_version:z.number().int(),action:z.enum(['create','update']),before_snapshot:policyRecord.nullable(),after_snapshot:policyRecord,
    reason:z.string(),actor_user_id:uuid,request_id:uuid,recorded_at:time})),pagination:z.object({limit:z.number().int(),next_before_version:z.number().int().nullable()})})
};
