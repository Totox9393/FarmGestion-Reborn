create or replace function public.buy_farm_badge(
  p_filename text,
  p_category text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.users_profiles%rowtype;
  v_farm public.farms_list%rowtype;
  v_badges jsonb := '[]'::jsonb;
  v_base_price integer := 100;
  v_variance integer := 60;
  v_hash integer := 0;
  v_i integer := 0;
  v_cost integer := 0;
  v_money_after integer := 0;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  if p_filename is null or length(trim(p_filename)) = 0 then
    return json_build_object('success', false, 'reason', 'INVALID_FILENAME');
  end if;

  if p_category is null or length(trim(p_category)) = 0 then
    return json_build_object('success', false, 'reason', 'INVALID_CATEGORY');
  end if;

  if p_category = '1_common' then
    v_base_price := 120;
    v_variance := 80;
  elsif p_category = '2_rare' then
    v_base_price := 480;
    v_variance := 220;
  elsif p_category = '3_epic' then
    v_base_price := 1900;
    v_variance := 700;
  elsif p_category = '4_legendary' then
    v_base_price := 5200;
    v_variance := 1600;
  else
    return json_build_object('success', false, 'reason', 'INVALID_CATEGORY');
  end if;

  if right(lower(p_filename), 4) <> '.gif' then
    return json_build_object('success', false, 'reason', 'INVALID_FILENAME');
  end if;

  select *
  into v_profile
  from public.users_profiles
  where id = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'PROFILE_NOT_FOUND');
  end if;

  if v_profile.farm_id is null then
    return json_build_object('success', false, 'reason', 'NO_FARM');
  end if;

  select *
  into v_farm
  from public.farms_list
  where id = v_profile.farm_id
    and proprietaire = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'FARM_NOT_FOUND');
  end if;

  v_badges := coalesce(v_farm.equipped_badges, '[]'::jsonb);
  if jsonb_typeof(v_badges) <> 'array' then
    v_badges := '[]'::jsonb;
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(v_badges) as item(value)
    where item.value = p_filename
  ) then
    return json_build_object(
      'success', false,
      'reason', 'ALREADY_OWNED',
      'money', coalesce(v_profile.money, 0)
    );
  end if;

  for v_i in 1..length(p_category || ':' || p_filename) loop
    v_hash := ((v_hash * 31) + ascii(substr(p_category || ':' || p_filename, v_i, 1))) % 2147483647;
  end loop;

  if v_hash < 0 then
    v_hash := -v_hash;
  end if;

  v_cost := v_base_price + (v_hash % greatest(1, v_variance));

  if coalesce(v_profile.money, 0) < v_cost then
    return json_build_object(
      'success', false,
      'reason', 'INSUFFICIENT_FUNDS',
      'cost', v_cost,
      'money', coalesce(v_profile.money, 0)
    );
  end if;

  update public.users_profiles
  set money = coalesce(money, 0) - v_cost,
      updated_at = now()
  where id = v_user_id;

  update public.farms_list
  set equipped_badges = v_badges || jsonb_build_array(p_filename)
  where id = v_profile.farm_id
    and proprietaire = v_user_id;

  select coalesce(money, 0)
  into v_money_after
  from public.users_profiles
  where id = v_user_id;

  return json_build_object(
    'success', true,
    'filename', p_filename,
    'category', p_category,
    'cost', v_cost,
    'money_after', v_money_after
  );
end;
$$;

grant execute on function public.buy_farm_badge(text, text) to authenticated;
