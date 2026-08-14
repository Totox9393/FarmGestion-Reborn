-- Patch after initial auctions_reborn.sql execution.
-- Applies admin settings needs:
-- 1) homepage_messages_enabled config toggle
-- 2) manual launch delay overrides persisted per session
-- 3) allow admins to update auction config through RLS policy

alter table public.auction_config_reborn
  add column if not exists homepage_messages_enabled boolean not null default true;

alter table public.auction_sessions_reborn
  add column if not exists open_delay_minutes_override integer null check (open_delay_minutes_override between 1 and 1440),
  add column if not exists duration_hours_override integer null check (duration_hours_override between 1 and 72);

grant update on public.auction_config_reborn to authenticated;

create or replace function public.admin_launch_auction_session_reborn(
  p_slots_count integer default null,
  p_open_delay_minutes integer default null,
  p_duration_hours integer default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_cfg public.auction_config_reborn%rowtype;
  v_active_exists boolean := false;
  v_slots integer;
  v_session_id uuid;
  v_now timestamptz := now();
  v_delay integer;
  v_duration integer;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_admin_user_reborn(v_user_id) then
    return json_build_object('success', false, 'reason', 'NOT_ALLOWED');
  end if;

  select * into v_cfg
  from public.auction_config_reborn
  where id = true
  for update;

  select exists (
    select 1
    from public.auction_sessions_reborn s
    where s.status in ('filling', 'ready_delay', 'open')
  ) into v_active_exists;

  if v_active_exists then
    return json_build_object('success', false, 'reason', 'ACTIVE_SESSION_EXISTS');
  end if;

  if p_slots_count is null then
    v_slots := floor(random() * (v_cfg.slot_max - v_cfg.slot_min + 1))::integer + v_cfg.slot_min;
  else
    v_slots := p_slots_count;
  end if;

  if v_slots < v_cfg.slot_min or v_slots > v_cfg.slot_max then
    return json_build_object('success', false, 'reason', 'SLOTS_OUT_OF_RANGE');
  end if;

  v_delay := coalesce(p_open_delay_minutes, v_cfg.open_delay_minutes);
  v_duration := coalesce(p_duration_hours, v_cfg.duration_hours);

  insert into public.auction_sessions_reborn (
    status,
    slots_count,
    open_delay_minutes_override,
    duration_hours_override,
    fill_deadline_at,
    open_at,
    end_at,
    launched_mode,
    created_by,
    created_at,
    updated_at
  ) values (
    'filling',
    v_slots,
    v_delay,
    v_duration,
    v_now + make_interval(hours => v_cfg.fill_timeout_hours),
    null,
    null,
    'admin',
    v_user_id,
    v_now,
    v_now
  )
  returning id into v_session_id;

  return json_build_object(
    'success', true,
    'session_id', v_session_id,
    'slots_count', v_slots,
    'fill_deadline_at', v_now + make_interval(hours => v_cfg.fill_timeout_hours),
    'planned_open_delay_minutes', v_delay,
    'planned_duration_hours', v_duration
  );
end;
$$;

create or replace function public.auction_join_slot_reborn(
  p_session_id uuid,
  p_betail_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_cfg public.auction_config_reborn%rowtype;
  v_session public.auction_sessions_reborn%rowtype;
  v_betail public.betails%rowtype;
  v_slot_index integer;
  v_slot_id uuid;
  v_slots_taken integer := 0;
  v_now timestamptz := now();
  v_open_delay_minutes integer;
  v_duration_hours integer;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  if p_session_id is null or p_betail_id is null then
    return json_build_object('success', false, 'reason', 'INVALID_INPUT');
  end if;

  select * into v_cfg
  from public.auction_config_reborn
  where id = true;

  select * into v_session
  from public.auction_sessions_reborn
  where id = p_session_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'SESSION_NOT_FOUND');
  end if;

  if v_session.status <> 'filling' then
    return json_build_object('success', false, 'reason', 'SESSION_NOT_FILLING');
  end if;

  if v_now > v_session.fill_deadline_at then
    update public.auction_sessions_reborn
    set status = 'expired',
        updated_at = v_now
    where id = v_session.id
      and status = 'filling';

    return json_build_object('success', false, 'reason', 'SESSION_EXPIRED');
  end if;

  if exists (
    select 1
    from public.auction_slots_reborn s
    where s.session_id = v_session.id
      and s.seller_user_id = v_user_id
  ) then
    return json_build_object('success', false, 'reason', 'ALREADY_SUBMITTED_THIS_SESSION');
  end if;

  select * into v_betail
  from public.betails b
  where b.id = p_betail_id
    and b.owner_id = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'BETAIL_NOT_OWNED');
  end if;

  if not coalesce(v_betail.visible, true) then
    return json_build_object('success', false, 'reason', 'BETAIL_NOT_VISIBLE');
  end if;

  if not coalesce(v_betail.premium, false) then
    return json_build_object('success', false, 'reason', 'BETAIL_NOT_PREMIUM');
  end if;

  if coalesce(v_betail.auction_locked, false) then
    return json_build_object('success', false, 'reason', 'BETAIL_ALREADY_LOCKED');
  end if;

  if coalesce(v_betail.created_at, now()) > (v_now - interval '14 day') then
    return json_build_object('success', false, 'reason', 'BETAIL_TOO_RECENT');
  end if;

  if exists (
    select 1
    from public.shipping sh
    where sh.betail_id = v_betail.id
      and sh.status = 'scheduled'
  ) then
    return json_build_object('success', false, 'reason', 'BETAIL_IN_SHIPPING');
  end if;

  select gs.slot
  into v_slot_index
  from generate_series(1, v_session.slots_count) as gs(slot)
  where not exists (
    select 1
    from public.auction_slots_reborn s
    where s.session_id = v_session.id
      and s.slot_index = gs.slot
  )
  order by gs.slot
  limit 1;

  if v_slot_index is null then
    return json_build_object('success', false, 'reason', 'SLOTS_FULL');
  end if;

  insert into public.auction_slots_reborn (
    session_id,
    slot_index,
    betail_id,
    seller_user_id,
    status,
    created_at,
    updated_at
  ) values (
    v_session.id,
    v_slot_index,
    v_betail.id,
    v_user_id,
    'listed',
    v_now,
    v_now
  )
  returning id into v_slot_id;

  update public.betails
  set auction_locked = true,
      auction_session_id = v_session.id
  where id = v_betail.id;

  select count(*)::integer
  into v_slots_taken
  from public.auction_slots_reborn s
  where s.session_id = v_session.id;

  if v_slots_taken >= v_session.slots_count then
    v_open_delay_minutes := coalesce(v_session.open_delay_minutes_override, v_cfg.open_delay_minutes);
    v_duration_hours := coalesce(v_session.duration_hours_override, v_cfg.duration_hours);

    update public.auction_sessions_reborn
    set status = 'ready_delay',
        open_at = v_now + make_interval(mins => v_open_delay_minutes),
        end_at = v_now + make_interval(mins => v_open_delay_minutes) + make_interval(hours => v_duration_hours),
        updated_at = v_now
    where id = v_session.id
      and status = 'filling';
  end if;

  return json_build_object(
    'success', true,
    'session_id', v_session.id,
    'slot_id', v_slot_id,
    'slot_index', v_slot_index,
    'slots_taken', v_slots_taken,
    'slots_count', v_session.slots_count,
    'status_after', (
      select s.status
      from public.auction_sessions_reborn s
      where s.id = v_session.id
    )
  );
end;
$$;

create or replace function public.admin_force_open_auction_session_reborn(
  p_session_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_cfg public.auction_config_reborn%rowtype;
  v_session public.auction_sessions_reborn%rowtype;
  v_duration_hours integer;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_admin_user_reborn(v_user_id) then
    return json_build_object('success', false, 'reason', 'NOT_ALLOWED');
  end if;

  if p_session_id is null then
    return json_build_object('success', false, 'reason', 'INVALID_INPUT');
  end if;

  select * into v_cfg
  from public.auction_config_reborn
  where id = true;

  select * into v_session
  from public.auction_sessions_reborn s
  where s.id = p_session_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'SESSION_NOT_FOUND');
  end if;

  if v_session.status not in ('filling', 'ready_delay') then
    return json_build_object('success', false, 'reason', 'SESSION_NOT_FORCE_OPENABLE', 'status', v_session.status);
  end if;

  v_duration_hours := coalesce(v_session.duration_hours_override, v_cfg.duration_hours);

  update public.auction_sessions_reborn s
  set status = 'open',
      open_at = v_now,
      end_at = v_now + make_interval(hours => v_duration_hours),
      updated_at = v_now
  where s.id = v_session.id;

  return json_build_object(
    'success', true,
    'session_id', v_session.id,
    'status_after', 'open',
    'open_at', v_now,
    'end_at', v_now + make_interval(hours => v_duration_hours)
  );
end;
$$;

create or replace function public.admin_force_close_auction_session_reborn(
  p_session_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_session public.auction_sessions_reborn%rowtype;
  v_close_result json;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_admin_user_reborn(v_user_id) then
    return json_build_object('success', false, 'reason', 'NOT_ALLOWED');
  end if;

  if p_session_id is null then
    return json_build_object('success', false, 'reason', 'INVALID_INPUT');
  end if;

  select * into v_session
  from public.auction_sessions_reborn s
  where s.id = p_session_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'SESSION_NOT_FOUND');
  end if;

  if v_session.status <> 'open' then
    return json_build_object('success', false, 'reason', 'SESSION_NOT_OPEN', 'status', v_session.status);
  end if;

  update public.auction_sessions_reborn s
  set end_at = least(coalesce(s.end_at, v_now), v_now),
      updated_at = v_now
  where s.id = v_session.id;

  select public.auction_close_session_reborn(v_session.id) into v_close_result;
  return coalesce(v_close_result, json_build_object('success', false, 'reason', 'CLOSE_RESULT_EMPTY'));
end;
$$;

grant execute on function public.admin_force_open_auction_session_reborn(uuid) to authenticated;
grant execute on function public.admin_force_close_auction_session_reborn(uuid) to authenticated;
