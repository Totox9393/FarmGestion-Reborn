-- Interrupteur général des enchères ("mise en veille").
-- Run after auctions_reborn.sql and auctions_weekly_quota_fix.sql.
--
-- system_enabled = false :
--   * aucune nouvelle session (automatique : ignorée en silence, manuelle : erreur)
--   * aucun slot rejoint, aucune mise
--   * les tables, sessions passées et historique des gagnants sont conservés
-- Le site masque aussi la page, le lien du menu et le bandeau d'accueil.
-- Remettre system_enabled à true rétablit tout, avec la configuration d'avant.

alter table public.auction_config_reborn
  add column if not exists system_enabled boolean not null default true;

-- 1) Bloque les écritures quand les enchères sont en veille.
create or replace function public.auction_block_when_disabled_reborn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  select coalesce(c.system_enabled, true)
  into v_enabled
  from public.auction_config_reborn c
  where c.id = true;

  if coalesce(v_enabled, true) then
    return new;
  end if;

  -- Le scheduler tourne toujours : on annule seulement la ligne, sans erreur.
  if tg_table_name = 'auction_sessions_reborn' and new.launched_mode = 'auto' then
    return null;
  end if;

  raise exception 'AUCTIONS_DISABLED';
end;
$$;

drop trigger if exists auction_block_when_disabled_sessions_reborn on public.auction_sessions_reborn;
create trigger auction_block_when_disabled_sessions_reborn
before insert on public.auction_sessions_reborn
for each row
execute function public.auction_block_when_disabled_reborn();

drop trigger if exists auction_block_when_disabled_slots_reborn on public.auction_slots_reborn;
create trigger auction_block_when_disabled_slots_reborn
before insert on public.auction_slots_reborn
for each row
execute function public.auction_block_when_disabled_reborn();

drop trigger if exists auction_block_when_disabled_bids_reborn on public.auction_bids_reborn;
create trigger auction_block_when_disabled_bids_reborn
before insert on public.auction_bids_reborn
for each row
execute function public.auction_block_when_disabled_reborn();

-- 2) Refuse la mise en veille tant qu'une session est en cours
--    (sinon les bétails resteraient verrouillés).
create or replace function public.auction_guard_disable_reborn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.system_enabled, true) and not coalesce(new.system_enabled, true) then
    if exists (
      select 1
      from public.auction_sessions_reborn s
      where s.status in ('filling', 'ready_delay', 'open')
    ) then
      raise exception 'ACTIVE_SESSION_EXISTS';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists auction_guard_disable_reborn on public.auction_config_reborn;
create trigger auction_guard_disable_reborn
before update on public.auction_config_reborn
for each row
execute function public.auction_guard_disable_reborn();
