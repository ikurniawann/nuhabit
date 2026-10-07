-- =============================================================================
-- Reorganize POS sidebar groups for clearer IA.
-- Idempotent.
--
-- Target tree:
--   Operasional     → Kasir, Restaurant, Pesanan, Meja, Reservasi
--   Produk & Stok   → Produk, Stok Alert
--   Dapur & Cetak   → KDS, TV Antrian, Antrian Cetak
--   Member          → Topup
--   Pengaturan      → Metode Bayar, ARK & XP, Printer   (NEW group)
--   Laporan         → Dashboard, Profit, Transaksi, Penjualan Produk, Tutup Kasir
-- =============================================================================

-- 1) New group: Pengaturan
INSERT INTO iam.menus (
  code, menu_name, route_path, icon, menu_type, order_number,
  permission_context, module, level, is_active, is_visible
)
VALUES (
  'pos.settings',
  'Pengaturan',
  NULL,
  'settings',
  'group',
  45,
  '{"actions":["read"]}'::jsonb,
  'pos',
  1,
  true,
  true
)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number,
  module = EXCLUDED.module,
  level = EXCLUDED.level,
  is_active = true,
  is_visible = true,
  deleted_at = NULL,
  updated_at = now();

UPDATE iam.menus child
SET parent_id = parent.id,
    module = 'pos',
    level = 1,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'pos.settings'
  AND parent.code = 'pos';

-- Grant group like other POS groups (from pos.operations holders)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT rmp.role_id, settings.id, rmp.granted_actions
FROM iam.role_menu_permissions rmp
JOIN iam.menus ops ON ops.id = rmp.menu_id AND ops.code = 'pos.operations'
JOIN iam.menus settings ON settings.code = 'pos.settings'
WHERE rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();

-- 2) Move Metode Bayar → Pengaturan
UPDATE iam.menus child
SET parent_id = parent.id,
    order_number = 10,
    menu_name = 'Metode Bayar',
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'pos.loyalty.payment-methods'
  AND parent.code = 'pos.settings';

-- 3) Move Printer → Pengaturan (config, not kitchen ops)
UPDATE iam.menus child
SET parent_id = parent.id,
    order_number = 20,
    menu_name = 'Printer',
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'pos.kitchen.printer-settings'
  AND parent.code = 'pos.settings';

-- 4) Group order under POS
UPDATE iam.menus SET order_number = 10, updated_at = now() WHERE code = 'pos.operations';
UPDATE iam.menus SET order_number = 20, updated_at = now() WHERE code = 'pos.catalog';
UPDATE iam.menus SET order_number = 30, updated_at = now() WHERE code = 'pos.kitchen';
UPDATE iam.menus SET order_number = 40, updated_at = now() WHERE code = 'pos.loyalty';
UPDATE iam.menus SET order_number = 45, updated_at = now() WHERE code = 'pos.settings';
UPDATE iam.menus SET order_number = 50, updated_at = now() WHERE code = 'pos.reports';

-- 5) Operasional children: logical daily flow + ID labels
UPDATE iam.menus SET menu_name = 'Kasir', order_number = 10, updated_at = now()
WHERE code = 'pos.operations.cashier';
UPDATE iam.menus SET menu_name = 'Restaurant', order_number = 15, updated_at = now()
WHERE code = 'pos.operations.restaurant';
UPDATE iam.menus SET menu_name = 'Pesanan', order_number = 20, updated_at = now()
WHERE code = 'pos.operations.orders';
UPDATE iam.menus SET menu_name = 'Meja', order_number = 25, updated_at = now()
WHERE code = 'pos.operations.tables';
UPDATE iam.menus SET menu_name = 'Reservasi', order_number = 30, updated_at = now()
WHERE code = 'pos.operations.reservation';

-- 6) Kitchen labels
UPDATE iam.menus SET menu_name = 'Antrian Cetak', order_number = 20, updated_at = now()
WHERE code = 'pos.kitchen.print-queue';
UPDATE iam.menus SET order_number = 10, updated_at = now() WHERE code = 'pos.kitchen.kds';
UPDATE iam.menus SET order_number = 15, updated_at = now() WHERE code = 'pos.kitchen.queue-board';

-- 7) Member / Laporan labels stay; ensure order
UPDATE iam.menus SET order_number = 10, updated_at = now() WHERE code = 'pos.loyalty.topup';
UPDATE iam.menus SET order_number = 20, updated_at = now() WHERE code = 'pos.loyalty.settings';

UPDATE iam.menus SET order_number = 10, updated_at = now() WHERE code = 'pos.reports.dashboard';
UPDATE iam.menus SET order_number = 20, updated_at = now() WHERE code = 'pos.reports.profit';
UPDATE iam.menus SET order_number = 25, updated_at = now() WHERE code = 'pos.reports.transactions';
UPDATE iam.menus SET order_number = 28, updated_at = now() WHERE code = 'pos.reports.product-sales';
UPDATE iam.menus SET order_number = 30, updated_at = now() WHERE code = 'pos.reports.closing';
