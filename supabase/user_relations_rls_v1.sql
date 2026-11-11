-- Execute this entire file in the Supabase SQL Editor.
-- Prerequisite: no existing policies on public.user_relations (checked below).
-- Keeps the existing allow_friend_requests trigger.
BEGIN;

LOCK TABLE public.user_relations IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_relations'
  ) THEN
    RAISE EXCEPTION 'Existing user_relations policies: stop and review before applying.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.user_relations'::regclass
      AND tgname = 'trg_enforce_allow_friend_requests_on_pending_relation'
      AND tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'The allow_friend_requests trigger must be enabled first.';
  END IF;
END;
$$;

CREATE FUNCTION public.guard_user_relations_rls_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor uuid := auth.uid();
  allowed boolean := false;
BEGIN
  -- Administrative SQL and service-role maintenance keep their existing access.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF actor IS NULL OR NEW.user_a IS NULL OR NEW.user_b IS NULL
     OR NEW.user_a = NEW.user_b
     OR (actor <> NEW.user_a AND actor <> NEW.user_b) THEN
    RAISE EXCEPTION 'Relation non autorisee' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.initiator IS DISTINCT FROM actor
       OR NEW.status IS NULL OR NEW.status NOT IN ('pending', 'blocked') THEN
      RAISE EXCEPTION 'Creation de relation non autorisee' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := now();
    NEW.responded_at := CASE WHEN NEW.status = 'blocked' THEN now() ELSE NULL END;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_a IS DISTINCT FROM OLD.user_a
     OR NEW.user_b IS DISTINCT FROM OLD.user_b THEN
    RAISE EXCEPTION 'Les participants ne peuvent pas etre modifies' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'blocked' THEN
    -- The blocked person cannot unblock, replace the blocker, or resend a request.
    allowed := OLD.initiator = actor AND NEW.status = 'cancelled'
               AND NEW.initiator IS NOT DISTINCT FROM OLD.initiator;
  ELSIF NEW.status = 'blocked' THEN
    allowed := NEW.initiator = actor;
  ELSIF OLD.status = 'pending' THEN
    allowed := NEW.initiator IS NOT DISTINCT FROM OLD.initiator AND (
      (OLD.initiator = actor AND NEW.status = 'cancelled')
      OR (OLD.initiator <> actor AND NEW.status IN ('accepted', 'declined'))
    );
  ELSIF OLD.status IN ('declined', 'cancelled') THEN
    allowed := NEW.status = 'pending' AND NEW.initiator = actor;
  END IF;

  IF NOT coalesce(allowed, false) THEN
    RAISE EXCEPTION 'Changement de relation non autorise' USING ERRCODE = '42501';
  END IF;

  NEW.created_at := CASE WHEN NEW.status = 'pending' THEN now() ELSE OLD.created_at END;
  NEW.responded_at := CASE WHEN NEW.status = 'pending' THEN NULL ELSE now() END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_user_relations_rls_v1() FROM PUBLIC, anon, authenticated;

-- Runs before the existing preference check (alphabetical trigger ordering).
CREATE TRIGGER trg_00_guard_user_relations_rls_v1
BEFORE INSERT OR UPDATE ON public.user_relations
FOR EACH ROW EXECUTE FUNCTION public.guard_user_relations_rls_v1();

REVOKE ALL ON TABLE public.user_relations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_relations TO authenticated;

DO $$
DECLARE
  seq_name text := pg_get_serial_sequence('public.user_relations', 'id');
BEGIN
  IF seq_name IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', seq_name);
    EXECUTE format('GRANT USAGE ON SEQUENCE %s TO authenticated', seq_name);
  END IF;
END;
$$;

CREATE POLICY user_relations_read_v1 ON public.user_relations
FOR SELECT TO authenticated
USING (status = 'accepted' OR auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY user_relations_insert_v1 ON public.user_relations
FOR INSERT TO authenticated
WITH CHECK (
  initiator = auth.uid()
  AND (auth.uid() = user_a OR auth.uid() = user_b)
  AND status IN ('pending', 'blocked')
);

CREATE POLICY user_relations_update_v1 ON public.user_relations
FOR UPDATE TO authenticated
USING (auth.uid() = user_a OR auth.uid() = user_b)
WITH CHECK (auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY user_relations_delete_v1 ON public.user_relations
FOR DELETE TO authenticated
USING (status = 'accepted' AND (auth.uid() = user_a OR auth.uid() = user_b));

ALTER TABLE public.user_relations ENABLE ROW LEVEL SECURITY;

COMMIT;

SELECT relrowsecurity AS rls_active
FROM pg_class WHERE oid = 'public.user_relations'::regclass;
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'user_relations'
ORDER BY policyname;
