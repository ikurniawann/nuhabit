-- Stall default per user + izin pindah stall (kasir/switcher).
-- Default login = default_warehouse_id. can_switch_stall = boleh jualan
-- di stall lain dalam branch yang sama.

ALTER TABLE configuration.users
  ADD COLUMN IF NOT EXISTS can_switch_stall boolean NOT NULL DEFAULT false;

ALTER TABLE configuration.users
  ADD COLUMN IF NOT EXISTS default_warehouse_id uuid
    REFERENCES configuration.warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_default_warehouse_id
  ON configuration.users(default_warehouse_id);

-- Admin / Super Admin / Main Storage / multi-stall lama: tetap boleh pindah.
UPDATE configuration.users u
SET can_switch_stall = true
WHERE u.can_switch_stall = false
  AND (
    u.role IN ('super_admin', 'admin')
    OR EXISTS (
      SELECT 1
      FROM configuration.user_warehouses uw
      INNER JOIN configuration.warehouses w ON w.id = uw.warehouse_id
      WHERE uw.user_id = u.id
        AND uw.is_active = true
        AND w.is_active = true
        AND w.is_default = true
    )
    OR (
      SELECT count(*)
      FROM configuration.user_warehouses uw
      INNER JOIN configuration.warehouses w ON w.id = uw.warehouse_id
      WHERE uw.user_id = u.id
        AND uw.is_active = true
        AND w.is_active = true
    ) > 1
  );

UPDATE configuration.users u
SET default_warehouse_id = sub.warehouse_id
FROM (
  SELECT DISTINCT ON (uw.user_id)
    uw.user_id,
    uw.warehouse_id
  FROM configuration.user_warehouses uw
  INNER JOIN configuration.warehouses w ON w.id = uw.warehouse_id
  WHERE uw.is_active = true
    AND w.is_active = true
  ORDER BY uw.user_id, w.is_default DESC, w.name ASC
) sub
WHERE u.id = sub.user_id
  AND u.default_warehouse_id IS NULL;
