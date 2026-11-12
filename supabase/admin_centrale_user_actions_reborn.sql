-- Actions de compte utilisées par la Centrale.
-- L'avatar standard d'un nouveau compte est représenté par avatar_url = NULL :
-- le client affiche alors assets/defaut_profile_user.png.
-- À exécuter dans le SQL Editor avant d'utiliser l'action de réinitialisation.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_reset_user_avatar_reborn(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.users_profiles admin_profile
    WHERE admin_profile.id = auth.uid()
      AND (
        upper(btrim(coalesce(admin_profile.role, ''))) = 'ADMIN'
        OR upper(btrim(coalesce(admin_profile.role_ingame, ''))) = 'ADMIN'
      )
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER_ID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users_profiles
  SET avatar_url = NULL,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING updated_at INTO v_updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'avatar_url', NULL,
    'updated_at', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_user_avatar_reborn(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_avatar_reborn(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
