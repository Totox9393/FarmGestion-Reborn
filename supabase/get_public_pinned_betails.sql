-- Public pinned betails for a profile, resolved from user_settings.pinned_betails
-- Safe for community pages: only returns visible betails.

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
  comments text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with pinned_raw as (
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
    b.comments,
    b.created_at
  from pinned_raw pr
  join public.betails b
    on b.id::text = pr.betail_id_text
  where b.visible = true
  order by pr.position asc
  limit greatest(1, least(coalesce(p_limit, 24), 100));
$$;

grant execute on function public.get_public_pinned_betails(uuid, integer) to anon, authenticated, service_role;
