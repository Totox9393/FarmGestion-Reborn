create table if not exists public.user_relations (
  id bigserial primary key,
  user_a uuid not null references public.users_profiles(id) on delete cascade,
  user_b uuid not null references public.users_profiles(id) on delete cascade,
  initiator uuid not null references public.users_profiles(id) on delete cascade,
  status text not null
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'blocked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz null,
  pair_left uuid generated always as (least(user_a, user_b)) stored,
  pair_right uuid generated always as (greatest(user_a, user_b)) stored,
  constraint user_relations_no_self check (user_a <> user_b),
  constraint user_relations_initiator_in_pair check (initiator = user_a or initiator = user_b)
);

create unique index if not exists user_relations_pair_unique_idx
  on public.user_relations (pair_left, pair_right);

create index if not exists user_relations_user_a_status_idx
  on public.user_relations (user_a, status, created_at desc);

create index if not exists user_relations_user_b_status_idx
  on public.user_relations (user_b, status, created_at desc);

create index if not exists user_relations_status_created_idx
  on public.user_relations (status, created_at desc);

alter table public.user_relations enable row level security;

drop policy if exists user_relations_select_participants on public.user_relations;
create policy user_relations_select_participants
  on public.user_relations
  for select
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists user_relations_insert_participants on public.user_relations;
create policy user_relations_insert_participants
  on public.user_relations
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and initiator = auth.uid()
    and (auth.uid() = user_a or auth.uid() = user_b)
  );

drop policy if exists user_relations_update_participants on public.user_relations;
create policy user_relations_update_participants
  on public.user_relations
  for update
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b)
  with check (
    auth.uid() = user_a or auth.uid() = user_b
  );

drop policy if exists user_relations_delete_participants on public.user_relations;
create policy user_relations_delete_participants
  on public.user_relations
  for delete
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);
