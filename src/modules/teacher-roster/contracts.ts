import {z} from 'zod';
import {uuid} from '../foundation/contracts.js';
import {registrySchemas} from '../registry/contracts.js';

/**
 * An adviser takes their own learners into their own class.
 *
 * This reverses the settled rule that only managers change learner records
 * (decided 2026-11-05; the reversal and its reasons are in
 * docs/constraints.md). It is kept as narrow as the request allows:
 *
 * - Every operation names a **section**, and `may_advise_section` decides it:
 *   the adviser of that section, or any manager, while the year is open.
 * - Taking a learner in only ever **gives a class to an enrolment that has
 *   none**, or enrols a learner who has none this year. Taking a learner out of
 *   a colleague's class stays a manager's movement.
 * - Registering a learner refuses a **name and birth date already on the
 *   registry**, because an adviser cannot search the registry to check and two
 *   records for one child is the worst thing this system can be made to hold.
 * - Nothing else widens. No profile correction, no LRN, no withdrawal.
 *
 * Both writes go through `place_enrollment` and `move_enrollment`, the same two
 * writers the registry form, the roster import and next year's placement use.
 */

const date=z.iso.date();
export const rosterSchemas={
  pullable:z.strictObject({
    search:z.string().trim().min(2,'Search with at least two characters.').max(100).optional(),
    limit:z.coerce.number().int().min(1).max(50).default(25),
  }),
  pull:z.strictObject({
    learner_id:uuid,
    enrolled_on:date,
    entry_kind:z.enum(['regular','transfer_in']).default('regular'),
    /** The enrolment's last-read version, when there is one to assign a class to. Omitted for a learner with no enrolment this year. */
    version:z.number().int().min(1).max(2147483646).optional(),
  }),
  register:z.strictObject({...registrySchemas.learnerCreate.shape,enrolled_on:date,entry_kind:z.enum(['regular','transfer_in']).default('regular')}),
};

export const rosterOperations=([
  {id:'pullableList',method:'get',path:'/api/v1/sections/:id/pullable-learners',
    summary:'List the learners an adviser may take into this class: those registered for its school year at its grade with no class yet, and — with a search of at least two characters — a learner on the registry with no enrolment this year at all. Names learners outside the caller\'s own class, so every call is logged',
    query:rosterSchemas.pullable},
  {id:'learnerPull',method:'post',path:'/api/v1/sections/:id/pulls',
    summary:'Take one already-registered learner into this class: a class is given to the enrolment they already hold, or they are enrolled at this section\'s grade if they hold none this year. Never creates a second learner record',
    body:rosterSchemas.pull},
  {id:'learnerRegister',method:'post',path:'/api/v1/sections/:id/learners',
    summary:'Register a new learner straight into this class. Refused when a learner with the same name and birth date is already on the registry, so an adviser who cannot search it cannot make a second record for one child',
    body:rosterSchemas.register},
] as const).map(op=>({...op,module:'teacher-roster' as const}));
export type RosterOperationId=typeof rosterOperations[number]['id'];

const sectionShape=z.object({id:uuid,name:z.string(),grade_level:z.number().int(),academic_year_id:uuid,
  start_year:z.number().int(),status:z.string(),starts_on:date,ends_on:date});
const candidate=z.object({learner_id:uuid,lrn:z.string().nullable(),first_name:z.string(),middle_name:z.string().nullable(),
  last_name:z.string(),name_extension:z.string().nullable(),sex:z.enum(['male','female']),birth_date:date,address:z.string().nullable(),
  enrollment_id:uuid.nullable(),enrollment_version:z.number().int().nullable(),enrolled_on:date.nullable(),
  how:z.enum(['assign','enrol']).describe('`assign`: they already hold an enrolment at this grade with no class, so taking them in gives it a class. `enrol`: they hold none this school year, so taking them in enrols them at this section\'s grade')});
const enrollment=z.object({id:uuid,learner_id:uuid,academic_year_id:uuid,grade_level:z.number().int(),section_id:uuid.nullable(),
  enrolled_on:date,effective_on:date,status:z.string(),last_reason:z.string(),version:z.number().int()}).loose();

export const rosterResponses:Record<string,z.ZodType>={
  pullableList:z.object({section:sectionShape,items:z.array(candidate)}),
  learnerPull:z.object({enrollment,how:z.enum(['assign','enrol'])}),
  learnerRegister:z.object({learner:z.object({id:uuid,lrn:z.string().nullable(),first_name:z.string(),middle_name:z.string().nullable(),
    last_name:z.string(),name_extension:z.string().nullable(),birth_date:date,sex:z.enum(['male','female']),address:z.string().nullable(),
    version:z.number().int()}).loose(),enrollment}),
};
