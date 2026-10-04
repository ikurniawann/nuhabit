-- =============================================================================
-- Restore ownership + SELECT grants on v_products_cogs
--
-- Delta 20260727151000 used DROP VIEW + CREATE VIEW, so ACL and ownership were
-- reset to the migrate role. App roles (arkiv / authenticated) then get
-- "permission denied for view v_products_cogs" on server.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'arkiv'
  ) AND EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'v_products_cogs'
  ) THEN
    EXECUTE 'ALTER VIEW public.v_products_cogs OWNER TO arkiv';
  END IF;
END $$;

GRANT SELECT ON TABLE public.v_products_cogs TO authenticated;
GRANT SELECT ON TABLE public.v_products_cogs TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arkiv') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.v_products_cogs TO arkiv';
  END IF;
END $$;
