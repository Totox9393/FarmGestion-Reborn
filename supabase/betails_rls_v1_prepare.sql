-- ÉTAPE 1 : préparation avant mise à jour du frontend et activation des RLS.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- La page d'accueil déconnectée affiche uniquement le nombre de bétails visibles.
CREATE OR REPLACE FUNCTION public.get_visible_betails_count_reborn()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT count(*) FROM public.betails WHERE visible IS TRUE; $$;
REVOKE ALL ON FUNCTION public.get_visible_betails_count_reborn() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visible_betails_count_reborn() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_moderate_betails_reborn()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users_profiles p WHERE p.id=auth.uid()
      AND (upper(coalesce(p.role,'') || ' ' || coalesce(p.role_ingame,'')) LIKE '%ADMIN%'
        OR upper(coalesce(p.role,'') || ' ' || coalesce(p.role_ingame,'')) LIKE '%MODERATION%')
  );
$$;
REVOKE ALL ON FUNCTION public.can_moderate_betails_reborn() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_moderate_betails_reborn() TO authenticated;

-- Détails nécessaires aux expéditions publiques, même après livraison et pour
-- une ferme privée. Aucun commentaire, badge, motif de modération ou décor.
CREATE OR REPLACE FUNCTION public.get_shipping_betails_reborn(p_betail_ids uuid[])
RETURNS TABLE (id uuid, name text, matricule text, avatar_url text,
  premium boolean, age integer, farm_id bigint, owner_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT b.id,b.name,b.matricule,b.avatar_url,b.premium,b.age,b.farm_id,b.owner_id
  FROM public.betails b
  WHERE auth.uid() IS NOT NULL AND b.id=ANY(p_betail_ids)
    AND EXISTS (SELECT 1 FROM public.shipping s WHERE s.betail_id=b.id);
$$;
REVOKE ALL ON FUNCTION public.get_shipping_betails_reborn(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shipping_betails_reborn(uuid[]) TO authenticated;

-- Actions déjà proposées dans les signalements. L'utilisateur ordinaire
-- ne reçoit aucun droit UPDATE sur avatar_url pour les réaliser.
CREATE OR REPLACE FUNCTION public.moderate_betail_content_reborn(
  p_betail_id uuid, p_action text, p_avatar_url text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_moderate_betails_reborn() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_action='replace_photo' THEN
    IF nullif(btrim(p_avatar_url),'') IS NULL THEN
      RAISE EXCEPTION 'INVALID_AVATAR' USING ERRCODE='22023';
    END IF;
    UPDATE public.betails SET avatar_url=p_avatar_url WHERE id=p_betail_id;
  ELSIF p_action='remove_comment' THEN
    UPDATE public.betails SET comments=NULL WHERE id=p_betail_id;
  ELSE
    RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE='22023';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BETAIL_NOT_FOUND' USING ERRCODE='P0002';
  END IF;
  RETURN jsonb_build_object('success',true,'betail_id',p_betail_id);
END;
$$;
REVOKE ALL ON FUNCTION public.moderate_betail_content_reborn(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_betail_content_reborn(uuid,text,text) TO authenticated;

-- Le compteur est maintenu par le trigger, jamais par un UPDATE client.
-- Le verrou d'enchères existant reste applicable.
CREATE OR REPLACE FUNCTION public.apply_betail_like_count_delta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'betail_likes' THEN
    RAISE EXCEPTION 'INVALID_TRIGGER_SOURCE' USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' THEN
    UPDATE public.betails SET like_count=coalesce(like_count,0)+1 WHERE id=NEW.betail_id;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    UPDATE public.betails SET like_count=greatest(0,coalesce(like_count,0)-1) WHERE id=OLD.betail_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_betail_like_count_delta() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
