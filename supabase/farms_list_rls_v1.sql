-- STEP 3: execute only after preparation SQL AND deployment of the frontend fixes.
-- No deletion of data. On any error the transaction must be rolled back.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.farms_list IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'farms_list') THEN
    RAISE EXCEPTION 'Existing farms_list policies: stop and review.';
  END IF;
  IF to_regprocedure('public.is_farm_name_available_reborn(text)') IS NULL THEN
    RAISE EXCEPTION 'Run farms_list_rls_v1_prepare.sql first.';
  END IF;
  IF to_regprocedure('public.get_shipping_farm_names_reborn(bigint[])') IS NULL THEN
    RAISE EXCEPTION 'Run the updated farms_list_rls_v1_prepare.sql first (public expeditions).';
  END IF;
  IF EXISTS (SELECT 1 FROM public.farms_list GROUP BY name HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate farm names exist. Stop and review them before activation.';
  END IF;
END;
$$;

-- Preserves the current exact, case-sensitive name availability rule, even
-- for private farms and simultaneous registrations.
CREATE UNIQUE INDEX farms_list_name_unique_rls_v1 ON public.farms_list (name);

CREATE FUNCTION public.can_read_private_farms_reborn()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users_profiles up
    WHERE up.id = auth.uid()
      AND (
        upper(coalesce(up.role, '')) LIKE '%ADMIN%'
        OR upper(coalesce(up.role_ingame, '')) LIKE '%ADMIN%'
        OR upper(coalesce(up.role, '')) LIKE '%MODERATION%'
        OR upper(coalesce(up.role_ingame, '')) LIKE '%MODERATION%'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_private_farms_reborn() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_private_farms_reborn() TO authenticated;

REVOKE ALL ON TABLE public.farms_list FROM PUBLIC, anon, authenticated;

-- Remove pre-existing column grants as well; table revocation alone is not enough.
DO $$
DECLARE
  cols text;
  seq_name text := pg_get_serial_sequence('public.farms_list', 'id');
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
  FROM pg_attribute
  WHERE attrelid = 'public.farms_list'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format(
    'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.farms_list FROM PUBLIC, anon, authenticated', cols);
  IF seq_name IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', seq_name);
    EXECUTE format('GRANT USAGE ON SEQUENCE %s TO authenticated', seq_name);
  END IF;
END;
$$;

GRANT SELECT ON TABLE public.farms_list TO authenticated;
GRANT INSERT (name, proprietaire, visible, site_colors, center_style)
  ON public.farms_list TO authenticated;
GRANT UPDATE (visible, site_colors, center_style)
  ON public.farms_list TO authenticated;

CREATE POLICY farms_list_read_v1 ON public.farms_list
FOR SELECT TO authenticated
USING (
  visible = true OR proprietaire = (SELECT auth.uid())
  OR (SELECT public.can_read_private_farms_reborn())
);

CREATE POLICY farms_list_insert_v1 ON public.farms_list
FOR INSERT TO authenticated
WITH CHECK (proprietaire = (SELECT auth.uid()) AND length(btrim(name)) > 0);

CREATE POLICY farms_list_update_v1 ON public.farms_list
FOR UPDATE TO authenticated
USING (proprietaire = (SELECT auth.uid()))
WITH CHECK (proprietaire = (SELECT auth.uid()));

ALTER TABLE public.farms_list ENABLE ROW LEVEL SECURITY;
COMMIT;

SELECT relrowsecurity AS rls_active
FROM pg_class WHERE oid = 'public.farms_list'::regclass;
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'farms_list'
ORDER BY policyname;
