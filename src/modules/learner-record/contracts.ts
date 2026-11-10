import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
const date=z.iso.date(),count=z.number().int().nonnegative();
// One enrollment at a time, so a page about one learner discloses one learner.
export const learnerRecordOperations=([
  {id:'enrollmentAttendance',method:'get',path:'/api/v1/enrollments/:id/attendance-record',summary:'Read one enrollment\'s raw session counts by month and its absence dates; counts, never a rate or an official credit'},
  {id:'enrollmentScores',method:'get',path:'/api/v1/enrollments/:id/score-record',summary:'Read one enrollment\'s raw marks for every assessment in its sections; nothing is totalled, weighted or averaged'},
] as const).map(op=>({...op,module:'learner-record' as const}));
export type LearnerRecordOperationId=typeof learnerRecordOperations[number]['id'];
export const learnerRecordResponses:Record<string,z.ZodType>={
  enrollmentAttendance:z.object({enrollment_id:uuid,learner_id:uuid,academic_year_id:uuid,from:date,to:date,
    months:z.array(z.object({month_on:date,expected_sessions:count,present_sessions:count,absent_sessions:count,missing_sessions:count,alternative_delivery_sessions:count,unconfigured_dates:count})),
    absences:z.array(z.object({day_on:date,section_id:uuid,am:z.enum(['present','absent']).nullable(),pm:z.enum(['present','absent']).nullable()}))}),
  enrollmentScores:z.object({enrollment_id:uuid,academic_year_id:uuid,items:z.array(z.object({task_id:uuid,offering_id:uuid,subject_code:z.string(),subject_name:z.string(),display_order:z.number().int(),
    reporting_period_id:uuid,period_ordinal:z.number().int(),period_name:z.string(),component_code:z.string(),sequence:z.number().int(),title:z.string(),max_score:z.number(),
    status:z.enum(['open','archived']),raw_score:z.number().nullable(),score_version:z.number().int().nullable()}))}),
};
