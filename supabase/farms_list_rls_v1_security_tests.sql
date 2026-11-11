-- Run the ENTIRE file in Supabase SQL Editor with role postgres.
-- All record changes (including temporary profile roles) are rolled back.
-- INSERT tests use real defaults: the ID sequence may advance, leaving harmless gaps.
-- Requires at least one existing expedition associated with a farm.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $test$
DECLARE
  account_a constant uuid := 'a66a0133-160b-47b3-abdb-1bbcf36986a6';
  account_b constant uuid := '3f9c5bb0-99b1-4341-b92c-3e1613b32825';
  account_c constant uuid := '0ce39ca5-65cf-44fc-ad11-51acc8da1a45';
  original_role text := current_user;
  shipping_farm_id bigint;
  test_case jsonb;
  test_role text;
  role_bypasses_rls boolean;
  test_sql text;
  row_count_actual bigint;
  error_actual text;
  error_message text;
  result_rows jsonb := '[]'::jsonb;
BEGIN
  IF original_role <> 'postgres' THEN
    RAISE EXCEPTION 'Execute this test in the SQL Editor with role postgres.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.farms_list'::regclass) THEN
    RAISE EXCEPTION 'farms_list RLS is not enabled.';
  END IF;
  IF (SELECT count(*) FROM public.users_profiles
      WHERE id IN (account_a,account_b,account_c)) <> 3 THEN
    RAISE EXCEPTION 'One of the three test profiles is missing.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.farms_list
             WHERE id IN (-910000001,-910000002,-910000003)
                OR name IN ('__FG_RLS_V1_PRIVATE_A_6c80__','__FG_RLS_V1_PUBLIC_B_6c80__','__FG_RLS_V1_NEW_6c80__')) THEN
    RAISE EXCEPTION 'A reserved test ID or farm name already exists. Stop.';
  END IF;
  -- Updating fixture farms or profile roles must not invoke unexpected user triggers.
  IF EXISTS (SELECT 1 FROM pg_trigger
             WHERE tgrelid IN ('public.farms_list'::regclass, 'public.users_profiles'::regclass)
               AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'A user trigger exists on farms_list/users_profiles. Review before running fixtures.';
  END IF;

  SELECT f.id INTO shipping_farm_id
  FROM public.shipping s
  JOIN public.betails b ON b.id=s.betail_id
  JOIN public.farms_list f ON f.id=b.farm_id
  ORDER BY s.id
  LIMIT 1;
  IF shipping_farm_id IS NULL THEN
    RAISE EXCEPTION 'No expedition linked to a farm is available to test the public farm-name helper.';
  END IF;

  -- Normalize identities within this uncommitted transaction only.
  UPDATE public.users_profiles SET role=NULL, role_ingame=NULL
  WHERE id IN (account_a,account_b,account_c);
  -- No animal, expedition or notification is created or changed.
  UPDATE public.farms_list SET visible=false, proprietaire=account_a
  WHERE id=shipping_farm_id;

  FOR test_case IN SELECT value FROM jsonb_array_elements(
    $cases$[
  {
    "label": "A peut lire sa ferme privee",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "SELECT id FROM public.farms_list WHERE id=-910000001",
    "rows": 1,
    "error": null,
    "staff": null
  },
  {
    "label": "B ne peut pas lire la ferme privee de A",
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "sql": "SELECT id FROM public.farms_list WHERE id=-910000001",
    "rows": 0,
    "error": null,
    "staff": null
  },
  {
    "label": "C ne peut pas lire la ferme privee de A",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT id FROM public.farms_list WHERE id=-910000001",
    "rows": 0,
    "error": null,
    "staff": null
  },
  {
    "label": "C peut lire la ferme publique de B",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT id FROM public.farms_list WHERE id=-910000002",
    "rows": 1,
    "error": null,
    "staff": null
  },
  {
    "label": "A peut changer ses couleurs et son decor",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.farms_list SET site_colors='{\"test\":\"blue\"}'::jsonb,center_style='{\"type\":\"emoji\",\"value\":\"🌱\"}'::jsonb WHERE id=-910000001",
    "rows": 1,
    "error": null,
    "staff": null
  },
  {
    "label": "A peut rendre sa ferme publique",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.farms_list SET visible=true WHERE id=-910000001",
    "rows": 1,
    "error": null,
    "staff": null
  },
  {
    "label": "B peut rendre sa ferme privee",
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "sql": "UPDATE public.farms_list SET visible=false WHERE id=-910000002",
    "rows": 1,
    "error": null,
    "staff": null
  },
  {
    "label": "B ne peut pas modifier la ferme privee de A",
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "sql": "UPDATE public.farms_list SET visible=true WHERE id=-910000001",
    "rows": 0,
    "error": null,
    "staff": null
  },
  {
    "label": "A ne peut pas modifier la ferme publique de B",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.farms_list SET site_colors='{}'::jsonb WHERE id=-910000002",
    "rows": 0,
    "error": null,
    "staff": null
  },
  {
    "label": "A ne peut pas changer le proprietaire",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.farms_list SET proprietaire='3f9c5bb0-99b1-4341-b92c-3e1613b32825' WHERE id=-910000001",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas changer l'identifiant",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.farms_list SET id=-910000003 WHERE id=-910000001",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas changer l'etat interne",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.farms_list SET state='OPEN' WHERE id=-910000001",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas modifier directement les badges",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.farms_list SET equipped_badges='{}'::jsonb WHERE id=-910000001",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas modifier la date de creation",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.farms_list SET creation_date=now() WHERE id=-910000001",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas supprimer directement sa ferme",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "DELETE FROM public.farms_list WHERE id=-910000001",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "A peut creer une ferme privee et relire le resultat",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "INSERT INTO public.farms_list(name,proprietaire,visible,site_colors,center_style) VALUES('__FG_RLS_V1_NEW_6c80__','a66a0133-160b-47b3-abdb-1bbcf36986a6',false,'{}','{}') RETURNING id",
    "rows": 1,
    "error": null,
    "staff": null
  },
  {
    "label": "A ne peut pas creer une ferme pour B",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "INSERT INTO public.farms_list(name,proprietaire) VALUES('__FG_RLS_V1_NEW_6c80__','3f9c5bb0-99b1-4341-b92c-3e1613b32825')",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas creer une ferme sans proprietaire",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "INSERT INTO public.farms_list(name,proprietaire) VALUES('__FG_RLS_V1_NEW_6c80__',NULL)",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "A ne peut pas imposer un etat a la creation",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "INSERT INTO public.farms_list(name,proprietaire,state) VALUES('__FG_RLS_V1_NEW_6c80__','a66a0133-160b-47b3-abdb-1bbcf36986a6','OPEN')",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Un nom de ferme privee reste reserve",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT 1 WHERE public.is_farm_name_available_reborn('__FG_RLS_V1_PRIVATE_A_6c80__') IS FALSE",
    "rows": 1,
    "error": null,
    "staff": null
  },
  {
    "label": "Un nom libre est disponible",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT 1 WHERE public.is_farm_name_available_reborn('__FG_RLS_V1_NEW_6c80__') IS TRUE",
    "rows": 1,
    "error": null,
    "staff": null
  },
  {
    "label": "Un nom vide est refuse",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT 1 WHERE public.is_farm_name_available_reborn('   ') IS FALSE",
    "rows": 1,
    "error": null,
    "staff": null
  },
  {
    "label": "La creation ne peut pas reutiliser un nom prive",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "INSERT INTO public.farms_list(name,proprietaire) VALUES('__FG_RLS_V1_PRIVATE_A_6c80__','0ce39ca5-65cf-44fc-ad11-51acc8da1a45')",
    "rows": null,
    "error": "23505",
    "staff": null
  },
  {
    "label": "Admin : lecture des fermes privees autorisee",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT id FROM public.farms_list WHERE id=-910000001",
    "rows": 1,
    "error": null,
    "staff": "ADMIN"
  },
  {
    "label": "Moderation : lecture des fermes privees autorisee",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT id FROM public.farms_list WHERE id=-910000001",
    "rows": 1,
    "error": null,
    "staff": "MODERATION"
  },
  {
    "label": "Admin : pas de modification directe d'une ferme tierce",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "UPDATE public.farms_list SET visible=true WHERE id=-910000001",
    "rows": 0,
    "error": null,
    "staff": "ADMIN"
  },
  {
    "label": "Expedition : C ne peut pas lire la fiche de la ferme privee",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT id FROM public.farms_list WHERE id=%SHIP_FARM%",
    "rows": 0,
    "error": null,
    "staff": null
  },
  {
    "label": "Expedition : C peut lire le nom de cette ferme",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT id FROM public.get_shipping_farm_names_reborn(ARRAY[%SHIP_FARM%]::bigint[]) WHERE id=%SHIP_FARM% AND name IS NOT NULL",
    "rows": 1,
    "error": null,
    "staff": null
  },
  {
    "label": "Expedition : sans expedition, pas de nom prive expose",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT id FROM public.get_shipping_farm_names_reborn(ARRAY[-910000001]::bigint[])",
    "rows": 0,
    "error": null,
    "staff": null
  },
  {
    "label": "Expedition : le helper n'expose pas la personnalisation",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT center_style FROM public.get_shipping_farm_names_reborn(ARRAY[%SHIP_FARM%]::bigint[])",
    "rows": null,
    "error": "42703",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : lecture interdite",
    "actor": null,
    "sql": "SELECT id FROM public.farms_list WHERE id=-910000002",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : creation interdite",
    "actor": null,
    "sql": "INSERT INTO public.farms_list(name,proprietaire) VALUES('__FG_RLS_V1_NEW_6c80__','a66a0133-160b-47b3-abdb-1bbcf36986a6')",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : helper expedition interdit",
    "actor": null,
    "sql": "SELECT * FROM public.get_shipping_farm_names_reborn(ARRAY[%SHIP_FARM%]::bigint[])",
    "rows": null,
    "error": "42501",
    "staff": null
  },
  {
    "label": "Visiteur deconnecte : recherche de nom interdite",
    "actor": null,
    "sql": "SELECT public.is_farm_name_available_reborn('__FG_RLS_V1_PRIVATE_A_6c80__')",
    "rows": null,
    "error": "42501",
    "staff": null
  }
]$cases$::jsonb
  ) LOOP
    PERFORM set_config('role', original_role, true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{}', true);
    UPDATE public.users_profiles SET role=test_case->>'staff', role_ingame=NULL
    WHERE id=account_c;
    DELETE FROM public.farms_list WHERE name IN ('__FG_RLS_V1_PRIVATE_A_6c80__','__FG_RLS_V1_PUBLIC_B_6c80__','__FG_RLS_V1_NEW_6c80__');
    INSERT INTO public.farms_list(id,name,proprietaire,visible) VALUES
      (-910000001,'__FG_RLS_V1_PRIVATE_A_6c80__',account_a,false),
      (-910000002,'__FG_RLS_V1_PUBLIC_B_6c80__',account_b,true);

    test_role := CASE WHEN test_case->>'actor' IS NULL THEN 'anon' ELSE 'authenticated' END;
    PERFORM set_config('request.jwt.claim.sub', coalesce(test_case->>'actor',''), true);
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub',test_case->>'actor','role',test_role)::text,true);
    PERFORM set_config('role', test_role, true);

    SELECT rolsuper OR rolbypassrls INTO role_bypasses_rls
    FROM pg_roles WHERE rolname=current_user;
    IF current_user <> test_role OR coalesce(role_bypasses_rls,true)
       OR auth.uid() IS DISTINCT FROM (test_case->>'actor')::uuid
       OR EXISTS (
         SELECT 1 FROM pg_class WHERE oid='public.farms_list'::regclass
           AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
       ) THEN
      RAISE EXCEPTION 'Invalid simulated identity: %',test_case->>'label';
    END IF;

    test_sql := replace(test_case->>'sql','%SHIP_FARM%',shipping_farm_id::text);
    row_count_actual := NULL;
    error_actual := NULL;
    error_message := NULL;
    BEGIN
      EXECUTE test_sql;
      GET DIAGNOSTICS row_count_actual = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS error_actual = RETURNED_SQLSTATE, error_message = MESSAGE_TEXT;
    END;
    PERFORM set_config('role', original_role, true);

    IF test_case->>'error' IS NOT NULL THEN
      IF error_actual IS DISTINCT FROM test_case->>'error' THEN
        RAISE EXCEPTION 'FAIL: %. Expected error %, got % (%).',
          test_case->>'label',test_case->>'error',coalesce(error_actual,'NO ERROR'),
          coalesce(error_message,row_count_actual::text);
      END IF;
    ELSIF error_actual IS NOT NULL
       OR row_count_actual IS DISTINCT FROM (test_case->>'rows')::bigint THEN
      RAISE EXCEPTION 'FAIL: %. Expected % rows, got %, error % (%).',
        test_case->>'label',test_case->>'rows',row_count_actual,error_actual,error_message;
    END IF;
    result_rows := result_rows || jsonb_build_array(
      jsonb_build_object('test',test_case->>'label','resultat','OK'));
  END LOOP;
  PERFORM set_config('farmgestion.farms_rls_test_results',result_rows::text,true);
END;
$test$;

SELECT value->>'test' AS test, value->>'resultat' AS resultat
FROM jsonb_array_elements(current_setting('farmgestion.farms_rls_test_results')::jsonb);

ROLLBACK;

