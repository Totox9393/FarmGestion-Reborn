alter table public.shipping
  add column if not exists scheduled_by_uuid uuid;

alter table public.shipping
  add column if not exists estimated_gain integer not null default 0;

create or replace function public.schedule_shipping_reborn(
  p_betail_id uuid,
  p_requested_date text default null,
  p_manual_choice boolean default false,
  p_notes text default null,
  p_estimated_gain integer default null,
  p_dry_run boolean default true,
  p_min_days_ahead integer default 7,
  p_max_days_ahead integer default 60,
  p_allow_reassign boolean default false
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_betail public.betails%rowtype;
  v_profile public.users_profiles%rowtype;
  v_existing_shipping public.shipping%rowtype;

  v_role text := '';
  v_has_manual_privilege boolean := false;
  v_manual_effective boolean := false;

  v_today date := (now() at time zone 'UTC')::date;
  v_min_days integer := greatest(1, coalesce(p_min_days_ahead, 7));
  v_max_days integer := greatest(greatest(1, coalesce(p_min_days_ahead, 7)), coalesce(p_max_days_ahead, 60));
  v_min_date date;
  v_max_date date;

  v_requested_date date := null;
  v_selected_date date := null;
  v_cursor_date date := null;

  v_day_limit integer := 1;
  v_day_count integer := 0;
  v_day_count_after integer := 0;
  v_reassigned boolean := false;
  v_effective_notes text := null;
  v_estimated_gain integer := 0;
  v_base_gain integer := 250;
  v_status_impact integer := 45;
  v_months_since_creation integer := 0;
  v_seniority_bonus integer := 0;
  v_badge_bonus integer := 0;
  v_normalized_age integer := 9;
  v_age_delta integer := 0;
  v_age_impact integer := 0;
  v_candidate_dates date[] := array[]::date[];
  v_candidate_count integer := 0;
  v_random_index integer := 0;

  v_selected_ts timestamptz := null;
  v_blocked_mm_dd text[] := array['01-01', '01-03', '02-27', '06-26', '12-25'];
  v_is_blocked boolean := false;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  if p_betail_id is null then
    return json_build_object('success', false, 'reason', 'NOT_FOUND');
  end if;

  v_min_date := v_today + v_min_days;
  v_max_date := v_today + v_max_days;

  select *
  into v_betail
  from public.betails
  where id = p_betail_id
    and coalesce(visible, true) = true
    and owner_id = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'NOT_FOUND');
  end if;

  if greatest(0, coalesce(v_betail.age, 0)) <= 6 then
    return json_build_object(
      'success', false,
      'reason', 'AGE_NOT_ELIGIBLE',
      'current_age', greatest(0, coalesce(v_betail.age, 0))
    );
  end if;

  select *
  into v_profile
  from public.users_profiles
  where id = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'PROFILE_NOT_FOUND');
  end if;

  v_role := upper(trim(concat_ws(' ', coalesce(v_profile.role, ''), coalesce(v_profile.role_ingame, ''))));
  v_has_manual_privilege := (
    v_role like '%VIP%'
    or v_role like '%MODERATION%'
    or v_role like '%ADMIN%'
  );
  v_manual_effective := (coalesce(p_manual_choice, false) and v_has_manual_privilege);

  if coalesce(p_manual_choice, false) and not v_has_manual_privilege then
    return json_build_object('success', false, 'reason', 'VIP_MANUAL_ONLY');
  end if;

  -- NOTE: p_estimated_gain is intentionally ignored.
  -- Shipping gain is always computed server-side from the betail + equipped badges.
  v_status_impact := case
    when coalesce(v_betail.premium, false) then 390
    else 45
  end;

  v_months_since_creation := greatest(
    0,
    (
      extract(year from age(
        (now() at time zone 'UTC')::date,
        coalesce(v_betail.created_at, now())::date
      ))::integer * 12
    )
    + extract(
      month from age(
        (now() at time zone 'UTC')::date,
        coalesce(v_betail.created_at, now())::date
      )
    )::integer
  );
  v_seniority_bonus := v_months_since_creation * 6;

  select floor(coalesce(sum(greatest(0, i.purchase_price)), 0) * 0.75)::integer
  into v_badge_bonus
  from public.badges_equips_reborn e
  join public.badges_inventory_reborn i
    on i.user_id = e.user_id
   and i.badge_id = e.badge_id
  where e.betail_id = p_betail_id
    and e.user_id = v_user_id;

  v_normalized_age := coalesce(v_betail.age, 9);
  v_age_delta := v_normalized_age - 8;
  v_age_impact := case
    when v_age_delta >= 0 then round(v_age_delta * 28.0)::integer
    else -round(abs(v_age_delta) * 22.0)::integer
  end;

  v_estimated_gain := greatest(
    0,
    v_base_gain
    + v_status_impact
    + v_seniority_bonus
    + coalesce(v_badge_bonus, 0)
    + v_age_impact
  );

  if p_requested_date is not null and btrim(p_requested_date) <> '' then
    begin
      v_requested_date := p_requested_date::date;
    exception
      when others then
        return json_build_object('success', false, 'reason', 'DATE_INVALID');
    end;
  end if;

  if v_requested_date is not null then
    if v_requested_date < v_min_date or v_requested_date > v_max_date then
      return json_build_object(
        'success', false,
        'reason', 'DATE_OUT_OF_RANGE',
        'min_date', v_min_date,
        'max_date', v_max_date
      );
    end if;

    if to_char(v_requested_date, 'MM-DD') = any(v_blocked_mm_dd) then
      return json_build_object(
        'success', false,
        'reason', 'DATE_BLOCKED',
        'requested_date', v_requested_date
      );
    end if;
  end if;

  v_day_limit := case when v_manual_effective then 2 else 1 end;

  perform pg_advisory_xact_lock(41288, 70061);

  select *
  into v_existing_shipping
  from public.shipping
  where betail_id = p_betail_id
  for update;

  if found and coalesce(v_existing_shipping.status, '') = 'delivered' then
    return json_build_object('success', false, 'reason', 'ALREADY_DELIVERED');
  end if;

  if found and coalesce(v_existing_shipping.status, '') = 'scheduled' then
    v_selected_ts := v_existing_shipping.scheduled_for;
    v_selected_date := (v_existing_shipping.scheduled_for at time zone 'UTC')::date;

    select count(*)::integer
    into v_day_count
    from public.shipping s
    where s.status = 'scheduled'
      and (s.scheduled_for at time zone 'UTC')::date = v_selected_date
      and s.betail_id <> p_betail_id;

    if coalesce(p_dry_run, true) then
      return json_build_object(
        'success', true,
        'preview', true,
        'betail_id', p_betail_id,
        'selected_date', v_selected_date,
        'suggested_date', v_selected_date,
        'requested_date', v_requested_date,
        'min_date', v_min_date,
        'max_date', v_max_date,
        'day_count', v_day_count,
        'day_limit', v_day_limit,
        'reassigned', false,
        'already_scheduled', true,
        'locked_date', true,
        'manual_choice', v_manual_effective,
        'estimated_gain', coalesce(v_existing_shipping.estimated_gain, v_estimated_gain, 0),
        'scheduled_for', v_selected_ts,
        'notes', coalesce(v_existing_shipping.notes, ''),
        'message', 'Date déjà fixée pour ce bétail.'
      );
    end if;

    v_effective_notes := nullif(btrim(coalesce(p_notes, '')), '');

    update public.shipping
    set status = 'scheduled',
        notes = coalesce(v_effective_notes, notes),
        estimated_gain = v_estimated_gain,
        scheduled_by_uuid = coalesce(scheduled_by_uuid, v_user_id),
        updated_at = now()
    where id = v_existing_shipping.id;

    return json_build_object(
      'success', true,
      'preview', false,
      'betail_id', p_betail_id,
      'selected_date', v_selected_date,
      'suggested_date', v_selected_date,
      'requested_date', v_requested_date,
      'min_date', v_min_date,
      'max_date', v_max_date,
      'day_count', v_day_count,
      'day_count_after', v_day_count + 1,
      'day_limit', v_day_limit,
      'reassigned', false,
      'already_scheduled', true,
      'locked_date', true,
      'manual_choice', v_manual_effective,
      'estimated_gain', v_estimated_gain,
      'scheduled_for', v_selected_ts,
      'notes', coalesce(v_effective_notes, v_existing_shipping.notes, ''),
      'message', 'Date conservée: ce bétail garde son créneau déjà validé.'
    );
  end if;

  v_cursor_date := v_min_date;
  while v_cursor_date <= v_max_date loop
    v_is_blocked := to_char(v_cursor_date, 'MM-DD') = any(v_blocked_mm_dd);
    if not v_is_blocked then
      select count(*)::integer
      into v_day_count
      from public.shipping s
      where s.status = 'scheduled'
        and (s.scheduled_for at time zone 'UTC')::date = v_cursor_date
        and s.betail_id <> p_betail_id;

      if v_day_count < v_day_limit then
        v_candidate_dates := array_append(v_candidate_dates, v_cursor_date);
      end if;
    end if;
    v_cursor_date := v_cursor_date + 1;
  end loop;

  v_candidate_count := coalesce(array_length(v_candidate_dates, 1), 0);
  if v_candidate_count = 0 then
    return json_build_object(
      'success', false,
      'reason', 'NO_SLOT_AVAILABLE',
      'min_date', v_min_date,
      'max_date', v_max_date,
      'manual_choice', v_manual_effective
    );
  end if;

  if v_requested_date is not null then
    select count(*)::integer
    into v_day_count
    from public.shipping s
    where s.status = 'scheduled'
      and (s.scheduled_for at time zone 'UTC')::date = v_requested_date
      and s.betail_id <> p_betail_id;

    if v_day_count < v_day_limit then
      v_selected_date := v_requested_date;
    elsif not coalesce(p_allow_reassign, false) then
      return json_build_object(
        'success', false,
        'reason', 'DAY_FULL',
        'requested_date', v_requested_date,
        'day_count', v_day_count,
        'day_limit', v_day_limit,
        'manual_choice', v_manual_effective
      );
    else
      v_reassigned := true;
    end if;
  else
    v_reassigned := false;
  end if;

  if v_selected_date is null then
    if v_requested_date is not null then
      v_candidate_dates := array_remove(v_candidate_dates, v_requested_date);
      v_candidate_count := coalesce(array_length(v_candidate_dates, 1), 0);
      if v_candidate_count = 0 then
        return json_build_object(
          'success', false,
          'reason', 'NO_SLOT_AVAILABLE',
          'min_date', v_min_date,
          'max_date', v_max_date,
          'manual_choice', v_manual_effective
        );
      end if;
    end if;

    v_candidate_count := coalesce(array_length(v_candidate_dates, 1), 0);
    v_random_index := floor(random() * v_candidate_count)::integer + 1;
    v_selected_date := v_candidate_dates[v_random_index];
  end if;

  select count(*)::integer
  into v_day_count
  from public.shipping s
  where s.status = 'scheduled'
    and (s.scheduled_for at time zone 'UTC')::date = v_selected_date
    and s.betail_id <> p_betail_id;

  if coalesce(p_dry_run, true) then
    return json_build_object(
      'success', true,
      'preview', true,
      'betail_id', p_betail_id,
      'selected_date', v_selected_date,
      'suggested_date', v_selected_date,
      'requested_date', v_requested_date,
      'min_date', v_min_date,
      'max_date', v_max_date,
      'day_count', v_day_count,
      'day_limit', v_day_limit,
      'reassigned', v_reassigned,
      'already_scheduled', false,
      'locked_date', false,
      'manual_choice', v_manual_effective,
      'estimated_gain', v_estimated_gain
    );
  end if;

  v_selected_ts := (v_selected_date::timestamp + interval '12 hours') at time zone 'UTC';
  v_effective_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if v_effective_notes is null then
    v_effective_notes := case when v_manual_effective then 'manual_vip' else 'auto' end;
  end if;

  insert into public.shipping (betail_id, scheduled_for, status, notes, estimated_gain, scheduled_by_uuid)
  values (
    p_betail_id,
    v_selected_ts,
    'scheduled',
    nullif(v_effective_notes, ''),
    v_estimated_gain,
    v_user_id
  )
  on conflict (betail_id)
  do update
  set scheduled_for = excluded.scheduled_for,
      status = 'scheduled',
      notes = coalesce(excluded.notes, public.shipping.notes),
      estimated_gain = excluded.estimated_gain,
      scheduled_by_uuid = excluded.scheduled_by_uuid,
      updated_at = now();

  select count(*)::integer
  into v_day_count_after
  from public.shipping s
  where s.status = 'scheduled'
    and (s.scheduled_for at time zone 'UTC')::date = v_selected_date;

  return json_build_object(
    'success', true,
    'preview', false,
    'betail_id', p_betail_id,
    'selected_date', v_selected_date,
    'suggested_date', v_selected_date,
    'requested_date', v_requested_date,
    'min_date', v_min_date,
    'max_date', v_max_date,
    'day_count', v_day_count,
    'day_count_after', v_day_count_after,
    'day_limit', v_day_limit,
    'reassigned', v_reassigned,
    'already_scheduled', false,
    'locked_date', false,
    'manual_choice', v_manual_effective,
    'estimated_gain', v_estimated_gain,
    'scheduled_for', v_selected_ts,
    'notes', coalesce(v_effective_notes, ''),
    'message', case
      when v_reassigned then 'Créneau ajusté automatiquement puis enregistré.'
      else 'Créneau enregistré.'
    end
  );
end;
$$;

grant execute on function public.schedule_shipping_reborn(uuid, text, boolean, text, integer, boolean, integer, integer, boolean) to authenticated;
