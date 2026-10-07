-- =============================================================================
-- EPIC-026 Task C2 — Pemakaian barang operasional + menu Inventory.
--
--   1. purchasing.supply_usages (header) + supply_usage_items (detail) → mencatat
--      pengeluaran/pemakaian stok (movement 'out' via service supply-inventory).
--   2. Grup menu baru `items.general.inventory` (Stok, Pemakaian, Penyesuaian).
-- Route fisik langsung di /dashboard/items/general/inventory/* (TANPA rewrite).
-- Idempoten.
-- =============================================================================

-- ── 1. Header pemakaian ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchasing.supply_usages (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nomor         varchar(50) NOT NULL,
    tanggal       date NOT NULL DEFAULT CURRENT_DATE,
    warehouse_id  uuid,
    divisi        varchar(120),                  -- divisi/unit yang memakai
    keperluan     text,                          -- untuk apa dipakai
    catatan       text,
    total_items   integer NOT NULL DEFAULT 0,
    company_id    uuid,
    branch_id     uuid,
    created_by    uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchasing.supply_usages
    ADD CONSTRAINT supply_usages_nomor_key UNIQUE (nomor);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supply_usages_warehouse_id_fkey') THEN
        ALTER TABLE purchasing.supply_usages
            ADD CONSTRAINT supply_usages_warehouse_id_fkey
            FOREIGN KEY (warehouse_id) REFERENCES configuration.warehouses(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supply_usages_tanggal ON purchasing.supply_usages (tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_supply_usages_warehouse ON purchasing.supply_usages (warehouse_id);

-- ── 2. Detail pemakaian ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchasing.supply_usage_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usage_id        uuid NOT NULL,
    supply_item_id  uuid NOT NULL,
    qty             numeric(15,3) NOT NULL,
    unit_cost       numeric(15,2) NOT NULL DEFAULT 0,   -- snapshot avg saat keluar
    catatan         text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supply_usage_items_usage_fkey') THEN
        ALTER TABLE purchasing.supply_usage_items
            ADD CONSTRAINT supply_usage_items_usage_fkey
            FOREIGN KEY (usage_id) REFERENCES purchasing.supply_usages(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supply_usage_items_supply_item_fkey') THEN
        ALTER TABLE purchasing.supply_usage_items
            ADD CONSTRAINT supply_usage_items_supply_item_fkey
            FOREIGN KEY (supply_item_id) REFERENCES item.supply_items(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supply_usage_items_usage ON purchasing.supply_usage_items (usage_id);
CREATE INDEX IF NOT EXISTS idx_supply_usage_items_supply ON purchasing.supply_usage_items (supply_item_id);

-- ── 3. Menu: grup Inventory + 3 anak ────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('items.general.inventory', 'Inventory', NULL, 'boxes', 'group', 30, '{"actions":["read"]}'::jsonb),
  ('items.general.inventory.stock', 'Stok Barang', '/dashboard/items/general/inventory', 'package', 'sidebar', 10, '{"actions":["read"]}'::jsonb),
  ('items.general.inventory.usage', 'Pemakaian Barang', '/dashboard/items/general/inventory/usage', 'package-minus', 'sidebar', 20, '{"actions":["read","create"]}'::jsonb),
  ('items.general.inventory.adjustment', 'Penyesuaian Stok', '/dashboard/items/general/inventory/adjustment', 'sliders-horizontal', 'sidebar', 30, '{"actions":["read","create"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'items', level = 3 WHERE code = 'items.general.inventory';
UPDATE iam.menus SET module = 'items', level = 4 WHERE code LIKE 'items.general.inventory.%';

-- Parent grup Inventory → items.general
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general.inventory' AND parent.code = 'items.general';
-- Anak → grup Inventory
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code LIKE 'items.general.inventory.%' AND parent.code = 'items.general.inventory';

-- ── 4. Grant: role sama dengan menu general lain ────────────────────────────
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'purchasing_admin', 'purchasing_manager',
                 'purchasing_staff', 'qc_staff', 'warehouse_admin', 'warehouse_staff',
                 'sulu_bandung_demo')
  AND m.code IN ('items.general.inventory', 'items.general.inventory.stock',
                 'items.general.inventory.usage', 'items.general.inventory.adjustment')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
