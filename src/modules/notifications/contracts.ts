import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
const time=z.iso.datetime({offset:true});
// A bigint id travels as a string, exactly as `recordAccessList` already sends
// one: the inbox is paged newest-first off an identity column, and a uuid
// cursor is not chronological.
const notificationId=z.string().regex(/^[1-9][0-9]{0,17}$/);
export const notificationSchemas={
  list:z.strictObject({status:z.enum(['unread','all']).default('unread'),limit:z.coerce.number().int().min(1).max(100).default(50),before_id:notificationId.optional()}),
  read:z.strictObject({id:notificationId}),
  readAll:z.strictObject({}),
};
// An inbox is personal: there is no manager-scoped variant of any of these, and
// `manager:true` appears on none of them. A principal reads their own
// notifications and nobody else's, which the row policy enforces underneath.
export const notificationOperations=([
  {id:'notificationCount',method:'get',path:'/api/v1/notifications/count',summary:'How many of your notifications are unread. Names no record and writes no access row, so the bell may ask for it freely'},
  {id:'notificationList',method:'get',path:'/api/v1/notifications',summary:'Your own notifications, newest first; no learner is named in one',query:notificationSchemas.list},
  {id:'notificationRead',method:'post',path:'/api/v1/notifications/read',summary:'Mark one of your notifications as read',body:notificationSchemas.read},
  {id:'notificationReadAll',method:'post',path:'/api/v1/notifications/read-all',summary:'Mark every unread notification of yours as read; nothing unread is a zero, not a refusal',body:notificationSchemas.readAll},
  // Not an inbox: the work waiting on a manager, counted for the rail (the UI notes of 8 November, note 8). Numbers
  // only, so it names nobody and writes no access row; a teacher is answered zeros. Nothing about attendance.
  {id:'waitingCount',method:'get',path:'/api/v1/waiting/count',summary:'How many class lists, endorsed outcomes and staff name corrections wait on you; zeros for a teacher. Names no record and writes no access row'},
] as const).map(op=>({...op,module:'notifications' as const}));
export type NotificationOperationId=typeof notificationOperations[number]['id'];
// Every key the payload check constraint in 0057 admits, all optional. A
// learner's name is not among them and cannot be: the database refuses an
// unlisted key, so a future emitter cannot quietly put one here.
export const notificationPayload=z.object({section_name:z.string(),grade_level:z.number().int(),row_count:z.number().int(),
  count:z.number().int(),month:z.string(),year_label:z.string(),decision:z.string()}).partial();
export const notificationRecord=z.object({id:z.string(),kind:z.string(),subject_table:z.string(),subject_id:uuid,
  academic_year_id:uuid.nullable(),section_id:uuid.nullable(),learner_id:uuid.nullable(),payload:notificationPayload,
  actor_user_id:uuid.nullable(),actor_name:z.string().nullable(),created_at:time,read_at:time.nullable()});
export const notificationResponses:Record<string,z.ZodType>={
  notificationCount:z.object({unread:z.number().int()}),
  notificationList:z.object({items:z.array(notificationRecord),pagination:z.object({limit:z.number().int(),next_before_id:z.string().nullable()})}),
  notificationRead:notificationRecord,
  notificationReadAll:z.object({marked:z.number().int()}),
  waitingCount:z.object({class_lists:z.number().int(),outcomes:z.number().int(),name_requests:z.number().int()}),
};
