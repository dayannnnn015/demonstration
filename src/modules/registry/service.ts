import type { z } from 'zod';
import type { Row } from '../../core/db.js';
import type { Context } from '../foundation/service.js';
import { AppError } from '../../core/errors.js';
import { learnerRegister, registrySchemas as s, type RegistryOperationId } from './contracts.js';

function found(rows: Row[], update = false) {
  if (!rows[0]) throw new AppError(update ? 409 : 404, update ? 'VERSION_CONFLICT' : 'NOT_FOUND', update ? 'The record changed or is unavailable. Refresh before saving.' : 'The record was not found.');
  return rows[0];
}
/** The words of a search as the query folds a name: lower case, accents dropped, punctuation read as a space. */
export function searchWords(search: string) {
  const words = search.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  return words.length ? words : [search.toLowerCase()];
}
function page(rows: Row[], limit: number, offset: number) { return { items: rows.slice(0, limit), pagination: { limit, offset, has_more: rows.length > limit } }; }
export async function executeRegistry(id: RegistryOperationId, ctx: Context, input: { body: unknown; query: unknown; id?: string }) {
  const { tx } = ctx;
  const enrollmentSelect = 'select e.*,e.learner_id as recorded_learner_id,edunexus.visible_learner_identity(e.learner_id) as learner_id from edunexus.enrollments e';
  const enrollmentRow = async (id: unknown) => found(await tx.query(`${enrollmentSelect} where e.id=$1`, [id]));
  // An access row holds at most 100 identifiers, so a longer disclosure is written as several rows.
  async function record(ids: unknown[]) {
    if (!ids.length) { await tx.query('select edunexus.record_access($1,$2::uuid[])', [id, []]); return; }
    for (let n = 0; n < ids.length; n += 100) await tx.query('select edunexus.record_access($1,$2::uuid[])', [id, ids.slice(n, n + 100)]);
  }
  switch (id) {
    case 'learnerCreate': {
      const { distinct_reason: distinct, ...profile } = input.body as z.infer<typeof learnerRegister>;
      // Through `register_learner` since 0062, for the duplicate guard an
      // adviser has had since 0054. A direct insert left the unique LRN as the
      // only check, so a second record for one child with a different LRN went
      // in — and the workspace's warning was a warning, not a control.
      return found(await tx.query('select * from edunexus.register_learner($1::jsonb,$2)', [JSON.stringify(profile), distinct]));
    }
    case 'learnerUpdate': {
      const b = input.body as z.infer<typeof s.learnerUpdate>;
      return found(await tx.query('update edunexus.learners set first_name=$1,middle_name=$2,last_name=$3,name_extension=$4,birth_date=$5,sex=$6,address=$7,guardian_name=$8,guardian_contact=$9 where id=$10 and version=$11 returning *', [b.first_name, b.middle_name, b.last_name, b.name_extension, b.birth_date, b.sex, b.address, b.guardian_name, b.guardian_contact, input.id, b.version]), true);
    }
    case 'learnerLrn': {
      const b = input.body as z.infer<typeof s.learnerLrn>;
      return found(await tx.query('update edunexus.learners set lrn=$1 where id=$2 and version=$3 and lrn is null returning *', [b.lrn, input.id, b.version]), true);
    }
    case 'learnerGet': {
      const row = found(await tx.query('select * from edunexus.learners where id=$1', [input.id]));
      await record([row.id]); return row;
    }
    case 'learnerList': {
      const q = input.query as z.infer<typeof s.learnerQuery>;
      // A registrar types "Juan Dela Cruz", "dela cruz, juan" or "Pena" for Peña,
      // and a search that finds nobody ends in the child being registered twice.
      // So each word must appear somewhere in the name, in any order, with case,
      // accents and punctuation set aside on both sides; an LRN may carry spaces.
      const words = q.search === undefined ? null : searchWords(q.search);
      const lrnSearch = q.search === undefined ? null : q.search.replace(/[\s-]/g, '');
      // The grade and section each row shows come from the learner's enrolment
      // in the active school year — there is at most one, by a unique index on
      // academic_years(status) where status='active'. Row security filters the
      // lateral join on its own, so a teacher reads a placement only for the
      // sections they advise and everyone else's comes back null.
      const rows = await tx.query(`select learners.*,p.placement from edunexus.learners
        left join lateral (
          select jsonb_build_object('enrollment_id',e.id,'academic_year_id',e.academic_year_id,'grade_level',e.grade_level,
            'section_id',s.id,'section_name',s.name,'status',e.status) as placement
          from edunexus.enrollments e left join edunexus.sections s on s.id=e.section_id
          where e.learner_id=learners.id and e.record_state='valid'
            and e.academic_year_id=(select id from edunexus.academic_years where status='active')
          limit 1
        ) p on true
        where
        ($1::text[] is null or not exists (select 1 from unnest($1::text[]) w where position(w in regexp_replace(translate(lower(concat_ws(' ',last_name,first_name,middle_name,name_extension)),'ñáàâäãéèêëíìîïóòôöõúùûüç','naaaaaeeeeiiiiooooouuuuc'),'[^a-z0-9]+',' ','g'))=0) or lrn=$8)
        and ($2::date is null or birth_date=$2) and ($3::text is null or lrn=$3) and ($6::boolean or merged_into is null) and ($7::text is null or sex=$7)
        -- Scoped to the active year, the same year the Grade column above reads.
        -- Without that predicate it matched a learner who was *ever* at the
        -- grade, so a promoted learner answered to their old grade while their
        -- row showed the new one: the filter and the column contradicted each
        -- other on screen. With no active year nothing matches, which is what
        -- the column says too -- it reads "Not enrolled this year" for everyone.
        and ($9::int is null or exists (select 1 from edunexus.enrollments e where e.learner_id=learners.id and e.grade_level=$9 and e.record_state='valid'
          and e.academic_year_id=(select id from edunexus.academic_years where status='active')))
        -- One class, in the active year, for an adviser who holds two (the UI notes of 8 November, note 10). The
        -- enrolment is read under row security like the placement above, so naming a colleague's section finds nobody.
        and ($10::uuid is null or exists (select 1 from edunexus.enrollments e where e.learner_id=learners.id and e.section_id=$10 and e.record_state='valid'
          and e.academic_year_id=(select id from edunexus.academic_years where status='active')))
        order by lower(last_name),lower(first_name),id limit $4 offset $5`, [words, q.birth_date ?? null, q.lrn ?? null, q.limit + 1, q.offset,q.include_linked==='true',q.sex ?? null, lrnSearch, q.grade_level ?? null, q.section_id ?? null]);
      const result = page(rows, q.limit, q.offset);
      // The placement names an enrolment, so the access row names it too. One
      // read of the registry stays one audit row either way; leaving the
      // enrolments out would under-record what was actually disclosed.
      const placed = result.items.flatMap(row => { const p = row.placement as { enrollment_id?: string } | null; return p?.enrollment_id ? [p.enrollment_id] : []; });
      await record([...result.items.map(row => row.id), ...placed]);
      return result;
    }
    case 'enrollmentCreate': {
      const b = input.body as z.infer<typeof s.enrollmentCreate>;
      // With a section the older writer still derives the year and grade from
      // it, so nothing that already worked changes. Without one the year and
      // grade are what make the enrolment, and the section stays empty until an
      // authorised workflow assigns it.
      const row = found(b.section_id !== null
        ? await tx.query('select * from edunexus.enroll_learner($1,$2,$3,$4)', [b.learner_id, b.section_id, b.enrolled_on, b.entry_kind])
        : await tx.query('select * from edunexus.place_enrollment($1,$2,$3::smallint,null,$4,$5)', [b.learner_id, b.academic_year_id, b.grade_level, b.enrolled_on, b.entry_kind]));
      return enrollmentRow(row.id);
    }
    case 'enrollmentRelease': {
      const b = input.body as z.infer<typeof s.release>;
      // Answered from the writer's own row, never re-read. Releasing is the one
      // write that ends the caller's right to read what they just wrote: an
      // adviser sees the enrolments in the classes they advise, and this one no
      // longer has a class, so a follow-up select returns nothing and would
      // turn a success into a 404 that rolls the whole thing back.
      //
      // No access row either: `record_access_events.resource` admits only the
      // five read operations, and a write is accounted for by its journal
      // entry — the same reason `enrollmentMove` writes none.
      return found(await tx.query(`select r.*,r.learner_id as recorded_learner_id,edunexus.visible_learner_identity(r.learner_id) as learner_id
        from edunexus.release_learner_from_section($1,$2,$3,$4) r`, [input.id, b.version, b.effective_on, b.reason]));
    }
    case 'enrollmentMove': {
      const b = input.body as z.infer<typeof s.movement>;
      const row=found(await tx.query('select * from edunexus.move_enrollment($1,$2,$3,$4,$5,$6)', [input.id, b.version, b.action, b.effective_on, b.section_id, b.exit_reason])); return enrollmentRow(row.id);
    }
    case 'enrollmentGet': {
      const row = await enrollmentRow(input.id); await record([row.id]); return row;
    }
    case 'enrollmentCounts': {
      // A number names nobody, so this read writes no access record: that is
      // the whole reason it exists beside the paged list. The row policy still
      // applies, so a teacher counts only the learners they may already read.
      const q = input.query as z.infer<typeof s.countQuery>;
      const grades = await tx.query<{ grade_level: number; enrolled: number; withdrawn: number }>(`select grade_level,count(*) filter(where status='enrolled')::int enrolled,
        count(*) filter(where status='withdrawn')::int withdrawn from edunexus.enrollments where academic_year_id=$1 and record_state='valid' group by grade_level order by grade_level`, [q.academic_year_id]);
      const sum = (key: 'enrolled' | 'withdrawn') => grades.reduce((total, row) => total + row[key], 0);
      return { academic_year_id: q.academic_year_id, scope: ctx.staff.role === 'teacher' ? 'current_access' : 'school', record_state: 'valid', enrolled: sum('enrolled'), withdrawn: sum('withdrawn'), grades };
    }
    case 'enrollmentList': {
      const q = input.query as z.infer<typeof s.enrollmentQuery>;
      // The learner's name and LRN come with each row, so a class list is one
      // read and one access row naming both the enrollments and the learners,
      // instead of a follow-up read per learner. Row security still applies:
      // a learner the caller may not read joins as null.
      const rows = await tx.query(`select e.*,e.learner_id as recorded_learner_id,edunexus.visible_learner_identity(e.learner_id) as learner_id,
        case when l.id is null then null else jsonb_build_object('id',l.id,'last_name',l.last_name,'first_name',l.first_name,'middle_name',l.middle_name,'name_extension',l.name_extension,'lrn',l.lrn) end as learner
        from edunexus.enrollments e left join edunexus.learners l on l.id=edunexus.visible_learner_identity(e.learner_id)
        where ($1::uuid is null or e.academic_year_id=$1)
        and ($2::uuid is null or e.section_id=$2) and ($3::uuid is null or e.learner_id=$3 or edunexus.visible_learner_identity(e.learner_id)=$3) and ($4::text is null or e.status=$4)
        and ($7::text='all' or e.record_state=$7) order by lower(l.last_name),lower(l.first_name),e.id limit $5 offset $6`, [q.academic_year_id ?? null, q.section_id ?? null, q.learner_id ?? null, q.status ?? null, q.limit + 1, q.offset, q.record_state]);
      const result = page(rows, q.limit, q.offset);
      await record([...result.items.map(row => row.id), ...new Set(result.items.map(row => (row.learner as { id?: string } | null)?.id).filter(Boolean))]); return result;
    }
    case 'enrollmentHistory': {
      const state = found(await tx.query('select edunexus.get_enrollment_timeline($1) as timeline', [input.id])).timeline as { version: number; latest_correction_id: string | null; record_state: string; usable_for_reporting: boolean; grade_level: number; academic_year_id: string };
      const q = input.query as z.infer<typeof s.historyQuery>;
      const result = page(await tx.query('select * from edunexus.enrollment_events where enrollment_id=$1 order by enrollment_version limit $2 offset $3', [input.id, q.limit + 1, q.offset]), q.limit, q.offset);
      await record([input.id]); return { ...result, interpretation: 'original_movements', timeline_version: state.version, has_corrections: state.latest_correction_id !== null, record_state: state.record_state, usable_for_reporting: state.usable_for_reporting, current_grade_level: state.grade_level, academic_year_id: state.academic_year_id };
    }
    case 'recordAccessList': {
      const q = input.query as z.infer<typeof s.accessQuery>;
      // Reads are logged under the IDs they returned, so a form, a register or a
      // score sheet names a learner only by enrollment. Narrowed to a learner,
      // the log therefore also matches that learner's enrollments, including any
      // recorded under a duplicate identity merged into them.
      const rows = await tx.query('select id::text,occurred_at,actor_user_id,request_id,resource,record_ids from edunexus.record_access_events where ($1::bigint is null or id<$1) and ($3::uuid is null or actor_user_id=$3) and ($4::uuid is null or record_ids && (array[$4::uuid] || array(select e.id from edunexus.enrollments e join edunexus.learners l on l.id=e.learner_id where l.id=$4 or l.merged_into=$4))) order by edunexus.record_access_events.id desc limit $2', [q.before_id ?? null, q.limit + 1, q.actor_user_id ?? null, q.record_id ?? null]);
      return { items: rows.slice(0, q.limit), pagination: { limit: q.limit, next_before_id: rows.length > q.limit ? rows[q.limit - 1]!.id : null } };
    }
  }
}
