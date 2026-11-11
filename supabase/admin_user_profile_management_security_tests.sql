-- Exécuter le fichier entier avec le rôle postgres après
-- admin_user_profile_management.sql. Toutes les modifications sont annulées.
BEGIN;
SET LOCAL statement_timeout = '30s';

DO $tests$
DECLARE
  account_a constant uuid := 'a66a0133-160b-47b3-abdb-1bbcf36986a6';
  account_b constant uuid := '3f9c5bb0-99b1-4341-b92c-3e1613b32825';
  account_c constant uuid := '0ce39ca5-65cf-44fc-ad11-51acc8da1a45';
  original_role text := current_user;
  test_case jsonb;
  test_role text;
  actual_rows bigint;
  actual_error text;
  actual_message text;
  results jsonb := '[]'::jsonb;
BEGIN
  IF original_role <> 'postgres' THEN
    RAISE EXCEPTION 'Utiliser le role postgres dans SQL Editor.';
  END IF;
  IF (SELECT count(*) FROM public.users_profiles
      WHERE id IN (account_a, account_b, account_c)) <> 3 THEN
    RAISE EXCEPTION 'Un compte A/B/C est absent.';
  END IF;

  FOR test_case IN SELECT value FROM jsonb_array_elements($cases$[
    {
      "label": "Admin modifie le solde",
      "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
      "sql": "DO $check$ BEGIN PERFORM public.admin_set_user_money_reborn('3f9c5bb0-99b1-4341-b92c-3e1613b32825',1234); IF (SELECT money FROM public.users_profiles WHERE id='3f9c5bb0-99b1-4341-b92c-3e1613b32825') IS DISTINCT FROM 1234 THEN RAISE EXCEPTION 'Solde incorrect'; END IF; END; $check$",
      "rows": 0,
      "error": null
    },
    {
      "label": "Admin attribue le role moderation",
      "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
      "sql": "DO $check$ BEGIN PERFORM public.admin_set_user_role_reborn('3f9c5bb0-99b1-4341-b92c-3e1613b32825','MODERATOR'); IF (SELECT role FROM public.users_profiles WHERE id='3f9c5bb0-99b1-4341-b92c-3e1613b32825') IS DISTINCT FROM 'MODERATION' THEN RAISE EXCEPTION 'Role incorrect'; END IF; END; $check$",
      "rows": 0,
      "error": null
    },
    {
      "label": "Admin attribue le role admin",
      "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
      "sql": "DO $check$ BEGIN PERFORM public.admin_set_user_role_reborn('3f9c5bb0-99b1-4341-b92c-3e1613b32825','ADMIN'); IF (SELECT role FROM public.users_profiles WHERE id='3f9c5bb0-99b1-4341-b92c-3e1613b32825') IS DISTINCT FROM 'ADMIN' THEN RAISE EXCEPTION 'Role incorrect'; END IF; END; $check$",
      "rows": 0,
      "error": null
    },
    {
      "label": "Standard supprime les deux roles stockes",
      "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
      "sql": "DO $check$ BEGIN UPDATE public.users_profiles SET role='MODERATION',role_ingame='ADMIN' WHERE id='3f9c5bb0-99b1-4341-b92c-3e1613b32825'; PERFORM public.admin_set_user_role_reborn('3f9c5bb0-99b1-4341-b92c-3e1613b32825','STANDARD'); IF EXISTS (SELECT 1 FROM public.users_profiles WHERE id='3f9c5bb0-99b1-4341-b92c-3e1613b32825' AND (role IS NOT NULL OR role_ingame IS NOT NULL)) THEN RAISE EXCEPTION 'Roles non effaces'; END IF; END; $check$",
      "rows": 0,
      "error": null
    },
    {
      "label": "Admin ne modifie pas son propre role",
      "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
      "sql": "SELECT public.admin_set_user_role_reborn('a66a0133-160b-47b3-abdb-1bbcf36986a6','STANDARD')",
      "rows": null,
      "error": "42501"
    },
    {
      "label": "Joueur standard ne modifie pas le solde",
      "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
      "sql": "SELECT public.admin_set_user_money_reborn('3f9c5bb0-99b1-4341-b92c-3e1613b32825',1234)",
      "rows": null,
      "error": "42501"
    },
    {
      "label": "Joueur standard ne modifie pas le role",
      "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
      "sql": "SELECT public.admin_set_user_role_reborn('3f9c5bb0-99b1-4341-b92c-3e1613b32825','ADMIN')",
      "rows": null,
      "error": "42501"
    },
    {
      "label": "Solde negatif refuse",
      "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
      "sql": "SELECT public.admin_set_user_money_reborn('3f9c5bb0-99b1-4341-b92c-3e1613b32825',-1)",
      "rows": null,
      "error": "22023"
    },
    {
      "label": "Role inconnu refuse",
      "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
      "sql": "SELECT public.admin_set_user_role_reborn('3f9c5bb0-99b1-4341-b92c-3e1613b32825','SUPERADMIN')",
      "rows": null,
      "error": "22023"
    },
    {
      "label": "Visiteur deconnecte refuse",
      "actor": null,
      "sql": "SELECT public.admin_set_user_money_reborn('3f9c5bb0-99b1-4341-b92c-3e1613b32825',1234)",
      "rows": null,
      "error": "42501"
    }
  ]$cases$::jsonb) LOOP
    PERFORM set_config('role', original_role, true);
    UPDATE public.users_profiles SET role=NULL, role_ingame=NULL
    WHERE id IN (account_a, account_b, account_c);
    UPDATE public.users_profiles SET role='ADMIN' WHERE id=account_a;

    test_role := CASE WHEN test_case->>'actor' IS NULL THEN 'anon' ELSE 'authenticated' END;
    PERFORM set_config('request.jwt.claim.sub', coalesce(test_case->>'actor',''), true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', test_case->>'actor', 'role', test_role,
      'user_metadata', jsonb_build_object('role','ADMIN'))::text, true);
    PERFORM set_config('role', test_role, true);

    actual_rows := NULL;
    actual_error := NULL;
    actual_message := NULL;
    BEGIN
      EXECUTE test_case->>'sql';
      GET DIAGNOSTICS actual_rows = ROW_COUNT;
      RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='rollback test case';
    EXCEPTION
      WHEN SQLSTATE 'ZX001' THEN NULL;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          actual_error=RETURNED_SQLSTATE,
          actual_message=MESSAGE_TEXT;
    END;
    PERFORM set_config('role', original_role, true);

    IF test_case->>'error' IS NOT NULL THEN
      IF actual_error IS DISTINCT FROM test_case->>'error' THEN
        RAISE EXCEPTION 'FAIL: %. Attendu erreur %, obtenu % (%).',
          test_case->>'label', test_case->>'error', coalesce(actual_error,'AUCUNE'), actual_message;
      END IF;
    ELSIF actual_error IS NOT NULL OR actual_rows IS DISTINCT FROM (test_case->>'rows')::bigint THEN
      RAISE EXCEPTION 'FAIL: %. Attendu % lignes, obtenu %, erreur % (%).',
        test_case->>'label', test_case->>'rows', actual_rows, actual_error, actual_message;
    END IF;

    results := results || jsonb_build_array(
      jsonb_build_object('test',test_case->>'label','resultat','OK'));
  END LOOP;

  PERFORM set_config('farmgestion.admin_profile_test_results',results::text,true);
END;
$tests$;

SELECT value->>'test' AS test, value->>'resultat' AS resultat
FROM jsonb_array_elements(current_setting('farmgestion.admin_profile_test_results')::jsonb);

ROLLBACK;
