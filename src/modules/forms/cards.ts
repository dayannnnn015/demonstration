// The SF9 and SF10 from what was recorded. Grades are the ones entered from
// the ECR and are carried as entered; the only counting here is attendance
// days, by the school's recorded rule, through the same two functions as the
// SF2. Nothing missing is filled in: an unknown month stays empty.
import {dayKind,dayValue,type DayRule,type Session} from './attendance.js';

type Name = {first_name:string;middle_name:string|null;last_name:string;name_extension:string|null};
type Learner = Name&{id:string;sex:'male'|'female';lrn:string|null;birth_date:string|null};
type Period = {id:string;ordinal:number;name:string;starts_on?:string;ends_on?:string};
type Offering = {id:string;display_order:number;code:string;name:string};
type Grade = {offering_id:string;reporting_period_id:string|null;grade:number|null;remark:'passed'|'failed'|null};
type Summary = {general_average:number|null;remark:'passed'|'failed'|null}|null;

export type Sf9Source = {
  school:Record<string,string|null>;today:string;learner:Learner;
  // `section_id` and `section_name` are null for a learner enrolled at a grade
  // but not yet in a class, which 0048 made possible and which every promoted
  // learner is between the approval and their new adviser’s pull (0069). The
  // SF10’s own source has said so since 0051; the SF9’s claimed a string and got
  // a null, so the card printed an empty section box rather than saying why.
  enrollment:{id:string;grade_level:number;status:string;section_id:string|null;section_name:string|null;adviser_name:string|null};
  school_year:{id:string;start_year:number;starts_on:string;ends_on:string;status:string};
  periods:(Period&{starts_on:string;ends_on:string})[];offerings:Offering[];grades:Grade[];summary:Summary;
  /** The approved end-of-year outcome, since 0033. */
  promotion?:{action:'promoted'|'conditionally_promoted'|'retained'|'remedial'}|null;
  values:{reporting_period_id:string;ratings:Record<string,string>}[];notes:{kind:string;reporting_period_id:string;body:string}[];
  days:{day_on:string;am:string|null;pm:string|null;configured:boolean;mark_am:Session;mark_pm:Session}[];
};

/** Whole years and months from a birth date to a date, as the Grade 1 card writes an age. */
export function ageOn(birth:string|null,on:string){
  if(!birth)return null;
  let years=Number(on.slice(0,4))-Number(birth.slice(0,4)),months=Number(on.slice(5,7))-Number(birth.slice(5,7));
  if(Number(on.slice(8,10))<Number(birth.slice(8,10)))months-=1;
  if(months<0){years-=1;months+=12;}
  return years<0?null:{years,months};
}

const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];

/** "5, 12 and 19 October": the dates of one month, as many of them as are worth reading. */
function datesIn(dates:string[]){
  const most=dates.slice(0,6),more=dates.length-most.length,nums=most.map(d=>String(Number(d.slice(8,10))));
  const listed=more?`${nums.join(', ')} and ${more} more`:nums.length>1?`${nums.slice(0,-1).join(', ')} and ${nums[nums.length-1]}`:nums[0]!;
  return `${listed} ${monthNames[Number(dates[0]!.slice(5,7))-1]}`;
}
const monthsBetween=(from:string,to:string)=>{
  const out:{key:string;label:string;from:string;to:string}[]=[];
  for(let y=Number(from.slice(0,4)),m=Number(from.slice(5,7));`${y}-${String(m).padStart(2,'0')}`<=to.slice(0,7);m===12?(y++,m=1):m++){
    const start=`${y}-${String(m).padStart(2,'0')}-01`,last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
    out.push({key:start.slice(0,7),label:monthNames[m-1]!,from:start<from?from:start,to:last>to?to:last});
  }
  return out;
};

export type AttendanceRow={label:string;term:string|null;from:string;to:string;class_days:number|null;present:number|null;absent:number|null;tardy:number|null;known:boolean;to_date?:string;
  /** The dates of this month holding a classroom session nobody marked, which is what leaves it empty. */
  unmarked:string[];
  /** The dates the calendar has not set, or that hold an alternative-delivery session: the school's rule decides neither. */
  unset:string[]};
type Counted=Omit<AttendanceRow,'label'|'term'|'from'|'to'>&{started:boolean};

/**
 * Days of classes, days present, days absent and times tardy for one stretch
 * of dates, counting only the dates the learner belonged to a section. The
 * day counts need a rule; present, absent and tardy also need every passed
 * day marked. A day still to come counts for nothing yet, and neither does
 * today until it has a mark, exactly as on the SF2. A month under way whose
 * days so far are all marked is counted to date: its days of classes are the
 * days held, and `to_date` is the last of them, so the card can say so. A
 * month wholly to come shows its days of classes from the calendar and nothing
 * else. `started` is for the year's total only and is not part of the form.
 */
export function attendanceFor(days:Sf9Source['days'],rule:DayRule|null,from:string,to:string,today:string):Counted{
  const inRange=days.filter(d=>d.day_on>=from&&d.day_on<=to);
  // The two reasons a month that has run is left empty, kept as dates rather than as a fact.
  // On the card an empty month looks the same whatever emptied it, and nobody can act on that.
  const unset=inRange.filter(d=>!d.configured||d.am==='alternative_delivery'||d.pm==='alternative_delivery').map(d=>d.day_on);
  if(!rule||unset.length)return {class_days:null,present:null,absent:null,tardy:null,known:false,started:from<=today,unmarked:[],unset};
  let classDays=0,held=0,present=0,absent=0,tardy=0,pending=false,last='';const unmarked:string[]=[];
  for(const d of inRange){
    if(dayKind(d,rule)!=='class')continue;
    classDays+=1;
    if(d.day_on>=today&&d.mark_am===null&&d.mark_pm===null){pending=true;continue;}
    const v=dayValue(d,d.mark_am,d.mark_pm,rule);
    if(v.mark==='unmarked'){unmarked.push(d.day_on);continue;}
    held+=1;last=d.day_on;present+=v.present;absent+=v.absent;tardy+=v.tardy;
  }
  if(unmarked.length)return {class_days:classDays,present:null,absent:null,tardy:null,known:false,started:true,unmarked,unset};
  if(!pending)return {class_days:classDays,present,absent,tardy,known:true,started:true,unmarked,unset};
  if(held>0)return {class_days:held,present,absent,tardy,known:true,to_date:last,started:true,unmarked,unset};
  return {class_days:classDays,present:null,absent:null,tardy:null,known:false,started:false,unmarked,unset};
}

/**
 * The year's totals over the months begun so far. Every one of them must be
 * known, or the total stays empty; while days of the year are still to come it
 * is a total to date and carries the date, as a month under way does.
 */
export function attendanceTotal(rows:(AttendanceRow&{started:boolean})[]){
  const begun=rows.filter(r=>r.started);
  const sum=(key:'class_days'|'present'|'absent'|'tardy')=>begun.length&&begun.every(r=>r.known&&r[key]!==null)?begun.reduce((t,r)=>t+r[key]!,0):null;
  const total={class_days:sum('class_days'),present:sum('present'),absent:sum('absent'),tardy:sum('tardy')};
  const ongoing=begun.length<rows.length||begun.some(r=>r.to_date);
  const asOf=begun.length?(begun[begun.length-1]!.to_date??begun[begun.length-1]!.to):null;
  return ongoing&&total.present!==null&&asOf?{...total,to_date:asOf}:total;
}

/**
 * The grade an approved outcome makes a learner eligible for: the next on
 * promotion or conditional promotion (DepEd Order No. 15, s. 2026, which moves
 * the learner up with back subjects), the same when retained, none yet while
 * the learner is in remedial classes.
 */
export const eligibleFor=(grade:number,promotion:{action:string}|null|undefined)=>
  promotion?.action==='promoted'||promotion?.action==='conditionally_promoted'?grade+1:promotion?.action==='retained'?grade:null;

const gradeTable=(periods:Period[],offerings:Offering[],grades:Grade[])=>offerings.map(o=>({
  offering_id:o.id,code:o.code,name:o.name,
  terms:Object.fromEntries(periods.map(p=>[p.id,grades.find(g=>g.offering_id===o.id&&g.reporting_period_id===p.id)?.grade??null])),
  final:grades.find(g=>g.offering_id===o.id&&g.reporting_period_id===null)?.grade??null,
  remark:grades.find(g=>g.offering_id===o.id&&g.reporting_period_id===null)?.remark??null,
}));

export type Sf9=ReturnType<typeof computeSf9>;

export function computeSf9(source:Sf9Source,rule:DayRule|null){
  const grade=source.enrollment.grade_level;
  const layout=grade===1?'grade1' as const:grade<=3?'grades2_3' as const:'grades4_6' as const;
  const y=source.school_year;
  // The Grade 1 card lists each term's months, a month split between two terms twice; the others list months once.
  const counted=layout==='grade1'
    ?source.periods.flatMap(p=>monthsBetween(p.starts_on,p.ends_on).map(m=>({label:m.label,term:p.name,from:m.from,to:m.to,...attendanceFor(source.days,rule,m.from,m.to,source.today)})))
    :monthsBetween(y.starts_on,y.ends_on).map(m=>({label:m.label,term:null,from:m.from,to:m.to,...attendanceFor(source.days,rule,m.from,m.to,source.today)}));
  const total=attendanceTotal(counted);
  const rows:AttendanceRow[]=counted.map(({started:_,...row})=>row);
  const subjects=gradeTable(source.periods,source.offerings,source.grades);
  const ended=source.periods.filter(p=>p.ends_on<source.today);
  // The Grade 1 card prints narratives, not grades, so a grade it has no box for is not missing.
  const missing=layout==='grade1'?0:subjects.reduce((n,s)=>n+ended.filter(p=>s.terms[p.id]===null).length,0);
  // A month left empty says which dates emptied it, so the gap can be closed on the
  // register instead of hunted for. A month wholly to come is not a gap and says nothing.
  const blanked=rule?counted.filter(r=>!r.known&&r.started&&(r.unmarked.length||r.unset.length)):[];
  const warnings=[
    !rule&&'The school’s attendance rule is not recorded, so no attendance figure is filled in.',
    missing&&`${missing} grade${missing===1?' is':'s are'} not recorded for terms that have ended.`,
    !source.enrollment.section_name&&'This learner is enrolled at this grade but is not in a class yet, so the section and adviser are blank.',
    ...blanked.map(r=>r.unset.length
      ?`${r.label} is empty because ${r.unset.length===1?'one date is':`${r.unset.length} dates are`} not set on the calendar or hold an alternative-delivery session (${datesIn(r.unset)}), which the school’s rule does not decide.`
      :`${r.label} is empty because ${r.unmarked.length===1?'one day has':`${r.unmarked.length} days have`} a session nobody marked (${datesIn(r.unmarked)}). A missing mark is never counted as present, so mark it on the register and this month fills in.`),
  ].filter((w):w is string=>!!w);
  return {
    form:'sf9' as const,layout,school:source.school,
    school_year:{id:y.id,start_year:y.start_year,starts_on:y.starts_on,ends_on:y.ends_on},
    learner:{...source.learner,age_at_start:ageOn(source.learner.birth_date,y.starts_on),age_at_end:ageOn(source.learner.birth_date,y.ends_on)},
    enrollment:{id:source.enrollment.id,grade_level:grade,section_name:source.enrollment.section_name,adviser_name:source.enrollment.adviser_name},
    periods:source.periods.map(p=>({id:p.id,ordinal:p.ordinal,name:p.name})),
    rule:rule?{mixed_day:rule.mixed_day,single_session_day:rule.single_session_day,version:rule.version}:null,
    attendance:{rows,total},
    subjects,general_average:{value:source.summary?.general_average??null,remark:source.summary?.remark??null},
    outcome:{action:source.promotion?.action??null,eligible_grade:eligibleFor(grade,source.promotion)},
    values:Object.fromEntries(source.values.map(v=>[v.reporting_period_id,v.ratings])),
    notes:Object.fromEntries(source.periods.map(p=>[p.id,{
      can_do:source.notes.find(n=>n.kind==='can_do'&&n.reporting_period_id===p.id)?.body??null,
      to_improve:source.notes.find(n=>n.kind==='to_improve'&&n.reporting_period_id===p.id)?.body??null,
      comment:source.notes.find(n=>n.kind==='comment'&&n.reporting_period_id===p.id)?.body??null,
    }])),
    warnings,
  };
}

export type Eligibility = {
  credential:'kinder_progress_report'|'eccd_checklist'|'kindergarten_certificate'|'pept'|'others';
  credential_other:string|null;school_name:string|null;school_code:string|null;school_address:string|null;
  pept_rating:string|null;examined_on:string|null;testing_center:string|null;remark:string|null;
};
/** One transcribed school year, as `learner_prior_years` holds it. Four quarters, because that is what the SF10-ES rules. */
export type PriorYear = {
  id:string;start_year:number;grade_level:number;school_name:string;school_code:string|null;school_address:string|null;
  section_name:string|null;adviser_name:string|null;general_average:number|null;remark:'passed'|'failed'|null;
  subjects:{subject_id:string|null;code:string|null;name:string;display_order:number;
    q1:number|null;q2:number|null;q3:number|null;q4:number|null;final:number|null;remark:'passed'|'failed'|null}[];
};
export type Sf10Source = {
  school:Record<string,string|null>;learner:Learner;
  // `section_name` is null for a learner enrolled at a grade but not yet placed
  // in a class, which 0048 made possible and 0051's outward join finally lets
  // onto their own permanent record.
  enrollments:{id:string;grade_level:number;status:string;section_name:string|null;adviser_name:string|null;
    school_year:{id:string;start_year:number;starts_on:string;ends_on:string};periods:Period[];offerings:Offering[];grades:Grade[];summary:Summary;
    promotion?:{action:'promoted'|'conditionally_promoted'|'retained'|'remedial'}|null}[];
  /** Since 0051: the credential presented for Grade 1, which is where a Kindergarten record lives. */
  eligibility?:Eligibility|null;
  /** Since 0051: the years transcribed from the school's own documents. */
  prior_years?:PriorYear[];
};
export type Sf10=ReturnType<typeof computeSf10>;
export type Sf10Block=Sf10['blocks'][number];

/** The quarters a transcribed year is read in. The SF10-ES rules four columns, so four it is, numbered as the form numbers them. */
const priorPeriods=[1,2,3,4].map(n=>({id:String(n),ordinal:n,name:String(n)}));

/**
 * The permanent record: one scholastic block per school year, in year order,
 * whichever of the two places it came from.
 *
 * A block is either a year EDUNEXUS recorded itself, from an enrollment and the
 * grades entered from the ECR, or a year transcribed from the school's own
 * documents when it started using EDUNEXUS (0051). They print identically and
 * sort together, because the SF10 is one continuous record and a learner's
 * Grade 2 does not become a different kind of fact for having been typed from a
 * spreadsheet. `origin` exists so a screen can say which is which, and so that
 * nothing derived from a transcription is mistaken for a decision EDUNEXUS
 * made: the certification below reads only the recorded years.
 *
 * Kindergarten is never a block. The SF10-ES has no scholastic block for it: it
 * is the credential that makes a learner eligible for Grade 1, and that is what
 * `eligibility` carries. A Kinder enrollment EDUNEXUS holds is reported as
 * `kindergarten_here`, and no grade is read from it.
 */
export function computeSf10(source:Sf10Source){
  const school=source.school;
  // A transcribed year names its own school, because a transferee's earlier year
  // was taught elsewhere and the form's block heading has those fields for it.
  // District, division and region are filled only when the code says this is
  // this school; for another school EDUNEXUS does not know them, and the form is
  // left blank rather than filled in with Balili's.
  const headingFor=(y:PriorYear)=>{
    const here=y.school_code!==null&&y.school_code===school.school_code;
    return {name:y.school_name,school_code:y.school_code,address:y.school_address,
      region:here?school.region??null:null,division:here?school.division??null:null,district:here?school.district??null:null};
  };
  const recorded=source.enrollments.filter(e=>e.grade_level>0).map(e=>({
    key:`e:${e.id}`,origin:'register' as const,enrollment_id:e.id as string|null,prior_year_id:null as string|null,
    grade_level:e.grade_level,section_name:e.section_name,adviser_name:e.adviser_name,
    school:{name:school.name??'',school_code:school.school_code??null,address:school.address??null,
      region:school.region??null,division:school.division??null,district:school.district??null},
    school_year:{id:e.school_year.id as string|null,start_year:e.school_year.start_year},
    periods:e.periods.map(p=>({id:p.id,ordinal:p.ordinal,name:p.name})),
    subjects:gradeTable(e.periods,e.offerings,e.grades).map(s=>({
      key:`o:${s.offering_id}`,offering_id:s.offering_id as string|null,code:s.code as string|null,name:s.name,
      terms:s.terms,final:s.final,remark:s.remark,
    })),
    general_average:{value:e.summary?.general_average??null,remark:e.summary?.remark??null},
    outcome:{action:e.promotion?.action??null,eligible_grade:eligibleFor(e.grade_level,e.promotion)},
  }));
  const encoded=(source.prior_years??[]).map(y=>({
    key:`p:${y.id}`,origin:'encoded' as const,enrollment_id:null as string|null,prior_year_id:y.id as string|null,
    grade_level:y.grade_level,section_name:y.section_name,adviser_name:y.adviser_name,
    school:headingFor(y),school_year:{id:null as string|null,start_year:y.start_year},periods:priorPeriods,
    subjects:[...y.subjects].sort((a,b)=>a.display_order-b.display_order).map(s=>({
      key:`p:${y.id}:${s.display_order}`,offering_id:null as string|null,code:s.code,name:s.name,
      terms:{'1':s.q1,'2':s.q2,'3':s.q3,'4':s.q4} as Record<string,number|null>,final:s.final,remark:s.remark,
    })),
    general_average:{value:y.general_average,remark:y.remark},
    // A transcription carries no promotion decision: EDUNEXUS approved none, and
    // the document's own remark already sits on the General Average line.
    outcome:{action:null,eligible_grade:null},
  }));
  const blocks=[...encoded,...recorded].sort((a,b)=>a.school_year.start_year-b.school_year.start_year||a.grade_level-b.grade_level);
  // The certification names the grade an approved outcome makes the learner
  // eligible for. Only a year EDUNEXUS recorded carries one, so a transcription
  // can never manufacture a promotion that nobody approved.
  const last=[...source.enrollments].sort((a,b)=>b.school_year.start_year-a.school_year.start_year)[0];
  const latest=blocks[blocks.length-1];
  return {
    form:'sf10' as const,school:source.school,learner:source.learner,blocks,
    eligibility:source.eligibility??null,
    last_school_year:latest?latest.school_year.start_year:null,
    eligible_grade:last?eligibleFor(last.grade_level,last.promotion):null,
    kindergarten_here:source.enrollments.some(e=>e.grade_level===0),
  };
}
