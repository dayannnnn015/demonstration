import {createHash} from 'node:crypto';
import type {z} from 'zod';
import type {Query} from '../../core/db.js';
import {AppError} from '../../core/errors.js';
import type {Context} from '../foundation/service.js';
import {computeSf2,computeSf4,type DayRule,type Sf2Source,type Sf4Source} from './attendance.js';
import {computeSf10,computeSf9,type Sf10Source,type Sf9Source} from './cards.js';
import {formSchemas as s,type FormOperationId} from './contracts.js';

async function readRule(tx:Query){
  const [row]=await tx.query<{r:{rule:DayRule|null;history:unknown[]}}>('select edunexus.read_attendance_day_rule() r');
  return row!.r;
}
/** A fingerprint of exactly what the form says, so a reissue with different content is visibly a correction. */
const fingerprint=(form:unknown)=>createHash('sha256').update(JSON.stringify(form)).digest('hex');
async function lastIssuance(tx:Query,form:string,scope:{year?:string|null;section?:string|null;month?:string|null;enrollment?:string|null;learner?:string|null}){
  const [row]=await tx.query(`select * from edunexus.form_issuances where form=$1 and academic_year_id is not distinct from $2 and section_id is not distinct from $3
    and month_on is not distinct from $4 and enrollment_id is not distinct from $5 and learner_id is not distinct from $6 order by serial desc limit 1`,
    [form,scope.year??null,scope.section??null,scope.month??null,scope.enrollment??null,scope.learner??null]);
  return row??null;
}
async function sf9(tx:Query,enrollment:string){
  const rule=(await readRule(tx)).rule;
  const [row]=await tx.query<{r:Sf9Source}>('select edunexus.read_sf9_source($1) r',[enrollment]);
  // No Kindergarten card has been supplied, so there is nothing to lay out.
  if(row!.r.enrollment.grade_level===0)throw new AppError(409,'NO_KINDERGARTEN_CARD','There is no Kindergarten card yet: the school has not supplied its Kindergarten progress report.');
  return computeSf9(row!.r,rule);
}
async function sf10(tx:Query,learner:string){
  const [row]=await tx.query<{r:Sf10Source}>('select edunexus.read_sf10_source($1) r',[learner]);
  const form=computeSf10(row!.r);
  /*
   * The SF10-ES begins when a learner enters Grade 1.
   *
   * The form has no scholastic block for Kindergarten: Kinder is the credential
   * that admits a learner to Grade 1, which is what its eligibility block
   * carries. So a learner with no Grade 1-to-6 year at all -- none recorded and
   * none transcribed -- has no permanent academic record yet, and a Kindergarten
   * learner is not supposed to have one.
   *
   * This used to answer 200 with a blank form. Issuing was already refused, but
   * reading it printed an empty SF10-ES for a Kinder learner, which is the one
   * thing their records must not be replaced by: theirs are the SF5-K and the
   * ECCD checklist, which EDUNEXUS does not hold and does not supersede.
   */
  if(!form.blocks.length)throw new AppError(409,'SF10_NOT_YET',form.kindergarten_here
    ?'The SF10 begins when a learner enters Grade 1, so this Kindergarten learner does not have one yet. Their Kindergarten records are the SF5-K and the ECCD checklist, which EDUNEXUS does not hold. The credential they present for Grade 1 is recorded on Academic history, once they are enrolled in it.'
    :'This learner has no Grade 1 to Grade 6 school year on record, so there is no permanent academic record to lay out yet. Enrol them, or encode the previous years the school still holds a document for on Academic history.');
  return form;
}
async function issue(tx:Query,form:'sf2'|'sf4',scope:{year:string;section:string|null;month:string},model:unknown,ruleVersion:number|null,reason:string|undefined){
  const [row]=await tx.query<{r:Record<string,unknown>}>('select edunexus.record_form_issuance($1,$2,$3,null,null,$4,$5,$6,$7) r',
    [form,scope.year,scope.section,scope.month,fingerprint(model),ruleVersion,reason??null]);
  return row!.r;
}
const missing=(c:{rule_recorded:boolean;unmarked_sessions?:number;pending_days?:number;unconfigured_days?:number;alternative_delivery_days?:number})=>[
  c.pending_days&&`the month is not over: ${c.pending_days} day${c.pending_days===1?' of classes is':'s of classes are'} still to come`,
  !c.rule_recorded&&'the principal has not recorded the school\'s attendance rule',
  c.unmarked_sessions&&`${c.unmarked_sessions} session${c.unmarked_sessions===1?' is':'s are'} not marked`,
  c.unconfigured_days&&`${c.unconfigured_days} date${c.unconfigured_days===1?' is':'s are'} not set on the calendar`,
  c.alternative_delivery_days&&`${c.alternative_delivery_days} date${c.alternative_delivery_days===1?' has':'s have'} an alternative-delivery session, which the rule does not cover`,
].filter(Boolean).join('; ');

async function sf2(tx:Query,section:string,month:string){
  const rule=(await readRule(tx)).rule;
  const [row]=await tx.query<{r:Sf2Source}>('select edunexus.read_sf2_source($1,$2) r',[section,month]);
  return computeSf2(row!.r,rule);
}
async function sf4(tx:Query,year:string,month:string){
  const rule=(await readRule(tx)).rule;
  const [row]=await tx.query<{r:Sf4Source}>('select edunexus.read_sf4_source($1,$2) r',[year,month]);
  return computeSf4(row!.r,rule);
}
// The SF2 names every learner on it, so its reads are logged like the register's.
async function logged(tx:Query,resource:string,ids:string[]){if(ids.length)await tx.query('select edunexus.record_access($1,$2::uuid[])',[resource,ids]);}
/**
 * What an SF10 read returned, for the privacy log: the learner, and every
 * enrollment whose grades are on it. A block transcribed from the school's own
 * documents (0051) has no enrollment, so the learner is named too -- the form
 * carries their name, LRN and birth date whether or not a block came from an
 * enrollment, and an audit that named nothing for an all-transcribed record
 * would be the one gap in it.
 */
const sf10Records=(form:{learner:{id:string};blocks:{enrollment_id:string|null}[]})=>
  [...new Set([form.learner.id,...form.blocks.map(b=>b.enrollment_id).filter((id):id is string=>id!==null)])];

export async function executeForm(id:FormOperationId,ctx:Context,input:{body:unknown;query:unknown;id?:string}){
  const {tx}=ctx;
  switch(id){
    case 'attendanceDayRuleGet':return readRule(tx);
    case 'attendanceDayRuleRecord':{
      const b=input.body as z.infer<typeof s.ruleRecord>;
      await tx.query('select id from edunexus.record_attendance_day_rule($1,$2,$3,$4)',[b.version,b.mixed_day,b.single_session_day,b.reason]);
      return readRule(tx);
    }
    case 'sf2Get':{
      const q=input.query as z.infer<typeof s.month>;
      const form=await sf2(tx,input.id!,q.month_on);
      await logged(tx,'sf2Get',form.learners.map(l=>l.enrollment_id));
      return {...form,last_issuance:await lastIssuance(tx,'sf2',{year:form.school_year.id,section:form.section.id,month:form.month_on})};
    }
    case 'sf2Issue':{
      const b=input.body as z.infer<typeof s.issue>;
      const form=await sf2(tx,input.id!,b.month_on);
      if(!form.completeness.complete)throw new AppError(409,'FORM_INCOMPLETE',`This SF2 cannot be issued yet: ${missing(form.completeness)}.`);
      const issuance=await issue(tx,'sf2',{year:form.school_year.id,section:form.section.id,month:form.month_on},form,form.rule?.version??null,b.reason);
      await logged(tx,'sf2Issue',form.learners.map(l=>l.enrollment_id));
      return {form,issuance};
    }
    case 'sf4Get':{
      const q=input.query as z.infer<typeof s.month>;
      const form=await sf4(tx,input.id!,q.month_on);
      return {...form,last_issuance:await lastIssuance(tx,'sf4',{year:form.school_year.id,month:form.month_on})};
    }
    case 'sf4Issue':{
      const b=input.body as z.infer<typeof s.issue>;
      const form=await sf4(tx,input.id!,b.month_on);
      // Before the submission gate, because it is the earlier step in the work:
      // every figure on the SF4 is grouped by section, so a registered learner
      // with no class is on no row and in no total, and issuing would report the
      // school short by exactly that many with nothing on the form saying so.
      // Putting them in a class changes that section's register for the month,
      // which a submitted month would then have to be returned and re-submitted
      // for -- so it is worth saying first rather than after.
      if(form.completeness.unplaced_learners)throw new AppError(409,'FORM_UNPLACED_LEARNERS',
        `${form.completeness.unplaced_learners} registered learner${form.completeness.unplaced_learners===1?' is':'s are'} not in a class at the end of this month`
        +` (${form.unplaced.map(u=>`${u.total} at ${u.grade_level===0?'Kinder':`Grade ${u.grade_level}`}`).join(', ')}).`
        +' The SF4 counts every figure by section, so they would be left off the form and out of its totals. Put them in a class, then issue it.');
      // The SF4 is compiled from submitted SF2s, so every section's month must have been submitted first.
      if(form.completeness.not_submitted)throw new AppError(409,'FORM_NOT_SUBMITTED',`${form.completeness.not_submitted} section${form.completeness.not_submitted===1?' has':'s have'} not submitted this month. Submit every section's month on Monthly consolidation first.`);
      if(!form.completeness.complete)throw new AppError(409,'FORM_INCOMPLETE',form.completeness.rule_recorded
        ?`${form.completeness.incomplete_sections} section${form.completeness.incomplete_sections===1?' has':'s have'} unmarked sessions, unset dates or days still to come this month.`
        :'This SF4 cannot be issued yet: the principal has not recorded the school\'s attendance rule.');
      return {form,issuance:await issue(tx,'sf4',{year:form.school_year.id,section:null,month:form.month_on},form,form.rule?.version??null,b.reason)};
    }
    case 'sf9Get':{
      const form=await sf9(tx,input.id!);
      await logged(tx,'sf9Get',[form.enrollment.id]);
      return {...form,last_issuance:await lastIssuance(tx,'sf9',{year:form.school_year.id,enrollment:form.enrollment.id})};
    }
    case 'sf9Issue':{
      const b=input.body as z.infer<typeof s.reissue>;
      const form=await sf9(tx,input.id!);
      const [row]=await tx.query<{r:Record<string,unknown>}>('select edunexus.record_form_issuance($1,$2,null,$3,null,null,$4,$5,$6) r',
        ['sf9',form.school_year.id,form.enrollment.id,fingerprint(form),form.rule?.version??null,b.reason??null]);
      await logged(tx,'sf9Issue',[form.enrollment.id]);
      return {form,issuance:row!.r};
    }
    case 'sf10Get':{
      const form=await sf10(tx,input.id!);
      await logged(tx,'sf10Get',sf10Records(form));
      return {...form,last_issuance:await lastIssuance(tx,'sf10',{learner:form.learner.id})};
    }
    case 'sf10Issue':{
      const b=input.body as z.infer<typeof s.reissue>;
      // No empty-record check here: sf10() refuses a learner who has no Grade 1
      // to 6 year before it gets this far, with the reason.
      const form=await sf10(tx,input.id!);
      const [row]=await tx.query<{r:Record<string,unknown>}>('select edunexus.record_form_issuance($1,null,null,null,$2,null,$3,null,$4) r',
        ['sf10',form.learner.id,fingerprint(form),b.reason??null]);
      await logged(tx,'sf10Issue',sf10Records(form));
      return {form,issuance:row!.r};
    }
    case 'sf9History':{
      const [row]=await tx.query<{r:{learner:{id:string};items:{enrollment_id:string}[]}}>('select edunexus.read_sf9_history($1) r',[input.id]);
      await logged(tx,'sf9History',[...new Set([row!.r.learner.id,...row!.r.items.map(i=>i.enrollment_id)])]);
      return row!.r;
    }
    case 'formIssuanceList':{
      const q=input.query as z.infer<typeof s.issuanceQuery>;
      return {items:await tx.query(`select * from edunexus.form_issuances where ($1::text is null or form=$1) and ($2::uuid is null or academic_year_id=$2)
        and ($3::uuid is null or section_id=$3) and ($4::uuid is null or enrollment_id=$4) and ($5::uuid is null or learner_id=$5) and ($6::date is null or month_on=$6)
        order by serial desc limit $7`,[q.form??null,q.academic_year_id??null,q.section_id??null,q.enrollment_id??null,q.learner_id??null,q.month_on??null,q.limit])};
    }
  }
}
