create function edunexus.is_ready() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from edunexus.school_profile where id=1)
    and exists (select 1 from edunexus.staff where role='principal' and active)
$$;
revoke all on function edunexus.is_ready() from public;
grant execute on function edunexus.is_ready() to edunexus_app;
