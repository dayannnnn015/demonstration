import type {z} from 'zod';
import type {Query} from '../../core/db.js';
import {AppError} from '../../core/errors.js';
import type {Context} from '../foundation/service.js';
import {notificationSchemas as s,type NotificationOperationId} from './contracts.js';
/**
 * A personal inbox, thin over 0057.
 *
 * Two things this service deliberately does *not* do.
 *
 * It never resolves a learner's name. `learner_id` is returned so a screen can
 * link to the record, and the screen it links to is what writes the
 * `record_access_events` row for the disclosure. Naming learners here would put
 * an access row behind every poll of the bell and bury the privacy audit, which
 * is the same reason the Overview reads no learner and the command palette
 * searches no record.
 *
 * And it never widens its own read. There is no manager branch: the row policy
 * in 0057 answers only rows addressed to the caller, so a principal asking for
 * the list gets their own inbox, not the school's.
 *
 * `actor_name` came from a left join on `edunexus.staff`, whose `staff_read`
 * policy is own-row-or-manager, so an adviser read a null and was not told
 * which manager imported or declined their class list. The school asked to
 * see it (2026-11-07), and `0066` gives it the narrow way.
 *
 * **`staff_read` is untouched**, which was the thing worth protecting: a
 * teacher still cannot list staff, search them, or read any row but their
 * own. `notification_actor_name` is a security-definer function taking a
 * notification id and nothing else, and it answers only when that
 * notification is addressed to the caller -- so the one name it can disclose
 * is the one person who acted on your own inbox row, and the disclosure
 * cannot be aimed at anybody else.
 */
const columns=`n.id::text,n.kind,n.subject_table,n.subject_id,n.academic_year_id,n.section_id,n.learner_id,n.payload,n.actor_user_id,edunexus.notification_actor_name(n.id) actor_name,n.created_at,n.read_at`;
const from=`from edunexus.notifications n`;
export async function executeNotification(id:NotificationOperationId,ctx:Context,input:{body:unknown;query:unknown}){
  const {tx}=ctx;
  switch(id){
    case 'notificationCount':{
      const [row]=await tx.query<{unread:string}>('select count(*)::text unread from edunexus.notifications where read_at is null');
      return {unread:Number(row?.unread??0)};
    }
    case 'notificationList':{
      const q=input.query as z.infer<typeof s.list>;
      const rows=await tx.query(`select ${columns} ${from} where ($1='all' or n.read_at is null) and ($2::bigint is null or n.id<$2)
        order by n.id desc limit $3`,[q.status,q.before_id??null,q.limit+1]);
      const items=rows.slice(0,q.limit);
      // The cursor is the last id actually returned, so a caller never has to
      // guess whether a page was trimmed.
      return {items,pagination:{limit:q.limit,next_before_id:rows.length>q.limit?String(items[items.length-1]!.id):null}};
    }
    case 'notificationRead':{
      const b=input.body as z.infer<typeof s.read>;
      const [row]=await tx.query<{id:string}>('select id::text from edunexus.mark_notification_read($1)',[b.id]);
      return one(tx,row!.id);
    }
    case 'waitingCount':{
      const [row]=await tx.query<{w:{class_lists:number;outcomes:number;name_requests:number}}>('select edunexus.read_waiting_counts() w');
      const w=row!.w;
      return {class_lists:Number(w.class_lists),outcomes:Number(w.outcomes),name_requests:Number(w.name_requests)};
    }
    case 'notificationReadAll':{
      const [row]=await tx.query<{marked:number}>('select edunexus.mark_all_notifications_read() marked');
      return {marked:Number(row?.marked??0)};
    }
  }
}
async function one(tx:Query,id:unknown){
  const [row]=await tx.query(`select ${columns} ${from} where n.id=$1`,[id]);
  if(!row)throw new AppError(404,'NOT_FOUND','The record was not found.');
  return row;
}
