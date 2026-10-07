-- =============================================================================
-- Grant schema accounting to app DB role (`arkiv`).
-- Schema was created by superuser; deploy user is not superuser so COA/JE
-- queries fail with "permission denied for schema accounting".
-- =============================================================================

DO $$
DECLARE
  app_role text := 'arkiv';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE NOTICE 'Role % tidak ada — skip accounting grants', app_role;
    RETURN;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA accounting TO %I', app_role);
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA accounting TO %I',
    app_role
  );
  EXECUTE format(
    'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA accounting TO %I',
    app_role
  );
  EXECUTE format(
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA accounting TO %I',
    app_role
  );

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA accounting GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    app_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA accounting GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
    app_role
  );
END $$;
