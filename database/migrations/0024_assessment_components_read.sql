-- An adviser creates an assessment under a component of the policy bound to
-- their offering, but adoptions and bindings are readable by managers only, so
-- an adviser had no way to learn which component codes exist and could only
-- guess until TASK_COMPONENT stopped refusing. This returns the codes and names
-- of the bound revision and nothing else: the weights stay manager-only, since
-- nothing an adviser does needs them and nothing in EDUNEXUS computes with them.
--
-- A read, so it takes the academic lock shared, as the register reads do since
-- 0023; every writer that could change a binding or adoption takes it
-- exclusively, so what this returns is never half of a change. It names no
-- learner and writes no access row.
create function edunexus.read_assessment_components(p_offering uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare offering edunexus.section_subjects; section edunexus.sections; year edunexus.academic_years; binding edunexus.assessment_policy_bindings; adoption edunexus.assessment_policy_adoptions;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into offering from edunexus.section_subjects where id=p_offering;
  if not found then raise exception using errcode='P0002',message='Offering not found'; end if;
  select * into section from edunexus.sections where id=offering.section_id;
  if not edunexus.is_manager() and section.adviser_user_id is distinct from edunexus.actor_id() then raise exception using errcode='P0002',message='Offering not found'; end if;
  select * into year from edunexus.academic_years where id=offering.academic_year_id;
  if not edunexus.is_manager() and year.status='closed' then raise exception using errcode='P0002',message='Offering not found'; end if;
  select * into binding from edunexus.assessment_policy_bindings where offering_id=p_offering and status='bound';
  if not found then return jsonb_build_object('offering_id',p_offering,'bound',false,'components','[]'::jsonb); end if;
  select * into adoption from edunexus.assessment_policy_adoptions where id=binding.adoption_id;
  return jsonb_build_object('offering_id',p_offering,'bound',true,
    'components',(select coalesce(jsonb_agg(jsonb_build_object('code',c->>'code','name',c->>'name') order by c->>'code'),'[]'::jsonb)
      from jsonb_array_elements(adoption.policy_snapshot->'components') c));
end $$;
revoke all on function edunexus.read_assessment_components(uuid) from public;
grant execute on function edunexus.read_assessment_components(uuid) to edunexus_app;
