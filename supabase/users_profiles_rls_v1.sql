-- 2. Exécuter après users_profiles_rls_v1_prepare.sql et mise à jour du frontend.
-- La version publiée doit également être adaptée si elle utilise cette base.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.users_profiles IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'users_profiles') THEN
    RAISE EXCEPTION 'Des policies existent déjà sur users_profiles : vérifier avant de continuer.';
  END IF;
  IF to_regprocedure('public.get_public_profiles_reborn()') IS NULL
     OR to_regprocedure('public.is_username_available_reborn(text)') IS NULL
     OR to_regprocedure('public.create_my_profile_reborn(text)') IS NULL THEN
    RAISE EXCEPTION 'Exécuter users_profiles_rls_v1_prepare.sql avant activation.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'trg_sync_user_email'
      AND t.tgenabled IN ('O', 'A') AND p.proname = 'sync_user_email' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Le trigger serveur de synchronisation email doit être actif et SECURITY DEFINER.';
  END IF;
END;
$$;

-- Garde la règle d'unicité du pseudo, y compris en cas d'inscriptions simultanées.
CREATE UNIQUE INDEX IF NOT EXISTS users_profiles_username_ci_unique_idx
  ON public.users_profiles (lower(username));

-- Helper indépendant pour éviter toute récursion dans la policy de lecture.
CREATE FUNCTION public.can_read_private_profiles_reborn()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users_profiles up WHERE up.id = auth.uid()
      AND (upper(coalesce(up.role, '')) LIKE '%ADMIN%'
        OR upper(coalesce(up.role_ingame, '')) LIKE '%ADMIN%')
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_private_profiles_reborn() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_private_profiles_reborn() TO authenticated;

-- Invoker : les RPC serveur SECURITY DEFINER conservent leurs opérations métier.
CREATE FUNCTION public.guard_profile_client_update_reborn()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
  IF NEW.farm_id IS DISTINCT FROM OLD.farm_id AND NEW.farm_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.farms_list f
      WHERE f.id = NEW.farm_id AND f.proprietaire = auth.uid()
    ) THEN
      RAISE EXCEPTION 'La ferme doit appartenir au joueur.' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_profile_client_update_reborn() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_profile_client_update_reborn
BEFORE UPDATE ON public.users_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_client_update_reborn();

REVOKE ALL ON TABLE public.users_profiles FROM PUBLIC, anon, authenticated;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
  FROM pg_attribute
  WHERE attrelid = 'public.users_profiles'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format(
    'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.users_profiles FROM PUBLIC, anon, authenticated', cols);
END;
$$;
GRANT SELECT ON public.users_profiles TO authenticated;
GRANT UPDATE (avatar_url, farm_id, updated_at) ON public.users_profiles TO authenticated;

CREATE POLICY users_profiles_read_v1 ON public.users_profiles
FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) OR (SELECT public.can_read_private_profiles_reborn()));

CREATE POLICY users_profiles_update_v1 ON public.users_profiles
FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

ALTER TABLE public.users_profiles ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT relrowsecurity AS rls_active
FROM pg_class WHERE oid = 'public.users_profiles'::regclass;
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users_profiles' ORDER BY policyname;
