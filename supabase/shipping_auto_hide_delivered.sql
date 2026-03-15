-- Auto-hide delivered betails at shipping due date/time.
-- Run this file once in Supabase SQL Editor.

update public.betails
set visible = true
where visible is null;

create index if not exists shipping_status_scheduled_for_idx
  on public.shipping (status, scheduled_for);

create or replace function public.mark_due_shipping_as_delivered()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_hidden_count integer := 0;
  v_delivered_count integer := 0;
begin
  with due_shipping as (
    select s.id, s.betail_id, s.scheduled_by_uuid
    from public.shipping s
    where s.status = 'scheduled'
      and s.scheduled_for <= v_now
    for update skip locked
  ),
  hidden_betails as (
    update public.betails b
    set visible = false,
        invisible_at = v_now,
        invisible_reason = (
          select
            'Expedie'
            || case
              when up.username is not null and btrim(up.username) <> '' then ' par ' || up.username
              else ''
            end
            || ' le '
            || to_char(v_now at time zone 'Europe/Paris', 'DD/MM/YYYY HH24:MI')
          from due_shipping ds
          left join public.users_profiles up on up.id = ds.scheduled_by_uuid
          where ds.betail_id = b.id
          limit 1
        )
    where b.id in (select ds.betail_id from due_shipping ds)
      and coalesce(b.visible, true) = true
    returning b.id
  ),
  delivered_shipping as (
    update public.shipping s
    set status = 'delivered',
        updated_at = v_now
    where s.id in (select ds.id from due_shipping ds)
      and s.status = 'scheduled'
    returning s.id
  )
  select
    (select count(*) from hidden_betails),
    (select count(*) from delivered_shipping)
  into v_hidden_count, v_delivered_count;

  return jsonb_build_object(
    'success', true,
    'processed_at', v_now,
    'betails_hidden', v_hidden_count,
    'shipping_delivered', v_delivered_count
  );
end;
$$;

revoke all on function public.mark_due_shipping_as_delivered() from public;
grant execute on function public.mark_due_shipping_as_delivered() to service_role;

-- Optional immediate run (safe to execute):
-- select public.mark_due_shipping_as_delivered();

-- Schedule every minute with pg_cron.
-- This keeps working even when no user is connected.
do $$
declare
  v_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception
      when insufficient_privilege then
        raise notice 'pg_cron not installable by current role. Install it in Supabase Dashboard, then run cron.schedule manually.';
        return;
    end;
  end if;

  begin
    select j.jobid
    into v_job_id
    from cron.job j
    where j.jobname = 'shipping-delivery-visibility-job'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'shipping-delivery-visibility-job',
      '* * * * *',
      'select public.mark_due_shipping_as_delivered();'
    );
  exception
    when undefined_table or undefined_function then
      raise notice 'cron schema/functions unavailable. Configure a Supabase Scheduled Function that runs: select public.mark_due_shipping_as_delivered();';
  end;
end;
$$;
