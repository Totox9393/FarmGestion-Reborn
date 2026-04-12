-- Bucket badges + policies RLS Storage (admin + moderation write)
-- A executer dans l'editeur SQL Supabase.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'badges',
  'badges',
  true,
  6291456,
  array['image/gif', 'image/png', 'image/jpeg', 'image/webp', 'image/avif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Lecture publique pour les assets badges.
drop policy if exists badges_public_read on storage.objects;
create policy badges_public_read
on storage.objects
for select
to public
using (bucket_id = 'badges');

-- Ecriture reservee aux admins/moderation dans les dossiers de rarete.
drop policy if exists badges_admin_insert_rarity_folder on storage.objects;
create policy badges_admin_insert_rarity_folder
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'badges'
  and (storage.foldername(name))[1] = any (array['0_auto', '1_common', '2_rare', '3_epic', '4_legendary'])
  and exists (
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

drop policy if exists badges_admin_update_rarity_folder on storage.objects;
create policy badges_admin_update_rarity_folder
on storage.objects
for update
to authenticated
using (
  bucket_id = 'badges'
  and (storage.foldername(name))[1] = any (array['0_auto', '1_common', '2_rare', '3_epic', '4_legendary'])
  and exists (
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
  bucket_id = 'badges'
  and (storage.foldername(name))[1] = any (array['0_auto', '1_common', '2_rare', '3_epic', '4_legendary'])
  and exists (
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

drop policy if exists badges_admin_delete_rarity_folder on storage.objects;
create policy badges_admin_delete_rarity_folder
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'badges'
  and (storage.foldername(name))[1] = any (array['0_auto', '1_common', '2_rare', '3_epic', '4_legendary'])
  and exists (
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
