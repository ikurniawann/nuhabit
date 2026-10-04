-- Default storage location for new branches: Main Storage (not legacy Gudang 1).

CREATE OR REPLACE FUNCTION configuration.ensure_default_warehouse_for_branch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO configuration.warehouses (branch_id, name, code, is_default, is_active)
    VALUES (NEW.id, 'Main Storage', 'MAIN', true, true)
    ON CONFLICT (branch_id, code) DO UPDATE
      SET name = EXCLUDED.name,
          is_default = true,
          is_active = true,
          updated_at = NOW();
    RETURN NEW;
END;
$$;
