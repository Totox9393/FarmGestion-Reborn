-- Guarantees that the automatic auction quota follows the current Paris week
-- (Monday 00:00 through Sunday 23:59), instead of relying only on randomness.
-- Run after auctions_reborn.sql and auctions_schedule.sql. This migration
-- replaces the existing cron command itself.

-- Final safety net: every automatic insertion, including one coming from an
-- older version of auction_tick_reborn(), must respect the cumulative quota
-- allowed for the current day. Returning NULL cancels only the attempted row;
-- lifecycle work performed by the scheduler remains committed.
create or replace function public.auction_guard_weekly_distribution_reborn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target integer := 0;
  v_week_start date := date_trunc('week', timezone('Europe/Paris', now()))::date;
  v_week_end date := date_trunc('week', timezone('Europe/Paris', now()))::date + 7;
  v_day_index integer := extract(isodow from timezone('Europe/Paris', now()))::integer - 1;
  v_created_this_week integer := 0;
  v_sessions_due integer := 0;
begin
  if new.launched_mode <> 'auto' then
    return new;
  end if;

  -- Serialize all automatic launch paths, including concurrent cron calls.
  perform pg_advisory_xact_lock(hashtext('auction_auto_session_insert_reborn'));

  select coalesce(c.weekly_sessions_target, 0)
  into v_target
  from public.auction_config_reborn c
  where c.id = true;

  if v_target <= 0 then
    return null;
  end if;

  select count(*)::integer
  into v_created_this_week
  from public.auction_sessions_reborn s
  where timezone('Europe/Paris', s.created_at)::date >= v_week_start
    and timezone('Europe/Paris', s.created_at)::date < v_week_end
    and s.launched_mode = 'auto'
    and s.status <> 'cancelled';

  v_sessions_due := least(
    v_target,
    floor((v_day_index * v_target)::numeric / 7)::integer + 1
  );

  if v_created_this_week >= v_sessions_due then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists auction_guard_weekly_distribution_reborn
on public.auction_sessions_reborn;

create trigger auction_guard_weekly_distribution_reborn
before insert on public.auction_sessions_reborn
for each row
execute function public.auction_guard_weekly_distribution_reborn();

create or replace function public.auction_enforce_weekly_quota_reborn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.auction_config_reborn%rowtype;
  v_now timestamptz := now();
  v_paris_now timestamp := timezone('Europe/Paris', now());
  v_week_start date := date_trunc('week', timezone('Europe/Paris', now()))::date;
  v_week_end date := date_trunc('week', timezone('Europe/Paris', now()))::date + 7;
  v_day_index integer := extract(isodow from timezone('Europe/Paris', now()))::integer - 1;
  v_created_this_week integer := 0;
  v_sessions_due integer := 0;
  v_active_exists boolean := false;
  v_slots integer;
  v_session_id uuid;
begin
  -- Prevent two scheduler invocations from creating sessions concurrently.
  -- This is the same lock used by the insertion guard so the count and insert
  -- form a single atomic decision.
  perform pg_advisory_xact_lock(hashtext('auction_auto_session_insert_reborn'));

  select * into v_cfg
  from public.auction_config_reborn
  where id = true;

  if not coalesce(v_cfg.enabled, false) or coalesce(v_cfg.weekly_sessions_target, 0) <= 0 then
    return jsonb_build_object('success', true, 'created', false, 'reason', 'AUTO_DISABLED');
  end if;

  select count(*)::integer
  into v_created_this_week
  from public.auction_sessions_reborn s
  where timezone('Europe/Paris', s.created_at)::date >= v_week_start
    and timezone('Europe/Paris', s.created_at)::date < v_week_end
    and s.launched_mode = 'auto'
    and s.status <> 'cancelled';

  -- Spread the minimum quota across the week. For a target of four, a session
  -- is due by Monday, Wednesday, Friday and Sunday.
  v_sessions_due := least(
    v_cfg.weekly_sessions_target,
    floor((v_day_index * v_cfg.weekly_sessions_target)::numeric / 7)::integer + 1
  );

  if v_created_this_week >= v_sessions_due then
    return jsonb_build_object(
      'success', true,
      'created', false,
      'reason', 'QUOTA_ON_TRACK',
      'created_this_week', v_created_this_week,
      'sessions_due', v_sessions_due
    );
  end if;

  select exists (
    select 1
    from public.auction_sessions_reborn s
    where s.status in ('filling', 'ready_delay', 'open')
  ) into v_active_exists;

  if v_active_exists then
    return jsonb_build_object(
      'success', true,
      'created', false,
      'reason', 'ACTIVE_SESSION_EXISTS',
      'created_this_week', v_created_this_week,
      'sessions_due', v_sessions_due
    );
  end if;

  v_slots := floor(random() * (v_cfg.slot_max - v_cfg.slot_min + 1))::integer + v_cfg.slot_min;

  insert into public.auction_sessions_reborn (
    status, slots_count, fill_deadline_at, launched_mode, created_by, created_at, updated_at
  ) values (
    'filling', v_slots, v_now + make_interval(hours => v_cfg.fill_timeout_hours),
    'auto', null, v_now, v_now
  )
  returning id into v_session_id;

  return jsonb_build_object(
    'success', true,
    'created', true,
    'session_id', v_session_id,
    'created_this_week', v_created_this_week + 1,
    'sessions_due', v_sessions_due,
    'paris_now', v_paris_now
  );
end;
$$;

revoke all on function public.auction_enforce_weekly_quota_reborn() from public;
grant execute on function public.auction_enforce_weekly_quota_reborn() to service_role;

create or replace function public.auction_scheduler_tick_reborn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tick_result jsonb;
  v_quota_result jsonb;
begin
  v_tick_result := public.auction_tick_reborn();
  v_quota_result := public.auction_enforce_weekly_quota_reborn();
  return jsonb_build_object('tick', v_tick_result, 'quota', v_quota_result);
end;
$$;

revoke all on function public.auction_scheduler_tick_reborn() from public;
grant execute on function public.auction_scheduler_tick_reborn() to service_role;

-- Replace the existing cron command so lifecycle processing and quota
-- enforcement are both executed every minute.
do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select j.jobid into v_job_id
    from cron.job j
    where j.jobname = 'auctions-reborn-hourly-tick'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'auctions-reborn-hourly-tick',
      '* * * * *',
      'select public.auction_scheduler_tick_reborn();'
    );
  end if;
end;
$$;
