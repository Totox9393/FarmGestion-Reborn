-- RLS policies pour la table badges_catalog_reborn (admin + moderation)
-- A executer dans l'editeur SQL Supabase.

alter table public.badges_catalog_reborn enable row level security;

-- Necessaire en plus des policies RLS: permissions SQL de base pour authenticated.
grant select, insert, update, delete on table public.badges_catalog_reborn to authenticated;

drop policy if exists badges_catalog_reborn_admin_select on public.badges_catalog_reborn;
create policy badges_catalog_reborn_admin_select
on public.badges_catalog_reborn
for select
to authenticated
using (
  exists (
    select 1
    from public.users_profiles up
    where up.id = auth.uid()
      and (
        upper(coalesce(up.role, '')) like '%ADMIN%'
        or upper(coalesce(up.role_ingame, '')) like '%ADMIN%'
        or upper(coalesce(up.role, '')) like '%MODERATION%'
        or upper(coalesce(up.role_ingame, '')) like '%MODERATION%'
      )
  )
);

drop policy if exists badges_catalog_reborn_admin_insert on public.badges_catalog_reborn;
create policy badges_catalog_reborn_admin_insert
on public.badges_catalog_reborn
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users_profiles up
    where up.id = auth.uid()
      and (
        upper(coalesce(up.role, '')) like '%ADMIN%'
        or upper(coalesce(up.role_ingame, '')) like '%ADMIN%'
        or upper(coalesce(up.role, '')) like '%MODERATION%'
        or upper(coalesce(up.role_ingame, '')) like '%MODERATION%'
      )
  )
);

drop policy if exists badges_catalog_reborn_admin_update on public.badges_catalog_reborn;
create policy badges_catalog_reborn_admin_update
on public.badges_catalog_reborn
for update
to authenticated
using (
  exists (
    select 1
    from public.users_profiles up
    where up.id = auth.uid()
      and (
        upper(coalesce(up.role, '')) like '%ADMIN%'
        or upper(coalesce(up.role_ingame, '')) like '%ADMIN%'
        or upper(coalesce(up.role, '')) like '%MODERATION%'
        or upper(coalesce(up.role_ingame, '')) like '%MODERATION%'
      )
  )
)
with check (
  exists (
    select 1
    from public.users_profiles up
    where up.id = auth.uid()
      and (
        upper(coalesce(up.role, '')) like '%ADMIN%'
        or upper(coalesce(up.role_ingame, '')) like '%ADMIN%'
        or upper(coalesce(up.role, '')) like '%MODERATION%'
        or upper(coalesce(up.role_ingame, '')) like '%MODERATION%'
      )
  )
);

drop policy if exists badges_catalog_reborn_admin_delete on public.badges_catalog_reborn;
create policy badges_catalog_reborn_admin_delete
on public.badges_catalog_reborn
for delete
to authenticated
using (
  exists (
    select 1
    from public.users_profiles up
    where up.id = auth.uid()
      and (
        upper(coalesce(up.role, '')) like '%ADMIN%'
        or upper(coalesce(up.role_ingame, '')) like '%ADMIN%'
        or upper(coalesce(up.role, '')) like '%MODERATION%'
        or upper(coalesce(up.role_ingame, '')) like '%MODERATION%'
      )
  )
);
