-- Executer le fichier ENTIER avec le role postgres.
-- Toutes les donnees de test et suppressions sont annulees par ROLLBACK.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $tests$
DECLARE
  account_a constant uuid := 'a66a0133-160b-47b3-abdb-1bbcf36986a6';
  account_b constant uuid := '3f9c5bb0-99b1-4341-b92c-3e1613b32825';
  account_c constant uuid := '0ce39ca5-65cf-44fc-ad11-51acc8da1a45';
  account_d constant uuid := 'd7e1e7ed-9400-4da1-9000-000000000001';
  owned_betail constant uuid := '892da712-86d9-4aaf-a390-00000000d001';
  authored_betail constant uuid := '892da712-86d9-4aaf-a390-00000000d002';
  active_session constant uuid := 'a7c71000-0000-4000-8000-000000000001';
  history_session constant uuid := 'a7c71000-0000-4000-8000-000000000002';
  active_slot constant uuid := 'a7c72000-0000-4000-8000-000000000001';
  history_slot constant uuid := 'a7c72000-0000-4000-8000-000000000002';
  original_role text := current_user;
  preserved_badge uuid;
  returned_badge uuid;
  preserved_sold_before integer;
  returned_sold_before integer;
  deletion_result jsonb;
  actual_error text;
  actual_message text;
  results jsonb := '[]'::jsonb;
BEGIN
  IF original_role <> 'postgres' THEN
    RAISE EXCEPTION 'Utiliser le role postgres dans SQL Editor.';
  END IF;
  IF to_regprocedure('public.admin_delete_user_account_reborn(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Executer admin_delete_user_account_reborn.sql avant ce controle.';
  END IF;
  IF (SELECT count(*) FROM public.users_profiles
      WHERE id IN (account_a, account_b, account_c)) <> 3 THEN
    RAISE EXCEPTION 'Un compte A/B/C est absent.';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = account_d)
     OR EXISTS (SELECT 1 FROM public.farms_list WHERE id = -940000001)
     OR EXISTS (SELECT 1 FROM public.betails WHERE id IN (owned_betail, authored_betail))
     OR EXISTS (SELECT 1 FROM public.auction_sessions_reborn WHERE id IN (active_session, history_session)) THEN
    RAISE EXCEPTION 'Un identifiant reserve au controle existe deja.';
  END IF;

  SELECT c.id
  INTO preserved_badge
  FROM public.badges_catalog_reborn c
  WHERE coalesce(c.stock_total, 0) >= 1
    AND NOT EXISTS (
    SELECT 1 FROM public.badges_inventory_reborn i
    WHERE i.user_id = account_b AND i.badge_id = c.id
  )
  ORDER BY c.id
  LIMIT 1;

  SELECT c.id
  INTO returned_badge
  FROM public.badges_catalog_reborn c
  WHERE c.id <> preserved_badge
    AND coalesce(c.stock_total, 0) >= 1
  ORDER BY c.id
  LIMIT 1;

  IF preserved_badge IS NULL OR returned_badge IS NULL THEN
    RAISE EXCEPTION 'Deux badges catalogue sont necessaires au controle.';
  END IF;

  INSERT INTO auth.users(id, email)
  VALUES (account_d, '__delete_test_d__@example.invalid');

  INSERT INTO public.users_profiles(id, username, email, money, role, role_ingame)
  VALUES (account_d, '__FG_DELETE_TEST_D__', '__delete_test_d__@example.invalid', 321, NULL, NULL);

  INSERT INTO public.farms_list(id, name, proprietaire, visible)
  VALUES (-940000001, '__FG_DELETE_FARM_D__', account_d, false);

  UPDATE public.users_profiles SET farm_id = -940000001 WHERE id = account_d;

  -- Invisibles a l'insertion pour ne declencher aucune notification Discord.
  INSERT INTO public.betails(
    id, matricule, name, author_id, owner_id, farm_id, farm_site,
    purchased_at, visible, comments, like_count, premium
  ) VALUES
    (owned_betail, '__DELETE_D_1__', 'Betail libere', account_d, account_d,
      -940000001, '1', now(), false, 'Attributs a conserver', 0, true),
    (authored_betail, '__DELETE_D_2__', 'Betail auteur inconnu', account_d, account_b,
      NULL, NULL, now(), false, 'Possede par B', 0, true);

  INSERT INTO public.shipping(id, betail_id, scheduled_for, status, scheduled_by_uuid, estimated_gain)
  VALUES (-940000001, owned_betail, now() + interval '10 days', 'scheduled', account_d, 100);

  INSERT INTO public.betail_likes(betail_id, user_id)
  VALUES (authored_betail, account_d);

  INSERT INTO public.betails_reports(
    id, betail_id, reporter_id, reason_code, status, betail_snapshot_comment
  ) VALUES (
    'd7e1e7ed-9400-4da1-9000-000000000002', authored_betail, account_d,
    'photo_inappropriee', 'done', 'Historique a conserver'
  );

  INSERT INTO public.user_relations(id, user_a, user_b, initiator, status)
  VALUES (-940000001, LEAST(account_c, account_d), GREATEST(account_c, account_d), account_d, 'accepted');

  -- Autorise uniquement les fixtures d'enchere dans cette transaction.
  -- Le ROLLBACK final restaure le mode veille actuel.
  UPDATE public.auction_config_reborn
  SET system_enabled = true
  WHERE id = true;

  INSERT INTO public.auction_sessions_reborn(
    id, status, slots_count, fill_deadline_at, open_at, end_at, launched_mode, created_by
  ) VALUES
    (active_session, 'open', 2, now() + interval '1 day', now() - interval '1 hour', now() + interval '2 hours', 'admin', account_a),
    (history_session, 'closed', 2, now() - interval '2 days', now() - interval '2 days', now() - interval '1 day', 'admin', account_a);

  INSERT INTO public.auction_slots_reborn(
    id, session_id, slot_index, betail_id, seller_user_id, status, winner_user_id, winning_bid_amount
  ) VALUES
    (active_slot, active_session, 1, owned_betail, account_d, 'listed', NULL, NULL),
    (history_slot, history_session, 1, authored_betail, account_d, 'sold', account_b, 500);

  INSERT INTO public.auction_bids_reborn(
    id, session_id, slot_id, bidder_user_id, amount, increment_used
  ) VALUES
    (-940000001, active_session, active_slot, account_d, 200, 200),
    (-940000002, history_session, history_slot, account_d, 500, 200);

  PERFORM set_config('app.auction_bypass', '1', true);
  UPDATE public.betails
  SET auction_locked = true, auction_session_id = active_session
  WHERE id = owned_betail;

  SELECT greatest(1, coalesce(c.sold_count, 0)) INTO preserved_sold_before
  FROM public.badges_catalog_reborn c WHERE c.id = preserved_badge;
  SELECT greatest(1, coalesce(c.sold_count, 0)) INTO returned_sold_before
  FROM public.badges_catalog_reborn c WHERE c.id = returned_badge;

  UPDATE public.badges_catalog_reborn SET sold_count = preserved_sold_before WHERE id = preserved_badge;
  UPDATE public.badges_catalog_reborn SET sold_count = returned_sold_before WHERE id = returned_badge;

  INSERT INTO public.badges_inventory_reborn(user_id, badge_id, purchase_price, source)
  VALUES
    (account_d, preserved_badge, 100, 'shop'),
    (account_d, returned_badge, 100, 'shop');

  INSERT INTO public.badges_equips_reborn(user_id, badge_id, betail_id, farm_id, slot)
  VALUES
    (account_d, preserved_badge, owned_betail, NULL, 1),
    (account_d, returned_badge, NULL, -940000001, 1);

  UPDATE public.users_profiles SET role = NULL, role_ingame = NULL
  WHERE id IN (account_a, account_b, account_c, account_d);
  UPDATE public.users_profiles SET role = 'ADMIN' WHERE id = account_a;

  -- Un joueur standard ne peut pas supprimer un compte.
  PERFORM set_config('request.jwt.claim.sub', account_c::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',account_c,'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  actual_error := NULL;
  actual_message := NULL;
  BEGIN
    PERFORM public.admin_delete_user_account_reborn(account_d);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_error=RETURNED_SQLSTATE, actual_message=MESSAGE_TEXT;
  END;
  PERFORM set_config('role', original_role, true);
  IF actual_error IS DISTINCT FROM '42501' OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=account_d) THEN
    RAISE EXCEPTION 'FAIL: joueur standard refuse. Erreur % (%).', actual_error, actual_message;
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Joueur standard ne supprime pas un compte','resultat','OK'));

  -- L'administrateur ne peut pas se supprimer lui-meme.
  PERFORM set_config('request.jwt.claim.sub', account_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',account_a,'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  actual_error := NULL;
  actual_message := NULL;
  BEGIN
    PERFORM public.admin_delete_user_account_reborn(account_a);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_error=RETURNED_SQLSTATE, actual_message=MESSAGE_TEXT;
  END;
  PERFORM set_config('role', original_role, true);
  IF actual_error IS DISTINCT FROM '42501' OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=account_a) THEN
    RAISE EXCEPTION 'FAIL: auto-suppression refusee. Erreur % (%).', actual_error, actual_message;
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Admin ne peut pas se supprimer lui-meme','resultat','OK'));

  -- Un visiteur deconnecte ne peut pas supprimer un compte.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anon')::text, true);
  PERFORM set_config('role', 'anon', true);
  actual_error := NULL;
  actual_message := NULL;
  BEGIN
    PERFORM public.admin_delete_user_account_reborn(account_d);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_error=RETURNED_SQLSTATE, actual_message=MESSAGE_TEXT;
  END;
  PERFORM set_config('role', original_role, true);
  IF actual_error IS DISTINCT FROM '42501' OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=account_d) THEN
    RAISE EXCEPTION 'FAIL: visiteur deconnecte refuse. Erreur % (%).', actual_error, actual_message;
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Visiteur deconnecte ne supprime pas un compte','resultat','OK'));

  -- Suppression autorisee de la fixture D.
  PERFORM set_config('request.jwt.claim.sub', account_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',account_a,'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT public.admin_delete_user_account_reborn(account_d) INTO deletion_result;
  PERFORM set_config('role', original_role, true);

  IF NOT coalesce((deletion_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'FAIL: suppression admin sans succes (%).', deletion_result;
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Admin peut supprimer un autre compte','resultat','OK'));

  IF EXISTS (SELECT 1 FROM auth.users WHERE id=account_d)
     OR EXISTS (SELECT 1 FROM public.users_profiles WHERE id=account_d) THEN
    RAISE EXCEPTION 'FAIL: compte Auth ou profil encore present.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Compte Auth et profil supprimes','resultat','OK'));

  IF EXISTS (SELECT 1 FROM public.farms_list WHERE proprietaire=account_d OR id=-940000001) THEN
    RAISE EXCEPTION 'FAIL: ferme encore presente.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Ferme supprimee','resultat','OK'));

  IF NOT EXISTS (
    SELECT 1 FROM public.betails b
    WHERE b.id=owned_betail AND b.owner_id IS NULL AND b.farm_id IS NULL
      AND b.farm_site IS NULL AND b.purchased_at IS NULL AND b.author_id IS NULL
      AND b.visible IS TRUE AND b.auction_locked IS FALSE AND b.auction_session_id IS NULL
      AND b.name='Betail libere' AND b.comments='Attributs a conserver'
  ) THEN
    RAISE EXCEPTION 'FAIL: betail possede mal libere.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Betail retourne complet au registre','resultat','OK'));

  IF NOT EXISTS (
    SELECT 1 FROM public.betails b
    WHERE b.id=authored_betail AND b.owner_id=account_b AND b.author_id IS NULL
      AND b.name='Betail auteur inconnu' AND b.comments='Possede par B'
  ) THEN
    RAISE EXCEPTION 'FAIL: betail cree puis possede par B incorrect.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Betail tiers conserve avec auteur inconnu','resultat','OK'));

  IF EXISTS (SELECT 1 FROM public.shipping WHERE id=-940000001 OR scheduled_by_uuid=account_d) THEN
    RAISE EXCEPTION 'FAIL: expedition encore presente.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Expedition supprimee du calendrier','resultat','OK'));

  IF EXISTS (SELECT 1 FROM public.betail_likes WHERE user_id=account_d)
     OR (SELECT like_count FROM public.betails WHERE id=authored_betail) <> 0 THEN
    RAISE EXCEPTION 'FAIL: like ou compteur incorrect.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Likes supprimes et compteurs corriges','resultat','OK'));

  IF EXISTS (SELECT 1 FROM public.user_relations WHERE user_a=account_d OR user_b=account_d OR initiator=account_d) THEN
    RAISE EXCEPTION 'FAIL: relation encore presente.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Relations et blocages supprimes','resultat','OK'));

  IF NOT EXISTS (
    SELECT 1 FROM public.betails_reports
    WHERE id='d7e1e7ed-9400-4da1-9000-000000000002' AND reporter_id IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL: signalement supprime ou non anonymise.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Signalement conserve et anonymise','resultat','OK'));

  IF EXISTS (SELECT 1 FROM public.auction_slots_reborn WHERE id=active_slot)
     OR EXISTS (SELECT 1 FROM public.auction_bids_reborn WHERE id=-940000001) THEN
    RAISE EXCEPTION 'FAIL: enchere active non annulee.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Enchere et mise actives annulees','resultat','OK'));

  IF NOT EXISTS (
    SELECT 1 FROM public.auction_slots_reborn
    WHERE id=history_slot AND seller_user_id IS NULL AND winner_user_id=account_b
  ) OR NOT EXISTS (
    SELECT 1 FROM public.auction_bids_reborn
    WHERE id=-940000002 AND bidder_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL: historique enchere absent ou non anonymise.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Historique enchere conserve et anonymise','resultat','OK'));

  IF EXISTS (SELECT 1 FROM public.badges_inventory_reborn WHERE user_id=account_d)
     OR EXISTS (SELECT 1 FROM public.badges_equips_reborn WHERE farm_id=-940000001) THEN
    RAISE EXCEPTION 'FAIL: inventaire ou badge de ferme encore present.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.badges_equips_reborn
    WHERE betail_id=owned_betail AND badge_id=preserved_badge AND user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL: badge du betail non conserve.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Badge du betail conserve sans proprietaire','resultat','OK'));

  IF (SELECT sold_count FROM public.badges_catalog_reborn WHERE id=preserved_badge)
       IS DISTINCT FROM preserved_sold_before
     OR (SELECT sold_count FROM public.badges_catalog_reborn WHERE id=returned_badge)
       IS DISTINCT FROM returned_sold_before - 1 THEN
    RAISE EXCEPTION 'FAIL: restitution du stock incorrecte.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Seuls les badges hors betail retournent en stock','resultat','OK'));

  IF position('b.author_id is distinct from v_user_id' in lower(pg_get_functiondef(
      'public.purchase_betail_reborn(uuid)'::regprocedure))) = 0
     OR position('betail_transfer' in pg_get_functiondef(
      'public.purchase_betail_reborn(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL: reprise future des badges/auteur inconnu absente.';
  END IF;
  results := results || jsonb_build_array(jsonb_build_object('test','Achat futur accepte auteur inconnu et reprend les badges','resultat','OK'));

  PERFORM set_config('farmgestion.admin_delete_tests', results::text, true);
END;
$tests$;

SELECT value->>'test' AS test, value->>'resultat' AS resultat
FROM jsonb_array_elements(current_setting('farmgestion.admin_delete_tests')::jsonb);

ROLLBACK;
