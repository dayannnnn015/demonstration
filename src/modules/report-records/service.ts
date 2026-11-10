import type {z} from 'zod';
import type {Query} from '../../core/db.js';
import {AppError} from '../../core/errors.js';
import type {Context} from '../foundation/service.js';
import {reportSchemas as s,type ReportOperationId} from './contracts.js';

// Every write names the learners it touched, and every read names the learners it returned.
async function logged(tx:Query,resource:string,ids:string[]){if(ids.length)await tx.query('select edunexus.record_access($1,$2::uuid[])',[resource,[...new Set(ids)]]);}
async function written(tx:Query,sql:string,params:unknown[]){
  const [row]=await tx.query<{r:{changed:number;entries:{enrollment_id:string}[]}}>(sql,params);
  await logged(tx,'reportRecordsWrite',row!.r.entries.map(e=>e.enrollment_id));
  return row!.r;
}

export async function executeReport(id:ReportOperationId,ctx:Context,input:{body:unknown;query:unknown;id?:string}){
  const {tx}=ctx;
  switch(id){
    case 'reportRecordsGet':{
      const [row]=await tx.query<{r:{learners:{enrollment_id:string}[]}}>('select edunexus.read_report_records($1) r',[input.id]);
      await logged(tx,'reportRecordsGet',row!.r.learners.map(l=>l.enrollment_id));
      return row!.r;
    }
    case 'reportCardGet':{
      // The section's own read, so every row check applies as it does there; only this learner is returned, and only it is logged.
      const [e]=await tx.query<{section_id:string}>("select section_id from edunexus.enrollments where id=$1 and record_state='valid'",[input.id]);
      if(!e)throw new AppError(404,'NOT_FOUND','The record was not found.');
      const [row]=await tx.query<{r:{learners:{enrollment_id:string}[]}&Record<string,unknown>}>('select edunexus.read_report_records($1) r',[e.section_id]);
      const {learners,...section}=row!.r;
      const learner=learners.find(l=>l.enrollment_id===input.id);
      if(!learner)throw new AppError(404,'NOT_FOUND','The record was not found.');
      await logged(tx,'reportRecordsGet',[learner.enrollment_id]);
      return {...section,learner};
    }
    case 'reportGradesRecord':{
      if(ctx.staff.role!=='teacher') throw new AppError(403,'FORBIDDEN','Only the class adviser can enter grades.');
      const b=input.body as z.infer<typeof s.grades>;
      return written(tx,'select edunexus.record_report_grades($1,$2,$3::jsonb,$4) r',[input.id,b.reporting_period_id,JSON.stringify(b.entries),b.reason]);
    }
    case 'reportSummariesRecord':{
      if(ctx.staff.role!=='teacher') throw new AppError(403,'FORBIDDEN','Only the class adviser can enter general averages.');
      const b=input.body as z.infer<typeof s.summaries>;
      return written(tx,'select edunexus.record_report_summaries($1,$2::jsonb,$3) r',[input.id,JSON.stringify(b.entries),b.reason]);
    }
    case 'reportValuesRecord':{
      if(ctx.staff.role!=='teacher') throw new AppError(403,'FORBIDDEN','Only the class adviser can enter observed values.');
      const b=input.body as z.infer<typeof s.values>;
      return written(tx,'select edunexus.record_report_values($1,$2,$3::jsonb,$4) r',[input.id,b.reporting_period_id,JSON.stringify(b.entries),b.reason]);
    }
    case 'reportNotesRecord':{
      if(ctx.staff.role!=='teacher') throw new AppError(403,'FORBIDDEN','Only the class adviser can enter report-card narratives and comments.');
      const b=input.body as z.infer<typeof s.notes>;
      return written(tx,'select edunexus.record_report_notes($1,$2,$3,$4,$5::jsonb,$6) r',[input.id,b.kind,b.reporting_period_id,b.month_on,JSON.stringify(b.entries),b.reason]);
    }
    case 'reportCardRecord':{
      const b=input.body as z.infer<typeof s.card>;
      const {reason,...card}=b;
      return written(tx,'select edunexus.record_report_card($1,$2::jsonb,$3) r',[input.id,JSON.stringify(card),reason]);
    }
    case 'promotionsGet':{
      const q=input.query as z.infer<typeof s.promotions>;
      const [row]=await tx.query<{r:{items:{enrollment_id:string}[]}}>('select edunexus.read_promotions($1,$2) r',[input.id,q.section_id??null]);
      await logged(tx,'promotionsGet',row!.r.items.map(i=>i.enrollment_id));
      return row!.r;
    }
    case 'promotionReadiness':{
      // Counts only: no learner is named, so no access row is written.
      const [row]=await tx.query<{r:unknown}>('select edunexus.read_promotion_readiness($1) r',[input.id]);
      return row!.r;
    }
    case 'promotionsRecommend':{
      if(ctx.staff.role!=='teacher') throw new AppError(403,'FORBIDDEN','Only the class adviser can endorse a promotion outcome.');
      const b=input.body as z.infer<typeof s.recommend>;
      const [row]=await tx.query<{r:{changed:number;entries:{enrollment_id:string}[]}}>('select edunexus.record_promotion_recommendations($1,$2::jsonb,$3) r',[input.id,JSON.stringify(b.entries),b.reason]);
      await logged(tx,'promotionsWrite',row!.r.entries.map(e=>e.enrollment_id));
      return row!.r;
    }
    case 'promotionsDecide':{
      const b=input.body as z.infer<typeof s.decide>;
      type Decided={changed:number;advanced:number;entries:{enrollment_id:string;advance:{advanced:boolean;enrollment_id?:string}}[]};
      const [row]=await tx.query<{r:Decided}>('select edunexus.decide_promotions($1,$2::jsonb,$3) r',[input.id,JSON.stringify(b.entries),b.reason]);
      // An approval now creates next year's enrolment too, so both records are named.
      // A hundred at a time: `record_access_events` caps a row's ids at 100, and a
      // batch of 100 decisions names up to 200 (the cap is why nextYearCommit fails
      // above fifty learners, which is recorded in docs/status.md and not ours here).
      const named=[...new Set(row!.r.entries.flatMap(e=>[e.enrollment_id,...(e.advance.enrollment_id?[e.advance.enrollment_id]:[])]))];
      for(let i=0;i<named.length;i+=100)await logged(tx,'promotionsWrite',named.slice(i,i+100));
      return row!.r;
    }
    case 'gradeEntryGet':{
      // Counts only: no learner is named, so no access row is written.
      const [row]=await tx.query<{r:unknown}>('select edunexus.read_grade_entry($1) r',[input.id]);
      return row!.r;
    }
    case 'reportRecordHistory':{
      const q=input.query as z.infer<typeof s.history>;
      // Row policy limits the journal to managers and the section's current adviser.
      // Qualified, like the audit, access and score journals: `id::text` takes
      // the output name `id`, and a bare `id` in ORDER BY binds to that output
      // column, sorting the identity column as text. Row 9 then outranks row 10
      // and the newest entries fall off the first page. Found while building the
      // encoded-history journal, which had the same fault.
      const rows=await tx.query<{id:string}>(`select id::text,kind,scope,entries,reason,actor_user_id,recorded_at from edunexus.report_record_events
        where section_id=$1 and ($2::bigint is null or id<$2) order by edunexus.report_record_events.id desc limit $3`,[input.id,q.before_id??null,q.limit+1]);
      const items=rows.slice(0,q.limit);
      // The journal's entries carry each learner's grades, so reading it is a read
      // of their report-card records. A page can name more enrollments than one
      // access row holds, so they are logged a hundred at a time.
      const named=[...new Set(items.flatMap(v=>((v as {entries?:{enrollment_id?:string}[]}).entries??[]).map(e=>e.enrollment_id).filter((e):e is string=>!!e)))];
      for(let i=0;i<named.length;i+=100)await logged(tx,'reportRecordsGet',named.slice(i,i+100));
      return {items,pagination:{limit:q.limit,next_before_id:rows.length>q.limit?rows[q.limit-1]!.id:null}};
    }
  }
}
