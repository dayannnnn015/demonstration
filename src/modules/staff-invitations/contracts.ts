import {z} from 'zod';
import {plainName,plainNameMessage} from '../../core/text.js';
import {uuid, staffRole} from '../foundation/contracts.js';
import {subjectReason} from '../subjects/contracts.js';
const version=z.number().int().min(1).max(2147483646);
// Deliberately permissive: Supabase, not EDUNEXUS, decides deliverability.
const email=z.string().trim().toLowerCase().min(5).max(254).regex(/^[^@\s\u0000-\u001f\u007f]+@[^@\s\u0000-\u001f\u007f]+\.[^@\s\u0000-\u001f\u007f]+$/,'Enter a single valid email address.');
export const invitationSchemas={
  request:z.strictObject({email,display_name:z.string().trim().min(1).max(150).regex(plainName,plainNameMessage),role:staffRole,reason:subjectReason}),
  provision:z.strictObject({version,user_id:uuid,reason:subjectReason}),
  provisionIdentity:z.strictObject({version,reason:subjectReason}),
  cancel:z.strictObject({version,reason:subjectReason}),
  list:z.strictObject({status:z.enum(['requested','provisioned','cancelled','all']).default('requested'),role:staffRole.optional(),
    limit:z.coerce.number().int().min(1).max(100).default(50),after_id:uuid.optional()}),
  history:z.strictObject({limit:z.coerce.number().int().min(1).max(10).default(5),before_version:z.coerce.number().int().min(1).max(2147483647).optional()})
};
export const invitationOperations=([
  {id:'invitationList',method:'get',path:'/api/v1/staff-invitations',summary:'List staff invitations awaiting or completed by the deployment operator',query:invitationSchemas.list},
  {id:'invitationGet',method:'get',path:'/api/v1/staff-invitations/:id',summary:'Read one staff invitation'},
  {id:'invitationCreate',method:'post',path:'/api/v1/staff-invitations',summary:'Request an invitation; the operator provisions the Supabase Auth identity separately',body:invitationSchemas.request},
  {id:'invitationProvision',method:'post',path:'/api/v1/staff-invitations/:id/provision',summary:'Link the provisioned Auth identity and authorize school access in one transaction',body:invitationSchemas.provision},
  {id:'invitationProvisionIdentity',method:'post',path:'/api/v1/staff-invitations/:id/identity',summary:'Create the Auth identity for this invitation through the isolated account service, then authorize school access',body:invitationSchemas.provisionIdentity},
  {id:'invitationCancel',method:'post',path:'/api/v1/staff-invitations/:id/cancellation',summary:'Cancel an outstanding invitation request',body:invitationSchemas.cancel},
  {id:'invitationHistory',method:'get',path:'/api/v1/staff-invitations/:id/events',summary:'Read protected invitation history',query:invitationSchemas.history}
] as const).map(op=>({...op,module:'staff-invitations' as const,manager:true as const}));
export type InvitationOperationId=typeof invitationOperations[number]['id'];
const time=z.iso.datetime({offset:true});
export const invitationRecord=z.object({id:uuid,email:z.string(),display_name:z.string(),role:staffRole,
  status:z.enum(['requested','provisioned','cancelled']),linked_user_id:uuid.nullable(),requested_by:uuid,
  version:z.number().int().positive(),created_at:time,updated_at:time});
export const invitationResponses:Record<string,z.ZodType>={invitationGet:invitationRecord,invitationCreate:invitationRecord,
  invitationProvision:invitationRecord,invitationProvisionIdentity:invitationRecord,invitationCancel:invitationRecord,
  invitationList:z.object({items:z.array(invitationRecord),pagination:z.object({limit:z.number().int(),next_after_id:uuid.nullable()})}),
  invitationHistory:z.object({items:z.array(z.object({id:uuid,invitation_id:uuid,invitation_version:z.number().int(),action:z.enum(['request','provision','cancel']),
    before_snapshot:invitationRecord.nullable(),after_snapshot:invitationRecord,reason:z.string(),actor_user_id:uuid,request_id:uuid,recorded_at:time})),
    pagination:z.object({limit:z.number().int(),next_before_version:z.number().int().nullable()})})
};
