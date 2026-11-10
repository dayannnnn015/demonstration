import type {z} from 'zod';
import type {Context} from '../foundation/service.js';
import {AppError} from '../../core/errors.js';
import {scoreSchemas as s,type ScoreOperationId} from './contracts.js';
const columns='id,offering_id,binding_id,reporting_period_id,section_id,academic_year_id,component_code,sequence,title,max_score,status,version,created_at,updated_at';
export async function executeScore(id:ScoreOperationId,ctx:Context,input:{id?:string;body:unknown;query:unknown}) {
  const {tx}=ctx;
  // A score sheet names learners and their marks, so reading one is a
  // disclosure and belongs in the privacy audit beside every other learner read.
  const record=async(ids:unknown[])=>{
    const unique=[...new Set(ids)];
    if(!unique.length)await tx.query('select edunexus.record_access($1,$2::uuid[])',[id,[]]);
    for(let n=0;n<unique.length;n+=100)await tx.query('select edunexus.record_access($1,$2::uuid[])',[id,unique.slice(n,n+100)]);
  };
  const task=async()=>{
    const [row]=await tx.query(`select ${columns} from edunexus.assessment_tasks where id=$1`,[input.id]);
    if(!row)throw new AppError(404,'NOT_FOUND','The assessment task was not found.');
    return row;
  };
  // Codes and names only, for choosing a component; it names no learner, so it writes no access row.
  if(id==='componentList'){const [row]=await tx.query('select edunexus.read_assessment_components($1) as components',[input.id]);return row!.components;}
  if(id==='taskList'){
    const q=input.query as z.infer<typeof s.taskList>;
    const rows=await tx.query(`select ${columns} from edunexus.assessment_tasks where offering_id=$1 and ($2='all' or status=$2)
      and ($3::uuid is null or reporting_period_id=$3) and ($4::text is null or component_code=upper($4)) and ($5::uuid is null or id>$5) order by id limit $6`,
      [input.id,q.status,q.reporting_period_id??null,q.component_code??null,q.after_id??null,q.limit+1]);
    if(!rows.length){
      const [offering]=await tx.query('select id from edunexus.section_subjects where id=$1',[input.id]);
      if(!offering)throw new AppError(404,'NOT_FOUND','The subject offering was not found.');
    }
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_after_id:rows.length>q.limit?rows[q.limit-1]!.id:null}};
  }
  if(id==='taskGet')return task();
  if(id==='taskCreate'){
    const b=input.body as z.infer<typeof s.taskCreate>;
    const [row]=await tx.query(`select ${columns} from edunexus.create_assessment_task($1,$2,$3,$4,$5,$6::numeric,$7)`,
      [input.id,b.reporting_period_id,b.component_code,b.sequence,b.title,b.max_score,b.reason]);
    return row;
  }
  if(id==='taskUpdate'){
    const b=input.body as z.infer<typeof s.taskUpdate>;
    const [row]=await tx.query(`select ${columns} from edunexus.update_assessment_task($1,$2,$3,$4::numeric,$5,$6)`,
      [input.id,b.version,b.title,b.max_score,b.status,b.reason]);
    return row;
  }
  if(id==='scoreSheet'){
    const q=input.query as z.infer<typeof s.sheet>;
    const current=await task();
    // The dated roster of the task's own section. Scores join in where recorded;
    // an unrecorded learner stays null rather than being treated as a zero.
    const rows=await tx.query(`select e.id as enrollment_id,edunexus.visible_learner_identity(e.learner_id) as learner_id,
        l.last_name,l.first_name,l.middle_name,l.name_extension,s.raw_score,coalesce(s.version,0) as version
      from edunexus.enrollments e
      join edunexus.learners l on l.id=edunexus.visible_learner_identity(e.learner_id)
      left join edunexus.assessment_scores s on s.task_id=$1 and s.enrollment_id=e.id
      where e.section_id=$2 and e.record_state='valid' and ($3::uuid is null or e.id>$3)
      order by e.id limit $4`,[current.id,current.section_id,q.after_id??null,q.limit+1]);
    const items=rows.slice(0,q.limit);
    await record(items.map(v=>v.enrollment_id));
    return {task:current,recorded_scores_only:true as const,items,
      pagination:{limit:q.limit,next_after_id:rows.length>q.limit?rows[q.limit-1]!.enrollment_id:null}};
  }
  if(id==='scoreRecord'){
    const b=input.body as z.infer<typeof s.record>;
    const [row]=await tx.query('select edunexus.record_assessment_scores($1,$2::jsonb,$3) as result',[input.id,JSON.stringify(b.entries),b.reason]);
    const result=row!.result as {entries:{enrollment_id:string}[]};
    await record(result.entries.map(v=>v.enrollment_id));
    return result;
  }
  if(id==='taskHistory'){
    await task();
    const q=input.query as z.infer<typeof s.history>;
    const rows=await tx.query(`select id,task_id,task_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id,recorded_at
      from edunexus.assessment_task_events where task_id=$1 and ($2::integer is null or task_version<$2) order by task_version desc limit $3`,
      [input.id,q.before_version??null,q.limit+1]);
    return {items:rows.slice(0,q.limit),pagination:{limit:q.limit,next_before_version:rows.length>q.limit?rows[q.limit-1]!.task_version:null}};
  }
  await task();
  const q=input.query as z.infer<typeof s.scoreHistory>;
  const rows=await tx.query(`select id::text,task_id,entries,reason,actor_user_id,request_id,recorded_at from edunexus.assessment_score_events
    where task_id=$1 and ($2::bigint is null or id<$2) order by edunexus.assessment_score_events.id desc limit $3`,[input.id,q.before_id??null,q.limit+1]);
  const items=rows.slice(0,q.limit);
  await record(items.flatMap(v=>(v.entries as {enrollment_id:string}[]).map(e=>e.enrollment_id)));
  return {items,pagination:{limit:q.limit,next_before_id:rows.length>q.limit?rows[q.limit-1]!.id:null}};
}
