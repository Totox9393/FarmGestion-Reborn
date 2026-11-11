-- STEP 1: install these helpers before deploying the frontend changes.
-- This does not activate RLS or change table permissions.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_farm_name_available_reborn(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_name IS NOT NULL
    AND length(btrim(p_name)) > 0
    AND NOT EXISTS (SELECT 1 FROM public.farms_list f WHERE f.name = p_name);
$$;

REVOKE ALL ON FUNCTION public.is_farm_name_available_reborn(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_farm_name_available_reborn(text) TO authenticated;

-- A private farm hides its page, not its expeditions. Return only the farm
-- names required by the public shipping calendar, never its configuration.
CREATE OR REPLACE FUNCTION public.get_shipping_farm_names_reborn(p_farm_ids bigint[])
RETURNS TABLE (id bigint, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT f.id, f.name
  FROM public.farms_list f
  WHERE auth.uid() IS NOT NULL
    AND f.id = ANY(p_farm_ids)
    AND EXISTS (
      SELECT 1
      FROM public.betails b
      JOIN public.shipping s ON s.betail_id = b.id
      WHERE b.farm_id = f.id
    );
$$;

REVOKE ALL ON FUNCTION public.get_shipping_farm_names_reborn(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shipping_farm_names_reborn(bigint[]) TO authenticated;

COMMIT;
