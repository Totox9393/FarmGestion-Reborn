-- Atomically cancel an active auction session without settling bids.
-- No money is debited before settlement, so cancellation only unlocks livestock
-- and marks the session cancelled. Ownership and balances remain unchanged.

create or replace function public.admin_cancel_auction_session_reborn(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.auction_sessions_reborn%rowtype;
  v_now timestamptz := now();
  v_unlocked_betails integer := 0;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_admin_user_reborn(v_user_id) then
    return jsonb_build_object('success', false, 'reason', 'NOT_ALLOWED');
  end if;

  if p_session_id is null then
    return jsonb_build_object('success', false, 'reason', 'INVALID_INPUT');
  end if;

  select * into v_session
  from public.auction_sessions_reborn s
  where s.id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'SESSION_NOT_FOUND');
  end if;

  if v_session.status not in ('filling', 'ready_delay', 'open') then
    return jsonb_build_object(
      'success', false,
      'reason', 'SESSION_NOT_CANCELLABLE',
      'status', v_session.status
    );
  end if;

  perform set_config('app.auction_bypass', '1', true);

  update public.betails b
  set auction_locked = false,
      auction_session_id = null
  where b.auction_session_id = v_session.id
    and coalesce(b.auction_locked, false);

  get diagnostics v_unlocked_betails = row_count;

  update public.auction_sessions_reborn s
  set status = 'cancelled',
      end_at = case when s.status = 'open' then v_now else s.end_at end,
      updated_at = v_now
  where s.id = v_session.id;

  return jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'status_after', 'cancelled',
    'unlocked_betails', v_unlocked_betails,
    'cancelled_at', v_now
  );
end;
$$;

revoke all on function public.admin_cancel_auction_session_reborn(uuid) from public;
grant execute on function public.admin_cancel_auction_session_reborn(uuid) to authenticated;
