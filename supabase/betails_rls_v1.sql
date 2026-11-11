-- ÉTAPE 2 : après préparation SQL et mise à jour du frontend qui utilise cette base.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.betails IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='betails') THEN
    RAISE EXCEPTION 'Des policies betails existent deja : verifier avant activation.';
  END IF;
  IF to_regprocedure('public.get_shipping_betails_reborn(uuid[])') IS NULL
    OR to_regprocedure('public.get_visible_betails_count_reborn()') IS NULL
    OR to_regprocedure('public.moderate_betail_content_reborn(uuid,text,text)') IS NULL
    OR to_regprocedure('public.can_moderate_betails_reborn()') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_proc
      WHERE oid=to_regprocedure('public.apply_betail_like_count_delta()') AND prosecdef) THEN
    RAISE EXCEPTION 'Executer betails_rls_v1_prepare.sql avant activation.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.betail_likes'::regclass) THEN
    RAISE EXCEPTION 'Les RLS betail_likes doivent etre actives pour proteger les compteurs.';
  END IF;
END;
$$;

REVOKE ALL ON TABLE public.betails FROM PUBLIC, anon, authenticated;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname),', ' ORDER BY attnum) INTO cols
  FROM pg_attribute WHERE attrelid='public.betails'::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format(
    'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.betails FROM PUBLIC, anon, authenticated',cols);
END;
$$;
GRANT SELECT ON public.betails TO authenticated;
GRANT UPDATE (comments) ON public.betails TO authenticated;

CREATE POLICY betails_read_v1 ON public.betails
FOR SELECT TO authenticated
USING (visible IS TRUE OR owner_id=(SELECT auth.uid())
  OR (SELECT public.can_moderate_betails_reborn()));

CREATE POLICY betails_update_comment_v1 ON public.betails
FOR UPDATE TO authenticated
USING (owner_id=(SELECT auth.uid()) AND visible IS TRUE)
WITH CHECK (owner_id=(SELECT auth.uid()) AND visible IS TRUE);

ALTER TABLE public.betails ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT relrowsecurity AS rls_active FROM pg_class WHERE oid='public.betails'::regclass;
SELECT policyname,cmd FROM pg_policies
WHERE schemaname='public' AND tablename='betails' ORDER BY policyname;
