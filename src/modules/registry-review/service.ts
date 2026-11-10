import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type { z } from 'zod';
import type { Row, Query } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import type { Context } from '../foundation/service.js';
import { registrySchemas } from '../registry/contracts.js';
import { executeRegistry } from '../registry/service.js';
import { candidateSchema, reviewSchemas, type ImportInput, type ReviewOperationId, type issueSchema, type previewRowSchema, type receiptSchema } from './contracts.js';

/**
 * The template's columns. `address` is last and was added by 0053, which is why
 * it is read as optional below: a class list saved from the earlier template has
 * seven columns and still imports, with no address recorded for its learners.
 * Nothing else about a child or their family is here, because which further
 * fields the school may keep is behind the learner-fields gate.
 */
// The template's columns. `grade_level` was added last, on 2026-11-07, so one
// file can carry learners of several grades — which is what the office
// actually has when it registers the school. The two older shapes are still
// read: a file saved from either of them simply carries no grade, and the
// grade given on the screen stands for every row.
const columns = ['lrn', 'first_name', 'middle_name', 'last_name', 'name_extension', 'birth_date', 'sex', 'address', 'grade_level'];
const columnsV2 = columns.slice(0, 8);
/** The columns before 0053, still accepted so a file already filled in is not refused. */
const columnsV1 = columns.slice(0, 7);
const header = columns.join(',') + '\r\n';
type Profile = z.infer<typeof registrySchemas.learnerCreate>;

/**
 * A grade as a school writes one in a spreadsheet column: a bare number, or
 * the words around it. Kindergarten is 0, as it is everywhere else here.
 *
 * It reads what can be read without guessing and returns null for the rest —
 * "Grade 3-A" is a section and a grade run together, and which part is the
 * grade is not ours to decide.
 */
/** A grade in the words a refusal should use. Kindergarten is never "Grade 0". */
const gradeWord = (grade: number) => (grade === 0 ? 'Kindergarten' : `Grade ${grade}`);

export function readGrade(typed: string): number | null {
  const text = typed.trim().toLowerCase();
  if (/^(k|kinder|kindergarten|grade\s*k|gr\.?\s*k)$/.test(text)) return 0;
  const digits = /^(?:grade\s*|gr\.?\s*|g\s*)?([0-6])$/.exec(text);
  return digits ? Number(digits[1]) : null;
}
type Candidate = z.infer<typeof candidateSchema>;
type Issue = z.infer<typeof issueSchema>;
type PreviewRow = z.infer<typeof previewRowSchema>;
type Receipt = z.infer<typeof receiptSchema>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Everything that decides what the import does, including where it lands: a
// preview reviewed for one section, year or grade cannot be committed against
// another, and the refusal is PREVIEW_CHANGED rather than a surprise enrolment.
const inputDigest = (b: ImportInput) => digest({ format: 'edunexus-roster-v2', section_id: b.section_id, academic_year_id: b.academic_year_id ?? null, grade_level: b.grade_level ?? null, enrolled_on: b.enrolled_on, entry_kind: b.entry_kind, csv: b.csv, resolutions: [...b.resolutions].sort((a, c) => a.row - c.row) });
const missing = () => new AppError(404, 'NOT_FOUND', 'The record was not found.');
const conflict = () => new AppError(409, 'PREVIEW_CHANGED', 'The roster or school records changed. Create and review a new preview.');

async function record(tx: Query, resource: string, ids: string[]) {
  const unique = [...new Set(ids)];
  // A bounded preview can inspect up to six candidates per row; keep each log
  // entry within the existing database limit and record every disclosed ID.
  if (!unique.length) await tx.query('select edunexus.record_access($1,$2::uuid[])', [resource, []]);
  for (let i = 0; i < unique.length; i += 100) await tx.query('select edunexus.record_access($1,$2::uuid[])', [resource, unique.slice(i, i + 100)]);
}

/** Sex as a school's own list writes it: the LIS and the SF forms use M and F, a spreadsheet often Male or FEMALE. */
const sexes: Record<string, 'male' | 'female'> = { m: 'male', male: 'male', f: 'female', female: 'female' };

/**
 * A class list as schools actually keep it (testing finding F32). The header may come back from Excel in other
 * capitals, with spaces after the commas or a trailing comma; sex may be M or F; an LRN may have lost digits to
 * Excel's number format. What can be read without guessing is read; what cannot is said in words a registrar
 * can act on, for that row. A date is never reordered: 03/04/2017 could be either month.
 */
export function readCsv(csv: string): { profiles: (Profile | null)[]; grades: (number | null)[]; issues: Issue[] } {
  if (Buffer.byteLength(csv, 'utf8') > 24000) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'CSV content must be at most 24,000 UTF-8 bytes.');
  const firstLine = csv.replace(/^\ufeff/, '').split(/\r?\n/, 1)[0] ?? '';
  if (!firstLine.includes(',') && firstLine.split(';').length >= columns.length) {
    throw new AppError(422, 'INVALID_CSV_HEADER', 'This file uses semicolons between its columns, as Excel saves a CSV in some regional settings. Save it again as "CSV (Comma delimited)", or start from the template.');
  }
  let records: string[][];
  try { records = parse(csv, { bom: true, skip_empty_lines: true, max_record_size: 2048, cast: false, relax_column_count: true }) as string[][]; }
  catch { throw new AppError(422, 'INVALID_CSV', 'Use a comma-separated UTF-8 file with the template header and correctly quoted fields.'); }
  // Empty cells past the template's last column are a spreadsheet's trailing commas, not data.
  records = records.map(r => { let n = r.length; while (n > columns.length && !(r[n - 1] ?? '').trim()) n--; return r.slice(0, n); });
  // A row that stops short is a trailing cell left empty, which many editors
  // and Excel itself write as nothing at all rather than as a final comma. The
  // school's own file was refused for it with "this row has 7 columns; the
  // template has 8", which reads as a broken file and is not one. Short rows
  // are padded, and whether what is missing actually mattered is then decided
  // by the field rules below, which name the field instead of the row.
  const head = (records.shift() ?? []).map(c => c.trim().toLowerCase());
  // Any of the three templates: the current one, the one before
  // `grade_level` was added, and the one before `address` was.
  const shape = JSON.stringify(head) === JSON.stringify(columns) ? columns
    : JSON.stringify(head) === JSON.stringify(columnsV2) ? columnsV2
      : JSON.stringify(head) === JSON.stringify(columnsV1) ? columnsV1 : null;
  if (!shape) throw new AppError(422, 'INVALID_CSV_HEADER', `The first row must be the template's header, ${columns.join(',')}, in that order. A file from an earlier template, without the grade level or without the address, is read too.`);
  if (records.length < 1 || records.length > 50) throw new AppError(422, 'INVALID_ROW_COUNT', 'Each import must contain 1 to 50 learner rows.');
  const issues: Issue[] = [];
  // Kept beside the profiles rather than inside them: a learner record has no
  // grade, an enrolment does, and putting one on the profile sent it into
  // `register_learner`, which refuses a key it does not know.
  const grades: (number | null)[] = records.map(() => null);
  const profiles = records.map((short, index) => {
    const row = index + 1;
    // Padded, never truncated: too many cells still means a comma inside an
    // unquoted field, which would silently put a name in the wrong column.
    const values = short.length < shape.length ? [...short, ...Array(shape.length - short.length).fill('')] : short;
    if (values.length !== shape.length) {
      issues.push({ row, field: 'csv', code: 'INVALID_TEXT', message: `This row has ${values.length} columns; the template has ${shape.length}. A name holding a comma needs quotes around it.` }); return null;
    }
    if (values.some(value => /[\u0000-\u001f\u007f\ufffd]/u.test(value))) {
      issues.push({ row, field: 'csv', code: 'INVALID_TEXT', message: 'Fields must contain valid single-line text.' }); return null;
    }
    const fields: Record<string, string | null> = Object.fromEntries(shape.map((key, i) => [key, values[i]!.trim() || (['lrn', 'middle_name', 'name_extension', 'address', 'grade_level'].includes(key) ? null : '')]));
    // A file from an earlier template carries no address column at all, which
    // is unrecorded rather than empty.
    if (!('address' in fields)) fields.address = null;
    // The grade is read out of the row before the profile is parsed, because
    // it is not a field of the learner record: a learner has no grade, an
    // enrolment does. An unreadable one is said on its own row rather than
    // refusing the file, and a row that leaves it empty takes the grade the
    // screen gives.
    const typed = (fields.grade_level ?? '').trim();
    delete fields.grade_level;
    if (typed !== '') {
      const read = readGrade(typed);
      if (read === null) {
        issues.push({ row, field: 'grade_level', code: 'INVALID_FIELD',
          message: 'Write the grade as a number from 0 to 6, or as Kinder, Kindergarten or Grade 3.' });
        grades[index] = null; return null;
      }
      grades[index] = read;
    }
    fields.sex = sexes[(fields.sex ?? '').toLowerCase()] ?? fields.sex ?? '';
    const result = registrySchemas.learnerCreate.safeParse(fields);
    if (!result.success) {
      const said = new Set<string>();
      for (const issue of result.error.issues) {
        const field = issue.path.join('.');
        if (said.has(field)) continue;
        said.add(field);
        const lrn = String(fields.lrn ?? '');
        const message = field === 'lrn' && (/^\d{11}$/.test(lrn) || /e\+/i.test(lrn))
          ? 'Excel has turned this LRN into a number and lost digits. Format the LRN column as Text, then type all twelve digits.'
          : field === 'birth_date' ? 'Write the birth date as YYYY-MM-DD, for example 2017-03-14, a past date.'
          : field === 'sex' ? 'Write male or female; M and F are read too.'
          : issue.message;
        issues.push({ row, field, code: 'INVALID_FIELD', message });
      }
      return null;
    }
    return result.data;
  });
  return { profiles, grades, issues };
}

async function planImport(tx: Query, b: ImportInput) {
  const { profiles, grades, issues } = readCsv(b.csv);
  const issue = (row: number, field: string, code: string, message: string) => issues.push({ row, field, code, message });
  // The same lock is taken by all learner writes, enrollment commands, and
  // section/adviser changes. The year row lock additionally blocks year closure.
  await tx.query('select pg_advisory_xact_lock(82412001)');
  // A section says all three; a year and a grade without one enrol the learners
  // with no class yet. The year is read from whichever was given, and a caller
  // who gives both must not contradict itself: a class list landing at a grade
  // other than the one its section teaches is a mistake worth refusing, not
  // worth silently resolving one way or the other.
  const [section] = b.section_id === null ? [undefined] : await tx.query<{ id: string; name: string; grade_level: number; academic_year_id: string; version: number }>('select id,name,grade_level,academic_year_id,version from edunexus.sections where id=$1', [b.section_id]);
  if (b.section_id !== null && !section) throw missing();
  if (section && b.academic_year_id !== undefined && b.academic_year_id !== section.academic_year_id) {
    throw new AppError(422, 'SECTION_MISMATCH', 'This section belongs to another school year than the one given. Send the section alone, or the year and grade without it.');
  }
  if (section && b.grade_level !== undefined && b.grade_level !== section.grade_level) {
    throw new AppError(422, 'SECTION_MISMATCH', 'This section does not teach the grade given. Send the section alone, or the year and grade without it.');
  }
  // The grade the whole file lands at, when one was given. Since the template
  // carries a grade per row, a registry import may give none at all and let
  // every row say its own; a row that says nothing then has nowhere to go and
  // is refused on its own line rather than the file being refused.
  const fileGrade: number | null = section ? section.grade_level : (b.grade_level ?? null);
  const [year] = await tx.query<{ id: string; version: number; status: string; starts_on: string; ends_on: string }>('select id,version,status,starts_on,ends_on from edunexus.academic_years where id=$1 for update', [section ? section.academic_year_id : b.academic_year_id]);
  if (!year) throw missing();
  const where = section ? 'section_id' : 'academic_year_id';
  if (year.status === 'closed') issue(0, where, 'YEAR_CLOSED', 'Import requires an open school year.');
  if (b.enrolled_on < year.starts_on || b.enrolled_on > year.ends_on) issue(0, 'enrolled_on', 'INVALID_ENROLLMENT_DATE', 'Enrollment must fall within the selected school year.');
  const resolutions = new Map<number, ImportInput['resolutions'][number]>();
  for (const resolution of b.resolutions) {
    if (resolution.row > profiles.length || resolutions.has(resolution.row)) issue(resolution.row, 'resolutions', 'INVALID_RESOLUTION', 'Supply at most one resolution for each existing CSV row.');
    resolutions.set(resolution.row, resolution);
  }
  const incoming = profiles.flatMap((p, i) => {
    const r = resolutions.get(i + 1);
    return p ? [{ row: i + 1, ...p, use_id: r?.action === 'use_existing' ? r.learner_id : null }] : [];
  });
  const matches = await tx.query(`select x.row,l.* from jsonb_to_recordset($1::jsonb)
    as x(row integer,lrn text,first_name text,last_name text,birth_date date,use_id uuid)
    cross join lateral (select id,lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,version from edunexus.learners l
      where merged_into is null and (id=x.use_id or (x.lrn is not null and lrn=x.lrn)
        or (birth_date=x.birth_date and lower(btrim(first_name))=lower(x.first_name) and lower(btrim(last_name))=lower(x.last_name))
        or exists(select 1 from edunexus.learners a where a.merged_into=l.id and a.birth_date=x.birth_date
          and lower(btrim(a.first_name))=lower(x.first_name) and lower(btrim(a.last_name))=lower(x.last_name)))
      order by (id=x.use_id) desc nulls last,(lrn=x.lrn) desc nulls last,id limit 6) l order by x.row,l.id`, [JSON.stringify(incoming)]);
  const candidates = new Map<number, Candidate[]>();
  for (const match of matches) {
    const row = Number(match.row); const items = candidates.get(row) ?? [];
    items.push(candidateSchema.parse(match)); candidates.set(row, items);
  }
  const candidateIds = matches.map(m => String(m.id));
  const enrolled = new Set((await tx.query('select edunexus.visible_learner_identity(learner_id) as learner_id from edunexus.enrollments where record_state=\'valid\' and academic_year_id=$1 and edunexus.visible_learner_identity(learner_id)=any($2::uuid[])', [year.id, candidateIds])).map(e => e.learner_id));
  const seenLrn = new Set<string>(), seenName = new Set<string>(), seenId = new Set<string>();
  const rows: PreviewRow[] = profiles.map((profile, index) => {
    const row = index + 1, choices = candidates.get(row) ?? [], resolution = resolutions.get(row);
    const result: PreviewRow = { row, profile, action: profile ? 'create' : null, learner_id: null, grade_level: null, candidates: choices, candidates_truncated: choices.length === 6 };
    if (!profile) return result;
    // The grade this learner is enrolled at: their own row's, or the one the
    // screen gave for the whole file.
    result.grade_level = grades[index] ?? fileGrade;
    if (result.grade_level === null) {
      issue(row, 'grade_level', 'GRADE_REQUIRED', 'This row has no grade level, and none was given for the file. Fill the grade level column, or choose a grade for the whole import.');
    } else if (section && result.grade_level !== section.grade_level) {
      // A class teaches one grade. A row naming another is a mistake worth
      // refusing rather than silently resolving either way.
      issue(row, 'grade_level', 'GRADE_NOT_THIS_CLASS', `This class teaches ${gradeWord(section.grade_level)}, and this row says ${gradeWord(result.grade_level)}.`);
    }
    if (profile.birth_date >= b.enrolled_on) issue(row, 'birth_date', 'INVALID_BIRTH_DATE', 'Birth date must precede enrollment.');
    const nameKey = JSON.stringify([profile.first_name.toLowerCase(), profile.last_name.toLowerCase(), profile.birth_date]);
    if ((profile.lrn && seenLrn.has(profile.lrn)) || seenName.has(nameKey)) issue(row, 'csv', 'DUPLICATE_INPUT', 'This batch repeats an LRN or the same first name, last name, and birth date. Review and split distinct namesakes into separate imports.');
    if (profile.lrn) seenLrn.add(profile.lrn); seenName.add(nameKey);
    if (resolution?.action === 'use_existing') {
      const existing = choices.find(c => c.id === resolution.learner_id);
      result.action = 'use_existing'; result.learner_id = resolution.learner_id;
      if (!existing || existing.version !== resolution.version) issue(row, 'resolutions', 'VERSION_CONFLICT', 'The selected learner is unavailable or changed. Refresh the resolution.');
      else {
        // A learner on file from before the LRN was required may have none; an import never assigns one, so it is recorded on the registry first.
        if (existing.lrn === null) issue(row, 'lrn', 'LRN_MISSING_ON_FILE', 'The learner on file has no LRN yet. Record it on the Learner registry first, then preview again.');
        // `columnsV2`, not `columns`: the grade is the enrolment's, not the
        // learner's, and a learner on file has no grade to compare against.
        else if (columnsV2.some(key => profile[key as keyof Profile] !== existing[key as keyof Candidate])) issue(row, 'csv', 'PROFILE_MISMATCH', 'CSV fields must match the selected learner. Imports cannot overwrite existing profiles or assign LRNs.');
        if (enrolled.has(existing.id)) issue(row, 'resolutions', 'ALREADY_ENROLLED', 'The learner already has enrollment history in this year. Use the existing enrollment workflow.');
        if (seenId.has(existing.id)) issue(row, 'resolutions', 'DUPLICATE_INPUT', 'The same learner cannot appear twice in a batch.');
        seenId.add(existing.id);
      }
    } else {
      if (profile.lrn && choices.some(c => c.lrn === profile.lrn)) issue(row, 'lrn', 'LRN_EXISTS', 'This LRN already exists. Review and explicitly select the existing learner.');
      else if (choices.length && resolution?.action !== 'create_distinct') issue(row, 'resolutions', 'POSSIBLE_DUPLICATE', 'Review possible matches. Select an existing learner or explain why this is a distinct person.');
      if (!choices.length && resolution?.action === 'create_distinct') issue(row, 'resolutions', 'UNNEEDED_RESOLUTION', 'No duplicate candidate remains. Remove the distinct-person resolution and preview again.');
    }
    return result;
  });
  // The plan hash binds the grade as well as the section, so a preview reviewed
  // for one grade cannot be committed against another. `section` is undefined
  // for an import with no class yet, and that is part of what is hashed.
  // `grade` is the file's own, which is null for a mixed registry import; the
  // grade each learner is actually enrolled at is on their row. The digest
  // names v3 because the rows now carry a grade, so a preview reviewed under
  // the old shape cannot be committed under the new one.
  return { section: section ?? null, year, grade: fileGrade, rows, issues, candidateIds,
    hash: digest({ format: 'edunexus-roster-v3', section: section ?? null, year, grade: fileGrade, rows }) };
}

export async function executeReview(id: ReviewOperationId, ctx: Context, input: { body: unknown; query: unknown; id?: string }) {
  const { tx } = ctx;
  switch (id) {
    case 'importTemplate': return { format: 'edunexus-roster-v2', csv: header, max_rows: 50, max_csv_bytes: 24000, max_request_bytes: 32768, preview_minutes: 30,
      instructions: ['Use UTF-8 comma-separated CSV with this exact header, or the EDUNEXUS Excel template, which carries the same columns. This is an EDUNEXUS template, not a DepEd LIS import format.', 'Preserve LRN as text with all 12 digits; every learner needs one. Dates use YYYY-MM-DD and sex is male or female.', 'One batch enrolls up to 50 learners in one section, which is one class list. Blank middle_name, name_extension and address are allowed: an address nobody has recorded is left empty rather than guessed at.', 'The address is one line, as the school\'s own learner information writes it. It is the only learner field beyond the name, LRN, birth date and sex that EDUNEXUS holds; any further field waits on the school\'s reviewed field list.', 'A file saved from the earlier template, without the address column, is still read; its learners are recorded with no address.', 'Preview first. Resolve duplicates explicitly and preview again. Existing profiles are never overwritten.', 'Commit the same CSV, section, date, entry kind, and resolutions with confirmed=true within 30 minutes, using the same manager account.', 'Row numbers identify data records starting at 1, excluding the header. Do not put real learner data in source control or application logs.'] };
    case 'importPreview': {
      const b = input.body as ImportInput, plan = await planImport(tx, b);
      await record(tx, id, plan.candidateIds);
      const [preview] = plan.issues.length ? [] : await tx.query('select id,expires_at from edunexus.create_import_preview($1,$2,$3)', [inputDigest(b), plan.hash, plan.rows.length]);
      return { can_commit: plan.issues.length === 0, preview_id: preview?.id ?? null, expires_at: preview?.expires_at ?? null,
        section: plan.section, academic_year_id: plan.year.id, grade_level: plan.grade, rows: plan.rows, issues: plan.issues };
    }
    case 'importGet': {
      const [preview] = await tx.query(`select id,row_count,created_at,expires_at,committed_at,receipt,
        case when committed_at is not null then 'committed' when expires_at<=clock_timestamp() then 'expired' else 'pending' end as status
        from edunexus.import_previews where id=$1`, [input.id]);
      if (!preview) throw missing();
      const receipt = preview.receipt as Receipt | null;
      await record(tx, id, receipt?.items.map(i => i.learner_id) ?? []); return preview;
    }
    case 'importCommit': {
      const b = input.body as z.infer<typeof reviewSchemas.commit>;
      const [preview] = await tx.query('select * from edunexus.lock_import_preview($1,$2)', [input.id, inputDigest(b)]);
      if (!preview) throw missing();
      if (preview.receipt) { const receipt = preview.receipt as Receipt; await record(tx, id, receipt.items.map(i => i.learner_id)); return receipt; }
      const plan = await planImport(tx, b);
      if (plan.issues.length || plan.hash !== preview.plan_hash) throw conflict();
      const items: Receipt['items'] = [];
      for (const row of plan.rows) {
        let learnerId = row.learner_id;
        if (row.action === 'create') {
          const created = await executeRegistry('learnerCreate', ctx, { body: row.profile, query: undefined });
          learnerId = String((created as Row).id);
        }
        // One writer for both, as `enrollmentCreate` does it for one learner:
        // the section is the optional argument, and null is a learner enrolled
        // at a grade with no class yet.
        // Each learner at the grade their own row names, which is how one
        // file carries a whole school rather than one class.
        const [enrollment] = await tx.query('select id from edunexus.place_enrollment($1,$2,$3::smallint,$4,$5,$6)',
          [learnerId, plan.year.id, row.grade_level, b.section_id, b.enrolled_on, b.entry_kind]);
        if (!enrollment || !learnerId || !row.action) throw new Error('Incomplete import plan');
        const resolution = b.resolutions.find(r => r.row === row.row);
        items.push({ row: row.row, learner_id: learnerId, enrollment_id: String(enrollment.id), action: row.action, resolution_reason: resolution?.action === 'create_distinct' ? resolution.reason : null });
      }
      // The receipt's grade is the file's: null when its rows carry their own.
      // `decide_roster_submission` matches a submission against it, so what it
      // says has to be what was asked for, not a grade picked from the rows.
      const receipt: Receipt = { preview_id: input.id!, section_id: b.section_id, academic_year_id: plan.year.id, grade_level: plan.grade, items };
      await tx.query('select edunexus.finish_import($1,$2,$3::jsonb)', [input.id, plan.hash, JSON.stringify(receipt)]);
      await record(tx, id, [...plan.candidateIds, ...items.map(i => i.learner_id)]);
      return receipt;
    }
    case 'lrnCorrect': {
      const b = input.body as z.infer<typeof reviewSchemas.correction>;
      const [learner] = await tx.query('select * from edunexus.correct_lrn($1,$2,$3,$4,$5)', [input.id, b.version, b.previous_lrn, b.corrected_lrn, b.reason]);
      return learner;
    }
    case 'lrnCorrectionHistory': {
      const [learner] = await tx.query('select id from edunexus.learners where id=$1', [input.id]);
      if (!learner) throw missing();
      const q = input.query as z.infer<typeof registrySchemas.historyQuery>;
      const rows = await tx.query(`select id,learner_id,learner_version,previous_lrn,corrected_lrn,reason,actor_user_id,request_id,recorded_at
        from edunexus.lrn_corrections where learner_id=$1 order by learner_version limit $2 offset $3`, [input.id, q.limit + 1, q.offset]);
      await record(tx, id, [String(learner.id)]);
      return { items: rows.slice(0, q.limit), pagination: { limit: q.limit, offset: q.offset, has_more: rows.length > q.limit } };
    }
  }
}
