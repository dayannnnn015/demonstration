-- Shared rate limiting survives multiple Vercel instances. Auth/anonymous abuse
-- must also be limited at the Vercel firewall and Supabase Auth service.
create table edunexus.request_buckets (
  user_id uuid primary key references edunexus.staff(user_id) on delete restrict,
  window_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 181)
);
alter table edunexus.request_buckets enable row level security;

create function edunexus.consume_request() returns boolean language plpgsql security definer set search_path = '' as $$
declare requests integer; window_time timestamptz := date_trunc('minute', clock_timestamp());
begin
  if edunexus.actor_role() is null then return false; end if;
  insert into edunexus.request_buckets as b (user_id, window_start, request_count)
  values (edunexus.actor_id(), window_time, 1)
  on conflict (user_id) do update set
    window_start = excluded.window_start,
    request_count = case when b.window_start < excluded.window_start then 1 else least(b.request_count + 1, 181) end
  returning request_count into requests;
  return requests <= 180;
end $$;
revoke all on function edunexus.consume_request() from public;
grant execute on function edunexus.consume_request() to edunexus_app;
