-- The learner's parent or guardian: who to contact, and the number to call.
--
-- This opens two more fields of the **learner fields and class capacity** gate,
-- and only these two, on the user's explicit decision of 2026-11-05. The gate
-- is recorded in docs/constraints.md, and until today it named "parent or
-- guardian" and "contact number" among the things it still blocked -- 0053's
-- own comment lists them by name. The user was shown that, in those words, and
-- asked for both fields afterwards. That is the same way `address` left this
-- gate on 2026-11-04, and it is the only way a field may: a named decision,
-- recorded, never a default chosen here.
--
-- The gate stays shut for everything else. No mother tongue, no religion, no
-- indigenous group, no second guardian, no relationship-to-learner field, no
-- occupation, no email, no address of the guardian, and still no breakdown of
-- the learner's one address line. Each of those is a fact about a child or
-- their family that would be held for 897 real learners, and which of them the
-- school may lawfully keep is the school's answer to give.
--
-- **Two fields, not three.** The request named a guardian name and a contact
-- number, and a relationship field ("mother", "father", "aunt") was *not*
-- added, because nothing supplied says which relationships the school records
-- or how it writes them, and a closed list invented here would refuse a real
-- family. Where it matters, it is written into the name as the school's own
-- forms write it, which is one line of text and no guess at a taxonomy.
--
-- Both nullable, deliberately, for the reason every learner field here is:
-- every learner already on file has neither recorded, and absence of a record
-- is not evidence. A learner whose guardian the school has not written down
-- reads as unrecorded, never as blank, and never as having no guardian.
-- Requiring either would refuse a class list the school already keeps.
--
-- `guardian_contact` is **deliberately not validated as a Philippine number.**
-- It takes digits and the punctuation a number is written with -- space, +, -,
-- parentheses, slash, comma -- so a mobile (09171234567), a landline with an
-- area code ((074) 422-1234) and two numbers in one line all pass. No minimum
-- length, no leading-zero rule, no +63 normalisation: the school's own records
-- are the authority on how it writes a number, and a stricter pattern invented
-- here would refuse a real one. Letters are refused, because a contact number
-- is a number; a learner with none is left unrecorded rather than typed "none".
--
-- Nothing else is needed for either. `edunexus.learners` already carries its
-- `version_record` and `audit_record` triggers, its manager-only insert and
-- update policies and its `can_read_learner` read policy from 0004, so both
-- columns inherit the version check, the change journal and the row security
-- without a line of new SQL -- including the rule that only a principal or an
-- administrative officer may write them, and that a teacher reads them only for
-- a learner in a section they advise. The learner writers are ordinary
-- statements in `src/modules/registry/service.ts` under those policies rather
-- than security definer functions, so there is no function to replace.
alter table edunexus.learners add column guardian_name text
  check(guardian_name is null or (length(btrim(guardian_name)) between 1 and 150 and guardian_name !~ '[[:cntrl:]]'));
alter table edunexus.learners add column guardian_contact text
  check(guardian_contact is null or (length(btrim(guardian_contact)) between 1 and 40 and guardian_contact ~ '^[0-9+()/,[:space:]-]+$' and guardian_contact ~ '[0-9]'));

-- 0004 grants insert and update on `edunexus.learners` **column by column**, so
-- that `version`, `created_at`, `updated_at`, `merged_into` and
-- `identity_revision` cannot be written by the API at all -- they belong to the
-- triggers and to the reviewed identity workflow. A new column is therefore not
-- writable until it is granted, which is the control doing its job: without
-- these lines registering a learner answers "permission denied for column
-- guardian_name" as a 403, which reads like a role problem and is not one.
-- 0053 records the same trap for `address`. Only these two columns are added;
-- nothing else becomes writable.
grant insert(guardian_name),update(guardian_name) on edunexus.learners to edunexus_app;
grant insert(guardian_contact),update(guardian_contact) on edunexus.learners to edunexus_app;

-- `register_learner_into_section`, replaced for the two new columns.
--
-- 0054 is applied and is never edited; this is the `create or replace` in a new
-- migration that the working contract requires, as 0018, 0019 and 0021 each do.
--
-- Only two things change, and the signature does not. The closed allow-list of
-- profile keys gains `guardian_name` and `guardian_contact` -- it is a
-- *deny-unknown* list, so without this an adviser registering a learner gets
-- "Invalid learner fields" the moment the contract carries the new keys, which
-- is the control doing its job -- and the insert carries them through. Every
-- other line is 0054's, unchanged: the advisory lock, the `may_advise_section`
-- check, the duplicate guard on name and birth date, and the enrolment through
-- `place_enrollment`.
--
-- **This does let an adviser record a guardian, and only when registering a
-- child the school has never held.** It widens nothing else: an adviser still
-- cannot correct a profile, so they cannot change a guardian once the record
-- exists, and `may_advise_section` still confines them to a class they advise.
-- It is deliberate rather than incidental -- the adviser registering a late
-- enrolee is the person who has the guardian's number in front of them, and
-- the alternative is a record the office must complete from a note.
create or replace function edunexus.register_learner_into_section(p_section uuid,p_profile jsonb,p_date date,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; l edunexus.learners; e edunexus.enrollments; existing edunexus.learners;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.may_advise_section(p_section) then raise exception using errcode='P2600',message='Register learners only into a class you advise'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found then raise exception using errcode='P0002',message='Section not found'; end if;
  if p_profile is null or jsonb_typeof(p_profile)<>'object'
    or p_profile-array['lrn','first_name','middle_name','last_name','name_extension','birth_date','sex','address','guardian_name','guardian_contact']<>'{}'::jsonb
    then raise exception using errcode='23514',message='Invalid learner fields'; end if;
  -- The same child, already on the registry. Matched the way the reviewed import
  -- matches: first name, last name and birth date, case and accents set aside.
  select * into existing from edunexus.learners c where c.merged_into is null
    and c.birth_date=(p_profile->>'birth_date')::date
    and lower(edunexus.unaccent_fallback(btrim(c.first_name)))=lower(edunexus.unaccent_fallback(btrim(p_profile->>'first_name')))
    and lower(edunexus.unaccent_fallback(btrim(c.last_name)))=lower(edunexus.unaccent_fallback(btrim(p_profile->>'last_name')))
    limit 1;
  if found then raise exception using errcode='P2601',
    message='A learner with this name and birth date is already on the school registry. Take that learner into your class instead of making a second record for the same child; the office can help if it is a different child with the same name.'; end if;
  insert into edunexus.learners(lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,address,guardian_name,guardian_contact)
    values(nullif(btrim(p_profile->>'lrn'),''),btrim(p_profile->>'first_name'),nullif(btrim(p_profile->>'middle_name'),''),
      btrim(p_profile->>'last_name'),nullif(btrim(p_profile->>'name_extension'),''),(p_profile->>'birth_date')::date,
      p_profile->>'sex',nullif(btrim(p_profile->>'address'),''),
      nullif(btrim(p_profile->>'guardian_name'),''),nullif(btrim(p_profile->>'guardian_contact'),'')) returning * into l;
  -- The same writer as every other enrolment, so the LRN rule, the date rules
  -- and the one-enrolment-a-year index are the same ones.
  e:=edunexus.place_enrollment(l.id,s.academic_year_id,s.grade_level,s.id,p_date,p_reason);
  return jsonb_build_object('learner',to_jsonb(l),'enrollment',to_jsonb(e));
end $$;
