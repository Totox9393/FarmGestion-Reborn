-- Run this ENTIRE file in Supabase SQL Editor as postgres.
-- No COMMIT: all fixtures, settings and helpers are rolled back.
-- Explicit fixture IDs avoid advancing the real ID sequence.
-- Do not execute individual selections from this file.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $test$
DECLARE
  account_a constant uuid := 'a66a0133-160b-47b3-abdb-1bbcf36986a6';
  account_b constant uuid := '3f9c5bb0-99b1-4341-b92c-3e1613b32825';
  account_c constant uuid := '0ce39ca5-65cf-44fc-ad11-51acc8da1a45';
  original_role text := current_user;
  test_case jsonb;
  row_count_actual bigint;
  error_actual text;
  error_message text;
  result_rows jsonb := '[]'::jsonb;
  test_role text;
  role_bypasses_rls boolean;
BEGIN
  IF original_role <> 'postgres' THEN
    RAISE EXCEPTION 'Execute this test in the SQL Editor with role postgres.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid = 'public.user_relations'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled.';
  END IF;
  IF (SELECT count(*) FROM public.users_profiles
      WHERE id IN (account_a, account_b, account_c)) <> 3 THEN
    RAISE EXCEPTION 'One of the three test profiles is missing.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_relations
             WHERE id IN (-900000001, -900000002)) THEN
    RAISE EXCEPTION 'A reserved test ID already exists. Stop without changing it.';
  END IF;

  -- Temporary normalization of these accounts only; restored by ROLLBACK.
  DELETE FROM public.user_relations
  WHERE user_a IN (account_a, account_b, account_c)
    AND user_b IN (account_a, account_b, account_c);
  DELETE FROM public.user_settings
  WHERE user_id IN (account_a, account_b, account_c)
    AND setting_name = 'allow_friend_requests';

  FOR test_case IN SELECT value FROM jsonb_array_elements(
    $cases$[
  {
    "label": "A voit sa demande",
    "state": "pending",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "SELECT id FROM public.user_relations WHERE id = -900000001",
    "rows": 1,
    "error": null
  },
  {
    "label": "B voit la demande recue",
    "state": "pending",
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "sql": "SELECT id FROM public.user_relations WHERE id = -900000001",
    "rows": 1,
    "error": null
  },
  {
    "label": "C ne voit pas la demande privee",
    "state": "pending",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT id FROM public.user_relations WHERE id = -900000001",
    "rows": 0,
    "error": null
  },
  {
    "label": "A ne peut pas accepter sa propre demande",
    "state": "pending",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.user_relations SET status='accepted' WHERE id = -900000001",
    "rows": null,
    "error": "42501"
  },
  {
    "label": "A ne peut pas remplacer B par C",
    "state": "pending",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.user_relations SET user_b='0ce39ca5-65cf-44fc-ad11-51acc8da1a45' WHERE id = -900000001",
    "rows": null,
    "error": "42501"
  },
  {
    "label": "B peut accepter la demande",
    "state": "pending",
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "sql": "UPDATE public.user_relations SET status='accepted', responded_at=now() WHERE id = -900000001",
    "rows": 1,
    "error": null
  },
  {
    "label": "C voit une amitie acceptee",
    "state": "accepted",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT id FROM public.user_relations WHERE id = -900000001",
    "rows": 1,
    "error": null
  },
  {
    "label": "C ne peut pas modifier cette amitie",
    "state": "accepted",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "UPDATE public.user_relations SET status='blocked', initiator='0ce39ca5-65cf-44fc-ad11-51acc8da1a45' WHERE id = -900000001",
    "rows": 0,
    "error": null
  },
  {
    "label": "C ne peut pas supprimer cette amitie",
    "state": "accepted",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "DELETE FROM public.user_relations WHERE id = -900000001",
    "rows": 0,
    "error": null
  },
  {
    "label": "A peut retirer son ami",
    "state": "accepted",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "DELETE FROM public.user_relations WHERE id = -900000001",
    "rows": 1,
    "error": null
  },
  {
    "label": "C ne voit pas le blocage",
    "state": "blocked",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "SELECT id FROM public.user_relations WHERE id = -900000001",
    "rows": 0,
    "error": null
  },
  {
    "label": "B voit le blocage qui le concerne",
    "state": "blocked",
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "sql": "SELECT id FROM public.user_relations WHERE id = -900000001",
    "rows": 1,
    "error": null
  },
  {
    "label": "B ne peut pas se debloquer",
    "state": "blocked",
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "sql": "UPDATE public.user_relations SET status='cancelled' WHERE id = -900000001",
    "rows": null,
    "error": "42501"
  },
  {
    "label": "B ne peut pas prendre la place du bloqueur",
    "state": "blocked",
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "sql": "UPDATE public.user_relations SET initiator='3f9c5bb0-99b1-4341-b92c-3e1613b32825' WHERE id = -900000001",
    "rows": null,
    "error": "42501"
  },
  {
    "label": "B ne peut pas effacer le blocage",
    "state": "blocked",
    "actor": "3f9c5bb0-99b1-4341-b92c-3e1613b32825",
    "sql": "DELETE FROM public.user_relations WHERE id = -900000001",
    "rows": 0,
    "error": null
  },
  {
    "label": "A peut retirer son propre blocage",
    "state": "blocked",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "UPDATE public.user_relations SET status='cancelled' WHERE id = -900000001",
    "rows": 1,
    "error": null
  },
  {
    "label": "A ne peut pas creer une amitie deja acceptee",
    "state": "pending",
    "actor": "a66a0133-160b-47b3-abdb-1bbcf36986a6",
    "sql": "INSERT INTO public.user_relations(id,user_a,user_b,initiator,status) VALUES(-900000002,'a66a0133-160b-47b3-abdb-1bbcf36986a6','0ce39ca5-65cf-44fc-ad11-51acc8da1a45','a66a0133-160b-47b3-abdb-1bbcf36986a6','accepted')",
    "rows": null,
    "error": "42501"
  },
  {
    "label": "C ne peut pas creer une demande au nom de B",
    "state": "pending",
    "actor": "0ce39ca5-65cf-44fc-ad11-51acc8da1a45",
    "sql": "INSERT INTO public.user_relations(id,user_a,user_b,initiator,status) VALUES(-900000002,'3f9c5bb0-99b1-4341-b92c-3e1613b32825','0ce39ca5-65cf-44fc-ad11-51acc8da1a45','3f9c5bb0-99b1-4341-b92c-3e1613b32825','pending')",
    "rows": null,
    "error": "42501"
  },
  {
    "label": "Visiteur deconnecte : lecture interdite",
    "state": "accepted",
    "actor": null,
    "sql": "SELECT id FROM public.user_relations WHERE id = -900000001",
    "rows": null,
    "error": "42501"
  },
  {
    "label": "Visiteur deconnecte : ecriture interdite",
    "state": "accepted",
    "actor": null,
    "sql": "INSERT INTO public.user_relations(id,user_a,user_b,initiator,status) VALUES(-900000002,'a66a0133-160b-47b3-abdb-1bbcf36986a6','0ce39ca5-65cf-44fc-ad11-51acc8da1a45','a66a0133-160b-47b3-abdb-1bbcf36986a6','pending')",
    "rows": null,
    "error": "42501"
  }
]$cases$::jsonb
  ) LOOP
    -- Recreate a known state before EACH test, as the database administrator.
    PERFORM set_config('role', original_role, true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{}', true);
    DELETE FROM public.user_relations WHERE id IN (-900000001, -900000002);
    INSERT INTO public.user_relations
      (id, user_a, user_b, initiator, status)
    VALUES (-900000001, account_a, account_b, account_a, test_case->>'state');

    test_role := CASE WHEN test_case->>'actor' IS NULL THEN 'anon' ELSE 'authenticated' END;
    PERFORM set_config('request.jwt.claim.sub', coalesce(test_case->>'actor', ''), true);
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', test_case->>'actor', 'role', test_role)::text, true);
    PERFORM set_config('role', test_role, true);

    -- Ensure tests really run with end-user permissions, not the editor's bypass.
    SELECT rolsuper OR rolbypassrls INTO role_bypasses_rls
    FROM pg_roles WHERE rolname = current_user;
    IF current_user <> test_role OR coalesce(role_bypasses_rls, true)
       OR auth.uid() IS DISTINCT FROM (test_case->>'actor')::uuid
       OR EXISTS (
         SELECT 1 FROM pg_class
         WHERE oid = 'public.user_relations'::regclass
           AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       ) THEN
      RAISE EXCEPTION 'Invalid simulated identity for %', test_case->>'label';
    END IF;

    row_count_actual := NULL;
    error_actual := NULL;
    error_message := NULL;
    BEGIN
      EXECUTE test_case->>'sql';
      GET DIAGNOSTICS row_count_actual = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS error_actual = RETURNED_SQLSTATE, error_message = MESSAGE_TEXT;
    END;
    PERFORM set_config('role', original_role, true);

    IF test_case->>'error' IS NOT NULL THEN
      IF error_actual IS DISTINCT FROM test_case->>'error' THEN
        RAISE EXCEPTION 'FAIL: %. Expected error %, got % (%).',
          test_case->>'label', test_case->>'error', coalesce(error_actual, 'NO ERROR'),
          coalesce(error_message, row_count_actual::text);
      END IF;
    ELSIF error_actual IS NOT NULL
       OR row_count_actual IS DISTINCT FROM (test_case->>'rows')::bigint THEN
      RAISE EXCEPTION 'FAIL: %. Expected % rows, got %, error % (%).',
        test_case->>'label', test_case->>'rows', row_count_actual, error_actual, error_message;
    END IF;
    result_rows := result_rows || jsonb_build_array(
      jsonb_build_object('test', test_case->>'label', 'resultat', 'OK'));
  END LOOP;

  PERFORM set_config('farmgestion.rls_test_results', result_rows::text, true);
END;
$test$;

-- Results are returned before ROLLBACK removes the temporary configuration.
SELECT value->>'test' AS test, value->>'resultat' AS resultat
FROM jsonb_array_elements(current_setting('farmgestion.rls_test_results')::jsonb);

ROLLBACK;

