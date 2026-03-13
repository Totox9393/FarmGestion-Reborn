create or replace function public.grow_betail_age_reborn(
  p_betail_id uuid,
  p_dry_run boolean default false
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
  v_age integer := 0;
  v_badge_count integer := 0;
  v_cost integer := 0;
  v_money_after integer := 0;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  select *
  into v_betail
  from public.betails
  where id = p_betail_id
    and owner_id = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'NOT_FOUND');
  end if;

  v_age := greatest(0, coalesce(v_betail.age, 0));

  if v_age > 6 then
    return json_build_object(
      'success', false,
      'reason', 'AGE_ALREADY_ELIGIBLE',
      'current_age', v_age
    );
  end if;

  if jsonb_typeof(v_betail.equipped_badges) = 'array' then
    v_badge_count := least(12, greatest(0, jsonb_array_length(v_betail.equipped_badges)));
  else
    v_badge_count := 0;
  end if;

  v_cost := 125
         + (v_age * 34)
         + (v_age * v_age * 7)
         + (v_badge_count * 18)
         + (case when coalesce(v_betail.premium, false) then 85 else 0 end);

  v_cost := greatest(120, least(v_cost, 2500));

  select *
  into v_profile
  from public.users_profiles
  where id = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'PROFILE_NOT_FOUND');
  end if;

  if coalesce(v_profile.money, 0) < v_cost then
    return json_build_object(
      'success', false,
      'reason', 'INSUFFICIENT_FUNDS',
      'cost', v_cost,
      'money', coalesce(v_profile.money, 0),
      'current_age', v_age
    );
  end if;

  if p_dry_run then
    return json_build_object(
      'success', true,
      'preview', true,
      'cost', v_cost,
      'money', coalesce(v_profile.money, 0),
      'can_afford', coalesce(v_profile.money, 0) >= v_cost,
      'current_age', v_age,
      'next_age', v_age + 1,
      'betail_id', p_betail_id
    );
  end if;

  update public.users_profiles
  set money = coalesce(money, 0) - v_cost,
      updated_at = now()
  where id = v_user_id;

  update public.betails
  set age = v_age + 1
  where id = p_betail_id
    and owner_id = v_user_id;

  select coalesce(money, 0)
  into v_money_after
  from public.users_profiles
  where id = v_user_id;

  return json_build_object(
    'success', true,
    'cost', v_cost,
    'betail_id', p_betail_id,
    'old_age', v_age,
    'new_age', v_age + 1,
    'money_after', v_money_after
  );
end;
$$;

grant execute on function public.grow_betail_age_reborn(uuid, boolean) to authenticated;
