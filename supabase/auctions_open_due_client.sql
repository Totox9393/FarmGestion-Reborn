-- Allows connected auction viewers to advance a ready session exactly when its
-- server-side opening timestamp has elapsed. The time and state checks prevent
-- clients from opening a session early.
create or replace function public.open_due_auction_session_reborn(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_status text;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  update public.auction_sessions_reborn
  set status = 'open',
      updated_at = v_now
  where id = p_session_id
    and status = 'ready_delay'
    and open_at is not null
    and open_at <= v_now
  returning status into v_status;

  if found then
    return jsonb_build_object('success', true, 'status_after', v_status);
  end if;

  select status into v_status
  from public.auction_sessions_reborn
  where id = p_session_id;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'SESSION_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'success', v_status = 'open',
    'reason', case when v_status = 'open' then null else 'SESSION_NOT_DUE' end,
    'status_after', v_status
  );
end;
$$;

revoke all on function public.open_due_auction_session_reborn(uuid) from public;
grant execute on function public.open_due_auction_session_reborn(uuid) to authenticated;
