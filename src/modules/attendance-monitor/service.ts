import type { z } from 'zod';
import type { Row } from '../../core/db.js';
import type { Context } from '../foundation/service.js';
import { monitorQuery, monitorDay, monitorDate, classification } from './contracts.js';
type Day=z.infer<typeof monitorDay>;
type DateRow=z.infer<typeof monitorDate>;
// Counts are observations within this requested window, never official credits.
export function summarizeAttendance(dates:DateRow[],days:Day[]) {
  const schedules=new Map(days.map(day=>[day.day_on,day]));
  const summary={eligible_dates:0,expected_sessions:0,present_sessions:0,absent_sessions:0,missing_sessions:0,unsupported_sessions:0,
    unconfigured_dates:0,absent_classroom_dates:0,longest_absent_date_run:0,trailing_absent_date_run:0,needs_completion:false};
  let run=0;
  const evidence=dates.map(row=>{
    const schedule=schedules.get(row.day_on);
    if(!schedule)throw new Error('Incomplete attendance monitor schedule');
    let state:z.infer<typeof classification>='not_eligible';
    if(row.eligible){
      summary.eligible_dates++;
      let expected=0,missing=0,absent=0,unsupported=0;
      for(const session of ['am','pm'] as const){
        if(schedule[session]==='classroom'){
          expected++;
          if(row[session]===null)missing++;
          else if(row[session]==='absent')absent++;
          else summary.present_sessions++;
        }else if(schedule[session]==='alternative_delivery')unsupported++;
      }
      summary.expected_sessions+=expected;summary.missing_sessions+=missing;summary.absent_sessions+=absent;summary.unsupported_sessions+=unsupported;
      if(!schedule.configured){summary.unconfigured_dates++;state='unconfigured';}
      else if(unsupported)state='unsupported_adm';
      else if(!expected)state='no_classroom';
      else if(missing)state='incomplete';
      else state=absent===expected?'absent':'attended';
    }
    if(state==='absent'){run++;summary.absent_classroom_dates++;summary.longest_absent_date_run=Math.max(summary.longest_absent_date_run,run);}
    else if(state!=='no_classroom')run=0;
    return {...row,classification:state};
  });
  summary.trailing_absent_date_run=run;
  summary.needs_completion=summary.missing_sessions+summary.unconfigured_dates+summary.unsupported_sessions>0;
  return {dates:evidence,summary};
}
export async function executeMonitor(ctx:Context,input:{query:unknown;id?:string}) {
  const q=input.query as z.infer<typeof monitorQuery>;
  const [row]=await ctx.tx.query('select edunexus.read_attendance_monitor($1,$2,$3,$4,$5,$6) result',[input.id,q.from,q.to,q.view,q.limit,q.after_id??null]);
  const result=row!.result as Row & {days:Day[];items:(Row & {dates:DateRow[]})[]};
  const items=result.items.map(item=>({...item,...summarizeAttendance(item.dates,result.days)}));
  await ctx.tx.query('select edunexus.record_access($1,$2::uuid[])',['attendanceMonitor',result.items.map(item=>item.enrollment_id)]);
  return {...result,items};
}
