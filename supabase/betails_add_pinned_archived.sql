alter table public.betails
  add column if not exists pinned boolean not null default false,
  add column if not exists archived boolean not null default false;

create index if not exists idx_betails_owner_pinned_created
  on public.betails (owner_id, pinned, purchased_at desc, created_at desc);

create index if not exists idx_betails_owner_archived_created
  on public.betails (owner_id, archived, purchased_at desc, created_at desc);
