import { z } from 'zod';
import { uuid } from '../foundation/contracts.js';
const date=z.iso.date(), count=z.number().int().nonnegative();
const mode=z.enum(['classroom','alternative_delivery','no_class','suspended']).nullable();
const mark=z.enum(['present','absent']).nullable();
export const monitorQuery=z.strictObject({from:date,to:date,view:z.enum(['all','with_absences','incomplete']).default('all'),
  limit:z.coerce.number().int().min(1).max(100).default(50),after_id:uuid.optional()});
export const monitorOperations=[{id:'attendanceMonitor',method:'get',path:'/api/v1/sections/:id/attendance/monitor',
  summary:'Read bounded classroom absence and completion evidence for accessible learners',query:monitorQuery,module:'attendance-monitor'}] as const;
export const monitorDay=z.object({day_on:date,configured:z.boolean(),source:z.enum(['school','section','unconfigured']),am:mode,pm:mode,
  day_type:z.string().nullable(),label:z.string().nullable(),month_status:z.enum(['draft','submitted','locked']),month_version:count});
export const monitorDate=z.object({day_on:date,eligible:z.boolean(),am:mark,pm:mark});
export const classification=z.enum(['not_eligible','unconfigured','unsupported_adm','no_classroom','incomplete','absent','attended']);
const summary=z.object({eligible_dates:count,expected_sessions:count,present_sessions:count,absent_sessions:count,missing_sessions:count,
  unsupported_sessions:count,unconfigured_dates:count,absent_classroom_dates:count,longest_absent_date_run:count,trailing_absent_date_run:count,needs_completion:z.boolean()});
export const monitorResponses={attendanceMonitor:z.object({
  section:z.object({id:uuid,academic_year_id:uuid,grade_level:count,name:z.string(),adviser_user_id:uuid.nullable(),version:count}),
  school_year:z.object({id:uuid,start_year:count,starts_on:date,ends_on:date,status:z.enum(['draft','active','closed']),version:count}),
  visibility:z.enum(['full_historical_roster','current_access_only']),source:z.literal('live'),from:date,to:date,
  view:z.enum(['all','with_absences','incomplete']),calendar_version:count,days:z.array(monitorDay),
  items:z.array(z.object({enrollment_id:uuid,enrollment_version:count,recorded_learner_id:uuid,learner_id:uuid,learner_version:count,
    first_name:z.string(),middle_name:z.string().nullable(),last_name:z.string(),name_extension:z.string().nullable(),summary,
    dates:z.array(monitorDate.extend({classification}))})),
  pagination:z.object({limit:count,next_after_id:uuid.nullable()})})};
