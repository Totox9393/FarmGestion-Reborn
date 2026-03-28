-- Public pinned betails for a profile, resolved from user_settings.pinned_betails
-- Safe for community pages: only returns visible betails.

drop function if exists public.get_public_pinned_betails(uuid, integer);

create or replace function public.get_public_pinned_betails(
  p_user_id uuid,
  p_limit integer default 24
)
returns table (
  id uuid,
  name text,
  matricule text,
  avatar_url text,
  like_count integer,
  liked_by_me boolean,
  comments text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with viewer as (
    select auth.uid() as uid
  ),
  pinned_raw as (
    select
      elem.value as betail_id_text,
      elem.ordinality as position
    from public.user_settings us
    cross join lateral jsonb_array_elements_text(coalesce(us.setting_value, '[]'::jsonb)) with ordinality as elem(value, ordinality)
    where us.user_id = p_user_id
      and us.setting_name = 'pinned_betails'
  )
  select
    b.id,
    b.name,
    b.matricule,
    b.avatar_url,
    coalesce(b.like_count, 0)::integer as like_count,
    case
      when viewer.uid is null then false
      else exists (
        select 1
        from public.betail_likes bl
        where bl.betail_id = b.id
          and bl.user_id = viewer.uid
      )
    end as liked_by_me,
    b.comments,
    b.created_at
  from pinned_raw pr
  join public.betails b
    on b.id::text = pr.betail_id_text
  cross join viewer
  where b.visible = true
  order by pr.position asc
  limit greatest(1, least(coalesce(p_limit, 24), 100));
$$;

grant execute on function public.get_public_pinned_betails(uuid, integer) to anon, authenticated, service_role;
