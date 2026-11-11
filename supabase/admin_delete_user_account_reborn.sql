-- Suppression definitive d'un compte depuis la Centrale.
-- Une seule transaction PostgreSQL : en cas d'erreur, aucune suppression n'est conservee.

begin;

-- Les historiques restent lisibles, mais sans identite utilisateur.
alter table public.betails
  alter column author_id drop not null;
alter table public.betails
  drop constraint if exists betails_author_id_fkey;
alter table public.betails
  add constraint betails_author_id_fkey
  foreign key (author_id) references auth.users(id) on delete set null;

alter table public.betails_reports
  alter column reporter_id drop not null;
alter table public.betails_reports
  drop constraint if exists betails_reports_reporter_id_fkey;
alter table public.betails_reports
  add constraint betails_reports_reporter_id_fkey
  foreign key (reporter_id) references public.users_profiles(id) on delete set null;

alter table public.auction_slots_reborn
  alter column seller_user_id drop not null;
alter table public.auction_slots_reborn
  drop constraint if exists auction_slots_reborn_seller_user_id_fkey;
alter table public.auction_slots_reborn
  add constraint auction_slots_reborn_seller_user_id_fkey
  foreign key (seller_user_id) references public.users_profiles(id) on delete set null;

alter table public.auction_bids_reborn
  alter column bidder_user_id drop not null;
alter table public.auction_bids_reborn
  drop constraint if exists auction_bids_reborn_bidder_user_id_fkey;
alter table public.auction_bids_reborn
  add constraint auction_bids_reborn_bidder_user_id_fkey
  foreign key (bidder_user_id) references public.users_profiles(id) on delete set null;

-- Un badge porte par un betail peut survivre temporairement sans proprietaire.
alter table public.badges_equips_reborn
  drop constraint if exists badges_equips_reborn_inventory_fk;
alter table public.badges_equips_reborn
  drop constraint if exists badges_equips_reborn_user_id_fkey;
alter table public.badges_equips_reborn
  alter column user_id drop not null;
alter table public.badges_equips_reborn
  add constraint badges_equips_reborn_user_id_fkey
  foreign key (user_id) references public.users_profiles(id) on delete set null;
alter table public.badges_equips_reborn
  add constraint badges_equips_reborn_inventory_fk
  foreign key (user_id, badge_id)
  references public.badges_inventory_reborn(user_id, badge_id)
  on delete cascade;

create or replace function public.admin_delete_user_account_reborn(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin_id uuid := auth.uid();
  v_username text;
  v_avatar_url text;
  v_farms_deleted integer := 0;
  v_betails_released integer := 0;
  v_shipping_deleted integer := 0;
  v_likes_deleted integer := 0;
  v_inventory_deleted integer := 0;
  v_badges_kept_on_betails integer := 0;
  v_active_bids_deleted integer := 0;
  v_active_slots_deleted integer := 0;
  v_preserved_badge_ids uuid[] := array[]::uuid[];
begin
  if v_admin_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.users_profiles admin_profile
    where admin_profile.id = v_admin_id
      and (
        upper(btrim(coalesce(admin_profile.role, ''))) = 'ADMIN'
        or upper(btrim(coalesce(admin_profile.role_ingame, ''))) = 'ADMIN'
      )
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'INVALID_USER_ID' using errcode = '22023';
  end if;

  if p_user_id = v_admin_id then
    raise exception 'SELF_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  select up.username, up.avatar_url
  into v_username, v_avatar_url
  from public.users_profiles up
  where up.id = p_user_id
  for update;

  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Les betails verrouilles doivent pouvoir etre liberes dans cette transaction.
  perform set_config('app.auction_bypass', '1', true);

  -- Toute expedition liee au compte disparait du calendrier.
  with removed as (
    delete from public.shipping s
    where s.scheduled_by_uuid = p_user_id
       or exists (
         select 1 from public.betails b
         where b.id = s.betail_id and b.owner_id = p_user_id
       )
    returning s.id
  )
  select count(*)::integer into v_shipping_deleted from removed;

  -- Les mises encore actives sont retirees. Les mises terminees seront anonymisees.
  with removed as (
    delete from public.auction_bids_reborn bid
    using public.auction_sessions_reborn session
    where bid.session_id = session.id
      and bid.bidder_user_id = p_user_id
      and session.status in ('filling', 'ready_delay', 'open')
    returning bid.id
  )
  select count(*)::integer into v_active_bids_deleted from removed;

  -- Retire uniquement les lots actifs de ce vendeur, sans annuler les autres lots.
  update public.betails b
  set auction_locked = false,
      auction_session_id = null
  where b.owner_id = p_user_id
    and (
      coalesce(b.auction_locked, false)
      or b.auction_session_id is not null
    );

  with removed as (
    delete from public.auction_slots_reborn slot
    using public.auction_sessions_reborn session
    where slot.session_id = session.id
      and slot.seller_user_id = p_user_id
      and session.status in ('filling', 'ready_delay', 'open')
    returning slot.id
  )
  select count(*)::integer into v_active_slots_deleted from removed;

  -- Memoriser les badges qui restent physiquement sur un betail.
  select coalesce(array_agg(distinct equip.badge_id), array[]::uuid[])
  into v_preserved_badge_ids
  from public.badges_equips_reborn equip
  where equip.user_id = p_user_id
    and equip.betail_id is not null;

  -- Les badges portes par un betail restent sur celui-ci sans proprietaire.
  update public.badges_equips_reborn equip
  set user_id = null
  where equip.user_id = p_user_id
    and equip.betail_id is not null;
  get diagnostics v_badges_kept_on_betails = row_count;

  -- Les badges de ferme et les autres equipements ne survivent pas au compte.
  delete from public.badges_equips_reborn equip
  where equip.user_id = p_user_id;

  -- Seuls les badges boutique qui ne restent pas sur un betail retournent en stock.
  with returned as (
    select inventory.badge_id, count(*)::integer as quantity
    from public.badges_inventory_reborn inventory
    where inventory.user_id = p_user_id
      and inventory.source = 'shop'
      and not (inventory.badge_id = any(v_preserved_badge_ids))
    group by inventory.badge_id
  )
  update public.badges_catalog_reborn catalog
  set sold_count = greatest(0, coalesce(catalog.sold_count, 0) - returned.quantity),
      updated_at = now()
  from returned
  where catalog.id = returned.badge_id;

  with removed as (
    delete from public.badges_inventory_reborn inventory
    where inventory.user_id = p_user_id
    returning inventory.id
  )
  select count(*)::integer into v_inventory_deleted from removed;

  -- Supprimer les interactions personnelles fait aussi diminuer like_count via le trigger existant.
  with removed as (
    delete from public.betail_likes likes
    where likes.user_id = p_user_id
    returning likes.id
  )
  select count(*)::integer into v_likes_deleted from removed;

  delete from public.user_relations relation
  where relation.user_a = p_user_id
     or relation.user_b = p_user_id
     or relation.initiator = p_user_id;

  -- Ancienne table encore presente dans cette base.
  delete from public.friendships friendship
  where friendship.user_a = p_user_id
     or friendship.user_b = p_user_id
     or friendship.initiator = p_user_id;

  delete from public.user_settings setting where setting.user_id = p_user_id;

  -- Rompre la reference circulaire profil/ferme avant de supprimer les fermes.
  update public.users_profiles
  set farm_id = null
  where id = p_user_id;

  -- Retour integral au registre public, en conservant les attributs et badges du betail.
  update public.betails b
  set owner_id = null,
      farm_id = null,
      farm_site = null,
      purchased_at = null,
      auction_locked = false,
      auction_session_id = null,
      visible = true,
      invisible_reason = null,
      invisible_at = null
  where b.owner_id = p_user_id;
  get diagnostics v_betails_released = row_count;

  with removed as (
    delete from public.farms_list farm
    where farm.proprietaire = p_user_id
    returning farm.id
  )
  select count(*)::integer into v_farms_deleted from removed;

  -- Les contraintes SET NULL anonymisent ici rapports et historiques d'encheres.
  delete from public.users_profiles where id = p_user_id;

  -- Cascade les donnees Auth, anciennes tables et redemptions encore rattachees a auth.users.
  delete from auth.users where id = p_user_id;

  if not found then
    raise exception 'AUTH_USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'username', v_username,
    'avatar_url', v_avatar_url,
    'farms_deleted', v_farms_deleted,
    'betails_released', v_betails_released,
    'shipping_deleted', v_shipping_deleted,
    'likes_deleted', v_likes_deleted,
    'inventory_deleted', v_inventory_deleted,
    'badges_kept_on_betails', v_badges_kept_on_betails,
    'active_bids_deleted', v_active_bids_deleted,
    'active_slots_deleted', v_active_slots_deleted
  );
end;
$$;

revoke all on function public.admin_delete_user_account_reborn(uuid) from public, anon;
grant execute on function public.admin_delete_user_account_reborn(uuid) to authenticated;

-- La prochaine acquisition reprend les badges orphelins du betail et accepte un auteur supprime.
-- Purchase function with daily limit (Europe/Paris)
create or replace function public.purchase_betail_reborn(p_betail_id uuid)
returns table(betail_id uuid, farm_id bigint, owner_id uuid, farm_site text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_farm_id bigint;
  v_today date;
  v_count int;
  v_farm_population int;
  v_betail_id uuid;
  v_owner_id uuid;
  v_farm_site text;
  v_reward_badges jsonb := '[]'::jsonb;
  v_reward_badge_text text;
  v_reward_badge_id uuid;
  v_inventory_insert_id uuid;
  v_free_slot integer;
  v_orphan_equip record;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select up.farm_id into v_farm_id
  from public.users_profiles as up
  where up.id = v_user_id;

  if v_farm_id is null then
    raise exception 'no_farm';
  end if;

  -- Serialize purchases per farm to keep capacity checks consistent under concurrency.
  perform pg_advisory_xact_lock(v_farm_id);

  v_today := (timezone('Europe/Paris', now()))::date;

  select count(*) into v_count
  from public.betails as b
  where b.owner_id = v_user_id
    and b.purchased_at is not null
    and (timezone('Europe/Paris', b.purchased_at))::date = v_today;

  if v_count >= 10 then
    raise exception 'daily_limit_reached';
  end if;

  select count(*) into v_farm_population
  from public.betails as b
  where b.farm_id = v_farm_id;

  if v_farm_population >= 180 then
    raise exception 'farm_capacity_reached';
  end if;

  select candidate.site
  into v_farm_site
  from (
    select gs.site
    from generate_series(1, 6) as gs(site)
    left join public.betails as b
      on b.farm_id = v_farm_id
     and b.farm_site = gs.site::text
    group by gs.site
    having count(b.id) < 30
    order by random()
    limit 1
  ) as candidate;

  if v_farm_site is null then
    raise exception 'farm_sites_full';
  end if;

  if exists (
    select 1
    from public.betails as b
    where b.id = p_betail_id
      and coalesce(b.visible, true) = false
  ) then
    raise exception 'betail_invisible';
  end if;

  update public.betails as b
  set farm_id = v_farm_id,
      owner_id = v_user_id,
      farm_site = v_farm_site,
      purchased_at = now()
  where b.id = p_betail_id
    and coalesce(b.visible, true) = true
    and b.owner_id is null
    and b.farm_id is null
    and b.author_id is distinct from v_user_id
  returning b.id, b.farm_id, b.owner_id, b.farm_site, coalesce(b.admin_reward_badge_ids, '[]'::jsonb)
  into v_betail_id, v_farm_id, v_owner_id, v_farm_site, v_reward_badges;

  if v_betail_id is null then
    raise exception 'already_sold_or_invalid';
  end if;

  -- Reprendre les badges restes sur un betail libere apres suppression de compte.
  for v_orphan_equip in
    select e.id, e.badge_id
    from public.badges_equips_reborn e
    where e.betail_id = v_betail_id
      and e.user_id is null
    order by e.slot, e.equipped_at, e.id
  loop
    insert into public.badges_inventory_reborn (
      user_id, badge_id, purchase_price, purchased_at, source
    )
    values (
      v_user_id, v_orphan_equip.badge_id, 0, now(), 'betail_transfer'
    )
    on conflict (user_id, badge_id) do nothing;

    if exists (
      select 1
      from public.badges_equips_reborn existing_equip
      where existing_equip.user_id = v_user_id
        and existing_equip.badge_id = v_orphan_equip.badge_id
        and existing_equip.id <> v_orphan_equip.id
    ) then
      -- Un meme badge ne peut pas etre equipe deux fois par le meme joueur.
      delete from public.badges_equips_reborn
      where id = v_orphan_equip.id;
    else
      update public.badges_equips_reborn
      set user_id = v_user_id
      where id = v_orphan_equip.id;
    end if;
  end loop;

  if jsonb_typeof(v_reward_badges) = 'array' then
    for v_reward_badge_text in
      select jsonb_array_elements_text(v_reward_badges)
    loop
      begin
        v_reward_badge_id := v_reward_badge_text::uuid;
      exception
        when invalid_text_representation then
          continue;
      end;

      if exists (
        select 1
        from public.badges_inventory_reborn i
        where i.user_id = v_user_id
          and i.badge_id = v_reward_badge_id
      ) then
        continue;
      end if;

      if not exists (
        select 1
        from public.badges_catalog_reborn c
        where c.id = v_reward_badge_id
          and coalesce(c.is_active, true) = true
      ) then
        continue;
      end if;

      v_inventory_insert_id := null;
      insert into public.badges_inventory_reborn (user_id, badge_id, purchase_price, purchased_at, source)
      values (v_user_id, v_reward_badge_id, 0, now(), 'betail_reward')
      on conflict (user_id, badge_id) do nothing
      returning id into v_inventory_insert_id;

      if v_inventory_insert_id is null then
        continue;
      end if;

      select slot
      into v_free_slot
      from generate_series(1, 3) as gs(slot)
      where not exists (
        select 1
        from public.badges_equips_reborn e
        where e.betail_id = v_betail_id
          and e.slot = gs.slot
      )
      order by gs.slot
      limit 1;

      if v_free_slot is not null then
        insert into public.badges_equips_reborn (user_id, badge_id, betail_id, slot, equipped_at)
        values (v_user_id, v_reward_badge_id, v_betail_id, v_free_slot, now())
        on conflict do nothing;
      end if;
    end loop;
  end if;

  betail_id := v_betail_id;
  farm_id := v_farm_id;
  owner_id := v_owner_id;
  farm_site := v_farm_site;
  return;
end;
$$;

grant execute on function public.purchase_betail_reborn(uuid) to authenticated;

-- La Centrale peut nettoyer les fichiers du bucket avatars apres le COMMIT metier.
drop policy if exists avatars_admin_delete_reborn on storage.objects;
create policy avatars_admin_delete_reborn
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and exists (
    select 1
    from public.users_profiles admin_profile
    where admin_profile.id = auth.uid()
      and (
        upper(btrim(coalesce(admin_profile.role, ''))) = 'ADMIN'
        or upper(btrim(coalesce(admin_profile.role_ingame, ''))) = 'ADMIN'
      )
  )
);

drop policy if exists avatars_admin_select_reborn on storage.objects;
create policy avatars_admin_select_reborn
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and exists (
    select 1
    from public.users_profiles admin_profile
    where admin_profile.id = auth.uid()
      and (
        upper(btrim(coalesce(admin_profile.role, ''))) = 'ADMIN'
        or upper(btrim(coalesce(admin_profile.role_ingame, ''))) = 'ADMIN'
      )
  )
);

notify pgrst, 'reload schema';
commit;

