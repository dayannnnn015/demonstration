-- Temporary. Marks a database that holds seeded synthetic records, so every
-- screen can say so. Only the operator's seeding script writes the one row,
-- with no runtime grant to change it. The go-live reset rebuilds the database
-- from the migrations, and this table then comes back empty: the notice ends
-- with the data it describes, rather than with someone remembering to remove it.
create table edunexus.seeded_data_notice (
  id boolean primary key default true check (id),
  note text not null check (length(btrim(note)) between 1 and 300 and note !~ '[[:cntrl:]]'),
  seeded_at timestamptz not null default now()
);
alter table edunexus.seeded_data_notice enable row level security;
create policy staff_read on edunexus.seeded_data_notice for select to edunexus_app using (edunexus.actor_role() is not null);
grant select on edunexus.seeded_data_notice to edunexus_app;
