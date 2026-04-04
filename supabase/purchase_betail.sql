-- Add purchase timestamp and helper index
alter table public.betails
  add column if not exists purchased_at timestamptz null;

alter table public.betails
  add column if not exists admin_reward_badge_ids jsonb not null default '[]'::jsonb;

create index if not exists betails_owner_purchased_at_idx
  on public.betails (owner_id, purchased_at);

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
  v_betail_id uuid;
  v_owner_id uuid;
  v_farm_site text;
  v_reward_badges jsonb := '[]'::jsonb;
  v_reward_badge_text text;
  v_reward_badge_id uuid;
  v_inventory_insert_id uuid;
  v_free_slot integer;
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

  v_today := (timezone('Europe/Paris', now()))::date;

  select count(*) into v_count
  from public.betails as b
  where b.owner_id = v_user_id
    and b.purchased_at is not null
    and (timezone('Europe/Paris', b.purchased_at))::date = v_today;

  if v_count >= 10 then
    raise exception 'daily_limit_reached';
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
      farm_site = (floor(random() * 6) + 1)::text,
      purchased_at = now()
  where b.id = p_betail_id
    and coalesce(b.visible, true) = true
    and b.owner_id is null
    and b.farm_id is null
    and b.author_id <> v_user_id
  returning b.id, b.farm_id, b.owner_id, b.farm_site, coalesce(b.admin_reward_badge_ids, '[]'::jsonb)
  into v_betail_id, v_farm_id, v_owner_id, v_farm_site, v_reward_badges;

  if v_betail_id is null then
    raise exception 'already_sold_or_invalid';
  end if;

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
      insert into public.badges_inventory_reborn (user_id, badge_id, purchase_price, purchased_at)
      values (v_user_id, v_reward_badge_id, 0, now())
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
