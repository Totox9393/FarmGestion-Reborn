# Schéma de base de données (Supabase)

## Table `public.farms_list`

```sql
create table public.farms_list (
  id bigserial not null,
  name text not null,
  creation_date timestamp with time zone null default now(),
  proprietaire uuid null,
  state text null,
  visible boolean not null default true,
  site_colors jsonb not null default '{}'::jsonb,
  center_style jsonb not null default '{}'::jsonb,
  equipped_badges jsonb not null default '{}'::jsonb,
  constraint farms_list_pkey primary key (id),
  constraint farms_list_proprietaire_fkey foreign KEY (proprietaire) references users_profiles (id)
) TABLESPACE pg_default;
```

## Table `public.users_profiles`

```sql
create table public.users_profiles (
  id uuid not null,
  username text not null,
  email text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  avatar_url text null,
  role_ingame text null,
  role text null,
  money integer null default 0,
  farm_id bigint null,
  receive_newsletter boolean not null default true,
  constraint users_profiles_pkey primary key (id),
  constraint users_profiles_farm_id_fkey foreign KEY (farm_id) references farms_list (id),
  constraint users_profiles_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;
```

## Table `public.betails`

```sql
create table public.betails (
  id uuid not null default gen_random_uuid (),
  matricule text not null,
  name text not null,
  avatar_url text null,
  farm_id bigint null,
  farm_site text null,
  age integer null,
  premium boolean not null default false,
  comments text null,
  author_id uuid not null,
  owner_id uuid null,
  created_at timestamp with time zone not null default now(),
  like_count integer not null default 0,
  purchased_at timestamp with time zone null,
  equipped_badges jsonb null,
  visible boolean null default true,
  invisible_at timestamp with time zone null,
  invisible_reason text null,
  admin_reward_badge_ids jsonb not null default '[]'::jsonb,
  constraint betails_pkey primary key (id),
  constraint betails_matricule_key unique (matricule),
  constraint betails_matricule_unique unique (matricule),
  constraint betails_admin_reward_badge_ids_is_array check (jsonb_typeof(admin_reward_badge_ids) = 'array'),
  constraint betails_author_id_fkey foreign KEY (author_id) references auth.users (id) on delete CASCADE,
  constraint betails_farm_id_fkey foreign KEY (farm_id) references farms_list (id) on delete set null,
  constraint betails_owner_id_fkey foreign KEY (owner_id) references auth.users (id) on delete set null
) TABLESPACE pg_default;
```

## Table `public.shipping`

```sql
create table public.shipping (
  id bigserial not null,
  betail_id uuid not null,
  scheduled_for timestamp with time zone not null,
  status text not null default 'scheduled'::text,
  notes text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  scheduled_by_uuid uuid null,
  estimated_gain integer not null default 0,
  constraint shipping_pkey primary key (id),
  constraint shipping_betail_id_unique unique (betail_id),
  constraint shipping_betail_id_fkey foreign KEY (betail_id) references betails (id) on delete CASCADE,
  constraint shipping_status_check check (
    (
      status = any (
        array[
          'scheduled'::text,
          'delivered'::text,
          'cancelled'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;
```

## Table `public.user_settings`

```sql
create table public.user_settings (
  user_id uuid not null,
  setting_name text not null,
  setting_value jsonb not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_settings_user_id_setting_name_key unique (user_id, setting_name),
  constraint user_settings_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint user_settings_setting_name_format check ((setting_name ~ '^[a-z0-9_]+$'::text))
) TABLESPACE pg_default; 
```

## Table `public.user_relations`

```sql
create table public.user_relations (
  id bigserial not null,
  user_a uuid not null,
  user_b uuid not null,
  initiator uuid not null,
  status text not null,
  created_at timestamp with time zone not null default now(),
  responded_at timestamp with time zone null,
  pair_left uuid GENERATED ALWAYS as (LEAST(user_a, user_b)) STORED null,
  pair_right uuid GENERATED ALWAYS as (GREATEST(user_a, user_b)) STORED null,
  constraint user_relations_pkey primary key (id),
  constraint user_relations_initiator_fkey foreign KEY (initiator) references users_profiles (id) on delete CASCADE,
  constraint user_relations_user_a_fkey foreign KEY (user_a) references users_profiles (id) on delete CASCADE,
  constraint user_relations_user_b_fkey foreign KEY (user_b) references users_profiles (id) on delete CASCADE,
  constraint user_relations_initiator_in_pair check (
    (
      (initiator = user_a)
      or (initiator = user_b)
    )
  ),
  constraint user_relations_no_self check ((user_a <> user_b)),
  constraint user_relations_status_check check (
    (
      status = any (
        array[
          'pending'::text,
          'accepted'::text,
          'declined'::text,
          'cancelled'::text,
          'blocked'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;
```

## Table `public.betails_reports`

```sql
create table public.betails_reports (
  id uuid not null default gen_random_uuid(),
  betail_id uuid not null,
  reporter_id uuid not null,
  reason_code text not null,
  reason_details text null,
  status text not null default 'pending'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  handled_by uuid null,
  handled_at timestamp with time zone null,
  betail_snapshot_comment text null,
  constraint betails_reports_pkey primary key (id),
  constraint betails_reports_betail_id_fkey foreign key (betail_id) references betails (id) on delete cascade,
  constraint betails_reports_reporter_id_fkey foreign key (reporter_id) references users_profiles (id) on delete cascade,
  constraint betails_reports_handled_by_fkey foreign key (handled_by) references users_profiles (id) on delete set null,
  constraint betails_reports_reason_code_check check (
    reason_code = any (
      array[
        'photo_inappropriee'::text,
        'nom_inapproprie'::text,
        'description_inappropriee'::text,
        'informations_personnelles'::text,
        'fraude_manipulation'::text,
        'harcelement'::text,
        'autre'::text
      ]
    )
  ),
  constraint betails_reports_status_check check (
    status = any (array['pending'::text, 'done'::text, 'rejected'::text])
  )
) TABLESPACE pg_default;
```

## Table `public.badges_catalog_reborn`

```sql
create table public.badges_catalog_reborn (
  id uuid not null default gen_random_uuid(),
  filename text not null,
  name text not null,
  rarity text not null,
  price integer not null default 0,
  stock_total integer not null default 50,
  sold_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  created_by uuid null,
  constraint badges_catalog_reborn_pkey primary key (id),
  constraint badges_catalog_reborn_filename_key unique (filename),
  constraint badges_catalog_reborn_created_by_fkey foreign key (created_by) references users_profiles (id) on delete set null,
  constraint badges_catalog_reborn_price_check check (price >= 0),
  constraint badges_catalog_reborn_stock_total_check check (stock_total >= 0),
  constraint badges_catalog_reborn_sold_count_check check (sold_count >= 0 and sold_count <= stock_total),
  constraint badges_catalog_reborn_rarity_check check (
    rarity = any (array['0_auto'::text, '1_common'::text, '2_rare'::text, '3_epic'::text, '4_legendary'::text])
  )
) TABLESPACE pg_default;
```

## Table `public.badges_inventory_reborn`

```sql
create table public.badges_inventory_reborn (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  badge_id uuid not null,
  purchase_price integer not null default 0,
  purchased_at timestamp with time zone not null default now(),
  constraint badges_inventory_reborn_pkey primary key (id),
  constraint badges_inventory_reborn_user_id_fkey foreign key (user_id) references users_profiles (id) on delete cascade,
  constraint badges_inventory_reborn_badge_id_fkey foreign key (badge_id) references badges_catalog_reborn (id) on delete cascade,
  constraint badges_inventory_reborn_unique_user_badge unique (user_id, badge_id),
  constraint badges_inventory_reborn_purchase_price_check check (purchase_price >= 0)
) TABLESPACE pg_default;
```

## Table `public.badges_equips_reborn`

```sql
create table public.badges_equips_reborn (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  badge_id uuid not null,
  farm_id bigint null,
  betail_id uuid null,
  slot integer not null,
  equipped_at timestamp with time zone not null default now(),
  constraint badges_equips_reborn_pkey primary key (id),
  constraint badges_equips_reborn_user_id_fkey foreign key (user_id) references users_profiles (id) on delete cascade,
  constraint badges_equips_reborn_badge_id_fkey foreign key (badge_id) references badges_catalog_reborn (id) on delete cascade,
  constraint badges_equips_reborn_farm_id_fkey foreign key (farm_id) references farms_list (id) on delete cascade,
  constraint badges_equips_reborn_betail_id_fkey foreign key (betail_id) references betails (id) on delete cascade,
  constraint badges_equips_reborn_unique_badge unique (badge_id),
  constraint badges_equips_reborn_slot_check check (slot >= 1 and slot <= 3),
  constraint badges_equips_reborn_target_check check (((farm_id is not null) <> (betail_id is not null)))
) TABLESPACE pg_default;

create unique index if not exists badges_equips_reborn_farm_slot_unique
  on public.badges_equips_reborn (farm_id, slot)
  where farm_id is not null;

create unique index if not exists badges_equips_reborn_betail_slot_unique
  on public.badges_equips_reborn (betail_id, slot)
  where betail_id is not null;
```

## Vue `public.user_badges_profile_reborn`

```sql
create or replace view public.user_badges_profile_reborn as
select
  i.user_id,
  i.badge_id,
  c.filename,
  c.name,
  c.rarity,
  c.price,
  i.purchased_at
from public.badges_inventory_reborn i
join public.badges_catalog_reborn c on c.id = i.badge_id
where c.is_active = true;
```

## Fonctions SQL (Badges Reborn)

```sql
buy_badge_reborn(p_badge_id uuid) returns jsonb
equip_betail_badge_reborn(p_badge_id uuid, p_betail_id uuid, p_slot integer default null) returns jsonb
unequip_betail_badge_reborn(p_badge_id uuid, p_betail_id uuid) returns jsonb
equip_farm_badge_reborn(p_badge_id uuid, p_slot integer default null) returns jsonb
unequip_farm_badge_reborn(p_badge_id uuid) returns jsonb
admin_create_badge_reborn(...) returns jsonb
admin_increase_badge_stock_reborn(...) returns jsonb
admin_delete_badge_reborn(...) returns jsonb
admin_set_betail_visibility_reborn(p_betail_id uuid, p_visible boolean, p_invisible_reason text default null) returns jsonb
admin_delete_betail_reborn(p_betail_id uuid) returns jsonb
create_admin_betail_reborn(..., p_reward_badge_ids jsonb default '[]'::jsonb) returns json
purchase_betail_reborn(p_betail_id uuid) returns table(betail_id uuid, farm_id bigint, owner_id uuid, farm_site text)
cleanup_delivered_badges_reborn() returns jsonb
process_shipping_with_badge_cleanup_reborn(...) returns jsonb
```

## Moderation admin (visibilite / suppression)

```text
- `admin_set_betail_visibility_reborn`:
  - quand `p_visible = false`, retire les badges equipes sur le betail,
  - puis retire ces memes badges de l'inventaire du proprietaire.
- `admin_delete_betail_reborn`:
  - retire d'abord badges_equips + inventaire associe,
  - puis supprime le betail.
- Objectif: eviter les suppressions bloquees et garder un etat badges coherent.
```

## Badges cachés admin (achat bétail)

```text
- `betails.admin_reward_badge_ids` stocke jusqu'à 3 badge_id offerts par l'admin (badges cachés).
- À l'achat (`purchase_betail_reborn`):
  - si l'utilisateur possède déjà un badge caché, on ne le redonne pas (et pas d'auto-équipement).
  - sinon, insertion dans `badges_inventory_reborn` avec `purchase_price = 0`.
  - puis tentative d'auto-équipement sur le bétail acheté (premier slot libre 1..3).
- Le stock de `badges_catalog_reborn` n'est pas décrémenté pour ces badges cadeaux admin.
```

## Règle gain expédition (shipping)

```text
La fonction `schedule_shipping_reborn` calcule `estimated_gain` côté SQL (source de vérité).
`p_estimated_gain` est conservé pour compatibilité mais ignoré.

Formule reborn actuelle:
- Base: 250
- Statut premium: +390 (sinon +45)
- Ancienneté: +6 par mois depuis création du bétail
- Bonus badges: +75% de la somme des `purchase_price` des badges équipés sur ce bétail
- Impact âge: +28 par an au-dessus de 8 ans, ou -22 par an sous 8 ans
```

## Storage badges (upload admin)

```text
- Bucket: `badges` (public), fichiers ranges sous:
  - `0_auto/`
  - `1_common/`
  - `2_rare/`
  - `3_epic/`
  - `4_legendary/`
- Pour autoriser l'upload depuis le panneau admin, executer:
  - `supabase/storage_badges_admin_policies.sql`
- Pour autoriser la creation/modification/suppression directe en table (fallback admin):
  - `supabase/badges_catalog_admin_policies.sql`
```

## Note migration badges legacy

```text
- Legacy `badges_achetes` -> migre vers `badges_inventory_reborn`.
- Legacy `badges_equipes` -> migre vers `badges_equips_reborn`.
- Les colonnes JSON `equipped_badges` (farms_list / betails) sont legacy et ne sont plus la source de verite du systeme badges reborn.
```
