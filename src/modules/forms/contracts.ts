import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
const version=z.number().int().min(0).max(2147483646),date=z.iso.date(),time=z.iso.datetime({offset:true});
const monthOn=date.refine(v=>v.endsWith('-01'),'Use the first day of a month');
export const formSchemas={
  ruleRecord:z.strictObject({version,mixed_day:z.enum(['tardy','absent','half_day']),single_session_day:z.enum(['counts','not_counted']),reason:subjectReason}),
  month:z.strictObject({month_on:monthOn}),
  issue:z.strictObject({month_on:monthOn,reason:subjectReason.optional()}),
  reissue:z.strictObject({reason:subjectReason.optional()}),
  issuanceQuery:z.strictObject({form:z.enum(['sf2','sf4','sf9','sf10']).optional(),academic_year_id:uuid.optional(),section_id:uuid.optional(),enrollment_id:uuid.optional(),
    learner_id:uuid.optional(),month_on:monthOn.optional(),limit:z.coerce.number().int().min(1).max(100).default(20)}),
};
// The forms are computed by the API from raw reads; the database never computes a rate.
export const formOperations=([
  {id:'attendanceDayRuleGet',method:'get',path:'/api/v1/attendance-day-rule',summary:'Read the school\'s recorded rule for turning a morning and an afternoon mark into the SF2\'s one daily mark, and its history; null until the principal records one'},
  {id:'attendanceDayRuleRecord',method:'post',path:'/api/v1/attendance-day-rule',summary:'Record or change the school\'s attendance rule, as the principal, with a reason; there is no default',body:formSchemas.ruleRecord},
  {id:'sf2Get',method:'get',path:'/api/v1/sections/:id/forms/sf2',summary:'Compute one section\'s SF2 for a month from its recorded marks, the school\'s rule and the formulas printed on the form; a figure that would need an unmarked session, an unconfigured date or a missing rule is null',query:formSchemas.month},
  {id:'sf2Issue',method:'post',path:'/api/v1/sections/:id/forms/sf2/issuances',summary:'Issue the SF2: refused while any figure is unknown; records a fingerprint of exactly what was issued, and needs a reason when it corrects an earlier issue',body:formSchemas.issue},
  {id:'sf4Get',method:'get',path:'/api/v1/academic-years/:id/forms/sf4',summary:'Compute the school\'s SF4 for a month: every section\'s registered learners, daily attendance and movements by sex, with grade and school totals; names no learner',query:formSchemas.month,manager:true},
  {id:'sf4Issue',method:'post',path:'/api/v1/academic-years/:id/forms/sf4/issuances',summary:'Issue the SF4 once every section\'s month is submitted and every figure is known, recording its fingerprint',body:formSchemas.issue,manager:true},
  {id:'sf9Get',method:'get',path:'/api/v1/enrollments/:id/forms/sf9',summary:'Lay out one enrollment\'s SF9 in its grade\'s card: the grades entered from the ECR, the general average, observed values and comments, and each month\'s attendance days counted by the school\'s rule; nothing is computed into a grade'},
  {id:'sf9Issue',method:'post',path:'/api/v1/enrollments/:id/forms/sf9/issuances',summary:'Issue the SF9, recording a fingerprint of exactly what it said; a different card for the same enrollment is a correction that needs a reason',body:formSchemas.reissue},
  {id:'sf10Get',method:'get',path:'/api/v1/learners/:id/forms/sf10',summary:'Lay out one learner\'s SF10: a scholastic block for every Grade 1 to 6 school year the caller may read, whether EDUNEXUS recorded it or it was transcribed from the school\'s own documents, with the grades and general average entered from the ECR, and the credential presented for Grade 1. Refused for a learner with no Grade 1 to 6 year at all: the SF10 begins at Grade 1, and a Kindergarten learner\'s records are the SF5-K and the ECCD checklist'},
  {id:'sf10Issue',method:'post',path:'/api/v1/learners/:id/forms/sf10/issuances',summary:'Issue the SF10, recording a fingerprint of exactly what it said; a different record for the same learner is a correction that needs a reason',body:formSchemas.reissue},
  {id:'sf9History',method:'get',path:'/api/v1/learners/:id/sf9-history',summary:'One learner\'s report cards year by year: each school year they were enrolled, its grade level and class, and whether that year\'s SF9 has been issued, with the serial and fingerprint of the one that was. An issued card is never overwritten by a later grade\'s — each hangs off its own enrollment. Reads no grade; names the enrollments it returned, so it is logged'},
  {id:'formIssuanceList',method:'get',path:'/api/v1/form-issuances',summary:'List issued forms, newest first: every one for managers, your own for a teacher',query:formSchemas.issuanceQuery},
] as const).map(op=>({...op,module:'forms' as const}));
export type FormOperationId=typeof formOperations[number]['id'];

const trio=z.object({male:z.number(),female:z.number(),total:z.number()});
const maybeTrio=z.object({male:z.number().nullable(),female:z.number().nullable(),total:z.number().nullable()});
const spans=z.object({a:trio,b:trio,ab:trio});
const school=z.object({name:z.string(),school_code:z.string().nullable(),address:z.string(),region:z.string().nullable(),division:z.string().nullable(),
  district:z.string().nullable(),school_head_name:z.string().nullable(),school_head_position:z.string().nullable()});
const rule=z.object({mixed_day:z.enum(['tardy','absent','half_day']),single_session_day:z.enum(['counts','not_counted']),version:z.number().int()});
const session=z.enum(['present','absent']).nullable();
const cell=z.union([z.literal('out'),z.literal('no_class'),z.object({mark:z.enum(['present','absent','late','cutting','half','unmarked','waiting','pending']),
  present:z.number(),absent:z.number(),tardy:z.number(),am:session,pm:session})]);
export const issuance=z.object({id:uuid,serial:z.number().int(),form:z.enum(['sf2','sf4','sf9','sf10']),academic_year_id:uuid.nullable(),section_id:uuid.nullable(),
  enrollment_id:uuid.nullable(),learner_id:uuid.nullable(),month_on:date.nullable(),data_hash:z.string(),day_rule_version:z.number().int().nullable(),
  supersedes_id:uuid.nullable(),reason:z.string().nullable(),actor_user_id:uuid,request_id:uuid,issued_at:time});
export const sf2Form=z.object({form:z.literal('sf2'),school,section:z.object({id:uuid,grade_level:z.number().int(),name:z.string(),adviser_name:z.string().nullable()}),
  school_year:z.object({id:uuid,start_year:z.number().int()}),month_on:date,from:date,to:date,cutoff:date,month_status:z.enum(['draft','submitted','locked']),rule:rule.nullable(),
  columns:z.array(z.object({day_on:date,date:z.number().int(),weekday:z.string(),kind:z.enum(['class','no_class','unconfigured','alternative_delivery'])})),
  learners:z.array(z.object({no:z.number().int(),enrollment_id:uuid,name:z.string(),sex:z.enum(['male','female']),lrn:z.string().nullable(),days:z.record(z.string(),cell),
    absent:z.number().nullable(),present:z.number().nullable(),tardy:z.number().nullable(),absent_five_consecutive:z.boolean().nullable(),registered_at_end:z.boolean(),remarks:z.array(z.string())})),
  daily:z.array(z.object({day_on:date,male:z.number().nullable(),female:z.number().nullable(),total:z.number().nullable()})),
  summary:z.object({days_of_classes:z.number().int(),enrolment_at_cutoff:trio,late_enrolment:trio,registered:trio,percentage_of_enrolment:maybeTrio,
    average_daily_attendance:trio.nullable(),percentage_of_attendance:maybeTrio.nullable(),absent_five_consecutive:trio.nullable(),dropped_out:trio,transferred_out:trio,transferred_in:trio}),
  completeness:z.object({complete:z.boolean(),rule_recorded:z.boolean(),unmarked_sessions:z.number().int(),pending_days:z.number().int(),unconfigured_days:z.number().int(),alternative_delivery_days:z.number().int()}),
  to_date:z.object({as_of:date,days_held:z.number().int()}).optional().describe('Present only while days of classes are still to come: every total is then counted to the last day of classes held (as_of), not for the month')});
const sf4Row={registered:trio,average_daily_attendance:trio.nullable(),percentage:maybeTrio.nullable(),dropout:spans,transferred_out:spans,transferred_in:spans,death:spans,withdrawal:spans};
export const sf4Form=z.object({form:z.literal('sf4'),school,school_year:z.object({id:uuid,start_year:z.number().int()}),month_on:date,from:date,to:date,rule:rule.nullable(),
  sections:z.array(z.object({section_id:uuid,grade_level:z.number().int(),name:z.string(),adviser_name:z.string().nullable(),adviser_position:z.string().nullable(),
    adviser_specialization:z.string().nullable(),month_status:z.enum(['draft','submitted','locked']),days_of_classes:z.number().int().nullable(),...sf4Row,
    completeness:z.object({complete:z.boolean(),unmarked_learner_days:z.number().int(),pending_days:z.number().int(),unconfigured_days:z.number().int(),alternative_delivery_days:z.number().int()})})),
  grades:z.array(z.object({grade_level:z.number().int(),...sf4Row})),school_total:z.object(sf4Row),
  unplaced:z.array(trio.extend({grade_level:z.number().int()}))
    .describe('Learners registered at a grade but in no class as of the last day of the month. Every SF4 figure is grouped by section, so these belong to no section row and are never added into a grade or school total; the form cannot be issued while any remain'),
  other_staff:z.array(z.object({name:z.string(),role:z.string(),position:z.string().nullable(),specialization:z.string().nullable()})),
  completeness:z.object({complete:z.boolean(),rule_recorded:z.boolean(),incomplete_sections:z.number().int(),not_submitted:z.number().int(),
    unplaced_learners:z.number().int()})});
const age=z.object({years:z.number().int(),months:z.number().int()}).nullable();
const cardLearner=z.object({id:uuid,first_name:z.string(),middle_name:z.string().nullable(),last_name:z.string(),name_extension:z.string().nullable(),
  sex:z.enum(['male','female']),lrn:z.string().nullable(),birth_date:date.nullable()});
const subjectRows=z.array(z.object({offering_id:uuid,code:z.string(),name:z.string(),terms:z.record(z.string(),z.number().nullable()),final:z.number().nullable(),
  remark:z.enum(['passed','failed']).nullable()}));
const average=z.object({value:z.number().nullable(),remark:z.enum(['passed','failed']).nullable()});
const periods=z.array(z.object({id:uuid,ordinal:z.number().int(),name:z.string()}));
const count=z.number().nullable();
export const sf9Form=z.object({form:z.literal('sf9'),layout:z.enum(['grade1','grades2_3','grades4_6']),school,
  school_year:z.object({id:uuid,start_year:z.number().int(),starts_on:date,ends_on:date}),learner:cardLearner.extend({age_at_start:age,age_at_end:age}),
  enrollment:z.object({id:uuid,grade_level:z.number().int(),section_name:z.string().nullable(),adviser_name:z.string().nullable()}),periods,rule:rule.nullable(),
  attendance:z.object({rows:z.array(z.object({label:z.string(),term:z.string().nullable(),from:date,to:date,class_days:count,present:count,absent:count,tardy:count,known:z.boolean(),
      unmarked:z.array(date).describe('The dates of this month holding a classroom session nobody marked, which is what leaves it empty'),
      unset:z.array(date).describe('The dates the calendar has not set, or that hold an alternative-delivery session'),
      to_date:date.optional().describe('Only for a month under way: its figures are counted to this date, the last day of classes held')})),
    total:z.object({class_days:count,present:count,absent:count,tardy:count,to_date:date.optional().describe('Only while the year is under way: the totals are of the months begun, to this date')})}),
  subjects:subjectRows,general_average:average,outcome:z.object({action:z.enum(['promoted','conditionally_promoted','retained','remedial']).nullable(),eligible_grade:z.number().int().nullable()}),
  values:z.record(z.string(),z.record(z.string(),z.string())),
  notes:z.record(z.string(),z.object({can_do:z.string().nullable(),to_improve:z.string().nullable(),comment:z.string().nullable()})),warnings:z.array(z.string())});
// The SF10's own block shapes, which are not the SF9's. A transcribed year
// (0051) has no enrollment, no offering and no reporting period of this school's
// own, so each of those is nullable and the four quarters are numbered '1' to
// '4' as the form numbers them. `key` is what the page draws a row by, since a
// transcribed row has no id of the kind an offering has.
const sf10Periods=z.array(z.object({id:z.string(),ordinal:z.number().int(),name:z.string()}));
const sf10Subjects=z.array(z.object({key:z.string(),offering_id:uuid.nullable(),code:z.string().nullable(),name:z.string(),
  terms:z.record(z.string(),z.number().nullable()),final:z.number().nullable(),remark:z.enum(['passed','failed']).nullable()}));
const sf10School=z.object({name:z.string(),school_code:z.string().nullable(),address:z.string().nullable(),
  region:z.string().nullable(),division:z.string().nullable(),district:z.string().nullable()});
export const eligibility=z.object({credential:z.enum(['kinder_progress_report','eccd_checklist','kindergarten_certificate','pept','others']),
  credential_other:z.string().nullable(),school_name:z.string().nullable(),school_code:z.string().nullable(),school_address:z.string().nullable(),
  pept_rating:z.string().nullable(),examined_on:date.nullable(),testing_center:z.string().nullable(),remark:z.string().nullable()});
export const sf10Form=z.object({form:z.literal('sf10'),school,learner:cardLearner,
  blocks:z.array(z.object({key:z.string(),
    origin:z.enum(['register','encoded']).describe('`register`: a year EDUNEXUS recorded itself. `encoded`: a year transcribed from the school\'s own documents'),
    enrollment_id:uuid.nullable(),prior_year_id:uuid.nullable(),
    grade_level:z.number().int(),section_name:z.string().nullable(),adviser_name:z.string().nullable(),school:sf10School,
    school_year:z.object({id:uuid.nullable(),start_year:z.number().int()}),periods:sf10Periods,subjects:sf10Subjects,general_average:average,
    outcome:z.object({action:z.enum(['promoted','conditionally_promoted','retained','remedial']).nullable(),eligible_grade:z.number().int().nullable()})})),
  eligibility:eligibility.nullable().describe('The credential presented for Grade 1, which is where a Kindergarten record lives; the form has no scholastic block for Kinder'),
  last_school_year:z.number().int().nullable(),eligible_grade:z.number().int().nullable(),kindergarten_here:z.boolean()});
const ruleState=z.object({rule:rule.extend({updated_at:time}).nullable(),history:z.array(z.object({rule_version:z.number().int(),mixed_day:z.string(),single_session_day:z.string(),
  reason:z.string(),recorded_by:z.string().nullable(),recorded_at:time}))});
export const formResponses:Record<string,z.ZodType>={
  attendanceDayRuleGet:ruleState,attendanceDayRuleRecord:ruleState,
  sf2Get:sf2Form.extend({last_issuance:issuance.nullable()}),sf2Issue:z.object({form:sf2Form,issuance:issuance.extend({reprint:z.boolean()})}),
  sf4Get:sf4Form.extend({last_issuance:issuance.nullable()}),sf4Issue:z.object({form:sf4Form,issuance:issuance.extend({reprint:z.boolean()})}),
  formIssuanceList:z.object({items:z.array(issuance)}),
  sf9History:z.object({learner:z.object({id:uuid,first_name:z.string(),middle_name:z.string().nullable(),last_name:z.string(),
      name_extension:z.string().nullable(),lrn:z.string().nullable()}),
    items:z.array(z.object({enrollment_id:uuid,academic_year_id:uuid,start_year:z.number().int(),year_status:z.string(),
      grade_level:z.number().int(),section_name:z.string().nullable().describe('Null while the learner is enrolled at the grade but not in a class yet'),
      record_state:z.string(),enrollment_status:z.string(),
      card:z.enum(['issued','in_progress','no_card','voided']).describe('`no_card` is Kindergarten, which prints none: the school has supplied no Kindergarten card'),
      issuance:z.object({id:uuid,serial:z.number().int(),issued_at:z.iso.datetime({offset:true}),data_hash:z.string(),
        corrected:z.boolean(),reason:z.string().nullable()}).nullable(),
      issued_count:z.number().int().describe('How many times this year\'s card has been issued, corrections included; every one is kept')}))}),
  sf9Get:sf9Form.extend({last_issuance:issuance.nullable()}),sf9Issue:z.object({form:sf9Form,issuance:issuance.extend({reprint:z.boolean()})}),
  sf10Get:sf10Form.extend({last_issuance:issuance.nullable()}),sf10Issue:z.object({form:sf10Form,issuance:issuance.extend({reprint:z.boolean()})}),
};
