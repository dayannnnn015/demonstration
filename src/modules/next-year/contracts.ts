import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
// The seed drew sections. Promotion no longer assigns one, so it decides
// nothing; it is still accepted and recorded, because next_year_placements.seed
// is NOT NULL and the runs already written carry theirs.
const seed=z.coerce.number().int().min(0).max(2147483647).default(0),grade=z.coerce.number().int().min(0).max(6);
export const nextYearSchemas={
  preview:z.strictObject({target_year_id:uuid,seed,grade_level:grade.optional()}),
  commit:z.strictObject({target_year_id:uuid,seed,grade_level:grade.nullable().default(null),review_hash:z.string().regex(/^[0-9a-f]{64}$/),reason:subjectReason}),
};
// Who moves up is the school's approved outcome; promotion carries them to the next grade and assigns no section.
export const nextYearOperations=([
  {id:'nextYearPreview',method:'get',path:'/api/v1/academic-years/:id/next-year-classes',summary:'Preview who is carried into next year from their approved outcomes and the grade each one lands in, with every learner left out and why. No section is assigned: a class is given to a learner separately',query:nextYearSchemas.preview,manager:true},
  {id:'nextYearCommit',method:'post',path:'/api/v1/academic-years/:id/next-year-classes',summary:'Enrol everyone in the preview at the grade their outcome leads to, in one transaction and with no section, if nothing has changed since the preview',body:nextYearSchemas.commit,manager:true},
] as const).map(op=>({...op,module:'next-year' as const}));
export type NextYearOperationId=typeof nextYearOperations[number]['id'];
const person={enrollment_id:uuid,learner_id:uuid,first_name:z.string(),middle_name:z.string().nullable(),last_name:z.string(),name_extension:z.string().nullable(),
  sex:z.enum(['male','female']),from_grade:z.number().int(),from_section:z.string().nullable(),action:z.enum(['promoted','conditionally_promoted','retained','remedial']).nullable(),
  outcome_status:z.enum(['recommended','approved','returned']).nullable()};
const counts=z.object({male:z.number().int(),female:z.number().int()});
export const nextYearResponses:Record<string,z.ZodType>={
  nextYearPreview:z.object({source_year:z.object({id:uuid,start_year:z.number().int(),status:z.string()}),
    target_year:z.object({id:uuid,start_year:z.number().int(),starts_on:z.iso.date(),status:z.string()}),
    grade_level:z.number().int().nullable(),review_hash:z.string(),
    grades:z.array(z.object({grade_level:z.number().int(),carried:counts})),
    placements:z.array(z.object({...person,to_grade:z.number().int()})),
    unplaced:z.array(z.object({...person,to_grade:z.number().int().nullable(),reason:z.enum(['left','no_outcome','not_approved','remedial','completer','already_enrolled'])})),
    runs:z.array(z.object({id:z.string(),grade_level:z.number().int().nullable(),seed:z.number().int(),placed:z.number().int(),reason:z.string(),actor_name:z.string().nullable(),recorded_at:z.string()}))}),
  nextYearCommit:z.object({placed:z.number().int(),entries:z.array(z.object({source_enrollment_id:uuid,learner_id:uuid,action:z.string(),enrollment_id:uuid,section_id:uuid.nullable(),grade_level:z.number().int()}))}),
};
