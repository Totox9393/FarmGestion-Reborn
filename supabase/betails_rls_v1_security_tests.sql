-- Exécuter le FICHIER ENTIER dans SQL Editor, rôle postgres.
-- Toutes les fixtures et modifications sont annulées. Les séquences de likes
-- peuvent avancer (trous sans conséquence). Aucun achat ni notification envoyé.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $tests$
DECLARE
  original_role text := current_user;
  test_case jsonb;
  test_role text;
  test_sql text;
  visible_count bigint;
  actual_rows bigint;
  actual_error text;
  actual_message text;
  results jsonb := '[]'::jsonb;
BEGIN
  IF original_role <> 'postgres' THEN RAISE EXCEPTION 'Utiliser le role postgres.'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.betails'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.betail_likes'::regclass) THEN
    RAISE EXCEPTION 'RLS betails/betail_likes non actives.';
  END IF;
  IF (SELECT count(*) FROM public.users_profiles WHERE id IN ('a66a0133-160b-47b3-abdb-1bbcf36986a6','3f9c5bb0-99b1-4341-b92c-3e1613b32825','0ce39ca5-65cf-44fc-ad11-51acc8da1a45')) <> 3 THEN
    RAISE EXCEPTION 'Compte A/B/C absent.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.betails WHERE id IN ('892da712-86d9-4aaf-a390-000000000001','892da712-86d9-4aaf-a390-000000000002','892da712-86d9-4aaf-a390-000000000003','892da712-86d9-4aaf-a390-000000000004','892da712-86d9-4aaf-a390-000000000005','892da712-86d9-4aaf-a390-000000000006','892da712-86d9-4aaf-a390-000000000099') OR matricule LIKE '__RLS_BETAIL_93%')
    OR EXISTS (SELECT 1 FROM public.farms_list WHERE id=-930000001 OR name='__RLS_BETAIL_FARM_93__')
    OR EXISTS (SELECT 1 FROM public.shipping WHERE id IN (-930000001,-930000002)) THEN
    RAISE EXCEPTION 'Identifiants de fixtures deja presents.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled <> 'D' AND (
      (t.tgrelid='public.betails'::regclass AND t.tgname NOT IN ('trg_guard_locked_betail_updates_reborn','trg_notify_discord_betail_created','trg_notify_discord_betail_purchased'))
      OR (t.tgrelid='public.betail_likes'::regclass AND t.tgname <> 'trg_betail_likes_apply_count_delta')
      OR (t.tgrelid='public.shipping'::regclass AND t.tgname NOT IN ('trg_guard_shipping_on_locked_betail_reborn','trg_shipping_updated_at'))
      OR (t.tgrelid='public.users_profiles'::regclass AND t.tgname <> 'guard_profile_client_update_reborn')
      OR t.tgrelid='public.farms_list'::regclass
    )
  ) THEN RAISE EXCEPTION 'Trigger supplementaire detecte : verifier avant les fixtures.'; END IF;
  -- On vérifie les conditions qui empêchent les notifications de création/achat.
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.betails'::regclass
    AND tgname IN ('trg_notify_discord_betail_created','trg_notify_discord_betail_purchased')
    AND (tgqual IS NULL OR position('WHEN' IN pg_get_triggerdef(oid))=0)) THEN
    RAISE EXCEPTION 'Conditions des triggers de notification absentes.';
  END IF;
  UPDATE public.users_profiles SET role=NULL,role_ingame=NULL WHERE id IN ('a66a0133-160b-47b3-abdb-1bbcf36986a6','3f9c5bb0-99b1-4341-b92c-3e1613b32825','0ce39ca5-65cf-44fc-ad11-51acc8da1a45');
  INSERT INTO public.farms_list(id,name,proprietaire,visible)
    VALUES (-930000001,'__RLS_BETAIL_FARM_93__','a66a0133-160b-47b3-abdb-1bbcf36986a6',false);
  -- INSERT invisible : pas de notification de création. Propriétaire fixé ici,
  -- jamais modifié depuis NULL : pas de notification d'achat.
  INSERT INTO public.betails(id,matricule,name,author_id,owner_id,farm_id,visible,comments,like_count)
  SELECT x.id::uuid,'__RLS_BETAIL_93_' || x.n,'Test RLS','a66a0133-160b-47b3-abdb-1bbcf36986a6'::uuid,
    CASE WHEN x.n=6 THEN NULL ELSE 'a66a0133-160b-47b3-abdb-1bbcf36986a6'::uuid END,
    CASE WHEN x.n=6 THEN NULL ELSE -930000001 END,false,'Commentaire test',0
  FROM (VALUES ('892da712-86d9-4aaf-a390-000000000001',1),('892da712-86d9-4aaf-a390-000000000002',2),('892da712-86d9-4aaf-a390-000000000003',3),('892da712-86d9-4aaf-a390-000000000004',4),('892da712-86d9-4aaf-a390-000000000005',5),('892da712-86d9-4aaf-a390-000000000006',6)) x(id,n);
  UPDATE public.betails SET visible=true WHERE id IN ('892da712-86d9-4aaf-a390-000000000001','892da712-86d9-4aaf-a390-000000000003','892da712-86d9-4aaf-a390-000000000005','892da712-86d9-4aaf-a390-000000000006');
  INSERT INTO public.betail_likes(betail_id,user_id) VALUES ('892da712-86d9-4aaf-a390-000000000006','a66a0133-160b-47b3-abdb-1bbcf36986a6');
  UPDATE public.betails SET auction_locked=true WHERE id='892da712-86d9-4aaf-a390-000000000003';
  INSERT INTO public.shipping(id,betail_id,scheduled_for,status,scheduled_by_uuid,estimated_gain)
  VALUES (-930000001,'892da712-86d9-4aaf-a390-000000000005',now()+interval '30 days','scheduled','a66a0133-160b-47b3-abdb-1bbcf36986a6',0),
         (-930000002,'892da712-86d9-4aaf-a390-000000000004',now()-interval '1 day','delivered','a66a0133-160b-47b3-abdb-1bbcf36986a6',0);
  SELECT count(*) INTO visible_count FROM public.betails WHERE visible IS TRUE;

  FOR test_case IN SELECT value FROM jsonb_array_elements(
    $cases$[
  {
    "label": "A lit son betail visible",
    "sql": "SELECT id FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": 1,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "B lit un betail visible de la ferme privee de A",
    "sql": "SELECT id FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": 1,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": null,
    "staff": null
  },
  {
    "label": "C lit le betail du registre sans proprietaire",
    "sql": "SELECT id FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000006'",
    "rows": 1,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": null
  },
  {
    "label": "A lit son propre betail invisible",
    "sql": "SELECT id FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000002'",
    "rows": 1,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "B ne lit pas le betail invisible de A",
    "sql": "SELECT id FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000002'",
    "rows": 0,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": null,
    "staff": null
  },
  {
    "label": "C ne lit pas le betail invisible de A",
    "sql": "SELECT id FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000002'",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": null
  },
  {
    "label": "A modifie son commentaire",
    "sql": "WITH edited AS (UPDATE public.betails SET comments='test rls' WHERE id='892da712-86d9-4aaf-a390-000000000001' RETURNING comments) SELECT 1 FROM edited WHERE comments='test rls'",
    "rows": 1,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "B ne modifie pas le commentaire de A",
    "sql": "UPDATE public.betails SET comments='test rls' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": 0,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": null,
    "staff": null
  },
  {
    "label": "A ne modifie pas son betail invisible",
    "sql": "UPDATE public.betails SET comments='test rls' WHERE id='892da712-86d9-4aaf-a390-000000000002'",
    "rows": 0,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "Un betail sans proprietaire ne peut pas etre modifie",
    "sql": "UPDATE public.betails SET comments='test rls' WHERE id='892da712-86d9-4aaf-a390-000000000006'",
    "rows": 0,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "A ne modifie pas directement owner_id",
    "sql": "UPDATE public.betails SET owner_id='3f9c5bb0-99b1-4341-b92c-3e1613b32825' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement author_id",
    "sql": "UPDATE public.betails SET author_id='3f9c5bb0-99b1-4341-b92c-3e1613b32825' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement farm_id",
    "sql": "UPDATE public.betails SET farm_id=NULL WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement farm_site",
    "sql": "UPDATE public.betails SET farm_site='1' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement name",
    "sql": "UPDATE public.betails SET name='FORGED' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement matricule",
    "sql": "UPDATE public.betails SET matricule='FORGED' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement age",
    "sql": "UPDATE public.betails SET age=99 WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement premium",
    "sql": "UPDATE public.betails SET premium=true WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement avatar_url",
    "sql": "UPDATE public.betails SET avatar_url='https://example.invalid/test.png' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement visible",
    "sql": "UPDATE public.betails SET visible=false WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement like_count",
    "sql": "UPDATE public.betails SET like_count=99999 WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement equipped_badges",
    "sql": "UPDATE public.betails SET equipped_badges='[]'::jsonb WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement admin_reward_badge_ids",
    "sql": "UPDATE public.betails SET admin_reward_badge_ids='[]'::jsonb WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement auction_locked",
    "sql": "UPDATE public.betails SET auction_locked=true WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement auction_session_id",
    "sql": "UPDATE public.betails SET auction_session_id=NULL WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement purchased_at",
    "sql": "UPDATE public.betails SET purchased_at=now() WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement created_at",
    "sql": "UPDATE public.betails SET created_at=now() WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement invisible_at",
    "sql": "UPDATE public.betails SET invisible_at=now() WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement invisible_reason",
    "sql": "UPDATE public.betails SET invisible_reason='test' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne modifie pas directement id",
    "sql": "UPDATE public.betails SET id='892da712-86d9-4aaf-a390-000000000099' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne supprime pas directement son betail",
    "sql": "DELETE FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "Creation directe interdite",
    "sql": "INSERT INTO public.betails(id,matricule,name,author_id,visible) VALUES ('892da712-86d9-4aaf-a390-000000000099','__RLS_FORGED__','Test','a66a0133-160b-47b3-abdb-1bbcf36986a6',false)",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "Le verrou encheres bloque le commentaire du proprietaire",
    "sql": "UPDATE public.betails SET comments='test' WHERE id='892da712-86d9-4aaf-a390-000000000003'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "P0001",
    "staff": null
  },
  {
    "label": "B peut liker une seule fois puis retirer son like",
    "sql": "DO $check$ BEGIN \nPERFORM public.like_betail('892da712-86d9-4aaf-a390-000000000001');\nIF (SELECT like_count FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Compteur attendu: 1'; END IF;\nPERFORM public.like_betail('892da712-86d9-4aaf-a390-000000000001');\nIF (SELECT like_count FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Double like comptabilise'; END IF;\nPERFORM public.unlike_betail('892da712-86d9-4aaf-a390-000000000001');\nPERFORM public.unlike_betail('892da712-86d9-4aaf-a390-000000000001');\nIF (SELECT like_count FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001') IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Compteur attendu: 0'; END IF;\nIF EXISTS (SELECT 1 FROM public.betail_likes WHERE betail_id='892da712-86d9-4aaf-a390-000000000001' AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Like encore present'; END IF;\n END; $check$",
    "rows": 0,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": null,
    "staff": null
  },
  {
    "label": "B ne peut pas liker au nom de A",
    "sql": "INSERT INTO public.betail_likes(betail_id,user_id) VALUES ('892da712-86d9-4aaf-a390-000000000001','a66a0133-160b-47b3-abdb-1bbcf36986a6')",
    "rows": null,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": "42501",
    "staff": null
  },
  {
    "label": "B ne peut pas retirer le like de A",
    "sql": "DELETE FROM public.betail_likes WHERE betail_id='892da712-86d9-4aaf-a390-000000000006' AND user_id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": 0,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": null,
    "staff": null
  },
  {
    "label": "A ne peut pas liker un betail invisible meme possede",
    "sql": "SELECT * FROM public.like_betail('892da712-86d9-4aaf-a390-000000000002')",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "P0001",
    "staff": null
  },
  {
    "label": "Le verrou encheres reste applique aux likes",
    "sql": "SELECT * FROM public.like_betail('892da712-86d9-4aaf-a390-000000000003')",
    "rows": null,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": "P0001",
    "staff": null
  },
  {
    "label": "ADMIN lit le betail invisible de A",
    "sql": "SELECT id FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000002'",
    "rows": 1,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": "ADMIN"
  },
  {
    "label": "ADMIN : replace_photo via fonction reservee",
    "sql": "DO $check$ BEGIN PERFORM public.moderate_betail_content_reborn('892da712-86d9-4aaf-a390-000000000001','replace_photo','https://example.invalid/mod.png'); IF (SELECT avatar_url FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001') IS DISTINCT FROM 'https://example.invalid/mod.png' THEN RAISE EXCEPTION 'Action moderation non appliquee'; END IF; END; $check$",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": "ADMIN"
  },
  {
    "label": "ADMIN : remove_comment via fonction reservee",
    "sql": "DO $check$ BEGIN PERFORM public.moderate_betail_content_reborn('892da712-86d9-4aaf-a390-000000000001','remove_comment'); IF (SELECT comments FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001') IS DISTINCT FROM NULL THEN RAISE EXCEPTION 'Action moderation non appliquee'; END IF; END; $check$",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": "ADMIN"
  },
  {
    "label": "MODERATION lit le betail invisible de A",
    "sql": "SELECT id FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000002'",
    "rows": 1,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": "MODERATION"
  },
  {
    "label": "MODERATION : replace_photo via fonction reservee",
    "sql": "DO $check$ BEGIN PERFORM public.moderate_betail_content_reborn('892da712-86d9-4aaf-a390-000000000001','replace_photo','https://example.invalid/mod.png'); IF (SELECT avatar_url FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001') IS DISTINCT FROM 'https://example.invalid/mod.png' THEN RAISE EXCEPTION 'Action moderation non appliquee'; END IF; END; $check$",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": "MODERATION"
  },
  {
    "label": "MODERATION : remove_comment via fonction reservee",
    "sql": "DO $check$ BEGIN PERFORM public.moderate_betail_content_reborn('892da712-86d9-4aaf-a390-000000000001','remove_comment'); IF (SELECT comments FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001') IS DISTINCT FROM NULL THEN RAISE EXCEPTION 'Action moderation non appliquee'; END IF; END; $check$",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": "MODERATION"
  },
  {
    "label": "B ne peut pas appeler la correction de moderation",
    "sql": "SELECT public.moderate_betail_content_reborn('892da712-86d9-4aaf-a390-000000000001','remove_comment')",
    "rows": null,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": "42501",
    "staff": null
  },
  {
    "label": "Le staff ne modifie pas directement le commentaire tiers",
    "sql": "UPDATE public.betails SET comments='test' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": "ADMIN"
  },
  {
    "label": "Le staff ne modifie pas directement le premium",
    "sql": "UPDATE public.betails SET premium=true WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": "42501",
    "staff": "ADMIN"
  },
  {
    "label": "Moderation : action inconnue refusee",
    "sql": "SELECT public.moderate_betail_content_reborn('892da712-86d9-4aaf-a390-000000000001','change_owner')",
    "rows": null,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": "22023",
    "staff": "MODERATION"
  },
  {
    "label": "Moderation : photo vide refusee",
    "sql": "SELECT public.moderate_betail_content_reborn('892da712-86d9-4aaf-a390-000000000001','replace_photo',' ')",
    "rows": null,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": "22023",
    "staff": "MODERATION"
  },
  {
    "label": "Moderation : betail inexistant signale",
    "sql": "SELECT public.moderate_betail_content_reborn('892da712-86d9-4aaf-a390-000000000099','remove_comment')",
    "rows": null,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": "P0002",
    "staff": "MODERATION"
  },
  {
    "label": "C ne lit pas la fiche invisible du betail livre",
    "sql": "SELECT id FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000004'",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": null
  },
  {
    "label": "C voit les details des expeditions programmee et livree",
    "sql": "SELECT id FROM public.get_shipping_betails_reborn(ARRAY['892da712-86d9-4aaf-a390-000000000005','892da712-86d9-4aaf-a390-000000000004']::uuid[])",
    "rows": 2,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": null
  },
  {
    "label": "Le helper expedition ne renvoie pas les betails sans expedition",
    "sql": "SELECT id FROM public.get_shipping_betails_reborn(ARRAY['892da712-86d9-4aaf-a390-000000000001','892da712-86d9-4aaf-a390-000000000002']::uuid[])",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": null
  },
  {
    "label": "Le helper expedition ne divulgue pas commentaires badges ou moderation",
    "sql": "SELECT id FROM public.get_shipping_betails_reborn(ARRAY['892da712-86d9-4aaf-a390-000000000004']::uuid[]) p WHERE NOT (to_jsonb(p) ?| ARRAY['comments','equipped_badges','admin_reward_badge_ids','invisible_reason','invisible_at'])",
    "rows": 1,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": null
  },
  {
    "label": "La ferme privee reste inaccessible a C",
    "sql": "SELECT id FROM public.farms_list WHERE id=-930000001",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": null
  },
  {
    "label": "Le nom de ferme reste accessible pour les expeditions",
    "sql": "SELECT id FROM public.get_shipping_farm_names_reborn(ARRAY[-930000001]::bigint[])",
    "rows": 1,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": null
  },
  {
    "label": "Le compteur public correspond aux betails visibles",
    "sql": "SELECT 1 WHERE public.get_visible_betails_count_reborn()=%VISIBLE_COUNT%",
    "rows": 1,
    "actor": null,
    "error": null,
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : lecture table interdite",
    "sql": "SELECT id FROM public.betails",
    "rows": null,
    "actor": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : creation interdite",
    "sql": "INSERT INTO public.betails(id,matricule,name,author_id,visible) VALUES ('892da712-86d9-4aaf-a390-000000000099','__RLS_FORGED__','Test','a66a0133-160b-47b3-abdb-1bbcf36986a6',false)",
    "rows": null,
    "actor": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : modification interdite",
    "sql": "UPDATE public.betails SET comments='x' WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : suppression interdite",
    "sql": "DELETE FROM public.betails WHERE id='892da712-86d9-4aaf-a390-000000000001'",
    "rows": null,
    "actor": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : details expedition interdite",
    "sql": "SELECT * FROM public.get_shipping_betails_reborn(ARRAY['892da712-86d9-4aaf-a390-000000000004']::uuid[])",
    "rows": null,
    "actor": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : moderation interdite",
    "sql": "SELECT public.moderate_betail_content_reborn('892da712-86d9-4aaf-a390-000000000001','remove_comment')",
    "rows": null,
    "actor": null,
    "error": "42501",
    "staff": null
  }
]$cases$::jsonb
  ) LOOP
    PERFORM set_config('role',original_role,true);
    UPDATE public.users_profiles SET role=test_case->>'staff',role_ingame=NULL WHERE id='0ce39ca5-65cf-44fc-ad11-51acc8da1a45';
    test_role := CASE WHEN test_case->>'actor' IS NULL THEN 'anon' ELSE 'authenticated' END;
    PERFORM set_config('request.jwt.claim.sub',coalesce(test_case->>'actor',''),true);
    -- Identité réelle simulée via le rôle SQL et le JWT ; métadonnées non fiables.
    PERFORM set_config('request.jwt.claims',jsonb_build_object(
      'sub',test_case->>'actor','role',test_role,'email','forged@example.invalid',
      'user_metadata',jsonb_build_object('role','ADMIN','money',999999))::text,true);
    PERFORM set_config('app.auction_bypass','0',true);
    PERFORM set_config('role',test_role,true);
    IF current_user <> test_role
       OR auth.uid() IS DISTINCT FROM (test_case->>'actor')::uuid
       OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
       OR EXISTS (SELECT 1 FROM pg_class WHERE oid='public.betails'::regclass
         AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
      RAISE EXCEPTION 'Identite de test invalide.';
    END IF;
    test_sql := replace(test_case->>'sql','%VISIBLE_COUNT%',visible_count::text);
    actual_rows := NULL;
    actual_error := NULL;
    actual_message := NULL;
    BEGIN
      EXECUTE test_sql;
      GET DIAGNOSTICS actual_rows = ROW_COUNT;
      -- Annulation de chaque tentative réussie, sans perdre les variables du test.
      RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='rollback test case';
    EXCEPTION
      WHEN SQLSTATE 'ZX001' THEN NULL;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_error=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT;
    END;
    PERFORM set_config('role',original_role,true);
    IF test_case->>'error' IS NOT NULL THEN
      IF actual_error IS DISTINCT FROM test_case->>'error' THEN
        RAISE EXCEPTION 'FAIL: %. Attendu erreur %, obtenu % (%).',
          test_case->>'label',test_case->>'error',coalesce(actual_error,'AUCUNE'),actual_message;
      END IF;
    ELSIF actual_error IS NOT NULL OR actual_rows IS DISTINCT FROM (test_case->>'rows')::bigint THEN
      RAISE EXCEPTION 'FAIL: %. Attendu % lignes, obtenu %, erreur % (%).',
        test_case->>'label',test_case->>'rows',actual_rows,actual_error,actual_message;
    END IF;
    results := results || jsonb_build_array(jsonb_build_object('test',test_case->>'label','resultat','OK'));
  END LOOP;
  PERFORM set_config('farmgestion.betails_rls_test_results',results::text,true);
END;
$tests$;

SELECT value->>'test' AS test, value->>'resultat' AS resultat
FROM jsonb_array_elements(current_setting('farmgestion.betails_rls_test_results')::jsonb);

ROLLBACK;
