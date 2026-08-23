-- Fix auth signup failures caused by a stale trigger referencing public.profiles.
--
-- FarmGestion stores application profiles in public.users_profiles and creates
-- them from RegisterModal after Supabase Auth has created the auth.users row.
-- Recreating public.profiles (or aliasing it to users_profiles) would cause an
-- incomplete/duplicate profile insertion. The safe repair is therefore to
-- detach only the stale auth.users trigger(s) that still use public.profiles.

begin;

do $repair$
declare
  candidate record;
  dropped_count integer := 0;
begin
  if to_regclass('public.users_profiles') is null then
    raise exception 'public.users_profiles is missing; no change was made.';
  end if;

  if to_regclass('public.profiles') is not null then
    raise exception 'public.profiles exists; this repair does not apply and no change was made.';
  end if;

  for candidate in
    select
      trigger_info.tgname as trigger_name,
      function_namespace.nspname as function_schema,
      function_info.proname as function_name
    from pg_catalog.pg_trigger trigger_info
    join pg_catalog.pg_class table_info
      on table_info.oid = trigger_info.tgrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_info.relnamespace
    join pg_catalog.pg_proc function_info
      on function_info.oid = trigger_info.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_info.pronamespace
    where not trigger_info.tgisinternal
      and table_namespace.nspname = 'auth'
      and table_info.relname = 'users'
      and lower(function_info.prosrc) like '%public.profiles%'
  loop
    raise notice 'Removing stale trigger %. Function: %.%',
      candidate.trigger_name,
      candidate.function_schema,
      candidate.function_name;

    execute format(
      'drop trigger %I on auth.users',
      candidate.trigger_name
    );

    dropped_count := dropped_count + 1;
  end loop;

  if dropped_count = 0 then
    raise exception
      'No auth.users trigger referencing public.profiles was found; no change was made.';
  end if;

  raise notice 'Removed % stale auth.users trigger(s).', dropped_count;
end
$repair$;

-- Abort instead of committing if a broken trigger is somehow still attached.
do $verify$
begin
  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_info
    join pg_catalog.pg_class table_info
      on table_info.oid = trigger_info.tgrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_info.relnamespace
    join pg_catalog.pg_proc function_info
      on function_info.oid = trigger_info.tgfoid
    where not trigger_info.tgisinternal
      and table_namespace.nspname = 'auth'
      and table_info.relname = 'users'
      and lower(function_info.prosrc) like '%public.profiles%'
  ) then
    raise exception 'A stale auth.users trigger still references public.profiles.';
  end if;
end
$verify$;

commit;
