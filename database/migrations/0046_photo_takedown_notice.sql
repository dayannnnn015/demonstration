-- From the profile test pass (P5, 28 October): when a manager took a photo down,
-- its owner saw it turn into initials with no word of why, though the reason
-- was journalled. The profile read now carries that notice to them, for as long
-- as no photo has been set since and for 60 days, naming who and why; never the
-- picture, which is gone. Everything else 0045's read returns is unchanged.
create or replace function edunexus.read_my_profile() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s edunexus.staff;
begin
  select * into s from edunexus.staff where user_id=edunexus.actor_id() and active;
  if not found then raise exception using errcode='42501',message='Active staff access required'; end if;
  return jsonb_build_object('user_id',s.user_id,'display_name',s.display_name,'role',s.role,'position',s.position,'specialization',s.specialization,
    'profile',edunexus.staff_profile_view(s.user_id),
    'advises',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'grade_level',x.grade_level,'name',x.name,'start_year',y.start_year,'year_status',y.status)
        order by y.start_year desc,x.grade_level,x.name),'[]'::jsonb)
      from edunexus.sections x join edunexus.academic_years y on y.id=x.academic_year_id where x.adviser_user_id=s.user_id and y.status in ('draft','active')),
    'name_request',(select edunexus.name_request_view(r) from edunexus.staff_name_requests r where r.user_id=s.user_id
      and (r.status='pending' or r.updated_at>clock_timestamp()-interval '30 days') order by r.created_at desc limit 1),
    'photo_taken_down',(select jsonb_build_object('at',e.recorded_at,'by',(select display_name from edunexus.staff where user_id=e.actor_user_id),'reason',e.reason)
      from (select * from edunexus.staff_profile_events where user_id=s.user_id and kind in ('photo_set','photo_remove','photo_taken_down') order by id desc limit 1) e
      where e.kind='photo_taken_down' and e.recorded_at>clock_timestamp()-interval '60 days'));
end $$;
