import {z} from 'zod';
import {plainText} from '../../core/text.js';
import {uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
const paragraphs=(min:number,max:number)=>z.string().trim().min(min).max(max).regex(plainText,'Remove the hidden control characters.');
const line=(min:number,max:number)=>z.string().trim().min(min).max(max).regex(/^[^\u0000-\u001f\u007f]*$/,'Keep it on one line.');
const date=z.iso.date(),version=z.number().int().min(0).max(2147483646);
const fields={
  kind:z.enum(['news','event','advisory']),title:line(3,160),summary:line(3,300),body:z.string().max(6000).regex(plainText,'Remove the hidden control characters.').default(''),
  event_on:date.nullable().default(null),event_ends_on:date.nullable().default(null),event_time:line(1,60).nullable().default(null),venue:line(1,120).nullable().default(null),
  pinned:z.boolean().default(false),
};
// An event has a date and the others do not; the database refuses the rest, this names the field.
const dated=<T extends z.ZodType<{kind:string;event_on:string|null;event_ends_on:string|null}>>(schema:T)=>schema
  .refine(v=>(v.kind==='event')===(v.event_on!==null),{path:['event_on'],message:'An event needs its date; news and advisories have none.'})
  .refine(v=>v.event_ends_on===null||(v.event_on!==null&&v.event_ends_on>=v.event_on),{path:['event_ends_on'],message:'The last day comes on or after the first.'});
const optional=(schema:z.ZodType<string>)=>schema.nullable().default(null);
export const siteSchemas={
  list:z.strictObject({archived:z.enum(['true','false']).default('false')}),
  create:dated(z.strictObject({...fields,reason:subjectReason})),
  update:dated(z.strictObject({...fields,version,reason:subjectReason})),
  status:z.strictObject({version,action:z.enum(['publish','unpublish','archive']),reason:subjectReason}),
  faqCreate:z.strictObject({question:line(3,200),answer:paragraphs(3,3000),position:z.number().int().min(1).max(999).default(100),reason:subjectReason}),
  faqUpdate:z.strictObject({question:line(3,200),answer:paragraphs(3,3000),position:z.number().int().min(1).max(999).default(100),version,reason:subjectReason}),
  settings:z.strictObject({version,reason:subjectReason,
    tagline:optional(line(3,200)),about:optional(paragraphs(3,3000)),mission:optional(paragraphs(3,1500)),vision:optional(paragraphs(3,1500)),
    phone:optional(line(3,60)),email:optional(z.email()),office_hours:optional(line(3,120)),
    facebook_url:optional(z.string().regex(/^https:\/\/(www\.|m\.)?facebook\.com\/\S{1,200}$/,'A Facebook page address, starting https://www.facebook.com/'))}),
};
// The school's own front page. Writing is the principal's and the administrative officer's; the public reads it without signing in.
export const siteOperations=([
  {id:'announcementList',method:'get',path:'/api/v1/announcements',summary:'List the school\'s announcements and events, drafts included, and its front-page details',query:siteSchemas.list,manager:true},
  {id:'announcementCreate',method:'post',path:'/api/v1/announcements',summary:'Write an announcement, an event or an advisory as a draft',body:siteSchemas.create,manager:true},
  {id:'announcementUpdate',method:'patch',path:'/api/v1/announcements/:id',summary:'Change an announcement, keeping what it said before in the journal',body:siteSchemas.update,manager:true},
  {id:'announcementStatus',method:'post',path:'/api/v1/announcements/:id/status',summary:'Publish an announcement on the front page, take it back to a draft, or archive it for good',body:siteSchemas.status,manager:true},
  {id:'siteFaqList',method:'get',path:'/api/v1/site-faqs',summary:'List the questions for parents and guardians on the front page, drafts included, in the order they are shown',query:siteSchemas.list,manager:true},
  {id:'siteFaqCreate',method:'post',path:'/api/v1/site-faqs',summary:'Write a question and its answer for the front page, as a draft',body:siteSchemas.faqCreate,manager:true},
  {id:'siteFaqUpdate',method:'patch',path:'/api/v1/site-faqs/:id',summary:'Change a question, its answer or its place in the list, keeping what it said before in the journal',body:siteSchemas.faqUpdate,manager:true},
  {id:'siteFaqStatus',method:'post',path:'/api/v1/site-faqs/:id/status',summary:'Publish a question on the front page, take it back to a draft, or archive it for good',body:siteSchemas.status,manager:true},
  {id:'siteSettingsSave',method:'patch',path:'/api/v1/site-settings',summary:'Change what the front page says about the school: tagline, about, mission, vision and contact details',body:siteSchemas.settings,manager:true},
] as const).map(op=>({...op,module:'site' as const}));
export type SiteOperationId=typeof siteOperations[number]['id'];
const announcement=z.object({id:uuid,kind:z.enum(['news','event','advisory']),title:z.string(),summary:z.string(),body:z.string(),event_on:date.nullable(),event_ends_on:date.nullable(),
  event_time:z.string().nullable(),venue:z.string().nullable(),pinned:z.boolean(),status:z.enum(['draft','published','archived']),published_at:z.string().nullable(),version:z.number().int(),updated_at:z.string()});
const settings=z.object({tagline:z.string().nullable(),about:z.string().nullable(),mission:z.string().nullable(),vision:z.string().nullable(),phone:z.string().nullable(),
  email:z.string().nullable(),office_hours:z.string().nullable(),facebook_url:z.string().nullable(),version:z.number().int()});
const faq=z.object({id:uuid,question:z.string(),answer:z.string(),position:z.number().int(),status:z.enum(['draft','published','archived']),published_at:z.string().nullable(),version:z.number().int(),updated_at:z.string()});
export const siteResponses:Record<string,z.ZodType>={
  siteFaqList:z.object({items:z.array(faq.extend({updated_by:z.string().nullable()}))}),siteFaqCreate:faq,siteFaqUpdate:faq,siteFaqStatus:faq,
  announcementList:z.object({items:z.array(announcement.extend({updated_by:z.string().nullable()})),settings}),
  announcementCreate:announcement,announcementUpdate:announcement,announcementStatus:announcement,siteSettingsSave:settings,
};
