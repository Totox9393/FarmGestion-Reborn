-- Exécuter le FICHIER ENTIER dans Supabase SQL Editor, rôle postgres.
-- Chaque tentative est annulée, puis ROLLBACK annule toutes les fixtures.
-- Ne supprime aucun compte existant. Le compte Auth fictif n'est jamais validé.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $tests$
DECLARE
  original_role text := current_user;
  test_case jsonb;
  test_role text;
  test_sql text;
  existing_username text;
  actual_rows bigint;
  actual_error text;
  actual_message text;
  results jsonb := '[]'::jsonb;
BEGIN
  IF original_role <> 'postgres' THEN RAISE EXCEPTION 'Utiliser le role postgres dans SQL Editor.'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.users_profiles'::regclass) THEN
    RAISE EXCEPTION 'Les RLS users_profiles ne sont pas actives.';
  END IF;
  IF (SELECT count(*) FROM public.users_profiles WHERE id IN ('a66a0133-160b-47b3-abdb-1bbcf36986a6','3f9c5bb0-99b1-4341-b92c-3e1613b32825','0ce39ca5-65cf-44fc-ad11-51acc8da1a45')) <> 3 THEN
    RAISE EXCEPTION 'Un des profils A/B/C est absent.';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id='f921c854-034e-4c2e-a923-ff0ab56ddc90')
     OR EXISTS (SELECT 1 FROM public.users_profiles WHERE lower(username)='__fg_profile_rls_d_f921__')
     OR EXISTS (SELECT 1 FROM public.farms_list WHERE id IN (-920000001,-920000002,-920000003)
       OR name IN ('__FG_PROFILE_RLS_FARM_A__','__FG_PROFILE_RLS_FARM_B__','__FG_PROFILE_RLS_FARM_B_PRIVATE__')) THEN
    RAISE EXCEPTION 'Une fixture de test existe deja : arret sans modification.';
  END IF;
  -- Évite de déclencher des automatismes inconnus (notifications, webhooks, etc.).
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgenabled <> 'D' AND (
      (t.tgrelid='auth.users'::regclass AND (t.tgtype::integer & 4) <> 0)
      OR t.tgrelid='public.farms_list'::regclass
      OR (t.tgrelid='public.users_profiles'::regclass
          AND t.tgname <> 'guard_profile_client_update_reborn')
    )
  ) THEN RAISE EXCEPTION 'Trigger supplementaire detecte : verifier avant les fixtures.'; END IF;

  SELECT upper(username) INTO existing_username FROM public.users_profiles WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6';
  UPDATE public.users_profiles SET role=NULL,role_ingame=NULL WHERE id IN ('a66a0133-160b-47b3-abdb-1bbcf36986a6','3f9c5bb0-99b1-4341-b92c-3e1613b32825','0ce39ca5-65cf-44fc-ad11-51acc8da1a45');
  INSERT INTO auth.users(id,email) VALUES ('f921c854-034e-4c2e-a923-ff0ab56ddc90','rls-test-f921@example.invalid');
  INSERT INTO public.farms_list(id,name,proprietaire,visible) VALUES
    (-920000001,'__FG_PROFILE_RLS_FARM_A__','a66a0133-160b-47b3-abdb-1bbcf36986a6',false),
    (-920000002,'__FG_PROFILE_RLS_FARM_B__','3f9c5bb0-99b1-4341-b92c-3e1613b32825',true),
    (-920000003,'__FG_PROFILE_RLS_FARM_B_PRIVATE__','3f9c5bb0-99b1-4341-b92c-3e1613b32825',false);

  FOR test_case IN SELECT value FROM jsonb_array_elements(
    $cases$[
  {
    "label": "A peut lire son profil complet",
    "sql": "SELECT * FROM public.users_profiles WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": 1,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "B ne peut pas lire le profil prive de A",
    "sql": "SELECT email,money,role FROM public.users_profiles WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": 0,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": null,
    "staff": null
  },
  {
    "label": "C ne peut pas lire le profil prive de A",
    "sql": "SELECT email,money,role FROM public.users_profiles WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": null
  },
  {
    "label": "C peut lire les profils publics de A et B",
    "sql": "SELECT id,username,avatar_url,created_at,farm_id,role_ingame FROM public.get_public_profiles_reborn() WHERE id IN ('a66a0133-160b-47b3-abdb-1bbcf36986a6','3f9c5bb0-99b1-4341-b92c-3e1613b32825')",
    "rows": 2,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": null
  },
  {
    "label": "Le profil public ne contient ni email ni argent ni role interne",
    "sql": "SELECT id FROM public.get_public_profiles_reborn() p WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6' AND NOT (to_jsonb(p) ?| ARRAY['email','money','role','updated_at'])",
    "rows": 1,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "La fonction publique refuse la colonne email",
    "sql": "SELECT email FROM public.get_public_profiles_reborn()",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42703",
    "staff": null
  },
  {
    "label": "La fonction publique refuse la colonne money",
    "sql": "SELECT money FROM public.get_public_profiles_reborn()",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42703",
    "staff": null
  },
  {
    "label": "La fonction publique refuse la colonne role",
    "sql": "SELECT role FROM public.get_public_profiles_reborn()",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42703",
    "staff": null
  },
  {
    "label": "A peut changer son avatar",
    "sql": "UPDATE public.users_profiles SET avatar_url='https://example.invalid/rls-test.png' WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6' RETURNING id",
    "rows": 1,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "B ne peut pas changer l avatar de A",
    "sql": "UPDATE public.users_profiles SET avatar_url='https://example.invalid/rls-test.png' WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6' RETURNING id",
    "rows": 0,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": null,
    "staff": null
  },
  {
    "label": "A peut rattacher sa propre ferme privee",
    "sql": "UPDATE public.users_profiles SET farm_id=-920000001 WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6' RETURNING id",
    "rows": 1,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "A ne peut pas rattacher la ferme publique de B",
    "sql": "UPDATE public.users_profiles SET farm_id=-920000002 WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas rattacher la ferme privee de B",
    "sql": "UPDATE public.users_profiles SET farm_id=-920000003 WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "B ne peut pas changer le rattachement de A",
    "sql": "UPDATE public.users_profiles SET farm_id=-920000002 WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": 0,
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "error": null,
    "staff": null
  },
  {
    "label": "A ne peut pas modifier directement money",
    "sql": "UPDATE public.users_profiles SET money=999999 WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas modifier directement role",
    "sql": "UPDATE public.users_profiles SET role='ADMIN' WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas modifier directement role_ingame",
    "sql": "UPDATE public.users_profiles SET role_ingame='ADMIN' WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas modifier directement email",
    "sql": "UPDATE public.users_profiles SET email='forged@example.invalid' WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas modifier directement username",
    "sql": "UPDATE public.users_profiles SET username='__FG_FORGED__' WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas modifier directement id",
    "sql": "UPDATE public.users_profiles SET id='f921c854-034e-4c2e-a923-ff0ab56ddc90' WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas modifier directement created_at",
    "sql": "UPDATE public.users_profiles SET created_at='2000-01-01'::timestamptz WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "La date de modification reste geree par le serveur",
    "sql": "WITH changed AS (UPDATE public.users_profiles SET updated_at='2000-01-01' WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6' RETURNING updated_at) SELECT 1 FROM changed WHERE updated_at=now()",
    "rows": 1,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "A ne peut pas supprimer son profil directement",
    "sql": "DELETE FROM public.users_profiles WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "42501",
    "staff": null
  },
  {
    "label": "Creation directe de profil interdite",
    "sql": "INSERT INTO public.users_profiles(id,username) VALUES ('f921c854-034e-4c2e-a923-ff0ab56ddc90','__FG_DIRECT_PROFILE__')",
    "rows": null,
    "actor": "f921c854-034e-4c2e-a923-ff0ab56ddc90",
    "error": "42501",
    "staff": null
  },
  {
    "label": "RPC inscription : identite email solde et roles imposes par le serveur",
    "sql": "DO $signup$\nDECLARE new_id uuid; p public.users_profiles%ROWTYPE;\nBEGIN\n  new_id := public.create_my_profile_reborn('  __FG_PROFILE_RLS_D_f921__  ');\n  SELECT * INTO STRICT p FROM public.users_profiles WHERE id=new_id;\n  IF new_id IS DISTINCT FROM 'f921c854-034e-4c2e-a923-ff0ab56ddc90'::uuid\n     OR p.username IS DISTINCT FROM '__FG_PROFILE_RLS_D_f921__'\n     OR p.email IS DISTINCT FROM 'rls-test-f921@example.invalid'\n     OR p.money IS DISTINCT FROM 0 OR p.role IS NOT NULL OR p.role_ingame IS NOT NULL\n     OR p.farm_id IS NOT NULL OR p.avatar_url IS NOT NULL\n     OR p.created_at IS DISTINCT FROM now() OR p.updated_at IS DISTINCT FROM now() THEN\n    RAISE EXCEPTION 'Invalid initial profile values';\n  END IF;\nEND;\n$signup$",
    "rows": 0,
    "actor": "f921c854-034e-4c2e-a923-ff0ab56ddc90",
    "error": null,
    "staff": null
  },
  {
    "label": "Un profil existant ne peut pas etre recree ou reinitialise",
    "sql": "SELECT public.create_my_profile_reborn('__FG_PROFILE_RLS_D_f921__')",
    "rows": null,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": "23505",
    "staff": null
  },
  {
    "label": "Pseudo vide refuse par la creation",
    "sql": "SELECT public.create_my_profile_reborn('   ')",
    "rows": null,
    "actor": "f921c854-034e-4c2e-a923-ff0ab56ddc90",
    "error": "22023",
    "staff": null
  },
  {
    "label": "Pseudo NULL refuse par la creation",
    "sql": "SELECT public.create_my_profile_reborn(NULL)",
    "rows": null,
    "actor": "f921c854-034e-4c2e-a923-ff0ab56ddc90",
    "error": "22023",
    "staff": null
  },
  {
    "label": "Pseudo existant reserve sans distinction de casse",
    "sql": "SELECT 1 WHERE NOT public.is_username_available_reborn(upper((SELECT username FROM public.users_profiles WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6')))",
    "rows": 1,
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "error": null,
    "staff": null
  },
  {
    "label": "La creation refuse un pseudo existant meme en majuscules",
    "sql": "SELECT public.create_my_profile_reborn('%EXISTING_USERNAME%')",
    "rows": null,
    "actor": "f921c854-034e-4c2e-a923-ff0ab56ddc90",
    "error": "23505",
    "staff": null
  },
  {
    "label": "Pseudo libre disponible avant connexion",
    "sql": "SELECT 1 WHERE public.is_username_available_reborn('__FG_PROFILE_RLS_D_f921__')",
    "rows": 1,
    "actor": null,
    "error": null,
    "staff": null
  },
  {
    "label": "Pseudo vide indisponible avant connexion",
    "sql": "SELECT 1 WHERE NOT public.is_username_available_reborn('   ') AND NOT public.is_username_available_reborn(NULL)",
    "rows": 1,
    "actor": null,
    "error": null,
    "staff": null
  },
  {
    "label": "Admin peut lire les profils prives",
    "sql": "SELECT email,money,role FROM public.users_profiles WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": 1,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": "ADMIN"
  },
  {
    "label": "Admin ne peut pas modifier directement un autre profil",
    "sql": "UPDATE public.users_profiles SET avatar_url='https://example.invalid/test.png' WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": "ADMIN"
  },
  {
    "label": "Admin ne peut pas modifier directement le solde",
    "sql": "UPDATE public.users_profiles SET money=999999 WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": "42501",
    "staff": "ADMIN"
  },
  {
    "label": "Moderation ne peut pas lire l email d autrui",
    "sql": "SELECT email FROM public.users_profiles WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": 0,
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "error": null,
    "staff": "MODERATION"
  },
  {
    "label": "Visiteur deconnecte : lecture privee interdite",
    "sql": "SELECT * FROM public.users_profiles",
    "rows": null,
    "actor": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : lecture publique interdite",
    "sql": "SELECT * FROM public.get_public_profiles_reborn()",
    "rows": null,
    "actor": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : creation RPC interdite",
    "sql": "SELECT public.create_my_profile_reborn('__FG_PROFILE_RLS_D_f921__')",
    "rows": null,
    "actor": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : modification interdite",
    "sql": "UPDATE public.users_profiles SET avatar_url=NULL WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
    "rows": null,
    "actor": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : suppression interdite",
    "sql": "DELETE FROM public.users_profiles WHERE id='a66a0133-160b-47b3-abdb-1bbcf36986a6'",
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
    -- Un email et des rôles forgés dans les métadonnées ne doivent pas être repris.
    PERFORM set_config('request.jwt.claims',jsonb_build_object(
      'sub',test_case->>'actor','role',test_role,'email','forged@example.invalid',
      'user_metadata',jsonb_build_object('role','ADMIN','money',999999))::text,true);
    PERFORM set_config('role',test_role,true);
    IF current_user <> test_role
       OR auth.uid() IS DISTINCT FROM (test_case->>'actor')::uuid
       OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
       OR EXISTS (SELECT 1 FROM pg_class WHERE oid='public.users_profiles'::regclass
         AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
      RAISE EXCEPTION 'Identite de test invalide.';
    END IF;
    test_sql := replace(test_case->>'sql',quote_literal('%EXISTING_USERNAME%'),quote_literal(existing_username));
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
  PERFORM set_config('farmgestion.profiles_rls_test_results',results::text,true);
END;
$tests$;

SELECT value->>'test' AS test, value->>'resultat' AS resultat
FROM jsonb_array_elements(current_setting('farmgestion.profiles_rls_test_results')::jsonb);

ROLLBACK;
