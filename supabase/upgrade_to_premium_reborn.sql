create or replace function public.upgrade_to_premium_reborn(
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
  v_premium_count integer := 0;
  v_cost integer := 0;
  v_age integer := 0;
  v_rarity integer := 0;
  v_digits text;
  v_money_after integer := 0;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  select * into v_betail
  from public.betails
  where id = p_betail_id
    and owner_id = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'NOT_FOUND');
  end if;

  if coalesce(v_betail.premium, false) then
    return json_build_object('success', false, 'reason', 'ALREADY_PREMIUM');
  end if;

  select * into v_profile
  from public.users_profiles
  where id = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'PROFILE_NOT_FOUND');
  end if;

  select count(*) into v_premium_count
  from public.betails
  where owner_id = v_user_id
    and coalesce(premium, false);

  v_age := coalesce(v_betail.age, 0);
  v_digits := regexp_replace(coalesce(v_betail.matricule, ''), '\\D', '', 'g');

  if v_digits is not null and v_digits <> '' then
    v_rarity := abs((v_digits)::bigint % 40);
  else
    v_rarity := abs(hashtext(coalesce(v_betail.matricule, ''))) % 40;
  end if;

  v_cost := 110
         + (v_age * 5)
         + (v_premium_count * 12)
         + v_rarity;

  v_cost := greatest(200, least(v_cost, 420));

  if coalesce(v_profile.money, 0) < v_cost then
    return json_build_object(
      'success', false,
      'reason', 'INSUFFICIENT_FUNDS',
      'cost', v_cost,
      'money', coalesce(v_profile.money, 0)
    );
  end if;

  if p_dry_run then
    return json_build_object(
      'success', true,
      'preview', true,
      'cost', v_cost,
      'money', coalesce(v_profile.money, 0),
      'betail_id', p_betail_id
    );
  end if;

  update public.betails
  set premium = true
  where id = p_betail_id
    and owner_id = v_user_id;

  update public.users_profiles
  set money = coalesce(money, 0) - v_cost,
      updated_at = now()
  where id = v_user_id;

  select coalesce(money, 0) into v_money_after
  from public.users_profiles
  where id = v_user_id;

  return json_build_object(
    'success', true,
    'cost', v_cost,
    'betail_id', p_betail_id,
    'money_after', v_money_after
  );
end;
$$;

grant execute on function public.upgrade_to_premium_reborn(uuid, boolean) to authenticated;
