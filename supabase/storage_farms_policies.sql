-- Bucket farms + policies RLS Storage
-- A executer dans l'editeur SQL Supabase (projet cible)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'farms',
  'farms',
  true,
  6291456,
  array['image/webp', 'image/png', 'image/jpeg']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS est deja pilote par Supabase sur storage.objects.
-- On n'execute pas ALTER TABLE ici pour eviter l'erreur "must be owner of table objects".

-- Lecture publique (utile pour getPublicUrl)
drop policy if exists farms_public_read on storage.objects;
create policy farms_public_read
on storage.objects
for select
to public
using (bucket_id = 'farms');

-- Ecriture autorisee uniquement dans un dossier prefixe par auth.uid()
drop policy if exists farms_insert_own_prefix on storage.objects;
create policy farms_insert_own_prefix
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'farms'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists farms_update_own_prefix on storage.objects;
create policy farms_update_own_prefix
on storage.objects
for update
to authenticated
using (
  bucket_id = 'farms'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'farms'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists farms_delete_own_prefix on storage.objects;
create policy farms_delete_own_prefix
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'farms'
  and (storage.foldername(name))[1] = auth.uid()::text
);
