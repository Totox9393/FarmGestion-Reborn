-- Auction system (V1)
-- Global sessions with user-submitted premium betails, dynamic increments, anti-sniping,
-- engaged-budget checks, and atomic close/transfer.

-- 1) Config
create table if not exists public.auction_config_reborn (
  id boolean primary key default true,
  enabled boolean not null default true,
  weekly_sessions_target integer not null default 4 check (weekly_sessions_target between 0 and 7),
  homepage_messages_enabled boolean not null default true,
  slot_min integer not null default 2 check (slot_min between 2 and 5),
  slot_max integer not null default 5 check (slot_max between 2 and 5),
  fill_timeout_hours integer not null default 12 check (fill_timeout_hours between 1 and 72),
  open_delay_minutes integer not null default 60 check (open_delay_minutes between 1 and 1440),
  duration_hours integer not null default 8 check (duration_hours between 1 and 72),
  min_bid_start integer not null default 200 check (min_bid_start >= 1),
  min_participant_money integer not null default 500 check (min_participant_money >= 0),
  inc_tier1_limit integer not null default 5000 check (inc_tier1_limit > 0),
  inc_tier1_step integer not null default 200 check (inc_tier1_step > 0),
  inc_tier2_limit integer not null default 20000 check (inc_tier2_limit > 0),
  inc_tier2_step integer not null default 500 check (inc_tier2_step > 0),
  inc_tier3_step integer not null default 1000 check (inc_tier3_step > 0),
  anti_snipe_window_seconds integer not null default 120 check (anti_snipe_window_seconds between 0 and 3600),
  anti_snipe_extend_seconds integer not null default 120 check (anti_snipe_extend_seconds between 0 and 3600),
  anti_snipe_extend_cap_seconds integer not null default 1200 check (anti_snipe_extend_cap_seconds between 0 and 7200),
  auto_seed_tick_hours numeric(8,3) not null default 1 check (auto_seed_tick_hours > 0 and auto_seed_tick_hours <= 24),
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auction_config_reborn_singleton check (id is true),
  constraint auction_config_reborn_slot_bounds check (slot_min <= slot_max),
  constraint auction_config_reborn_increment_bounds check (inc_tier1_limit < inc_tier2_limit)
);

insert into public.auction_config_reborn (id)
values (true)
on conflict (id) do nothing;

-- 2) Core tables
create table if not exists public.auction_sessions_reborn (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'filling' check (status in ('filling', 'ready_delay', 'open', 'closed', 'expired', 'cancelled')),
  slots_count integer not null check (slots_count between 2 and 5),
  open_delay_minutes_override integer null check (open_delay_minutes_override between 1 and 1440),
  duration_hours_override integer null check (duration_hours_override between 1 and 72),
  fill_deadline_at timestamptz not null,
  open_at timestamptz null,
  end_at timestamptz null,
  anti_snipe_added_seconds integer not null default 0,
  launched_mode text not null default 'auto' check (launched_mode in ('auto', 'admin')),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auction_slots_reborn (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.auction_sessions_reborn(id) on delete cascade,
  slot_index integer not null check (slot_index >= 1),
  betail_id uuid not null references public.betails(id) on delete restrict,
  seller_user_id uuid not null references public.users_profiles(id) on delete restrict,
  status text not null default 'listed' check (status in ('listed', 'sold', 'unsold', 'cancelled_tie')),
  winner_user_id uuid null references public.users_profiles(id) on delete set null,
  winning_bid_amount integer null check (winning_bid_amount is null or winning_bid_amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auction_slots_reborn_unique_slot unique (session_id, slot_index),
  constraint auction_slots_reborn_unique_betail unique (session_id, betail_id),
  constraint auction_slots_reborn_unique_seller unique (session_id, seller_user_id)
);

create table if not exists public.auction_bids_reborn (
  id bigserial primary key,
  session_id uuid not null references public.auction_sessions_reborn(id) on delete cascade,
  slot_id uuid not null references public.auction_slots_reborn(id) on delete cascade,
  bidder_user_id uuid not null references public.users_profiles(id) on delete cascade,
  amount integer not null check (amount > 0),
  increment_used integer not null check (increment_used > 0),
  created_at timestamptz not null default now()
);

create index if not exists auction_sessions_reborn_status_time_idx
  on public.auction_sessions_reborn (status, fill_deadline_at, open_at, end_at);

create index if not exists auction_slots_reborn_session_idx
  on public.auction_slots_reborn (session_id, status, slot_index);

create index if not exists auction_slots_reborn_seller_idx
  on public.auction_slots_reborn (seller_user_id, created_at desc);

create index if not exists auction_bids_reborn_slot_rank_idx
  on public.auction_bids_reborn (slot_id, amount desc, created_at asc, id asc);

create index if not exists auction_bids_reborn_session_bidder_idx
  on public.auction_bids_reborn (session_id, bidder_user_id, amount desc, created_at desc);

-- 3) Betail lock fields
alter table public.betails
  add column if not exists auction_locked boolean not null default false,
  add column if not exists auction_session_id uuid null references public.auction_sessions_reborn(id) on delete set null;

create index if not exists betails_auction_lock_idx
  on public.betails (auction_locked, auction_session_id, owner_id);

alter table public.auction_config_reborn
  add column if not exists homepage_messages_enabled boolean not null default true;

alter table public.auction_sessions_reborn
  add column if not exists open_delay_minutes_override integer null check (open_delay_minutes_override between 1 and 1440),
  add column if not exists duration_hours_override integer null check (duration_hours_override between 1 and 72);

-- 4) Helper functions
create or replace function public.is_admin_user_reborn(p_user_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users_profiles up
    where up.id = p_user_id
      and (
        upper(coalesce(up.role, '')) like '%ADMIN%'
        or upper(coalesce(up.role_ingame, '')) like '%ADMIN%'
      )
  );
$$;

create or replace function public.get_auction_increment_reborn(p_current_amount integer)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_cfg public.auction_config_reborn%rowtype;
  v_amount integer := greatest(0, coalesce(p_current_amount, 0));
begin
  select * into v_cfg
  from public.auction_config_reborn
  where id = true;

  if v_amount < v_cfg.inc_tier1_limit then
    return v_cfg.inc_tier1_step;
  elsif v_amount < v_cfg.inc_tier2_limit then
    return v_cfg.inc_tier2_step;
  end if;

  return v_cfg.inc_tier3_step;
end;
$$;

create or replace function public.get_auction_session_leaderboard_reborn(p_session_id uuid)
returns table(
  slot_id uuid,
  leader_user_id uuid,
  leader_amount integer
)
language sql
stable
set search_path = public
as $$
  with ranked as (
    select
      b.slot_id,
      b.bidder_user_id,
      b.amount,
      row_number() over (
        partition by b.slot_id
        order by b.amount desc, b.created_at asc, b.id asc
      ) as rn
    from public.auction_bids_reborn b
    where b.session_id = p_session_id
  )
  select
    r.slot_id,
    r.bidder_user_id,
    r.amount
  from ranked r
  where r.rn = 1;
$$;

create or replace function public.get_auction_engaged_total_reborn(p_session_id uuid, p_user_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(sum(lb.leader_amount), 0)::integer
  from public.get_auction_session_leaderboard_reborn(p_session_id) lb
  where lb.leader_user_id = p_user_id;
$$;

-- 5) Guard triggers (locked betail cannot be edited/shipped by normal flows)
create or replace function public.guard_locked_betail_updates_reborn()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(old.auction_locked, false)
     and coalesce(current_setting('app.auction_bypass', true), '0') <> '1' then
    raise exception 'BETAIL_AUCTION_LOCKED'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_locked_betail_updates_reborn on public.betails;
create trigger trg_guard_locked_betail_updates_reborn
before update on public.betails
for each row
execute function public.guard_locked_betail_updates_reborn();

create or replace function public.guard_shipping_on_locked_betail_reborn()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.status, 'scheduled') = 'scheduled'
     and exists (
       select 1
       from public.betails b
       where b.id = new.betail_id
         and coalesce(b.auction_locked, false)
     ) then
    raise exception 'BETAIL_AUCTION_LOCKED'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_shipping_on_locked_betail_reborn on public.shipping;
create trigger trg_guard_shipping_on_locked_betail_reborn
before insert or update of betail_id, status on public.shipping
for each row
execute function public.guard_shipping_on_locked_betail_reborn();

-- 6) Admin: launch session manually
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

-- 6b) Admin: force open/close controls
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

-- 7) User action: submit a betail into a filling session
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

-- 8) User action: place bid with dynamic increments + engaged budget checks + anti-sniping
create or replace function public.auction_place_bid_reborn(
  p_session_id uuid,
  p_slot_id uuid,
  p_step_multiplier integer default 1
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
  v_slot public.auction_slots_reborn%rowtype;
  v_profile public.users_profiles%rowtype;
  v_now timestamptz := now();
  v_current_best integer := 0;
  v_increment integer := 0;
  v_mult integer := greatest(1, coalesce(p_step_multiplier, 1));
  v_new_amount integer := 0;
  v_engaged_after integer := 0;
  v_remaining_money integer := 0;
  v_extend_seconds integer := 0;
  v_seconds_left integer := 0;
  v_bid_id bigint;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  if p_session_id is null or p_slot_id is null then
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

  if v_session.status <> 'open' then
    return json_build_object('success', false, 'reason', 'SESSION_NOT_OPEN');
  end if;

  if v_session.end_at is null or v_now >= v_session.end_at then
    return json_build_object('success', false, 'reason', 'SESSION_ENDED');
  end if;

  select * into v_slot
  from public.auction_slots_reborn s
  where s.id = p_slot_id
    and s.session_id = p_session_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'SLOT_NOT_FOUND');
  end if;

  if v_slot.status <> 'listed' then
    return json_build_object('success', false, 'reason', 'SLOT_NOT_ACTIVE');
  end if;

  if v_slot.seller_user_id = v_user_id then
    return json_build_object('success', false, 'reason', 'CANNOT_BID_OWN_BETAIL');
  end if;

  select * into v_profile
  from public.users_profiles up
  where up.id = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'PROFILE_NOT_FOUND');
  end if;

  if coalesce(v_profile.money, 0) < v_cfg.min_participant_money then
    return json_build_object('success', false, 'reason', 'INSUFFICIENT_MIN_MONEY', 'required', v_cfg.min_participant_money);
  end if;

  select coalesce(max(b.amount), 0)
  into v_current_best
  from public.auction_bids_reborn b
  where b.slot_id = v_slot.id;

  if v_current_best = 0 then
    v_new_amount := v_cfg.min_bid_start;
    v_increment := v_cfg.min_bid_start;
  else
    v_increment := public.get_auction_increment_reborn(v_current_best) * v_mult;
    v_new_amount := v_current_best + v_increment;
  end if;

  insert into public.auction_bids_reborn (
    session_id,
    slot_id,
    bidder_user_id,
    amount,
    increment_used,
    created_at
  ) values (
    v_session.id,
    v_slot.id,
    v_user_id,
    v_new_amount,
    greatest(1, v_increment),
    v_now
  )
  returning id into v_bid_id;

  v_engaged_after := public.get_auction_engaged_total_reborn(v_session.id, v_user_id);

  if v_engaged_after > coalesce(v_profile.money, 0) then
    raise exception 'INSUFFICIENT_FUNDS_FOR_ENGAGED_TOTAL';
  end if;

  v_seconds_left := greatest(0, floor(extract(epoch from (v_session.end_at - v_now)))::integer);

  if v_cfg.anti_snipe_window_seconds > 0
     and v_cfg.anti_snipe_extend_seconds > 0
     and v_seconds_left <= v_cfg.anti_snipe_window_seconds
     and v_session.anti_snipe_added_seconds < v_cfg.anti_snipe_extend_cap_seconds then

    v_extend_seconds := least(
      v_cfg.anti_snipe_extend_seconds,
      v_cfg.anti_snipe_extend_cap_seconds - v_session.anti_snipe_added_seconds
    );

    if v_extend_seconds > 0 then
      update public.auction_sessions_reborn
      set end_at = end_at + make_interval(secs => v_extend_seconds),
          anti_snipe_added_seconds = anti_snipe_added_seconds + v_extend_seconds,
          updated_at = v_now
      where id = v_session.id;
    end if;
  end if;

  v_remaining_money := greatest(0, coalesce(v_profile.money, 0) - v_engaged_after);

  return json_build_object(
    'success', true,
    'bid_id', v_bid_id,
    'session_id', v_session.id,
    'slot_id', v_slot.id,
    'amount', v_new_amount,
    'increment_used', greatest(1, v_increment),
    'engaged_total_after', v_engaged_after,
    'money_now', coalesce(v_profile.money, 0),
    'money_remaining_estimate', v_remaining_money,
    'anti_snipe_extend_seconds', v_extend_seconds,
    'end_at', (
      select s.end_at
      from public.auction_sessions_reborn s
      where s.id = v_session.id
    )
  );
exception
  when raise_exception then
    if sqlerrm = 'INSUFFICIENT_FUNDS_FOR_ENGAGED_TOTAL' then
      return json_build_object('success', false, 'reason', 'INSUFFICIENT_FUNDS_FOR_ENGAGED_TOTAL');
    end if;
    raise;
end;
$$;

-- 9) Close session atomically (service role / admin)
create or replace function public.auction_close_session_reborn(p_session_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_now timestamptz := now();
  v_session public.auction_sessions_reborn%rowtype;
  v_processed_slots integer := 0;
  v_sold_slots integer := 0;
  v_tie_slots integer := 0;
  v_unsold_slots integer := 0;
  v_invalid_winner_slots integer := 0;
begin
  if p_session_id is null then
    return json_build_object('success', false, 'reason', 'INVALID_INPUT');
  end if;

  if v_user_id is not null
     and v_jwt_role <> 'service_role'
     and not public.is_admin_user_reborn(v_user_id) then
    return json_build_object('success', false, 'reason', 'NOT_ALLOWED');
  end if;

  select * into v_session
  from public.auction_sessions_reborn s
  where s.id = p_session_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'SESSION_NOT_FOUND');
  end if;

  if v_session.status <> 'open' then
    return json_build_object('success', false, 'reason', 'SESSION_NOT_OPEN');
  end if;

  if v_session.end_at is null or v_now < v_session.end_at then
    return json_build_object('success', false, 'reason', 'SESSION_NOT_DUE');
  end if;

  create temporary table tmp_auction_candidates_reborn (
    slot_id uuid primary key,
    betail_id uuid not null,
    seller_user_id uuid not null,
    winner_user_id uuid null,
    top_amount integer null,
    top_count integer not null default 0,
    winner_valid boolean not null default false
  ) on commit drop;

  insert into tmp_auction_candidates_reborn (slot_id, betail_id, seller_user_id, winner_user_id, top_amount, top_count)
  with max_amount as (
    select b.slot_id, max(b.amount) as max_amount
    from public.auction_bids_reborn b
    where b.session_id = v_session.id
    group by b.slot_id
  ),
  top_rows as (
    select
      b.slot_id,
      b.bidder_user_id,
      b.amount,
      b.created_at,
      b.id,
      row_number() over (
        partition by b.slot_id
        order by b.amount desc, b.created_at asc, b.id asc
      ) as rn,
      count(*) over (partition by b.slot_id, b.amount) as amount_count
    from public.auction_bids_reborn b
    join max_amount m
      on m.slot_id = b.slot_id
     and m.max_amount = b.amount
    where b.session_id = v_session.id
  )
  select
    s.id,
    s.betail_id,
    s.seller_user_id,
    case when tr.amount_count = 1 then tr.bidder_user_id else null end as winner_user_id,
    m.max_amount,
    coalesce(tr.amount_count, 0) as top_count
  from public.auction_slots_reborn s
  left join max_amount m
    on m.slot_id = s.id
  left join top_rows tr
    on tr.slot_id = s.id
   and tr.rn = 1
  where s.session_id = v_session.id;

  -- Lock winners and sellers profiles used in settlement.
  perform 1
  from public.users_profiles up
  where up.id in (
    select distinct x.user_id
    from (
      select c.winner_user_id as user_id
      from tmp_auction_candidates_reborn c
      where c.winner_user_id is not null
      union all
      select c.seller_user_id as user_id
      from tmp_auction_candidates_reborn c
    ) x
  )
  for update;

  -- Validate each winner against total won amount and farm presence.
  with winner_totals as (
    select c.winner_user_id, sum(c.top_amount)::integer as total_due
    from tmp_auction_candidates_reborn c
    where c.winner_user_id is not null
      and c.top_count = 1
      and c.top_amount is not null
    group by c.winner_user_id
  )
  update tmp_auction_candidates_reborn c
  set winner_valid = true
  from winner_totals wt
  join public.users_profiles up
    on up.id = wt.winner_user_id
  where c.winner_user_id = wt.winner_user_id
    and c.top_count = 1
    and c.top_amount is not null
    and coalesce(up.money, 0) >= wt.total_due
    and up.farm_id is not null;

  -- Apply state to slots.
  update public.auction_slots_reborn s
  set status = case
        when c.top_amount is null then 'unsold'
        when c.top_count > 1 then 'cancelled_tie'
        when c.winner_valid then 'sold'
        else 'unsold'
      end,
      winner_user_id = case when c.winner_valid then c.winner_user_id else null end,
      winning_bid_amount = case when c.winner_valid then c.top_amount else null end,
      updated_at = v_now
  from tmp_auction_candidates_reborn c
  where s.id = c.slot_id
    and s.session_id = v_session.id;

  -- Debit valid winners (total across won slots).
  with winner_totals as (
    select c.winner_user_id, sum(c.top_amount)::integer as total_due
    from tmp_auction_candidates_reborn c
    where c.winner_valid
      and c.top_count = 1
      and c.top_amount is not null
    group by c.winner_user_id
  )
  update public.users_profiles up
  set money = coalesce(up.money, 0) - wt.total_due,
      updated_at = v_now
  from winner_totals wt
  where up.id = wt.winner_user_id;

  -- Credit sellers.
  with seller_totals as (
    select c.seller_user_id, sum(c.top_amount)::integer as total_gain
    from tmp_auction_candidates_reborn c
    where c.winner_valid
      and c.top_count = 1
      and c.top_amount is not null
    group by c.seller_user_id
  )
  update public.users_profiles up
  set money = coalesce(up.money, 0) + st.total_gain,
      updated_at = v_now
  from seller_totals st
  where up.id = st.seller_user_id;

  -- Transfer sold betails + unlock all slot betails.
  perform set_config('app.auction_bypass', '1', true);

  update public.betails b
  set owner_id = up.id,
      farm_id = up.farm_id,
      purchased_at = v_now,
      auction_locked = false,
      auction_session_id = null
  from tmp_auction_candidates_reborn c
  join public.users_profiles up
    on up.id = c.winner_user_id
  where b.id = c.betail_id
    and c.winner_valid
    and c.top_count = 1
    and c.top_amount is not null;

  update public.betails b
  set auction_locked = false,
      auction_session_id = null
  from tmp_auction_candidates_reborn c
  where b.id = c.betail_id
    and (
      c.top_amount is null
      or c.top_count > 1
      or not c.winner_valid
    );

  update public.auction_sessions_reborn s
  set status = 'closed',
      updated_at = v_now
  where s.id = v_session.id;

  select count(*)::integer into v_processed_slots
  from tmp_auction_candidates_reborn;

  select count(*)::integer into v_sold_slots
  from tmp_auction_candidates_reborn c
  where c.winner_valid
    and c.top_count = 1
    and c.top_amount is not null;

  select count(*)::integer into v_tie_slots
  from tmp_auction_candidates_reborn c
  where c.top_count > 1
    and c.top_amount is not null;

  select count(*)::integer into v_unsold_slots
  from tmp_auction_candidates_reborn c
  where c.top_amount is null;

  select count(*)::integer into v_invalid_winner_slots
  from tmp_auction_candidates_reborn c
  where c.top_amount is not null
    and c.top_count = 1
    and not c.winner_valid;

  return json_build_object(
    'success', true,
    'session_id', v_session.id,
    'processed_slots', v_processed_slots,
    'sold_slots', v_sold_slots,
    'tie_cancelled_slots', v_tie_slots,
    'no_bid_slots', v_unsold_slots,
    'invalid_winner_slots', v_invalid_winner_slots,
    'closed_at', v_now
  );
end;
$$;

-- 10) Public snapshot for the auction page
create or replace function public.get_active_auction_snapshot_reborn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.auction_sessions_reborn%rowtype;
  v_result jsonb;
begin
  select * into v_session
  from public.auction_sessions_reborn s
  where s.status in ('filling', 'ready_delay', 'open')
  order by s.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('success', true, 'session', null, 'slots', '[]'::jsonb);
  end if;

  with slot_data as (
    select
      s.id as slot_id,
      s.slot_index,
      s.status,
      s.betail_id,
      s.seller_user_id,
      b.name as betail_name,
      b.matricule,
      b.avatar_url as betail_avatar_url,
      b.premium,
      b.comments,
      up.username as seller_username,
      up.avatar_url as seller_avatar_url,
      (
        select jsonb_build_object(
          'amount', lb.amount,
          'bidder_user_id', lb.bidder_user_id,
          'bidder_username', up2.username,
          'bidder_avatar_url', up2.avatar_url,
          'created_at', lb.created_at
        )
        from public.auction_bids_reborn lb
        left join public.users_profiles up2 on up2.id = lb.bidder_user_id
        where lb.slot_id = s.id
        order by lb.amount desc, lb.created_at asc, lb.id asc
        limit 1
      ) as top_bid,
      (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'amount', hb.amount,
            'bidder_user_id', hb.bidder_user_id,
            'bidder_username', up3.username,
            'bidder_avatar_url', up3.avatar_url,
            'created_at', hb.created_at
          )
          order by hb.created_at desc
        ), '[]'::jsonb)
        from (
          select b2.*
          from public.auction_bids_reborn b2
          where b2.slot_id = s.id
          order by b2.created_at desc, b2.id desc
          limit 2
        ) hb
        left join public.users_profiles up3 on up3.id = hb.bidder_user_id
      ) as latest_two_bids
    from public.auction_slots_reborn s
    join public.betails b on b.id = s.betail_id
    left join public.users_profiles up on up.id = s.seller_user_id
    where s.session_id = v_session.id
    order by s.slot_index asc
  )
  select jsonb_build_object(
    'success', true,
    'session', jsonb_build_object(
      'id', v_session.id,
      'status', v_session.status,
      'slots_count', v_session.slots_count,
      'fill_deadline_at', v_session.fill_deadline_at,
      'open_at', v_session.open_at,
      'end_at', v_session.end_at,
      'anti_snipe_added_seconds', v_session.anti_snipe_added_seconds,
      'created_at', v_session.created_at
    ),
    'slots', coalesce((select jsonb_agg(to_jsonb(sd)) from slot_data sd), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- 11) Scheduler tick: expire, open, close, and probabilistically seed sessions
create or replace function public.auction_tick_reborn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.auction_config_reborn%rowtype;
  v_now timestamptz := now();
  v_week_start date := date_trunc('week', timezone('Europe/Paris', now()))::date;
  v_week_end date := (date_trunc('week', timezone('Europe/Paris', now()))::date + 7);
  v_today date := timezone('Europe/Paris', now())::date;
  v_created_this_week integer := 0;
  v_active_exists boolean := false;
  v_remaining_sessions integer := 0;
  v_remaining_days integer := 0;
  v_probability_per_tick numeric := 0;
  v_roll numeric := random();
  v_seeded_session_id uuid;
  v_expired_count integer := 0;
  v_opened_count integer := 0;
  v_closed_count integer := 0;
  v_due_session_id uuid;
  v_slots integer;
begin
  select * into v_cfg
  from public.auction_config_reborn
  where id = true
  for update;

  -- expire filling sessions that did not fill before deadline
  with stale as (
    select s.id
    from public.auction_sessions_reborn s
    where s.status = 'filling'
      and s.fill_deadline_at < v_now
      and (
        select count(*)
        from public.auction_slots_reborn sl
        where sl.session_id = s.id
      ) < s.slots_count
  )
  update public.auction_sessions_reborn s
  set status = 'expired',
      updated_at = v_now
  where s.id in (select id from stale);

  get diagnostics v_expired_count = row_count;

  perform set_config('app.auction_bypass', '1', true);

  update public.betails b
  set auction_locked = false,
      auction_session_id = null
  where coalesce(b.auction_locked, false)
    and b.auction_session_id in (
      select s.id
      from public.auction_sessions_reborn s
      where s.status = 'expired'
    );

  -- open ready_delay sessions
  update public.auction_sessions_reborn s
  set status = 'open',
      updated_at = v_now
  where s.status = 'ready_delay'
    and s.open_at is not null
    and s.open_at <= v_now;

  get diagnostics v_opened_count = row_count;

  -- close due open sessions
  for v_due_session_id in
    select s.id
    from public.auction_sessions_reborn s
    where s.status = 'open'
      and s.end_at is not null
      and s.end_at <= v_now
  loop
    perform public.auction_close_session_reborn(v_due_session_id);
    v_closed_count := v_closed_count + 1;
  end loop;

  -- probabilistic auto seed (requires no active session)
  if v_cfg.enabled then
    select exists (
      select 1
      from public.auction_sessions_reborn s
      where s.status in ('filling', 'ready_delay', 'open')
    ) into v_active_exists;

    if not v_active_exists and v_cfg.weekly_sessions_target > 0 then
      select count(*)::integer
      into v_created_this_week
      from public.auction_sessions_reborn s
      where (timezone('Europe/Paris', s.created_at))::date >= v_week_start
        and (timezone('Europe/Paris', s.created_at))::date < v_week_end
        and s.status <> 'cancelled';

      v_remaining_sessions := greatest(0, v_cfg.weekly_sessions_target - v_created_this_week);
      v_remaining_days := greatest(1, (v_week_end - v_today));

      if v_remaining_sessions > 0 then
        v_probability_per_tick := least(
          1,
          ((v_remaining_sessions::numeric / v_remaining_days::numeric) / greatest(1, 24 / v_cfg.auto_seed_tick_hours))
        );

        if v_roll <= v_probability_per_tick then
          v_slots := floor(random() * (v_cfg.slot_max - v_cfg.slot_min + 1))::integer + v_cfg.slot_min;

          insert into public.auction_sessions_reborn (
            status,
            slots_count,
            fill_deadline_at,
            launched_mode,
            created_by,
            created_at,
            updated_at
          ) values (
            'filling',
            v_slots,
            v_now + make_interval(hours => v_cfg.fill_timeout_hours),
            'auto',
            null,
            v_now,
            v_now
          )
          returning id into v_seeded_session_id;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'now', v_now,
    'expired_sessions', v_expired_count,
    'opened_sessions', v_opened_count,
    'closed_sessions', v_closed_count,
    'seeded_session_id', v_seeded_session_id,
    'probability_roll', v_roll,
    'weekly_sessions_target', v_cfg.weekly_sessions_target
  );
end;
$$;

-- 12) RLS + grants
alter table public.auction_config_reborn enable row level security;
alter table public.auction_sessions_reborn enable row level security;
alter table public.auction_slots_reborn enable row level security;
alter table public.auction_bids_reborn enable row level security;

grant select on public.auction_config_reborn to anon, authenticated;
grant update on public.auction_config_reborn to authenticated;
grant select on public.auction_sessions_reborn to anon, authenticated;
grant select on public.auction_slots_reborn to anon, authenticated;
grant select on public.auction_bids_reborn to anon, authenticated;

drop policy if exists auction_config_reborn_public_read on public.auction_config_reborn;
create policy auction_config_reborn_public_read
on public.auction_config_reborn
for select
to anon, authenticated
using (true);

drop policy if exists auction_config_reborn_admin_update on public.auction_config_reborn;
create policy auction_config_reborn_admin_update
on public.auction_config_reborn
for update
to authenticated
using (public.is_admin_user_reborn(auth.uid()))
with check (public.is_admin_user_reborn(auth.uid()));

drop policy if exists auction_sessions_reborn_public_read on public.auction_sessions_reborn;
create policy auction_sessions_reborn_public_read
on public.auction_sessions_reborn
for select
to anon, authenticated
using (true);

drop policy if exists auction_slots_reborn_public_read on public.auction_slots_reborn;
create policy auction_slots_reborn_public_read
on public.auction_slots_reborn
for select
to anon, authenticated
using (true);

drop policy if exists auction_bids_reborn_public_read on public.auction_bids_reborn;
create policy auction_bids_reborn_public_read
on public.auction_bids_reborn
for select
to anon, authenticated
using (true);

grant execute on function public.is_admin_user_reborn(uuid) to authenticated;
grant execute on function public.get_auction_increment_reborn(integer) to anon, authenticated;
grant execute on function public.get_auction_session_leaderboard_reborn(uuid) to anon, authenticated;
grant execute on function public.get_auction_engaged_total_reborn(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_launch_auction_session_reborn(integer, integer, integer) to authenticated;
grant execute on function public.admin_force_open_auction_session_reborn(uuid) to authenticated;
grant execute on function public.admin_force_close_auction_session_reborn(uuid) to authenticated;
grant execute on function public.auction_join_slot_reborn(uuid, uuid) to authenticated;
grant execute on function public.auction_place_bid_reborn(uuid, uuid, integer) to authenticated;
grant execute on function public.auction_close_session_reborn(uuid) to service_role, authenticated;
grant execute on function public.get_active_auction_snapshot_reborn() to anon, authenticated, service_role;
grant execute on function public.auction_tick_reborn() to service_role;

-- Optional scheduling examples:
-- select public.auction_tick_reborn();
-- Run every hour via pg_cron or Supabase Scheduled Function.
