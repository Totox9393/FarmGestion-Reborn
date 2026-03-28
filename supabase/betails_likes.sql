-- Likes system for betails.
-- Source of truth: public.betail_likes
-- Fast reads/sorting: public.betails.like_count maintained by trigger

create table if not exists public.betail_likes (
  id bigserial primary key,
  betail_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint betail_likes_betail_fkey
    foreign key (betail_id)
    references public.betails (id)
    on delete cascade,
  constraint betail_likes_user_fkey
    foreign key (user_id)
    references public.users_profiles (id)
    on delete cascade
);

create unique index if not exists betail_likes_unique_betail_user_idx
  on public.betail_likes (betail_id, user_id);

create index if not exists betail_likes_user_created_idx
  on public.betail_likes (user_id, created_at desc);

create index if not exists betail_likes_betail_created_idx
  on public.betail_likes (betail_id, created_at desc);

create or replace function public.apply_betail_like_count_delta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.betails
    set like_count = coalesce(like_count, 0) + 1
    where id = new.betail_id;

    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.betails
    set like_count = greatest(0, coalesce(like_count, 0) - 1)
    where id = old.betail_id;

    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_betail_likes_apply_count_delta on public.betail_likes;
create trigger trg_betail_likes_apply_count_delta
after insert or delete on public.betail_likes
for each row
execute function public.apply_betail_like_count_delta();

-- Reconciliation helper for manual maintenance if needed.
create or replace function public.recompute_all_betail_like_counts()
returns void
language sql
security definer
set search_path = public
as $$
  update public.betails b
  set like_count = coalesce(src.likes, 0)
  from (
    select bl.betail_id, count(*)::integer as likes
    from public.betail_likes bl
    group by bl.betail_id
  ) as src
  where src.betail_id = b.id;

  update public.betails b
  set like_count = 0
  where not exists (
    select 1
    from public.betail_likes bl
    where bl.betail_id = b.id
  )
  and coalesce(b.like_count, 0) <> 0;
$$;

create or replace function public.like_betail(p_betail_id uuid)
returns table (liked boolean, like_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.betails b
    where b.id = p_betail_id
      and b.visible = true
  ) then
    raise exception 'betail_not_likeable';
  end if;

  insert into public.betail_likes (betail_id, user_id)
  values (p_betail_id, v_user_id)
  on conflict (betail_id, user_id) do nothing;

  return query
  select
    exists (
      select 1
      from public.betail_likes bl
      where bl.betail_id = p_betail_id
        and bl.user_id = v_user_id
    ) as liked,
    coalesce(b.like_count, 0)::integer as like_count
  from public.betails b
  where b.id = p_betail_id;
end;
$$;

create or replace function public.unlike_betail(p_betail_id uuid)
returns table (liked boolean, like_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.betail_likes bl
  where bl.betail_id = p_betail_id
    and bl.user_id = v_user_id;

  return query
  select
    false as liked,
    coalesce(b.like_count, 0)::integer as like_count
  from public.betails b
  where b.id = p_betail_id;
end;
$$;

alter table public.betail_likes enable row level security;

drop policy if exists betail_likes_insert_own on public.betail_likes;
create policy betail_likes_insert_own
  on public.betail_likes
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.betails b
      where b.id = betail_id
        and b.visible = true
    )
  );

drop policy if exists betail_likes_select_own on public.betail_likes;
create policy betail_likes_select_own
  on public.betail_likes
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists betail_likes_delete_own on public.betail_likes;
create policy betail_likes_delete_own
  on public.betail_likes
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant execute on function public.like_betail(uuid) to authenticated;
grant execute on function public.unlike_betail(uuid) to authenticated;
grant execute on function public.recompute_all_betail_like_counts() to service_role;
