import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
const version=z.number().int().min(0).max(2147483646),date=z.iso.date();
// As the ECR shows it; a third decimal place is refused, never rounded, here beside its box and in the database too.
const grade=z.number().min(0).max(100).refine(v=>Math.abs(v*100-Math.round(v*100))<1e-6,'At most two decimal places, as the ECR shows it.').nullable();
// A comment or narrative is written in sentences and may run to a second line. The table refuses a tab, a
// carriage return and any other control character, and text that is only spaces; this says so beside the box.
const body=z.string().trim().min(1,'Write the comment, or clear it.').max(1000).regex(/^[^\u0000-\u0009\u000b-\u001f\u007f]*$/,'Use plain text: line breaks are kept, tabs and hidden characters are not.').nullable();
const remark=z.enum(['passed','failed']).nullable();
const mark=z.enum(['AO','SO','RO','NO']).nullable();
export const valueCodes=['MD1','MD2','MT1','MT2','MK1','MB1','MB2'] as const;
const entries=<T extends z.ZodRawShape>(shape:T)=>z.array(z.strictObject({enrollment_id:uuid,version,...shape})).min(1).max(100);
export const reportSchemas={
  grades:z.strictObject({reporting_period_id:uuid.nullable(),entries:entries({grade,remark:remark.optional()}),reason:subjectReason}),
  summaries:z.strictObject({entries:entries({general_average:grade,remark}),reason:subjectReason}),
  values:z.strictObject({reporting_period_id:uuid,entries:entries({ratings:z.partialRecord(z.enum(valueCodes),mark)}),reason:subjectReason}),
  notes:z.strictObject({kind:z.enum(['can_do','to_improve','comment','sf2_remark']),reporting_period_id:uuid.nullable().default(null),month_on:date.nullable().default(null),
    entries:entries({body}),reason:subjectReason}),
  // One learner's card as it prints, box by box; each part is checked by the class table's own writer.
  card:z.strictObject({grades:z.array(z.strictObject({offering_id:uuid,reporting_period_id:uuid.nullable(),grade,remark:remark.optional(),version})).max(200).default([]),
    summary:z.strictObject({general_average:grade,remark,version}).nullable().default(null),
    values:z.array(z.strictObject({reporting_period_id:uuid,ratings:z.partialRecord(z.enum(valueCodes),mark),version})).max(20).default([]),
    notes:z.array(z.strictObject({kind:z.enum(['can_do','to_improve','comment']),reporting_period_id:uuid,body,version})).max(60).default([]),
    reason:subjectReason}),
  promotions:z.strictObject({section_id:uuid.optional()}),
  recommend:z.strictObject({entries:entries({action:z.enum(['promoted','conditionally_promoted','retained','remedial']).nullable()}),reason:subjectReason}),
  decide:z.strictObject({entries:entries({decision:z.enum(['approved','returned'])}),reason:subjectReason}),
  history:z.strictObject({limit:z.coerce.number().int().min(1).max(50).default(10),before_id:z.string().regex(/^[1-9][0-9]{0,17}$/).optional()}),
};
// Grades are entered as the DepEd ECR computed them; nothing here computes one.
export const reportOperations=([
  {id:'reportRecordsGet',method:'get',path:'/api/v1/sections/:id/report-records',summary:'Read a section\'s report-card records: its terms and learning areas, and each current learner\'s grades as entered from the ECR, general average, observed values and notes'},
  {id:'reportGradesRecord',method:'post',path:'/api/v1/section-subjects/:id/report-grades',summary:'Record one learning area\'s grades for a term, or its final grades and remarks when the period is null, exactly as the ECR computed them; never computed here',body:reportSchemas.grades},
  {id:'reportSummariesRecord',method:'post',path:'/api/v1/sections/:id/report-summaries',summary:'Record each learner\'s general average and remark as the ECR computed them',body:reportSchemas.summaries},
  {id:'reportValuesRecord',method:'post',path:'/api/v1/sections/:id/report-values',summary:'Record the report card\'s observed values for a term: AO, SO, RO or NO against each behaviour statement',body:reportSchemas.values},
  {id:'reportNotesRecord',method:'post',path:'/api/v1/sections/:id/report-notes',summary:'Record an adviser\'s narratives or comment for a term, or a learner\'s SF2 remark for a month',body:reportSchemas.notes},
  {id:'reportCardGet',method:'get',path:'/api/v1/enrollments/:id/report-card',summary:'Read one learner\'s report-card records with the version each box was last recorded at, so the card can be typed on the SF9 itself; the same read as the section\'s, narrowed to this enrollment, and the access log names only it'},
  {id:'reportCardRecord',method:'post',path:'/api/v1/enrollments/:id/report-card',summary:'Record one learner\'s report card box by box, as it prints: term grades, subject averages and remarks, the general average, observed values and term narratives, all in one transaction or none; every part is checked and journalled as the class tables are, and nothing is computed',body:reportSchemas.card},
  {id:'promotionsGet',method:'get',path:'/api/v1/academic-years/:id/promotions',summary:'Read end-of-year outcomes: one section\'s, or for a manager every section\'s in the year; recorded decisions, never derived from grades',query:reportSchemas.promotions},
  {id:'promotionReadiness',method:'get',path:'/api/v1/sections/:id/promotion-readiness',summary:'Whether promotion is open for this class, and what its report cards are still missing: every learning area in every configured term, each subject average and remark, and a general average, counted against its current learners. Counts only — no grade is read and no learner is named'},
  {id:'promotionsRecommend',method:'post',path:'/api/v1/sections/:id/promotion-recommendations',summary:'Recommend each learner\'s end-of-year outcome, promoted, retained or remedial, as the adviser; an approved outcome changes only after it is returned',body:reportSchemas.recommend},
  {id:'promotionsDecide',method:'post',path:'/api/v1/sections/:id/promotion-decisions',summary:'Approve recommended outcomes, or return them to the adviser, with a reason',body:reportSchemas.decide,manager:true},
  {id:'gradeEntryGet',method:'get',path:'/api/v1/academic-years/:id/grade-entry',summary:'Count, for every section of a year, the grades recorded for each learning area and term, the general averages and the outcomes, against its current learners; reads no grade and names no learner',manager:true},
  {id:'reportRecordHistory',method:'get',path:'/api/v1/sections/:id/report-record-events',summary:'Read the journal of a section\'s report-card records, newest first',query:reportSchemas.history},
] as const).map(op=>({...op,module:'report-records' as const}));
export type ReportOperationId=typeof reportOperations[number]['id'];
const learner=z.object({enrollment_id:uuid,status:z.enum(['enrolled','withdrawn']),first_name:z.string(),middle_name:z.string().nullable(),last_name:z.string(),name_extension:z.string().nullable(),
  sex:z.enum(['male','female']),lrn:z.string().nullable(),
  grades:z.array(z.object({offering_id:uuid,reporting_period_id:uuid.nullable(),grade:z.number().nullable(),remark,version:z.number().int()})),
  summary:z.object({general_average:z.number().nullable(),remark,version:z.number().int()}).nullable(),
  values:z.array(z.object({reporting_period_id:uuid,ratings:z.record(z.string(),z.string()),version:z.number().int()})),
  notes:z.array(z.object({kind:z.string(),reporting_period_id:uuid.nullable(),month_on:date.nullable(),body:z.string().nullable(),version:z.number().int()}))});
const written=z.object({changed:z.number().int(),entries:z.array(z.object({enrollment_id:uuid,before:z.unknown(),after:z.unknown(),version:z.number().int()}))});
const sectionRecords={section:z.object({id:uuid,grade_level:z.number().int(),name:z.string(),adviser_name:z.string().nullable()}),
  school_year:z.object({id:uuid,start_year:z.number().int(),starts_on:date,ends_on:date,status:z.string()}),
  periods:z.array(z.object({id:uuid,ordinal:z.number().int(),name:z.string(),starts_on:date,ends_on:date})),
  offerings:z.array(z.object({id:uuid,display_order:z.number().int(),active:z.boolean(),code:z.string(),name:z.string()}))};
export const reportResponses:Record<string,z.ZodType>={
  reportRecordsGet:z.object({...sectionRecords,learners:z.array(learner)}),
  reportCardGet:z.object({...sectionRecords,learner}),
  promotionsGet:z.object({items:z.array(z.object({enrollment_id:uuid,section_id:uuid,grade_level:z.number().int(),action:z.enum(['promoted','conditionally_promoted','retained','remedial']).nullable(),
    status:z.enum(['recommended','approved','returned']),version:z.number().int(),updated_at:z.iso.datetime({offset:true}),recommended_by:z.string().nullable(),decided_by:z.string().nullable()}))}),
  promotionsRecommend:written,
  // Each decision says what became of the learner: advanced into next year, or the reason it did not.
  promotionsDecide:z.object({changed:z.number().int(),advanced:z.number().int(),waiting_for_next_year:z.number().int(),
    entries:z.array(z.object({enrollment_id:uuid,before:z.unknown(),after:z.unknown(),version:z.number().int(),
      advance:z.object({advanced:z.boolean(),why:z.string().optional(),enrollment_id:uuid.optional(),academic_year_id:uuid.optional(),
        start_year:z.number().int().optional(),grade_level:z.number().int().optional(),action:z.string().optional()})}))}),
  promotionReadiness:z.object({section:z.object({id:uuid,grade_level:z.number().int(),name:z.string(),adviser_name:z.string().nullable()}),
    school_year:z.object({id:uuid,start_year:z.number().int(),status:z.string()}),today:date,
    learners:z.number().int(),offerings:z.number().int(),
    requires:z.object({descriptive:z.boolean(),grades:z.boolean(),note_kinds:z.array(z.string())}),
    ready:z.boolean(),blocked_by:z.enum(['incomplete','no_periods','no_offerings']).nullable(),missing_total:z.number().int(),
    periods:z.array(z.object({id:uuid,ordinal:z.number().int(),name:z.string(),starts_on:date,ends_on:date,
      open:z.boolean().describe('The term has started, so its grades may be encoded'),missing:z.number().int(),complete:z.boolean()})),
    final:z.object({missing_grades:z.number().int(),missing_remarks:z.number().int(),complete:z.boolean()}),
    general_average:z.object({missing:z.number().int(),complete:z.boolean()})}),
  gradeEntryGet:z.object({school_year:z.object({id:uuid,start_year:z.number().int(),status:z.string()}),today:date,
    periods:z.array(z.object({id:uuid,ordinal:z.number().int(),name:z.string(),starts_on:date,ends_on:date})),
    sections:z.array(z.object({id:uuid,grade_level:z.number().int(),name:z.string(),adviser_name:z.string().nullable(),learners:z.number().int(),
      offerings:z.array(z.object({id:uuid,code:z.string(),name:z.string(),recorded:z.record(z.string(),z.number().int()).describe('Grades recorded, keyed by reporting period ID, or final')})),
      general_averages:z.number().int(),outcomes:z.object({recorded:z.number().int(),approved:z.number().int(),returned:z.number().int()})}))}),
  reportGradesRecord:written,reportCardRecord:written,reportSummariesRecord:written,reportValuesRecord:written,reportNotesRecord:written,
  reportRecordHistory:z.object({items:z.array(z.object({id:z.string(),kind:z.string(),scope:z.record(z.string(),z.unknown()),entries:z.array(z.unknown()),reason:z.string(),
    actor_user_id:uuid,recorded_at:z.iso.datetime({offset:true})})),pagination:z.object({limit:z.number(),next_before_id:z.string().nullable()})}),
};
