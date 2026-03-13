-- Exemple 1: programmer une expédition sur un bétail précis
-- Remplace UUID_BETAIL_ICI par l'id UUID réel d'un bétail
insert into public.shipping (betail_id, scheduled_for, status, notes, scheduled_by_uuid)
values (
  'UUID_BETAIL_ICI'::uuid,
  ('2026-03-25 14:30:00 Europe/Paris')::timestamptz,
  'scheduled',
  'Test GCE - livraison planifiée',
  'UUID_USER_ICI'::uuid
)
on conflict (betail_id)
do update set
  scheduled_for = excluded.scheduled_for,
  status = excluded.status,
  notes = excluded.notes,
  scheduled_by_uuid = excluded.scheduled_by_uuid;

-- Exemple 2: injecter 8 expéditions de test sur les 8 premiers bétails non archivés
-- (utile pour visualiser le calendrier rapidement)
with picked as (
  select b.id,
         row_number() over (order by b.created_at desc) as rn
  from public.betails b
  where coalesce(b.archived, false) = false
  limit 8
)
insert into public.shipping (betail_id, scheduled_for, status, notes)
select
  p.id,
  (
    now() at time zone 'Europe/Paris'
    + make_interval(days => p.rn * 3)
    + make_interval(hours => 10 + (p.rn % 6))
  ) at time zone 'Europe/Paris',
  'scheduled',
  format('Seed test GCE #%s', p.rn)
from picked p
on conflict (betail_id)
do update set
  scheduled_for = excluded.scheduled_for,
  status = excluded.status,
  notes = excluded.notes;
