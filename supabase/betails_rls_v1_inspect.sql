-- Lecture seule : exécuter dans SQL Editor et transmettre le résultat complet.
-- N'active aucune RLS et ne modifie aucune donnée.
WITH inventory AS (
  SELECT 'table'::text AS type, c.oid::regclass::text AS nom,
    jsonb_build_object('rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity)::text AS definition
  FROM pg_class c WHERE c.oid = 'public.betails'::regclass
  UNION ALL
  SELECT 'colonne', a.attname,
    jsonb_build_object('type', format_type(a.atttypid,a.atttypmod),
      'nullable', NOT a.attnotnull, 'defaut', pg_get_expr(d.adbin,d.adrelid))::text
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='public.betails'::regclass AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'contrainte', conname, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conrelid='public.betails'::regclass
  UNION ALL
  SELECT 'index', indexname, indexdef FROM pg_indexes
  WHERE schemaname='public' AND tablename='betails'
  UNION ALL
  SELECT 'policy', tablename || '.' || policyname,
    jsonb_build_object('roles',roles,'commande',cmd,'using',qual,'check',with_check)::text
  FROM pg_policies WHERE schemaname='public' AND tablename IN ('betails','betail_likes')
  UNION ALL
  SELECT 'trigger', t.tgrelid::regclass::text || '.' || t.tgname,
    jsonb_build_object('etat',t.tgenabled,'definition',pg_get_triggerdef(t.oid))::text
  FROM pg_trigger t
  WHERE t.tgrelid IN ('public.betails'::regclass,'public.betail_likes'::regclass)
    AND NOT t.tgisinternal
  UNION ALL
  SELECT 'droit_table', grantee || '.' || table_name || '.' || privilege_type,
    is_grantable::text
  FROM information_schema.table_privileges
  WHERE table_schema='public' AND table_name='betails'
    AND grantee IN ('PUBLIC','anon','authenticated')
  UNION ALL
  SELECT 'droit_colonne', grantee || '.' || privilege_type,
    jsonb_agg(column_name ORDER BY column_name)::text
  FROM information_schema.column_privileges
  WHERE table_schema='public' AND table_name='betails'
    AND grantee IN ('PUBLIC','anon','authenticated')
  GROUP BY grantee, privilege_type
  UNION ALL
  SELECT 'fonction_a_verifier', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f'
    AND p.proname IN ('like_betail','unlike_betail','apply_betail_like_count_delta',
      'guard_locked_betail_updates_reborn','mark_due_shipping_as_delivered')
  UNION ALL
  SELECT 'fonction_dependante', p.oid::regprocedure::text,
    jsonb_build_object('security_definer',p.prosecdef,
      'execute_anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'execute_authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'))::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f'
    AND p.prosrc ~* '\mbetails\M'
)
SELECT type, nom, definition FROM inventory ORDER BY type,nom;
