create or replace function public.create_admin_betail_reborn(
  p_name text,
  p_age integer,
  p_avatar_url text,
  p_matricule text,
  p_premium boolean default false,
  p_comments text default null,
  p_visible boolean default true,
  p_invisible_reason text default null,
  p_invisible_at timestamp with time zone default null
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

grant execute on function public.create_admin_betail_reborn(text, integer, text, text, boolean, text, boolean, text, timestamp with time zone) to authenticated;
