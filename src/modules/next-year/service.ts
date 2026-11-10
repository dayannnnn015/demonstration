import type {z} from 'zod';
import type {Query} from '../../core/db.js';
import {AppError} from '../../core/errors.js';
import type {Context} from '../foundation/service.js';
import {nextYearSchemas as s,type NextYearOperationId} from './contracts.js';
import {placeNextYear,type Source} from './placement.js';

async function source(tx:Query,year:string,target:string){
  const [row]=await tx.query<{r:Source}>('select edunexus.read_next_year_source($1,$2) r',[year,target]);
  return row!.r;
}

export async function executeNextYear(id:NextYearOperationId,ctx:Context,input:{body:unknown;query:unknown;id?:string}){
  const {tx}=ctx;
  if(id==='nextYearPreview'){
    const q=input.query as z.infer<typeof s.preview>;
    const preview=placeNextYear(await source(tx,input.id!,q.target_year_id),q.grade_level??null);
    const named=[...preview.placements,...preview.unplaced].map(l=>l.enrollment_id);
    if(named.length)await tx.query('select edunexus.record_access($1,$2::uuid[])',['nextYearPreview',named]);
    return preview;
  }
  const b=input.body as z.infer<typeof s.commit>;
  // Exclusive before the read takes it shared: a transaction never asks for a lock exclusively after holding it shared.
  await tx.query('select pg_advisory_xact_lock(82412001)');
  const preview=placeNextYear(await source(tx,input.id!,b.target_year_id),b.grade_level);
  if(preview.review_hash!==b.review_hash)throw new AppError(409,'PLACEMENT_CHANGED','Something changed since this preview was read. Read it again, check it, and enroll from the new one.');
  if(!preview.placements.length)throw new AppError(409,'PLACEMENT_EMPTY','No learner in this preview is waiting to be enrolled.');
  const [row]=await tx.query<{r:{placed:number;entries:{source_enrollment_id:string;enrollment_id:string}[]}}>(
    'select edunexus.commit_next_year_placement($1,$2,$3,$4,$5,$6::jsonb,$7) r',
    [input.id,b.target_year_id,b.grade_level,b.seed,b.review_hash,JSON.stringify(preview.placements.map(p=>({enrollment_id:p.enrollment_id}))),b.reason]);
  await tx.query('select edunexus.record_access($1,$2::uuid[])',['nextYearCommit',row!.r.entries.flatMap(e=>[e.source_enrollment_id,e.enrollment_id])]);
  return row!.r;
}
