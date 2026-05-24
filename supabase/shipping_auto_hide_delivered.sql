-- Auto-hide delivered betails at shipping due date/time.
-- Run this file once in Supabase SQL Editor.

update public.betails
set visible = true
where visible is null;

update public.user_settings us
set setting_value = coalesce((
  select jsonb_agg(filtered.betail_id_text order by filtered.position)
  from (
    select
      elem.value as betail_id_text,
      elem.ordinality as position
    from jsonb_array_elements_text(coalesce(us.setting_value, '[]'::jsonb)) with ordinality as elem(value, ordinality)
    join public.betails b
      on b.id::text = elem.value
    where b.owner_id = us.user_id
      and coalesce(b.visible, true) = true
  ) filtered
), '[]'::jsonb)
where us.setting_name = 'pinned_betails';

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
  v_unpinned_count integer := 0;
  v_delivered_count integer := 0;
  v_credited_profiles_count integer := 0;
  v_credited_total_gain integer := 0;
begin
  with due_shipping as (
    select
      s.id,
      s.betail_id,
      s.scheduled_by_uuid,
      coalesce(s.scheduled_by_uuid, b.owner_id) as beneficiary_uuid,
      greatest(0, coalesce(s.estimated_gain, 0)) as estimated_gain
    from public.shipping s
    left join public.betails b on b.id = s.betail_id
    where s.status = 'scheduled'
      and s.scheduled_for <= v_now
    for update of s skip locked
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
    returning b.id, b.owner_id
  ),
  cleaned_pinned_settings as (
    update public.user_settings us
    set setting_value = coalesce((
      select jsonb_agg(filtered.betail_id_text order by filtered.position)
      from (
        select
          elem.value as betail_id_text,
          elem.ordinality as position
        from jsonb_array_elements_text(coalesce(us.setting_value, '[]'::jsonb)) with ordinality as elem(value, ordinality)
        where not exists (
          select 1
          from hidden_betails hb
          where hb.owner_id = us.user_id
            and hb.id::text = elem.value
        )
      ) filtered
    ), '[]'::jsonb)
    where us.setting_name = 'pinned_betails'
      and exists (
        select 1
        from hidden_betails hb
        where hb.owner_id = us.user_id
      )
    returning us.user_id
  ),
  credited_profiles as (
    update public.users_profiles up
    set money = coalesce(up.money, 0) + credits.total_gain,
        updated_at = v_now
    from (
      select
        ds.beneficiary_uuid as user_id,
        sum(ds.estimated_gain)::integer as total_gain
      from due_shipping ds
      where ds.beneficiary_uuid is not null
        and ds.estimated_gain > 0
      group by ds.beneficiary_uuid
    ) credits
    where up.id = credits.user_id
    returning up.id, credits.total_gain
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
    (select count(*) from cleaned_pinned_settings),
    (select count(*) from delivered_shipping),
    (select count(*) from credited_profiles),
    (select coalesce(sum(total_gain), 0)::integer from credited_profiles)
  into v_hidden_count, v_unpinned_count, v_delivered_count, v_credited_profiles_count, v_credited_total_gain;

  return jsonb_build_object(
    'success', true,
    'processed_at', v_now,
    'betails_hidden', v_hidden_count,
    'pinned_settings_cleaned', v_unpinned_count,
    'shipping_delivered', v_delivered_count,
    'profiles_credited', v_credited_profiles_count,
    'credited_total_gain', v_credited_total_gain
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
