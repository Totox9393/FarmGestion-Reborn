-- Sends a Discord notification whenever a row is inserted into public.betails.
--
-- Prerequisite, to run once in the Supabase SQL editor:
--   create extension if not exists supabase_vault;
--   select vault.create_secret('<your service-role key>', 'FARMGESTION_SUPABASE_SERVICE_ROLE_KEY');
--
-- The service-role key is read from Supabase Vault at runtime and is never stored
-- in this repository.

create extension if not exists pg_net;
create extension if not exists supabase_vault;

create table if not exists public.discord_betail_messages (
  betail_id uuid primary key references public.betails (id) on delete cascade,
  message_id text not null,
  status text not null default 'available',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint discord_betail_messages_status_check
    check (status in ('available', 'purchased'))
);

alter table public.discord_betail_messages enable row level security;

create or replace function public.notify_discord_betail_created()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_function_url text := 'https://cjgwistssafinkoxbaal.supabase.co/functions/v1/notify-discord-betail-created';
  v_service_role_key text;
  v_request_id bigint;
begin
  select decrypted_secret
  into v_service_role_key
  from vault.decrypted_secrets
  where name = 'FARMGESTION_SUPABASE_SERVICE_ROLE_KEY'
  limit 1;

  if nullif(btrim(coalesce(v_service_role_key, '')), '') is null then
    raise warning 'Discord betail notification skipped: missing Vault secret FARMGESTION_SUPABASE_SERVICE_ROLE_KEY';
    return new;
  end if;

  select net.http_post(
    url := v_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'schema', TG_TABLE_SCHEMA,
      'table', TG_TABLE_NAME,
      'record', to_jsonb(new)
    ),
    timeout_milliseconds := 5000
  )
  into v_request_id;

  return new;
exception
  when others then
    raise warning 'Discord betail notification skipped: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_notify_discord_betail_created on public.betails;

create trigger trg_notify_discord_betail_created
after insert on public.betails
for each row
when (coalesce(new.visible, true) = true)
execute function public.notify_discord_betail_created();

create or replace function public.notify_discord_betail_purchased()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_function_url text := 'https://cjgwistssafinkoxbaal.supabase.co/functions/v1/notify-discord-betail-created';
  v_service_role_key text;
  v_request_id bigint;
begin
  select decrypted_secret
  into v_service_role_key
  from vault.decrypted_secrets
  where name = 'FARMGESTION_SUPABASE_SERVICE_ROLE_KEY'
  limit 1;

  if nullif(btrim(coalesce(v_service_role_key, '')), '') is null then
    raise warning 'Discord betail purchase notification skipped: missing Vault secret FARMGESTION_SUPABASE_SERVICE_ROLE_KEY';
    return new;
  end if;

  select net.http_post(
    url := v_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'type', 'UPDATE',
      'schema', TG_TABLE_SCHEMA,
      'table', TG_TABLE_NAME,
      'record', to_jsonb(new),
      'old_record', to_jsonb(old)
    ),
    timeout_milliseconds := 5000
  )
  into v_request_id;

  return new;
exception
  when others then
    raise warning 'Discord betail purchase notification skipped: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_notify_discord_betail_purchased on public.betails;

create trigger trg_notify_discord_betail_purchased
after update of owner_id, purchased_at on public.betails
for each row
when (
  old.owner_id is null
  and new.owner_id is not null
)
execute function public.notify_discord_betail_purchased();
