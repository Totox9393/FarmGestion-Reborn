create table if not exists public.shipping (
  id bigserial primary key,
  betail_id uuid not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled',
  notes text null,
  estimated_gain integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_betail_id_unique unique (betail_id),
  constraint shipping_betail_id_fkey foreign key (betail_id)
    references public.betails (id)
    on delete cascade,
  constraint shipping_status_check check (status in ('scheduled', 'delivered', 'cancelled')),
  constraint shipping_estimated_gain_check check (estimated_gain >= 0)
);

create index if not exists shipping_scheduled_for_idx on public.shipping (scheduled_for asc);
create index if not exists shipping_status_idx on public.shipping (status);

create or replace function public.set_shipping_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_shipping_updated_at on public.shipping;
create trigger trg_shipping_updated_at
before update on public.shipping
for each row
execute function public.set_shipping_updated_at();

alter table public.shipping enable row level security;

-- Lecture globale pour utilisateurs authentifiés (GCE public authentifié)
drop policy if exists shipping_select_authenticated on public.shipping;
create policy shipping_select_authenticated
on public.shipping
for select
to authenticated
using (true);

-- Insertion réservée aux propriétaires des bétails (version simple)
drop policy if exists shipping_insert_owner on public.shipping;
create policy shipping_insert_owner
on public.shipping
for insert
to authenticated
with check (
  exists (
    select 1
    from public.betails b
    where b.id = shipping.betail_id
      and b.owner_id = auth.uid()
  )
);

-- Update/Delete réservés aux propriétaires des bétails (version simple)
drop policy if exists shipping_update_owner on public.shipping;
create policy shipping_update_owner
on public.shipping
for update
to authenticated
using (
  exists (
    select 1
    from public.betails b
    where b.id = shipping.betail_id
      and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.betails b
    where b.id = shipping.betail_id
      and b.owner_id = auth.uid()
  )
);

drop policy if exists shipping_delete_owner on public.shipping;
create policy shipping_delete_owner
on public.shipping
for delete
to authenticated
using (
  exists (
    select 1
    from public.betails b
    where b.id = shipping.betail_id
      and b.owner_id = auth.uid()
  )
);
