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
