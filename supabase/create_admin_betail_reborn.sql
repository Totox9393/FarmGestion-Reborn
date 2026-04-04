alter table public.betails
  add column if not exists admin_reward_badge_ids jsonb not null default '[]'::jsonb;

update public.betails
set admin_reward_badge_ids = '[]'::jsonb
where admin_reward_badge_ids is null;

alter table public.betails
  drop constraint if exists betails_admin_reward_badge_ids_is_array;

alter table public.betails
  add constraint betails_admin_reward_badge_ids_is_array
  check (jsonb_typeof(admin_reward_badge_ids) = 'array');

create or replace function public.create_admin_betail_reborn(
  p_name text,
  p_age integer,
  p_avatar_url text,
  p_matricule text,
  p_premium boolean default false,
  p_comments text default null,
  p_visible boolean default true,
  p_invisible_reason text default null,
  p_invisible_at timestamp with time zone default null,
  p_reward_badge_ids jsonb default '[]'::jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.users_profiles%rowtype;
  v_normalized_roles text := '';
  v_betail_id uuid;
  v_matricule text := btrim(coalesce(p_matricule, ''));
  v_digits text := regexp_replace(coalesce(p_matricule, ''), '\D', '', 'g');
  v_reward_badge_ids jsonb := coalesce(p_reward_badge_ids, '[]'::jsonb);
  v_reward_badge_id_array uuid[] := array[]::uuid[];
  v_reward_badge_text text;
  v_reward_badge_uuid uuid;
  v_reward_badge_count integer := 0;
  v_reward_catalog_count integer := 0;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  select *
  into v_profile
  from public.users_profiles
  where id = v_user_id;

  if not found then
    return json_build_object('success', false, 'reason', 'PROFILE_NOT_FOUND');
  end if;

  v_normalized_roles := upper(trim(coalesce(v_profile.role, '') || ' ' || coalesce(v_profile.role_ingame, '')));

  if v_normalized_roles not like '%ADMIN%' then
    return json_build_object('success', false, 'reason', 'NOT_ADMIN');
  end if;

  if p_name is null or btrim(p_name) = '' then
    return json_build_object('success', false, 'reason', 'INVALID_NAME');
  end if;

  if p_avatar_url is null or btrim(p_avatar_url) = '' then
    return json_build_object('success', false, 'reason', 'INVALID_AVATAR_URL');
  end if;

  if p_age is null or p_age < 1 then
    return json_build_object('success', false, 'reason', 'INVALID_AGE');
  end if;

  if v_matricule = '' then
    return json_build_object('success', false, 'reason', 'INVALID_MATRICULE');
  end if;

  if char_length(v_digits) <> 5 or v_digits <> v_matricule then
    return json_build_object('success', false, 'reason', 'INVALID_MATRICULE_FORMAT');
  end if;

  if jsonb_typeof(v_reward_badge_ids) <> 'array' then
    return json_build_object('success', false, 'reason', 'INVALID_REWARD_BADGES');
  end if;

  for v_reward_badge_text in
    select jsonb_array_elements_text(v_reward_badge_ids)
  loop
    begin
      v_reward_badge_uuid := v_reward_badge_text::uuid;
    exception
      when invalid_text_representation then
        return json_build_object('success', false, 'reason', 'INVALID_REWARD_BADGES');
    end;

    if not (v_reward_badge_uuid = any(v_reward_badge_id_array)) then
      v_reward_badge_id_array := array_append(v_reward_badge_id_array, v_reward_badge_uuid);
    end if;
  end loop;

  v_reward_badge_count := coalesce(array_length(v_reward_badge_id_array, 1), 0);
  if v_reward_badge_count > 3 then
    return json_build_object('success', false, 'reason', 'TOO_MANY_REWARD_BADGES');
  end if;

  if v_reward_badge_count > 0 then
    select count(*)::integer
    into v_reward_catalog_count
    from public.badges_catalog_reborn c
    where c.id = any(v_reward_badge_id_array)
      and coalesce(c.is_active, true) = true;

    if v_reward_catalog_count <> v_reward_badge_count then
      return json_build_object('success', false, 'reason', 'INVALID_REWARD_BADGES');
    end if;
  end if;

  insert into public.betails (
    name,
    age,
    avatar_url,
    matricule,
    premium,
    comments,
    visible,
    invisible_at,
    invisible_reason,
    admin_reward_badge_ids,
    author_id,
    created_at
  )
  values (
    btrim(p_name),
    p_age,
    btrim(p_avatar_url),
    v_matricule,
    coalesce(p_premium, false),
    nullif(btrim(coalesce(p_comments, '')), ''),
    coalesce(p_visible, true),
    case when coalesce(p_visible, true) then null else p_invisible_at end,
    case when coalesce(p_visible, true) then null else nullif(btrim(coalesce(p_invisible_reason, '')), '') end,
    to_jsonb(v_reward_badge_id_array),
    v_user_id,
    now()
  )
  returning id
  into v_betail_id;

  return json_build_object(
    'success', true,
    'betail_id', v_betail_id
  );
exception
  when unique_violation then
    return json_build_object('success', false, 'reason', 'DUPLICATE_MATRICULE');
end;
$$;

grant execute on function public.create_admin_betail_reborn(text, integer, text, text, boolean, text, boolean, text, timestamp with time zone, jsonb) to authenticated;
