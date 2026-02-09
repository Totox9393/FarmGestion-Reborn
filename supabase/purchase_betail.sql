-- Add purchase timestamp and helper index
alter table public.betails
  add column if not exists purchased_at timestamptz null;

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

  update public.betails as b
  set farm_id = v_farm_id,
      owner_id = v_user_id,
      farm_site = (floor(random() * 6) + 1)::text,
      purchased_at = now()
  where b.id = p_betail_id
    and b.owner_id is null
    and b.farm_id is null
    and b.author_id <> v_user_id
  returning b.id, b.farm_id, b.owner_id, b.farm_site
  into v_betail_id, v_farm_id, v_owner_id, v_farm_site;

  if v_betail_id is null then
    raise exception 'already_sold_or_invalid';
  end if;

  betail_id := v_betail_id;
  farm_id := v_farm_id;
  owner_id := v_owner_id;
  farm_site := v_farm_site;
  return;
end;
$$;

grant execute on function public.purchase_betail_reborn(uuid) to authenticated;
