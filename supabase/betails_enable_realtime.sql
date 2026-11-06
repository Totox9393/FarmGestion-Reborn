-- Enable realtime events for public betail register updates.
-- Safe to execute multiple times.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'betails'
  ) then
    execute 'alter publication supabase_realtime add table public.betails';
  end if;
end;
$$;

-- Full row images improve update/delete payload reliability for client-side filtering.
alter table public.betails replica identity full;
