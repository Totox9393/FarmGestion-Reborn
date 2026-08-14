-- Schedules auction tick every minute.
-- Safe to re-run: unschedules previous job if it exists.

do $$
declare
  v_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception
      when insufficient_privilege then
        raise notice 'pg_cron not installable by current role. Use Supabase Scheduled Functions and run: select public.auction_tick_reborn();';
        return;
    end;
  end if;

  begin
    select j.jobid
    into v_job_id
    from cron.job j
    where j.jobname = 'auctions-reborn-hourly-tick'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'auctions-reborn-hourly-tick',
      '* * * * *',
      'select public.auction_tick_reborn();'
    );
  exception
    when undefined_table or undefined_function then
      raise notice 'cron schema/functions unavailable. Configure a Supabase Scheduled Function that runs: select public.auction_tick_reborn();';
  end;
end;
$$;

-- Optional manual run:
-- select public.auction_tick_reborn();
