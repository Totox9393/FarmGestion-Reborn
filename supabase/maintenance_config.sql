create table if not exists public.site_maintenance_config (
  id boolean primary key default true,
  enabled boolean not null default false,
  page_variant text not null default 'maintenance',
  title text not null default 'La ferme passe en atelier',
  message text not null default 'Nous preparons une version plus stable et plus rapide. Merci pour votre patience.',
  eta_text text null,
  music_url text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid null references auth.users(id) on delete set null,
  constraint site_maintenance_config_singleton check (id is true),
  constraint site_maintenance_config_page_variant_valid check (page_variant in ('maintenance', 'waiting'))
);

alter table public.site_maintenance_config
  add column if not exists page_variant text not null default 'maintenance';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'site_maintenance_config_page_variant_valid'
  ) then
    alter table public.site_maintenance_config
      add constraint site_maintenance_config_page_variant_valid
      check (page_variant in ('maintenance', 'waiting'));
  end if;
end $$;

update public.site_maintenance_config
set page_variant = 'maintenance'
where coalesce(page_variant, '') not in ('maintenance', 'waiting');

insert into public.site_maintenance_config (id)
values (true)
on conflict (id) do nothing;

alter table public.site_maintenance_config enable row level security;

grant select on public.site_maintenance_config to anon;
grant select on public.site_maintenance_config to authenticated;
grant insert, update on public.site_maintenance_config to authenticated;

drop policy if exists site_maintenance_config_public_read on public.site_maintenance_config;
create policy site_maintenance_config_public_read
on public.site_maintenance_config
for select
to anon, authenticated
using (true);

drop policy if exists site_maintenance_config_admin_insert on public.site_maintenance_config;
create policy site_maintenance_config_admin_insert
on public.site_maintenance_config
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
      )
  )
);

drop policy if exists site_maintenance_config_admin_update on public.site_maintenance_config;
create policy site_maintenance_config_admin_update
on public.site_maintenance_config
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
      )
  )
);
