create or replace function public.admin_set_betail_visibility_reborn(
  p_betail_id uuid,
  p_visible boolean,
  p_invisible_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.users_profiles%rowtype;
  v_roles text := '';
  v_deleted_inventory_count integer := 0;
  v_exists boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  select *
  into v_profile
  from public.users_profiles
  where id = v_user_id;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'PROFILE_NOT_FOUND');
  end if;

  v_roles := upper(trim(coalesce(v_profile.role, '') || ' ' || coalesce(v_profile.role_ingame, '')));
  if v_roles not like '%ADMIN%' and v_roles not like '%MODERATION%' then
    return jsonb_build_object('success', false, 'reason', 'NOT_ALLOWED');
  end if;

  if p_betail_id is null then
    return jsonb_build_object('success', false, 'reason', 'INVALID_BETAIL_ID');
  end if;

  select exists(select 1 from public.betails b where b.id = p_betail_id)
  into v_exists;

  if not v_exists then
    return jsonb_build_object('success', false, 'reason', 'NOT_FOUND');
  end if;

  if coalesce(p_visible, true) = false then
    with removed_equips as (
      delete from public.badges_equips_reborn e
      where e.betail_id = p_betail_id
      returning e.user_id, e.badge_id
    ),
    removed_inventory as (
      delete from public.badges_inventory_reborn i
      using removed_equips r
      where i.user_id = r.user_id
        and i.badge_id = r.badge_id
      returning i.id
    )
    select count(*)::integer
    into v_deleted_inventory_count
    from removed_inventory;
  end if;

  update public.betails
  set visible = coalesce(p_visible, true),
      invisible_at = case when coalesce(p_visible, true) then null else now() end,
      invisible_reason = case when coalesce(p_visible, true) then null else nullif(btrim(coalesce(p_invisible_reason, '')), '') end
  where id = p_betail_id;

  return jsonb_build_object(
    'success', true,
    'betail_id', p_betail_id,
    'visible', coalesce(p_visible, true),
    'removed_badges', v_deleted_inventory_count
  );
end;
$$;

create or replace function public.admin_delete_betail_reborn(
  p_betail_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.users_profiles%rowtype;
  v_roles text := '';
  v_deleted_inventory_count integer := 0;
  v_deleted_betail_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  select *
  into v_profile
  from public.users_profiles
  where id = v_user_id;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'PROFILE_NOT_FOUND');
  end if;

  v_roles := upper(trim(coalesce(v_profile.role, '') || ' ' || coalesce(v_profile.role_ingame, '')));
  if v_roles not like '%ADMIN%' then
    return jsonb_build_object('success', false, 'reason', 'NOT_ADMIN');
  end if;

  if p_betail_id is null then
    return jsonb_build_object('success', false, 'reason', 'INVALID_BETAIL_ID');
  end if;

  with removed_equips as (
    delete from public.badges_equips_reborn e
    where e.betail_id = p_betail_id
    returning e.user_id, e.badge_id
  ),
  removed_inventory as (
    delete from public.badges_inventory_reborn i
    using removed_equips r
    where i.user_id = r.user_id
      and i.badge_id = r.badge_id
    returning i.id
  )
  select count(*)::integer
  into v_deleted_inventory_count
  from removed_inventory;

  delete from public.betails b
  where b.id = p_betail_id
  returning b.id into v_deleted_betail_id;

  if v_deleted_betail_id is null then
    return jsonb_build_object('success', false, 'reason', 'NOT_FOUND');
  end if;

  return jsonb_build_object(
    'success', true,
    'betail_id', v_deleted_betail_id,
    'removed_badges', v_deleted_inventory_count
  );
end;
$$;

grant execute on function public.admin_set_betail_visibility_reborn(uuid, boolean, text) to authenticated;
grant execute on function public.admin_delete_betail_reborn(uuid) to authenticated;
