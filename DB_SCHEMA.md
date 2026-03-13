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
  pinned boolean not null default false,
  archived boolean not null default false,
  constraint betails_pkey primary key (id),
  constraint betails_matricule_key unique (matricule),
  constraint betails_matricule_unique unique (matricule),
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