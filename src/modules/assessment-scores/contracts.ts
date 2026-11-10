import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
import {shortCode,shortCodeMessage} from '../../core/text.js';
const version=z.number().int().min(1).max(2147483646);
const code=z.string().trim().regex(shortCode,shortCodeMessage);
const title=z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]*$/);
// Two decimals, mirroring the numeric(7,2) column, which migration 0022 widened
// so the documented maximum of 10000 actually fits. This is a storage bound, not
// a grading rule: no rounding, weighting or transmutation is applied anywhere.
const mark=z.number().min(0).max(10000).refine(v=>/^-?\d+(?:\.\d{1,2})?$/.test(String(v)),'Use at most two decimal places');
export const scoreSchemas={
  taskList:z.strictObject({reporting_period_id:uuid.optional(),component_code:code.optional(),status:z.enum(['open','archived','all']).default('open'),
    limit:z.coerce.number().int().min(1).max(100).default(50),after_id:uuid.optional()}),
  taskCreate:z.strictObject({reporting_period_id:uuid,component_code:code,sequence:z.number().int().min(1).max(99),title,max_score:mark.refine(v=>v>0,'The maximum must be above zero'),reason:subjectReason}),
  taskUpdate:z.strictObject({version,title,max_score:mark.refine(v=>v>0,'The maximum must be above zero'),status:z.enum(['open','archived']),reason:subjectReason}),
  sheet:z.strictObject({limit:z.coerce.number().int().min(1).max(100).default(100),after_id:uuid.optional()}),
  record:z.strictObject({entries:z.array(z.strictObject({enrollment_id:uuid,raw_score:mark.nullable(),version:z.number().int().min(0).max(2147483646)})).min(1).max(100)
    .refine(e=>new Set(e.map(v=>v.enrollment_id)).size===e.length,'Each learner appears once per batch'),reason:subjectReason}),
  history:z.strictObject({limit:z.coerce.number().int().min(1).max(10).default(5),before_version:z.coerce.number().int().min(1).max(2147483647).optional()}),
  scoreHistory:z.strictObject({limit:z.coerce.number().int().min(1).max(10).default(5),before_id:z.string().regex(/^[1-9][0-9]{0,17}$/).optional()})
};
export const scoreOperations=([
  {id:'componentList',method:'get',path:'/api/v1/section-subjects/:id/assessment-components',summary:'Read the component codes and names of the policy bound to an accessible offering; no weight is returned'},
  {id:'taskList',method:'get',path:'/api/v1/section-subjects/:id/assessment-tasks',summary:'List named assessments of an accessible offering',query:scoreSchemas.taskList},
  {id:'taskCreate',method:'post',path:'/api/v1/section-subjects/:id/assessment-tasks',summary:'Add a named assessment under a component of the bound policy revision',body:scoreSchemas.taskCreate},
  {id:'taskGet',method:'get',path:'/api/v1/assessment-tasks/:id',summary:'Read one named assessment'},
  {id:'taskUpdate',method:'patch',path:'/api/v1/assessment-tasks/:id',summary:'Retitle, adjust the maximum or archive an assessment; component and sequence are fixed',body:scoreSchemas.taskUpdate},
  {id:'scoreSheet',method:'get',path:'/api/v1/assessment-tasks/:id/scores',summary:'Read recorded raw scores; no total, average or grade is returned',query:scoreSchemas.sheet},
  {id:'scoreRecord',method:'post',path:'/api/v1/assessment-tasks/:id/scores',summary:'Record or clear up to 100 raw scores, each against its current version',body:scoreSchemas.record},
  {id:'taskHistory',method:'get',path:'/api/v1/assessment-tasks/:id/events',summary:'Read protected assessment-task history',query:scoreSchemas.history,manager:true},
  {id:'scoreHistory',method:'get',path:'/api/v1/assessment-tasks/:id/score-events',summary:'Read protected batched score-change history',query:scoreSchemas.scoreHistory,manager:true}
] as const).map(op=>({...op,module:'assessment-scores' as const}));
export type ScoreOperationId=typeof scoreOperations[number]['id'];
const time=z.iso.datetime({offset:true});
const score=z.union([z.number(),z.string()]).nullable().describe('Raw recorded mark, or null when nothing is recorded yet. Never a grade.');
export const taskRecord=z.object({id:uuid,offering_id:uuid,binding_id:uuid,reporting_period_id:uuid,section_id:uuid,academic_year_id:uuid,
  component_code:z.string(),sequence:z.number().int(),title:z.string(),max_score:z.union([z.number(),z.string()]),status:z.enum(['open','archived']),
  version:z.number().int().positive(),created_at:time,updated_at:time});
const sheetRow=z.object({enrollment_id:uuid,learner_id:uuid,last_name:z.string(),first_name:z.string(),middle_name:z.string().nullable(),
  name_extension:z.string().nullable(),raw_score:score,version:z.number().int()});
export const scoreResponses:Record<string,z.ZodType>={componentList:z.object({offering_id:uuid,bound:z.boolean(),components:z.array(z.object({code:z.string(),name:z.string()}))}),
  taskGet:taskRecord,taskCreate:taskRecord,taskUpdate:taskRecord,
  taskList:z.object({items:z.array(taskRecord),pagination:z.object({limit:z.number().int(),next_after_id:uuid.nullable()})}),
  scoreSheet:z.object({task:taskRecord,recorded_scores_only:z.literal(true),items:z.array(sheetRow),
    pagination:z.object({limit:z.number().int(),next_after_id:uuid.nullable()})}),
  scoreRecord:z.object({task_id:uuid,changed:z.number().int(),entries:z.array(z.object({enrollment_id:uuid,before:score,after:score,version:z.number().int()}))}),
  taskHistory:z.object({items:z.array(z.object({id:uuid,task_id:uuid,task_version:z.number().int(),action:z.enum(['create','update']),
    before_snapshot:taskRecord.nullable(),after_snapshot:taskRecord,reason:z.string(),actor_user_id:uuid,request_id:uuid,recorded_at:time})),
    pagination:z.object({limit:z.number().int(),next_before_version:z.number().int().nullable()})}),
  scoreHistory:z.object({items:z.array(z.object({id:z.string(),task_id:uuid,entries:z.array(z.object({enrollment_id:uuid,before:score,after:score,version:z.number().int()})),
    reason:z.string(),actor_user_id:uuid,request_id:uuid,recorded_at:time})),pagination:z.object({limit:z.number().int(),next_before_id:z.string().nullable()})})
};
