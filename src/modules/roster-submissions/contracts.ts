import {z} from 'zod';
import {gradeLevel,uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
import {issueSchema} from '../registry-review/contracts.js';
const version=z.number().int().min(1).max(2147483646),date=z.iso.date(),time=z.iso.datetime({offset:true});
// A list is for one class, or for one grade with no class yet (0061). Exactly
// one of the two, which the database checks again: `section_id` names the
// class, or `academic_year_id` and `grade_level` name the grade the learners
// are enrolling at, to be given classes afterwards.
const target={section_id:uuid.nullable().default(null),academic_year_id:uuid.optional(),grade_level:gradeLevel.optional()};
// A section, or a school year. The grade is optional from 2026-11-07: the
// template carries one per row, so a list may hold several grades and name
// none of them itself.
const oneTarget=(v:{section_id:string|null;academic_year_id?:string|undefined})=>
  (v.section_id!==null)!==(v.academic_year_id!==undefined);
const targetMessage='Give a section_id, or an academic_year_id; a grade_level for the whole list is optional when its rows carry their own.';
const list={...target,enrolled_on:date,entry_kind:z.enum(['regular','transfer_in']).default('regular'),csv:z.string().min(1).max(24000)};
export const submissionSchemas={
  check:z.strictObject(list).refine(oneTarget,targetMessage),create:z.strictObject({...list,reason:subjectReason}).refine(oneTarget,targetMessage),
  list:z.strictObject({status:z.enum(['submitted','withdrawn','accepted','declined','all']).default('submitted'),limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(100000).default(0)}),
  withdraw:z.strictObject({version,reason:subjectReason}),
  decide:z.strictObject({version,decision:z.enum(['accepted','declined']),import_id:uuid.nullable().default(null),reason:subjectReason}),
};
// A teacher prepares and submits; only a manager turns a list into learner records, through the reviewed import.
export const submissionOperations=([
  {id:'rosterSubmissionCheck',method:'post',path:'/api/v1/roster-submissions/check',summary:'Check a class list\'s format for a section you advise, without reading the registry or saving anything',body:submissionSchemas.check},
  {id:'rosterSubmissionCreate',method:'post',path:'/api/v1/roster-submissions',summary:'Submit a checked list, for your section or for a grade you advise a class at, for a manager to approve',body:submissionSchemas.create},
  {id:'rosterSubmissionList',method:'get',path:'/api/v1/roster-submissions',summary:'List class lists: every one for managers, your own for a teacher; the lists themselves are not included',query:submissionSchemas.list},
  {id:'rosterSubmissionGet',method:'get',path:'/api/v1/roster-submissions/:id',summary:'Read one class list, including the list itself'},
  {id:'rosterSubmissionWithdraw',method:'post',path:'/api/v1/roster-submissions/:id/withdrawal',summary:'Withdraw a class list you submitted while it is still waiting',body:submissionSchemas.withdraw},
  {id:'rosterSubmissionDecide',method:'post',path:'/api/v1/roster-submissions/:id/decision',summary:'Accept a waiting class list with the import you committed for it, or decline it with a reason',body:submissionSchemas.decide,manager:true},
] as const).map(op=>({...op,module:'roster-submissions' as const}));
export type SubmissionOperationId=typeof submissionOperations[number]['id'];
export const submissionRecord=z.object({id:uuid,section_id:uuid.nullable(),academic_year_id:uuid,enrolled_on:date,entry_kind:z.enum(['regular','transfer_in']),row_count:z.number().int(),
  status:z.enum(['submitted','withdrawn','accepted','declined']),submitted_by:uuid,decided_by:uuid.nullable(),import_id:uuid.nullable(),version:z.number().int(),created_at:time,updated_at:time,
  grade_level:z.number().int().nullable().describe('The grade of the section for a class list, the list own grade when it has one, or null when its rows carry their own grades'),
  section_name:z.string().nullable().describe('Null for a list submitted at a grade with no class yet'),submitted_by_name:z.string().nullable()});
const profile=z.object({lrn:z.string().nullable(),first_name:z.string(),middle_name:z.string().nullable(),last_name:z.string(),name_extension:z.string().nullable(),birth_date:date,sex:z.enum(['male','female'])});
export const submissionResponses:Record<string,z.ZodType>={
  rosterSubmissionCheck:z.object({row_count:z.number().int(),rows:z.array(profile.nullable()),issues:z.array(issueSchema)}),
  rosterSubmissionCreate:submissionRecord,rosterSubmissionWithdraw:submissionRecord,rosterSubmissionDecide:submissionRecord,
  rosterSubmissionList:z.object({items:z.array(submissionRecord),pagination:z.object({limit:z.number().int(),offset:z.number().int(),has_more:z.boolean()})}),
  rosterSubmissionGet:submissionRecord.extend({csv:z.string()}),
};
