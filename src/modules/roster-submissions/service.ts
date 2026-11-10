import type {z} from 'zod';
import type {Query} from '../../core/db.js';
import {AppError} from '../../core/errors.js';
import type {Context} from '../foundation/service.js';
import {readCsv} from '../registry-review/service.js';
import {submissionSchemas as s,type SubmissionOperationId} from './contracts.js';
const columns=`r.id,r.section_id,r.academic_year_id,r.enrolled_on,r.entry_kind,r.row_count,r.status,r.submitted_by,r.decided_by,r.import_id,r.version,r.created_at,r.updated_at,
  coalesce(sec.grade_level,r.grade_level) grade_level,sec.name section_name,st.display_name submitted_by_name`;
// Left, since 0061: a list submitted at a grade has no section to join to, and
// an inner join here dropped it from every manager's list entirely.
const from=`from edunexus.roster_submissions r left join edunexus.sections sec on sec.id=r.section_id left join edunexus.staff st on st.user_id=r.submitted_by`;
async function one(tx:Query,id:unknown,withList=false){
  const [row]=await tx.query(`select ${columns}${withList?',r.csv':''} ${from} where r.id=$1`,[id]);
  if(!row)throw new AppError(404,'NOT_FOUND','The record was not found.');
  return row;
}
/** Format only. It never reads the registry, so a teacher learns nothing about learners outside their section. */
async function check(tx:Query,b:z.infer<typeof s.check>){
  // The target has to exist to be checked against, but which target it is does
  // not change a single row rule: this reads the format and nothing else.
  const [target]=b.section_id!==null
    ?await tx.query('select id from edunexus.sections where id=$1',[b.section_id])
    :await tx.query('select id from edunexus.academic_years where id=$1',[b.academic_year_id]);
  if(!target)throw new AppError(404,'NOT_FOUND','The record was not found.');
  const {profiles,grades,issues}=readCsv(b.csv);
  profiles.forEach((p,i)=>{if(p&&p.birth_date>=b.enrolled_on)issues.push({row:i+1,field:'birth_date',code:'INVALID_BIRTH_DATE',message:'Birth date must precede enrollment.'});});
  // A row that names no grade, on a list that chose none either, has nowhere
  // to go. Said on its own row, as the import says it, rather than refusing
  // the whole file for one line.
  if(b.section_id===null&&b.grade_level===undefined){
    profiles.forEach((p,i)=>{if(p&&grades[i]===null)issues.push({row:i+1,field:'grade_level',code:'GRADE_REQUIRED',
      message:'This row has no grade level, and none was chosen for the list. Fill the grade level column.'});});
  }
  // The grades carried beside the rows, so the caller can tell the writer
  // which ones this list actually holds.
  return {row_count:profiles.length,rows:profiles,grades,issues};
}
export async function executeSubmission(id:SubmissionOperationId,ctx:Context,input:{body:unknown;query:unknown;id?:string}){
  const {tx}=ctx;
  switch(id){
    case 'rosterSubmissionCheck':return check(tx,input.body as z.infer<typeof s.check>);
    case 'rosterSubmissionCreate':{
      const b=input.body as z.infer<typeof s.create>;
      const result=await check(tx,b);
      if(result.issues.length)throw new AppError(422,'ROSTER_ROWS',`${result.issues.length} problem${result.issues.length===1?'':'s'} in the class list. Check the file and fix every row first.`);
      // The grades the list actually holds: each row's own, or the one grade
      // chosen for the whole list. The writer checks every one of them against
      // the grades this person advises a class at, so a list spanning two
      // grades needs a class at both.
      const held=b.section_id!==null?null:[...new Set(result.rows.flatMap((r,i)=>{
        if(!r)return [];
        const chosen=result.grades[i]??b.grade_level;
        return chosen===undefined||chosen===null?[]:[chosen];
      }))].sort((x,y)=>x-y);
      const [row]=await tx.query<{id:string}>('select id from edunexus.submit_roster_grades($1,$2::smallint[],$3,$4,$5,$6,$7,$8)',
        [b.section_id,held,b.academic_year_id??null,b.enrolled_on,b.entry_kind,b.csv,result.row_count,b.reason]);
      return one(tx,row!.id);
    }
    case 'rosterSubmissionList':{
      const q=input.query as z.infer<typeof s.list>;
      const rows=await tx.query(`select ${columns} ${from} where ($1='all' or r.status=$1) order by r.created_at desc,r.id limit $2 offset $3`,[q.status,q.limit+1,q.offset]);
      return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,offset:q.offset,has_more:rows.length>q.limit}};
    }
    case 'rosterSubmissionGet':return one(tx,input.id,true);
    case 'rosterSubmissionWithdraw':{
      const b=input.body as z.infer<typeof s.withdraw>;
      await tx.query('select id from edunexus.withdraw_roster_submission($1,$2,$3)',[input.id,b.version,b.reason]);return one(tx,input.id);
    }
    case 'rosterSubmissionDecide':{
      const b=input.body as z.infer<typeof s.decide>;
      await tx.query('select id from edunexus.decide_roster_submission($1,$2,$3,$4,$5)',[input.id,b.version,b.decision,b.import_id,b.reason]);return one(tx,input.id);
    }
  }
}
