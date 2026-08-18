-- Admin observability for the pg_cron job driving auction_tick_reborn().
-- Safe to run after auctions_reborn.sql and auctions_schedule.sql.

create or replace function public.get_admin_auction_scheduler_status_reborn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id bigint;
  v_job_active boolean := false;
  v_schedule text;
  v_last_run_at timestamptz;
  v_last_status text;
  v_last_message text;
  v_scheduler_available boolean := true;
  v_created_this_week integer := 0;
  v_last_auto_session_at timestamptz;
begin
  if v_user_id is null or not public.is_admin_user_reborn(v_user_id) then
    return jsonb_build_object('success', false, 'reason', 'NOT_ALLOWED');
  end if;

  begin
    execute $query$
      select j.jobid, j.active, j.schedule
      from cron.job j
      where j.jobname = 'auctions-reborn-hourly-tick'
      limit 1
    $query$
    into v_job_id, v_job_active, v_schedule;

    if v_job_id is not null then
      execute $query$
        select d.end_time, d.status, d.return_message
        from cron.job_run_details d
        where d.jobid = $1
        order by d.start_time desc
        limit 1
      $query$
      into v_last_run_at, v_last_status, v_last_message
      using v_job_id;
    end if;
  exception
    when undefined_table or undefined_function or invalid_schema_name or insufficient_privilege then
      v_scheduler_available := false;
  end;

  select count(*)::integer, max(s.created_at)
  into v_created_this_week, v_last_auto_session_at
  from public.auction_sessions_reborn s
  where s.launched_mode = 'auto'
    and timezone('Europe/Paris', s.created_at) >= date_trunc('week', timezone('Europe/Paris', now()))
    and s.status <> 'cancelled';

  return jsonb_build_object(
    'success', true,
    'scheduler_available', v_scheduler_available,
    'job_configured', v_job_id is not null,
    'job_active', coalesce(v_job_active, false),
    'schedule', v_schedule,
    'last_run_at', v_last_run_at,
    'last_run_status', v_last_status,
    'last_run_message', v_last_message,
    'next_check_at', case
      when v_job_id is not null and v_job_active
        then date_trunc('minute', now()) + interval '1 minute'
      else null
    end,
    'created_this_week', v_created_this_week,
    'last_auto_session_at', v_last_auto_session_at
  );
end;
$$;

revoke all on function public.get_admin_auction_scheduler_status_reborn() from public;
grant execute on function public.get_admin_auction_scheduler_status_reborn() to authenticated;

