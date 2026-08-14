-- Persistent, configurable announcement of the highest winning auction result.
alter table public.auction_config_reborn
  add column if not exists winner_announcement_enabled boolean not null default true,
  add column if not exists winner_announcement_minutes integer not null default 60
    check (winner_announcement_minutes between 1 and 1440),
  add column if not exists hidden_winner_session_id uuid null;

create or replace function public.get_latest_auction_winner_announcement_reborn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.auction_config_reborn%rowtype;
  v_result jsonb;
begin
  select * into v_cfg
  from public.auction_config_reborn
  where id = true;

  if not coalesce(v_cfg.winner_announcement_enabled, true) then
    return jsonb_build_object('active', false, 'reason', 'DISABLED');
  end if;

  select jsonb_build_object(
    'active', true,
    'session_id', s.id,
    'ended_at', s.updated_at,
    'expires_at', s.updated_at + make_interval(mins => v_cfg.winner_announcement_minutes),
    'winner_user_id', sl.winner_user_id,
    'winner_username', coalesce(up.username, 'Gagnant inconnu'),
    'winner_avatar_url', up.avatar_url,
    'betail_id', sl.betail_id,
    'betail_name', coalesce(b.name, 'Bétail'),
    'betail_matricule', b.matricule,
    'betail_avatar_url', b.avatar_url,
    'winning_amount', sl.winning_bid_amount
  )
  into v_result
  from public.auction_sessions_reborn s
  join lateral (
    select candidate.*
    from public.auction_slots_reborn candidate
    where candidate.session_id = s.id
      and candidate.status = 'sold'
      and candidate.winner_user_id is not null
      and candidate.winning_bid_amount is not null
    order by candidate.winning_bid_amount desc, candidate.slot_index asc
    limit 1
  ) sl on true
  left join public.users_profiles up on up.id = sl.winner_user_id
  left join public.betails b on b.id = sl.betail_id
  where s.status = 'closed'
    and s.updated_at >= now() - make_interval(mins => v_cfg.winner_announcement_minutes)
    and (v_cfg.hidden_winner_session_id is null or v_cfg.hidden_winner_session_id <> s.id)
  order by s.updated_at desc
  limit 1;

  return coalesce(v_result, jsonb_build_object('active', false, 'reason', 'NO_RECENT_WINNER'));
end;
$$;

revoke all on function public.get_latest_auction_winner_announcement_reborn() from public;
grant execute on function public.get_latest_auction_winner_announcement_reborn() to anon, authenticated;
