-- Community/friends server-side hardening for high concurrency
-- Run in Supabase SQL editor (staging first, then production).

-- 1) Search performance for username ilike
create extension if not exists pg_trgm;

create index if not exists users_profiles_username_trgm_idx
  on public.users_profiles using gin (username gin_trgm_ops);

-- 2) Community list performance (visible farms sorted by creation date)
create index if not exists farms_list_visible_creation_date_idx
  on public.farms_list (creation_date desc)
  where visible = true;

create index if not exists farms_list_visible_owner_idx
  on public.farms_list (proprietaire)
  where visible = true;

-- 3) Monthly activity scan performance
create index if not exists betails_created_at_author_idx
  on public.betails (created_at desc, author_id)
  where author_id is not null;

create index if not exists betails_purchased_at_owner_idx
  on public.betails (purchased_at desc, owner_id)
  where purchased_at is not null
    and owner_id is not null;

-- 4) Friend requests/friend list performance
create index if not exists user_relations_pending_user_a_idx
  on public.user_relations (user_a, created_at desc)
  where status = 'pending';

create index if not exists user_relations_pending_user_b_idx
  on public.user_relations (user_b, created_at desc)
  where status = 'pending';

create index if not exists user_relations_accepted_user_a_idx
  on public.user_relations (user_a, created_at desc)
  where status = 'accepted';

create index if not exists user_relations_accepted_user_b_idx
  on public.user_relations (user_b, created_at desc)
  where status = 'accepted';

-- 5) Optional RPC to aggregate active users in one server-side call
create or replace function public.get_active_user_scores_this_month(
  p_limit integer default 2000
)
returns table (
  user_id uuid,
  score bigint
)
language sql
security definer
set search_path = public
as $$
  with month_start as (
    select date_trunc('month', now())::timestamptz as ts
  ),
  events as (
    select b.author_id as user_id
    from public.betails b
    cross join month_start m
    where b.created_at >= m.ts
      and b.author_id is not null

    union all

    select b.owner_id as user_id
    from public.betails b
    cross join month_start m
    where b.purchased_at >= m.ts
      and b.owner_id is not null
  )
  select e.user_id, count(*)::bigint as score
  from events e
  group by e.user_id
  order by score desc
  limit greatest(1, least(coalesce(p_limit, 2000), 10000));
$$;

grant execute on function public.get_active_user_scores_this_month(integer)
  to authenticated, service_role;

-- 6) Refresh planner stats after index creation
analyze public.users_profiles;
analyze public.farms_list;
analyze public.betails;
analyze public.user_relations;
