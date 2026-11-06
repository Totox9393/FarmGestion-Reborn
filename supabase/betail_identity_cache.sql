-- Cache des identites visuelles (personnes/personnages) reconnues sur les photos des betails.
-- Alimente la fonction edge `registry-identities` pour ne pas proposer des personnalites deja presentes.
-- Acces reserve au service role : RLS active, aucune policy.

create table if not exists public.betail_identity_cache (
  betail_id uuid primary key references public.betails (id) on delete cascade,
  avatar_url text not null,
  identity text not null default '',
  known boolean not null default false,
  analyzed_at timestamptz not null default now()
);

alter table public.betail_identity_cache enable row level security;
