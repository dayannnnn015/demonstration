// Who moves up to next year, and into which grade.
//
// This used to be a draw: every promoted learner was dealt into a section of
// their next grade, balanced by sex and size from a seed. Promotion does not
// choose a class — an adviser takes a learner into one afterwards, which is
// separate work — so the draw is gone and a carried-forward learner arrives at
// their grade with no section. What is left is the part that was always the
// school's decision: who has an approved outcome, and where it leads.
//
// Nothing here changes an outcome. It reads them, works out the grade each one
// leads to, and says plainly who is not coming and why.
import {createHash} from 'node:crypto';

type Sex='male'|'female';
export type Source={
  source_year:{id:string;start_year:number;status:string};
  target_year:{id:string;start_year:number;starts_on:string;status:string};
  // section_id and section_name are null for a learner who is enrolled this
  // year but not yet in a class. They still have an outcome to carry forward.
  learners:{enrollment_id:string;learner_id:string;first_name:string;middle_name:string|null;last_name:string;name_extension:string|null;sex:Sex;
    grade_level:number;section_id:string|null;section_name:string|null;status:'enrolled'|'withdrawn';action:'promoted'|'conditionally_promoted'|'retained'|'remedial'|null;
    outcome_status:'recommended'|'approved'|'returned'|null;already_enrolled:boolean}[];
  runs:unknown[];
};
/**
 * Why a learner is not carried forward. `no_section` is deliberately absent:
 * under the draw, a learner whose next grade had no section yet was left
 * behind, so the school had to build next year's classes before it could
 * promote anybody. A grade needs no sections now.
 */
export type Unplaced='left'|'no_outcome'|'not_approved'|'remedial'|'completer'|'already_enrolled';

const targetGrade=(l:Source['learners'][number])=>l.action==='promoted'||l.action==='conditionally_promoted'?l.grade_level+1:l.grade_level;
const why=(l:Source['learners'][number]):Unplaced|null=>
  l.status!=='enrolled'?'left':!l.action?'no_outcome':l.outcome_status!=='approved'?'not_approved':l.action==='remedial'?'remedial':
  targetGrade(l)>6?'completer':l.already_enrolled?'already_enrolled':null;

export function placeNextYear(source:Source,grade:number|null){
  const learner=(l:Source['learners'][number])=>({enrollment_id:l.enrollment_id,learner_id:l.learner_id,first_name:l.first_name,middle_name:l.middle_name,
    last_name:l.last_name,name_extension:l.name_extension,sex:l.sex,from_grade:l.grade_level,from_section:l.section_name,action:l.action,outcome_status:l.outcome_status});
  const placements:(ReturnType<typeof learner>&{to_grade:number})[]=[];
  const unplaced:(ReturnType<typeof learner>&{to_grade:number|null;reason:Unplaced})[]=[];
  for(const l of source.learners){
    const to=targetGrade(l);
    if(grade!==null&&to!==grade)continue;
    const reason=why(l);
    if(reason){unplaced.push({...learner(l),to_grade:reason==='completer'||reason==='left'||reason==='no_outcome'?null:to,reason});continue;}
    placements.push({...learner(l),to_grade:to});
  }
  const byName=(a:{last_name:string;first_name:string},b:{last_name:string;first_name:string})=>a.last_name.localeCompare(b.last_name)||a.first_name.localeCompare(b.first_name);
  placements.sort(byName);unplaced.sort(byName);
  // The fingerprint of what is about to be committed: who, and into which
  // grade. The commit recomputes it and refuses if anything moved underneath.
  const review_hash=createHash('sha256').update(JSON.stringify({source:source.source_year.id,target:source.target_year.id,grade,
    placements:placements.map(p=>[p.enrollment_id,p.to_grade]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))})).digest('hex');
  const tally=(list:{sex:Sex}[])=>({male:list.filter(p=>p.sex==='male').length,female:list.filter(p=>p.sex==='female').length});
  return {
    source_year:source.source_year,target_year:source.target_year,grade_level:grade,review_hash,
    // What each grade receives, which is what a principal checks before committing.
    grades:[...new Set(placements.map(p=>p.to_grade))].sort((a,b)=>a-b)
      .map(g=>({grade_level:g,carried:tally(placements.filter(p=>p.to_grade===g))})),
    placements,unplaced,runs:source.runs,
  };
}
