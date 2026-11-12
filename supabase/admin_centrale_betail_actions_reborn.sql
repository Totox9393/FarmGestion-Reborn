-- Actions individuelles de la Centrale sur un betail.
-- A executer une fois avant de rendre les actions disponibles dans le frontend.

begin;

create or replace function public.admin_update_betail_comment_reborn(
  p_betail_id uuid,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_admin_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.users_profiles profile
    where profile.id = v_admin_id
      and (
        upper(btrim(coalesce(profile.role, ''))) = 'ADMIN'
        or upper(btrim(coalesce(profile.role_ingame, ''))) = 'ADMIN'
      )
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  update public.betails
  set comments = v_comment
  where id = p_betail_id;

  if not found then
    raise exception 'BETAIL_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object('success', true, 'betail_id', p_betail_id, 'comments', v_comment);
end;
$$;

create or replace function public.admin_release_betail_reborn(p_betail_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_shipping_deleted integer := 0;
  v_active_slots_deleted integer := 0;
begin
  if v_admin_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.users_profiles profile
    where profile.id = v_admin_id
      and (
        upper(btrim(coalesce(profile.role, ''))) = 'ADMIN'
        or upper(btrim(coalesce(profile.role_ingame, ''))) = 'ADMIN'
      )
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  perform 1 from public.betails where id = p_betail_id for update;
  if not found then
    raise exception 'BETAIL_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Une liberation annule toute expedition encore affichee au calendrier.
  if to_regclass('public.shipping') is not null then
    with removed as (
      delete from public.shipping where betail_id = p_betail_id returning id
    )
    select count(*)::integer into v_shipping_deleted from removed;
  end if;

  -- Annule uniquement le lot actif de ce betail. Les mises liees sont
  -- supprimees par la cle etrangere ON DELETE CASCADE.
  perform set_config('app.auction_bypass', '1', true);
  with removed as (
    delete from public.auction_slots_reborn slot
    using public.auction_sessions_reborn session
    where slot.session_id = session.id
      and slot.betail_id = p_betail_id
      and session.status in ('filling', 'ready_delay', 'open')
    returning slot.id
  )
  select count(*)::integer into v_active_slots_deleted from removed;

  update public.betails
  set owner_id = null,
      farm_id = null,
      farm_site = null,
      purchased_at = null,
      auction_locked = false,
      auction_session_id = null,
      visible = true,
      invisible_reason = null,
      invisible_at = null
  where id = p_betail_id;

  return jsonb_build_object(
    'success', true,
    'betail_id', p_betail_id,
    'shipping_deleted', v_shipping_deleted,
    'active_auction_slots_deleted', v_active_slots_deleted
  );
end;
$$;

create or replace function public.admin_set_betail_premium_reborn(
  p_betail_id uuid,
  p_premium boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_premium boolean := coalesce(p_premium, false);
begin
  if v_admin_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.users_profiles profile
    where profile.id = v_admin_id
      and (
        upper(btrim(coalesce(profile.role, ''))) = 'ADMIN'
        or upper(btrim(coalesce(profile.role_ingame, ''))) = 'ADMIN'
      )
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  update public.betails
  set premium = v_premium
  where id = p_betail_id;

  if not found then
    raise exception 'BETAIL_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'success', true,
    'betail_id', p_betail_id,
    'premium', v_premium
  );
end;
$$;

revoke all on function public.admin_update_betail_comment_reborn(uuid, text) from public, anon;
revoke all on function public.admin_release_betail_reborn(uuid) from public, anon;
revoke all on function public.admin_set_betail_premium_reborn(uuid, boolean) from public, anon;
grant execute on function public.admin_update_betail_comment_reborn(uuid, text) to authenticated;
grant execute on function public.admin_release_betail_reborn(uuid) to authenticated;
grant execute on function public.admin_set_betail_premium_reborn(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
