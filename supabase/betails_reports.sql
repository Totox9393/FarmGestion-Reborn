-- Table: public.betails_reports
-- Stores user reports about betails and keeps moderation history.

create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema extensions;

create table if not exists public.betails_reports (
  id uuid not null default gen_random_uuid(),
  betail_id uuid not null,
  reporter_id uuid not null,
  reason_code text not null,
  reason_details text null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handled_by uuid null,
  handled_at timestamptz null,
  betail_snapshot_comment text null,
  constraint betails_reports_pkey primary key (id),
  constraint betails_reports_betail_id_fkey foreign key (betail_id) references public.betails (id) on delete cascade,
  constraint betails_reports_reporter_id_fkey foreign key (reporter_id) references public.users_profiles (id) on delete cascade,
  constraint betails_reports_handled_by_fkey foreign key (handled_by) references public.users_profiles (id) on delete set null,
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
    status = any (
      array[
        'pending'::text,
        'done'::text,
        'rejected'::text
      ]
    )
  ),
  constraint betails_reports_reason_details_check check (
    (reason_code <> 'autre' and reason_details is null)
    or (reason_code = 'autre' and char_length(trim(coalesce(reason_details, ''))) >= 10)
  )
);

alter table public.betails_reports
  drop column if exists betail_snapshot_name,
  drop column if exists betail_snapshot_matricule,
  drop column if exists betail_snapshot_avatar_url;

alter table public.betails_reports
  add column if not exists betail_snapshot_comment text null;

create index if not exists betails_reports_status_created_idx
  on public.betails_reports (status, created_at desc);

create index if not exists betails_reports_betail_idx
  on public.betails_reports (betail_id);

create index if not exists betails_reports_reporter_idx
  on public.betails_reports (reporter_id, created_at desc);

create index if not exists betails_reports_done_rejected_cleanup_idx
  on public.betails_reports (updated_at)
  where status in ('done', 'rejected');

-- Deduplicate legacy pending reports before applying uniqueness guardrail.
with duplicates as (
  select
    id,
    row_number() over (
      partition by betail_id, reporter_id, status
      order by created_at desc, id desc
    ) as rn
  from public.betails_reports
  where status = 'pending'
)
delete from public.betails_reports br
using duplicates d
where br.id = d.id
  and d.rn > 1;

-- Guardrail: one pending report per user and betail.
create unique index if not exists betails_reports_unique_pending_by_user_betail_idx
  on public.betails_reports (betail_id, reporter_id)
  where status = 'pending';

create or replace function public.set_betails_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Idempotent report submission to avoid duplicate pending reports.
create or replace function public.submit_betail_report(
  p_betail_id uuid,
  p_reason_code text,
  p_reason_details text default null,
  p_betail_snapshot_comment text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_report_id uuid;
  v_reporter_id uuid;
  v_reason_details text;
  v_snapshot_comment text;
begin
  v_reporter_id := auth.uid();
  if v_reporter_id is null then
    raise exception 'Not authenticated';
  end if;

  v_reason_details := nullif(trim(coalesce(p_reason_details, '')), '');
  if p_reason_code <> 'autre' then
    v_reason_details := null;
  end if;

  v_snapshot_comment := nullif(trim(coalesce(p_betail_snapshot_comment, '')), '');

  select br.id into v_report_id
  from public.betails_reports br
  where br.betail_id = p_betail_id
    and br.reporter_id = v_reporter_id
    and br.status = 'pending'
  limit 1;

  if v_report_id is not null then
    return v_report_id;
  end if;

  begin
    insert into public.betails_reports (
      betail_id,
      reporter_id,
      reason_code,
      reason_details,
      status,
      betail_snapshot_comment
    )
    values (
      p_betail_id,
      v_reporter_id,
      p_reason_code,
      v_reason_details,
      'pending',
      v_snapshot_comment
    )
    returning id into v_report_id;
  exception
    when unique_violation then
      select br.id into v_report_id
      from public.betails_reports br
      where br.betail_id = p_betail_id
        and br.reporter_id = v_reporter_id
        and br.status = 'pending'
      limit 1;
  end;

  return v_report_id;
end;
$$;

drop trigger if exists trg_betails_reports_updated_at on public.betails_reports;
create trigger trg_betails_reports_updated_at
before update on public.betails_reports
for each row
execute function public.set_betails_reports_updated_at();

alter table public.betails_reports enable row level security;

-- Authenticated users can create their own reports.
drop policy if exists betails_reports_insert_own on public.betails_reports;
create policy betails_reports_insert_own
  on public.betails_reports
  for insert
  to authenticated
  with check (auth.uid() = reporter_id);

-- Users can read only their own reports.
drop policy if exists betails_reports_select_own on public.betails_reports;
create policy betails_reports_select_own
  on public.betails_reports
  for select
  to authenticated
  using (auth.uid() = reporter_id);

-- Admin/Moderation can read all reports.
drop policy if exists betails_reports_select_admin_mod on public.betails_reports;
create policy betails_reports_select_admin_mod
  on public.betails_reports
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.users_profiles up
      where up.id = auth.uid()
        and (
          upper(coalesce(up.role, '')) like '%ADMIN%'
          or upper(coalesce(up.role_ingame, '')) like '%ADMIN%'
          or upper(coalesce(up.role, '')) like '%MODERATION%'
          or upper(coalesce(up.role_ingame, '')) like '%MODERATION%'
        )
    )
  );

-- Admin/Moderation can update reports (status handling).
drop policy if exists betails_reports_update_admin_mod on public.betails_reports;
create policy betails_reports_update_admin_mod
  on public.betails_reports
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.users_profiles up
      where up.id = auth.uid()
        and (
          upper(coalesce(up.role, '')) like '%ADMIN%'
          or upper(coalesce(up.role_ingame, '')) like '%ADMIN%'
          or upper(coalesce(up.role, '')) like '%MODERATION%'
          or upper(coalesce(up.role_ingame, '')) like '%MODERATION%'
        )
    )
  )
  with check (
    exists (
      select 1
      from public.users_profiles up
      where up.id = auth.uid()
        and (
          upper(coalesce(up.role, '')) like '%ADMIN%'
          or upper(coalesce(up.role_ingame, '')) like '%ADMIN%'
          or upper(coalesce(up.role, '')) like '%MODERATION%'
          or upper(coalesce(up.role_ingame, '')) like '%MODERATION%'
        )
    )
  );

-- Cleanup function: remove done/rejected reports older than 6 months.
create or replace function public.cleanup_betails_reports_retention()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.betails_reports
  where status in ('done', 'rejected')
    and updated_at < now() - interval '6 months';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Daily cron (03:17 UTC). Adjust if needed.
do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'cleanup-betails-reports-daily'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'cleanup-betails-reports-daily',
    '17 3 * * *',
    $cron$select public.cleanup_betails_reports_retention();$cron$
  );
end
$$;
