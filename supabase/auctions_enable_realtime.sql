-- Enable true realtime events for the auction UI. Safe to execute more than once.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'auction_sessions_reborn',
    'auction_slots_reborn',
    'auction_bids_reborn'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

-- Full row images make UPDATE events reliable for session and slot state changes.
alter table public.auction_sessions_reborn replica identity full;
alter table public.auction_slots_reborn replica identity full;
