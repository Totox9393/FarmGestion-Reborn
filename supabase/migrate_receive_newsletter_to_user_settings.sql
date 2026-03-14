-- Migration receive_newsletter vers user_settings (mode sparse).
-- Règle cible:
--   - absence de ligne = newsletter active (true par défaut)
--   - ligne setting_value=false = newsletter désactivée

-- 1) Backfill uniquement les utilisateurs explicitement en false (si présents)
insert into public.user_settings (user_id, setting_name, setting_value)
select
  up.id as user_id,
  'receive_newsletter'::text as setting_name,
  'false'::jsonb as setting_value
from public.users_profiles up
where up.receive_newsletter = false
on conflict (user_id, setting_name)
do update
set
  setting_value = excluded.setting_value,
  updated_at = now();

-- 2) Nettoyage des éventuelles lignes inutiles à true/null
--    (on ne stocke que les false)
delete from public.user_settings us
where us.setting_name = 'receive_newsletter'
  and coalesce((us.setting_value)::text, 'null') <> 'false';
