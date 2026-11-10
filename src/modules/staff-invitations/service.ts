import type {z} from 'zod';
import type {Context} from '../foundation/service.js';
import {AppError} from '../../core/errors.js';
import {invitationSchemas as s,type InvitationOperationId} from './contracts.js';
type InvitationRow={email:string;display_name:string;role:string;status:string;version:number};
const columns='id,email,display_name,role,status,linked_user_id,requested_by,version,created_at,updated_at';
export async function executeInvitation(id:InvitationOperationId,ctx:Context,input:{id?:string;body:unknown;query:unknown}) {
  const {tx}=ctx;
  if(id==='invitationList'){
    const q=input.query as z.infer<typeof s.list>;
    const rows=await tx.query(`select ${columns} from edunexus.staff_invitations where ($1='all' or status=$1)
      and ($2::text is null or role=$2::edunexus.staff_role) and ($3::uuid is null or id>$3) order by id limit $4`,
      [q.status,q.role??null,q.after_id??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_after_id:rows.length>q.limit?rows[q.limit-1]!.id:null}};
  }
  if(id==='invitationGet'||id==='invitationHistory'){
    const [row]=await tx.query(`select ${columns} from edunexus.staff_invitations where id=$1`,[input.id]);
    if(!row)throw new AppError(404,'NOT_FOUND','The staff invitation was not found.');
    if(id==='invitationGet')return row;
    const q=input.query as z.infer<typeof s.history>;
    const rows=await tx.query(`select id,invitation_id,invitation_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id,recorded_at
      from edunexus.staff_invitation_events where invitation_id=$1 and ($2::integer is null or invitation_version<$2) order by invitation_version desc limit $3`,
      [input.id,q.before_version??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_before_version:rows.length>q.limit?rows[q.limit-1]!.invitation_version:null}};
  }
  if(id==='invitationCreate'){
    const b=input.body as z.infer<typeof s.request>;
    const [row]=await tx.query(`select ${columns} from edunexus.request_staff_invitation($1,$2,$3::edunexus.staff_role,$4)`,[b.email,b.display_name,b.role,b.reason]);
    return row;
  }
  if(id==='invitationProvision'){
    const b=input.body as z.infer<typeof s.provision>;
    const [row]=await tx.query(`select ${columns} from edunexus.provision_staff_invitation($1,$2,$3,$4)`,[input.id,b.version,b.user_id,b.reason]);
    return row;
  }
  if(id==='invitationProvisionIdentity'){
    const b=input.body as z.infer<typeof s.provisionIdentity>;
    if(!ctx.identities)throw new AppError(501,'IDENTITY_SERVICE_DISABLED','This deployment does not create accounts. The operator provisions the identity, then it is linked here.');
    // The same lock write_staff_invitation takes. Held across the account call
    // so two managers cannot both pass the checks and create two identities.
    await tx.query('select pg_advisory_xact_lock(82412001)');
    const [row]=await tx.query<InvitationRow>(`select ${columns} from edunexus.staff_invitations where id=$1`,[input.id]);
    if(!row)throw new AppError(404,'NOT_FOUND','The staff invitation was not found.');
    if(row.status!=='requested')throw new AppError(409,'INVITATION_STATE','Only an outstanding request can be provisioned.');
    if(row.version!==b.version)throw new AppError(409,'VERSION_CONFLICT','The record changed. Refresh before saving.');
    // The database enforces this again inside provision_staff_invitation, but an
    // Auth identity cannot be rolled back with the transaction, so refuse before
    // the account exists rather than leaving an orphan behind.
    if(ctx.staff.role==='administrative_officer'&&row.role!=='teacher')throw new AppError(403,'FORBIDDEN','An administrative officer can only provision a teacher account.');
    const userId=await ctx.identities.create({email:row.email,displayName:row.display_name,role:row.role});
    const [provisioned]=await tx.query(`select ${columns} from edunexus.provision_staff_invitation($1,$2,$3,$4)`,[input.id,b.version,userId,b.reason]);
    return provisioned;
  }
  const b=input.body as z.infer<typeof s.cancel>;
  const [row]=await tx.query(`select ${columns} from edunexus.cancel_staff_invitation($1,$2,$3)`,[input.id,b.version,b.reason]);
  return row;
}
