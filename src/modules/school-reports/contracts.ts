import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
const date=z.iso.date(),count=z.number().int().nonnegative(),mode=z.enum(['classroom','alternative_delivery','no_class','suspended']).nullable();
const month=z.iso.date().regex(/^\d{4}-\d{2}-01$/,'Use the first day of the month.');
const bySex=z.object({male:count,female:count});
export const schoolReportSchemas={daily:z.strictObject({day_on:date}),sf4:z.strictObject({month_on:month})};
// Both count in the database and name no learner, so neither writes an access row.
export const schoolReportOperations=([
  {id:'attendanceDailySummary',method:'get',path:'/api/v1/attendance/daily-summary',summary:'Count each section\'s register for one date: learners, and morning and afternoon sessions present, absent and not marked; names no learner',query:schoolReportSchemas.daily},
  {id:'sf4Counts',method:'get',path:'/api/v1/academic-years/:id/sf4',summary:'Count the SF4\'s registered learners and movements by section and sex for one month; attendance averages are not computed',query:schoolReportSchemas.sf4,manager:true},
] as const).map(op=>({...op,module:'school-reports' as const}));
export type SchoolReportOperationId=typeof schoolReportOperations[number]['id'];
const movement=z.object({a:bySex,b:bySex});
export const schoolReportResponses:Record<string,z.ZodType>={
  attendanceDailySummary:z.object({day_on:date,sections:z.array(z.object({section_id:uuid,academic_year_id:uuid,grade_level:z.number().int(),name:z.string(),adviser_user_id:uuid.nullable(),adviser_name:z.string().nullable(),
    am:mode,pm:mode,configured:z.boolean(),learners:count,am_present:count,am_absent:count,am_unmarked:count.nullable(),pm_present:count,pm_absent:count,pm_unmarked:count.nullable(),recorded_at:z.string().nullable()}))}),
  sf4Counts:z.object({academic_year_id:uuid,month_on:date,from:date,to:date,sections:z.array(z.object({section_id:uuid,grade_level:z.number().int(),name:z.string(),adviser_name:z.string().nullable(),
    month_status:z.enum(['draft','submitted','locked']),registered:bySex,movement:z.object({transfer_in:movement.optional(),transfer_out:movement.optional(),dropout:movement.optional(),death:movement.optional(),withdrawal:movement.optional()})}))}),
};
