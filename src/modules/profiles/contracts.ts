import {z} from 'zod';
import {staffRole,uuid} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
import {firstCapital,plainName,plainNameMessage,singleSpaced} from '../../core/text.js';

const staffName=(max:number)=>z.string().trim().overwrite(singleSpaced).overwrite(firstCapital).min(1).max(max).regex(plainName,plainNameMessage);

const version=z.number().int().min(0).max(2147483646);
export const avatarIcons=['book','pencil','globe','leaf','sun','star','music','flask','ball','heart','compass','palette'] as const;
export const avatarTones=['slate','blue','green','ochre','plum','teal'] as const;
// Base64 of the two sizes the browser sends; the API decodes and checks each as a JPEG before anything is stored.
// Half again over the limit still parses, so an oversized picture is answered in words rather than as a length.
const encoded=(max:number)=>z.string().max(Math.ceil(max*1.5/3)*4).regex(/^[A-Za-z0-9+/]+={0,2}$/,'Send the picture again from Change photo.');
export const photoLimits={image:{bytes:143360,min:128,max:1024},thumb:{bytes:20480,min:64,max:256}};
export const profileSchemas={
  save:z.strictObject({version,
    avatar:z.enum(['initials','icon','photo']).optional(),avatar_icon:z.enum(avatarIcons).nullable().optional(),avatar_tone:z.enum(avatarTones).optional(),
    landing:z.string().regex(/^[a-z0-9-]{1,40}$/,'Choose one of the screens offered.').nullable().optional(),
    text_size:z.enum(['small','standard','large','larger']).optional(),motion:z.enum(['system','reduce']).optional(),theme:z.enum(['light','dark','system']).optional(),
    density:z.enum(['compact','comfortable','spacious']).optional(),
    contrast:z.enum(['system','more']).optional(),links:z.enum(['standard','underline']).optional(),focus:z.enum(['standard','strong']).optional(),
    targets:z.enum(['standard','large']).optional(),spacing:z.enum(['standard','relaxed']).optional(),typeface:z.enum(['standard','readable']).optional()})
    .refine(v=>Object.keys(v).length>1,'Provide a change')
    .refine(v=>v.avatar!=='icon'||Boolean(v.avatar_icon),{path:['avatar_icon'],message:'Choose an icon to show.'}),
  photo:z.strictObject({version,image:encoded(photoLimits.image.bytes),thumb:encoded(photoLimits.thumb.bytes)}),
  remove:z.strictObject({version}),
  takeDown:z.strictObject({version,reason:subjectReason}),
  nameRequest:z.strictObject({display_name:staffName(150),position:staffName(120).nullable(),note:subjectReason}),
  withdraw:z.strictObject({version}),
  decide:z.strictObject({version,decision:z.enum(['approve','decline']),reason:subjectReason}),
  requests:z.strictObject({status:z.enum(['pending','approved','declined','withdrawn']).default('pending')}),
  activity:z.strictObject({kind:z.enum(['changes','reads']),before_id:z.string().regex(/^[1-9][0-9]{0,17}$/).optional(),limit:z.coerce.number().int().min(1).max(100).default(25)}),
};
// A person's own profile, and a manager taking down a colleague's photo. Only the last is a manager's.
export const profileOperations=([
  {id:'profileGet',method:'get',path:'/api/v1/me/profile',summary:'Read your own profile: how the school has you recorded, the sections you advise, your picture and your preferences'},
  {id:'profileSave',method:'patch',path:'/api/v1/me/profile',summary:'Change your own avatar, interface preferences and accessibility settings',body:profileSchemas.save},
  {id:'photoSave',method:'post',path:'/api/v1/me/photo',summary:'Set or replace your own profile photo, sent as a square JPEG and a thumbnail; metadata is removed before it is stored',body:profileSchemas.photo,bodyLimit:'256kb'},
  {id:'photoRemove',method:'post',path:'/api/v1/me/photo/remove',summary:'Remove your own profile photo for good',body:profileSchemas.remove},
  {id:'staffPhotoGet',method:'get',path:'/api/v1/staff/:id/photo',summary:'Read a staff member\'s full profile photo: your own, or as a principal or administrative officer'},
  {id:'sessionList',method:'get',path:'/api/v1/me/sessions',summary:'List where your account has been signed in lately, as the API saw it: browser and system, never an address'},
  {id:'sessionsEndOthers',method:'post',path:'/api/v1/me/sessions/end-others',summary:'Record that every other sign-in session was ended, after the sign-in service revoked them'},
  {id:'nameRequestCreate',method:'post',path:'/api/v1/me/name-requests',summary:'Ask for your own name or position to be corrected; a principal or administrative officer decides',body:profileSchemas.nameRequest},
  {id:'nameRequestWithdraw',method:'post',path:'/api/v1/me/name-requests/:id/withdraw',summary:'Withdraw your own open request',body:profileSchemas.withdraw},
  {id:'nameRequestList',method:'get',path:'/api/v1/name-requests',summary:'List the corrections staff asked for, open ones by default, saying which you may decide',query:profileSchemas.requests,manager:true},
  {id:'nameRequestDecide',method:'post',path:'/api/v1/name-requests/:id/decide',summary:'Approve a correction into the staff record, or decline it, with a reason; never your own',body:profileSchemas.decide,manager:true},
  {id:'activityList',method:'get',path:'/api/v1/me/activity',summary:'Your own recorded changes, or the learner record reads logged under your name, newest first; names no learner',query:profileSchemas.activity},
  {id:'staffPhotoRemove',method:'post',path:'/api/v1/staff/:id/photo/remove',summary:'Take down a colleague\'s profile photo with a reason, as the manager of that account',body:profileSchemas.takeDown,manager:true},
] as const).map(op=>({...op,module:'profiles' as const}));
export type ProfileOperationId=typeof profileOperations[number]['id'];

const view=z.object({avatar:z.enum(['initials','icon','photo']),avatar_icon:z.enum(avatarIcons).nullable(),avatar_tone:z.enum(avatarTones),
  landing:z.string().nullable(),text_size:z.enum(['small','standard','large','larger']),motion:z.enum(['system','reduce']),theme:z.enum(['light','dark','system']),
  density:z.enum(['compact','comfortable','spacious']),
  contrast:z.enum(['system','more']),links:z.enum(['standard','underline']),focus:z.enum(['standard','strong']),
  targets:z.enum(['standard','large']),spacing:z.enum(['standard','relaxed']),typeface:z.enum(['standard','readable']),
  version:z.number().int(),photo:z.object({sha256:z.string(),thumb:z.string().describe('Base64 JPEG, at most 256 pixels square'),updated_at:z.string()}).nullable()});
export const profileView=view;
const nameRequest=z.object({id:uuid,user_id:uuid,current_name:z.string(),requested_name:z.string().nullable(),current_position:z.string().nullable(),requested_position:z.string().nullable(),
  note:z.string(),status:z.enum(['pending','approved','declined','withdrawn']),decision_reason:z.string().nullable(),decided_at:z.string().nullable(),decided_by:z.string().nullable(),
  created_at:z.string(),version:z.number().int()});
export const profileResponses:Record<string,z.ZodType>={
  profileGet:z.object({user_id:uuid,display_name:z.string(),role:staffRole,position:z.string().nullable(),specialization:z.string().nullable(),profile:view,
    advises:z.array(z.object({id:uuid,grade_level:z.number().int(),name:z.string(),start_year:z.number().int(),year_status:z.enum(['draft','active'])})),
    name_request:nameRequest.nullable().describe('Your open request, or the last one decided in the past 30 days'),
    photo_taken_down:z.object({at:z.string(),by:z.string().nullable(),reason:z.string()}).nullable().describe('Who took your photo down and why, while no photo has been set since, for 60 days')}),
  sessionList:z.object({items:z.array(z.object({device:z.string(),assurance:z.enum(['aal1','aal2']),first_seen:z.string(),last_seen:z.string(),ended_at:z.string().nullable(),current:z.boolean()}))}),
  sessionsEndOthers:z.object({ended:z.number().int()}),
  nameRequestCreate:nameRequest,nameRequestWithdraw:nameRequest,nameRequestDecide:nameRequest,
  nameRequestList:z.object({items:z.array(nameRequest.extend({requested_by:z.string(),role:staffRole,yours:z.boolean(),may_decide:z.boolean()}))}),
  activityList:z.object({items:z.array(z.object({id:z.string(),occurred_at:z.string()}).loose()),pagination:z.object({limit:z.number(),next_before_id:z.string().nullable()})}),
  profileSave:view,photoSave:view,photoRemove:view,staffPhotoRemove:view,
  staffPhotoGet:z.object({user_id:uuid,image:z.string().describe('Base64 JPEG'),sha256:z.string(),width:z.number().int(),height:z.number().int(),updated_at:z.string()}),
};
