import type {z} from 'zod';
import type {Context} from '../foundation/service.js';
import {schoolReportSchemas as s,type SchoolReportOperationId} from './contracts.js';
export async function executeSchoolReport(id:SchoolReportOperationId,ctx:Context,input:{query:unknown;id?:string}) {
  const {tx}=ctx;
  // Section-level counts only: no learner or enrollment is named, so there is nothing for the access log to record.
  if(id==='attendanceDailySummary'){const q=input.query as z.infer<typeof s.daily>;const [row]=await tx.query<{r:unknown}>('select edunexus.read_daily_attendance_summary($1) r',[q.day_on]);return row!.r;}
  const q=input.query as z.infer<typeof s.sf4>;const [row]=await tx.query<{r:unknown}>('select edunexus.read_sf4_counts($1,$2) r',[input.id,q.month_on]);return row!.r;
}
