-- 1. Exécuter avant de tester le nouveau frontend, puis activer les RLS
-- avec users_profiles_rls_v1.sql. Ce script ne change pas les droits de la table.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Projection publique volontairement limitée, accessible aux joueurs connectés.
CREATE OR REPLACE FUNCTION public.get_public_profiles_reborn()
RETURNS TABLE (
  id uuid, username text, avatar_url text, created_at timestamptz,
  farm_id bigint, role_ingame text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT up.id, up.username, up.avatar_url, up.created_at, up.farm_id, up.role_ingame
  FROM public.users_profiles up
  WHERE auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.get_public_profiles_reborn() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles_reborn() TO authenticated;

-- Disponible avant connexion, renvoie seulement un booléen, jamais un profil.
CREATE OR REPLACE FUNCTION public.is_username_available_reborn(p_username text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(length(btrim(p_username)) > 0, false)
    AND NOT EXISTS (
      SELECT 1 FROM public.users_profiles up
      WHERE lower(up.username) = lower(btrim(p_username))
    );
$$;
REVOKE ALL ON FUNCTION public.is_username_available_reborn(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_available_reborn(text) TO anon, authenticated;

-- Après signUp avec session immédiate : identité et email issus de Supabase Auth.
-- Le client ne choisit ni argent, ni rôles, ni ferme, ni dates.
CREATE OR REPLACE FUNCTION public.create_my_profile_reborn(p_username text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF p_username IS NULL OR length(btrim(p_username)) = 0 THEN
    RAISE EXCEPTION 'INVALID_USERNAME' USING ERRCODE = '22023';
  END IF;
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUTH_USER_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.users_profiles
    (id, username, email, money, role, role_ingame, farm_id, avatar_url, created_at, updated_at)
  VALUES (v_uid, btrim(p_username), v_email, 0, NULL, NULL, NULL, NULL, now(), now());
  RETURN v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.create_my_profile_reborn(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_profile_reborn(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
