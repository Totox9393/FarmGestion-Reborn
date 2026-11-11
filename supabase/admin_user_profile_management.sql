-- Actions de profil disponibles depuis la Centrale.
-- À exécuter une fois dans Supabase SQL Editor avant de tester l'interface.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_set_user_money_reborn(
  p_user_id uuid,
  p_money integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_money integer;
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

  IF p_user_id IS NULL OR p_money IS NULL OR p_money < 0 THEN
    RAISE EXCEPTION 'INVALID_MONEY' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users_profiles
  SET money = p_money,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING money, updated_at INTO v_money, v_updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'money', v_money,
    'updated_at', v_updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role_reborn(
  p_user_id uuid,
  p_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := upper(btrim(coalesce(p_role, '')));
  v_stored_role text;
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

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'SELF_ROLE_CHANGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'STANDARD' THEN
    v_stored_role := NULL;
  ELSIF v_role IN ('MODERATOR', 'MODERATION') THEN
    v_stored_role := 'MODERATION';
  ELSIF v_role = 'ADMIN' THEN
    v_stored_role := 'ADMIN';
  ELSE
    RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users_profiles
  SET role = v_stored_role,
      role_ingame = NULL,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING role, updated_at INTO v_stored_role, v_updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'role', v_stored_role,
    'role_ingame', NULL,
    'updated_at', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_money_reborn(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_user_role_reborn(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_money_reborn(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role_reborn(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
