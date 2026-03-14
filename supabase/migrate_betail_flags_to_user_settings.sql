-- Migration des flags betails.pinned / betails.archived vers user_settings.
-- A exécuter avant de supprimer les colonnes pinned/archived de public.betails.

with pinned_source as (
  select
    b.owner_id as user_id,
    'pinned_betails'::text as setting_name,
    jsonb_agg(distinct b.id::text) as setting_value
  from public.betails b
  where b.owner_id is not null
    and b.pinned = true
  group by b.owner_id
),
archived_source as (
  select
    b.owner_id as user_id,
    'archived_betails'::text as setting_name,
    jsonb_agg(distinct b.id::text) as setting_value
  from public.betails b
  where b.owner_id is not null
    and b.archived = true
  group by b.owner_id
),
source_flags as (
  select * from pinned_source
  union all
  select * from archived_source
),
existing_flags as (
  select
    us.user_id,
    us.setting_name,
    us.setting_value
  from public.user_settings us
  where us.setting_name in ('pinned_betails', 'archived_betails')
),
merged_flags as (
  select
    sf.user_id,
    sf.setting_name,
    coalesce(
      (
        select jsonb_agg(flag_id order by flag_id)
        from (
          select distinct flag_id
          from (
            select jsonb_array_elements_text(coalesce(ef.setting_value, '[]'::jsonb)) as flag_id
            union all
            select jsonb_array_elements_text(coalesce(sf.setting_value, '[]'::jsonb)) as flag_id
          ) all_ids
          where flag_id is not null
            and length(trim(flag_id)) > 0
        ) distinct_ids
      ),
      '[]'::jsonb
    ) as setting_value
  from source_flags sf
  left join existing_flags ef
    on ef.user_id = sf.user_id
   and ef.setting_name = sf.setting_name
)
insert into public.user_settings (user_id, setting_name, setting_value)
select
  mf.user_id,
  mf.setting_name,
  mf.setting_value
from merged_flags mf
where jsonb_array_length(mf.setting_value) > 0
on conflict (user_id, setting_name)
do update
set
  setting_value = excluded.setting_value,
  updated_at = now();
