import {z} from 'zod';
import {firstCapital} from '../../core/text.js';
import {uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
const version=z.number().int().min(0).max(2147483646),date=z.iso.date();
// Exactly as report-records states it, because it is the same thing: a grade a
// document already carries, refused rather than rounded if it has a third
// decimal place. Nothing here computes one.
const grade=z.number().min(0).max(100).refine(v=>Math.abs(v*100-Math.round(v*100))<1e-6,'At most two decimal places, as the document shows it.').nullable();
const remark=z.enum(['passed','failed']).nullable();
const line=(max:number)=>z.string().trim().overwrite(firstCapital).min(1).max(max).regex(/^[^\u0000-\u001f\u007f]*$/,'Use one plain line of text.');
const code=z.string().trim().regex(/^[A-Z][A-Z0-9_-]{0,23}$/,'A code is capitals, digits, dash or underscore, starting with a letter.');
// Which document this was transcribed from. A permanent record copied out of a
// spreadsheet is only as good as the note saying which spreadsheet.
const source=z.string().trim().overwrite(firstCapital).min(10,'Name the document this was copied from, in at least ten characters.').max(500)
  .regex(/^[^\u0000-\u001f\u007f]*$/,'Use one plain line of text.');
const priorSubject=z.strictObject({subject_id:uuid.nullable().default(null),code:code.nullable().default(null),name:line(120),
  q1:grade.default(null),q2:grade.default(null),q3:grade.default(null),q4:grade.default(null),final:grade.default(null),remark:remark.default(null)});
// A scholastic block is Grade 1 to Grade 6. Kindergarten is the credential that
// makes a learner eligible for Grade 1, and goes on the eligibility block
// instead; the SF10-ES has no scholastic block for it (decided 2026-11-03).
const kinderIsACredential='Grade 1 to Grade 6. A Kindergarten record is the credential presented for Grade 1: record it under Eligibility for Grade 1, which carries no grade.';
const priorYear=z.strictObject({start_year:z.number().int().min(1990,'A school year from 1990 up to this one.').max(2100),
  grade_level:z.number().int().min(1,kinderIsACredential).max(6,kinderIsACredential),
  school_name:line(150),school_code:z.string().trim().regex(/^[0-9]{6}$/,'Six digits, as the school\'s own forms print it.').nullable().default(null),
  school_address:line(300).nullable().default(null),section_name:line(60).nullable().default(null),adviser_name:line(150).nullable().default(null),
  general_average:grade.default(null),remark:remark.default(null),source});
export const priorSchemas={
  create:z.strictObject({year:priorYear,subjects:z.array(priorSubject).min(1).max(40),reason:subjectReason}),
  update:z.strictObject({version,year:priorYear,subjects:z.array(priorSubject).min(1).max(40),reason:subjectReason}),
  remove:z.strictObject({version,reason:subjectReason}),
  eligibility:z.strictObject({version,credential:z.enum(['kinder_progress_report','eccd_checklist','kindergarten_certificate','pept','others']),
    credential_other:line(150).nullable().default(null),school_name:line(150).nullable().default(null),
    school_code:z.string().trim().regex(/^[0-9]{6}$/,'Six digits, as the school\'s own forms print it.').nullable().default(null),
    school_address:line(300).nullable().default(null),pept_rating:line(30).nullable().default(null),examined_on:date.nullable().default(null),
    testing_center:line(300).nullable().default(null),remark:line(150).nullable().default(null),source,reason:subjectReason}),
  history:z.strictObject({limit:z.coerce.number().int().min(1).max(50).default(10),before_id:z.string().regex(/^[1-9][0-9]{0,17}$/).optional()}),
};
// The one-off transcription of the history the school already holds on paper, so
// that a learner who starts mid-way through elementary school still has one
// cumulative SF10. Grades are the ones the source document carries; nothing here
// computes a total, an average or a transmutation.
export const priorOperations=([
  {id:'priorRecordsGet',method:'get',path:'/api/v1/learners/:id/prior-records',summary:'Read one learner\'s encoded academic history: the credential presented for Grade 1, every transcribed school year with its learning areas, and the school years EDUNEXUS holds itself, so the whole record reads as one'},
  {id:'priorYearRecord',method:'post',path:'/api/v1/learners/:id/prior-years',summary:'Transcribe one previous school year from the school\'s own documents: the grade, the school that taught it, its learning areas and the general average the document carries; refused for a year EDUNEXUS already holds, and for Kindergarten, which is the eligibility credential instead',body:priorSchemas.create},
  {id:'priorYearUpdate',method:'patch',path:'/api/v1/prior-years/:id',summary:'Correct one transcribed school year against its source document, learning areas and all, with the reason; the journal keeps what it said before',body:priorSchemas.update},
  {id:'priorYearRemove',method:'post',path:'/api/v1/prior-years/:id/removal',summary:'Remove a school year that should never have been transcribed, with the reason; its learning areas go with it and the journal keeps what it said',body:priorSchemas.remove},
  {id:'eligibilityRecord',method:'patch',path:'/api/v1/learners/:id/eligibility',summary:'Record the credential presented for Grade 1 — the Kinder progress report, ECCD checklist, Kindergarten certificate, a PEPT rating or another — with the school that issued it; this is where a Kindergarten record goes, and it carries no grade',body:priorSchemas.eligibility},
  {id:'encodingProgressGet',method:'get',path:'/api/v1/academic-years/:id/encoding-progress',summary:'Count, for every section of a year and for the learners in no class yet, how far the historical encoding has got: the learners each holds, how many have an encoded previous year, how many have the Grade 1 credential and how many have neither, with the adviser named; reads no grade, names no learner and writes no access record',manager:true},
  {id:'priorRecordHistory',method:'get',path:'/api/v1/learners/:id/prior-record-events',summary:'Read the journal of one learner\'s encoded history, newest first, with what each save changed',query:priorSchemas.history},
] as const).map(op=>({...op,module:'prior-records' as const}));
export type PriorOperationId=typeof priorOperations[number]['id'];

const subjectRow=z.object({subject_id:uuid.nullable(),code:z.string().nullable(),name:z.string(),display_order:z.number().int(),
  q1:z.number().nullable(),q2:z.number().nullable(),q3:z.number().nullable(),q4:z.number().nullable(),final:z.number().nullable(),remark});
export const priorYearRecord=z.object({id:uuid,learner_id:uuid,start_year:z.number().int(),grade_level:z.number().int(),school_name:z.string(),
  school_code:z.string().nullable(),school_address:z.string().nullable(),section_name:z.string().nullable(),adviser_name:z.string().nullable(),
  general_average:z.number().nullable(),remark,source:z.string(),version:z.number().int(),subjects:z.array(subjectRow)});
export const eligibilityRecordShape=z.object({id:uuid,learner_id:uuid,credential:z.enum(['kinder_progress_report','eccd_checklist','kindergarten_certificate','pept','others']),
  credential_other:z.string().nullable(),school_name:z.string().nullable(),school_code:z.string().nullable(),school_address:z.string().nullable(),
  pept_rating:z.string().nullable(),examined_on:date.nullable(),testing_center:z.string().nullable(),remark:z.string().nullable(),
  source:z.string(),version:z.number().int()});
const records=z.object({
  learner:z.object({id:uuid,first_name:z.string(),middle_name:z.string().nullable(),last_name:z.string(),name_extension:z.string().nullable(),
    sex:z.enum(['male','female']),lrn:z.string().nullable(),birth_date:date.nullable(),version:z.number().int()}),
  may_write:z.boolean().describe('Whether this caller may encode for this learner: a manager for anyone, an adviser for a learner currently in a section they advise'),
  school:z.object({name:z.string(),school_code:z.string().nullable(),address:z.string(),region:z.string().nullable(),division:z.string().nullable(),district:z.string().nullable()}).loose(),
  eligibility:eligibilityRecordShape.nullable(),
  prior_years:z.array(priorYearRecord),
  recorded_years:z.array(z.object({academic_year_id:uuid,start_year:z.number().int(),grade_level:z.number().int(),section_name:z.string().nullable(),status:z.string()}))
    .describe('The school years EDUNEXUS holds as enrollments. They are not encoded here: their grades are entered on Promotion and reach the SF10 from there'),
});
/**
 * How far the school has got with the historical encoding, by section.
 *
 * Counts only, and that is the whole design: every learner list under
 * `/learners` and `/enrollments` writes a `record_access_events` row naming the
 * records it returned, so a school-wide view that paged the registry would bury
 * the privacy audit in its own noise. This names no learner and reads no rating,
 * so it writes no access row — the same bargain `gradeEntryGet` makes.
 */
const encodingProgress=z.object({
  school_year:z.object({id:uuid,start_year:z.number().int(),status:z.string()}),today:date,
  sections:z.array(z.object({id:uuid,grade_level:z.number().int(),name:z.string(),
    adviser_user_id:uuid.nullable(),adviser_name:z.string().nullable(),
    learners:z.number().int().describe('The learners this section currently holds'),
    with_years:z.number().int().describe('How many have at least one encoded previous school year'),
    with_credential:z.number().int().describe('How many have the credential presented for Grade 1 recorded'),
    with_nothing:z.number().int().describe('How many have neither: the work still to do'),
    encoded_years:z.number().int().describe('Encoded previous school years counted across the section')})),
  unplaced:z.array(z.object({grade_level:z.number().int(),learners:z.number().int(),
    with_years:z.number().int(),with_credential:z.number().int(),with_nothing:z.number().int()}))
    .describe('Learners registered at a grade with no class yet, who are on no section row above and would otherwise be missing from the school total'),
});
export const priorResponses:Record<string,z.ZodType>={
  priorRecordsGet:records,
  encodingProgressGet:encodingProgress,
  priorYearRecord:priorYearRecord,priorYearUpdate:priorYearRecord,priorYearRemove:priorYearRecord,
  eligibilityRecord:eligibilityRecordShape,
  priorRecordHistory:z.object({items:z.array(z.object({id:z.string(),prior_year_id:uuid.nullable(),kind:z.enum(['prior_year','eligibility']),
    action:z.enum(['create','update','delete']),before_snapshot:z.unknown().nullable(),after_snapshot:z.unknown().nullable(),reason:z.string(),
    actor_user_id:uuid,recorded_at:z.iso.datetime({offset:true})})),pagination:z.object({limit:z.number(),next_before_id:z.string().nullable()})}),
};

