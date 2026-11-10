import type {Context} from '../foundation/service.js';
import type {LearnerRecordOperationId} from './contracts.js';
export async function executeLearnerRecord(id:LearnerRecordOperationId,ctx:Context,input:{id?:string}) {
  const {tx}=ctx;
  const fn=id==='enrollmentAttendance'?'read_enrollment_attendance':'read_enrollment_scores';
  const [row]=await tx.query<{record:Record<string,unknown>}>(`select edunexus.${fn}($1) as record`,[input.id]);
  // The read names one enrollment, and the audit says exactly that.
  await tx.query('select edunexus.record_access($1,$2::uuid[])',[id,[input.id]]);
  return row!.record;
}
