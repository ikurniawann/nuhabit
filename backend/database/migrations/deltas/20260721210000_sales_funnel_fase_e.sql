-- EPIC-022 Fase E: Laporan Funnel — riwayat tahap deal (fondasi funnel
-- conversion yang jujur) + menu "Laporan Funnel".

-- ============================================================
-- 1. Riwayat tahap: satu baris tiap deal MASUK sebuah tahap.
--    Diisi API saat create deal & pindah tahap; dipakai laporan
--    menghitung "berapa deal pernah mencapai tahap X".
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_sales_deal_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES crm.crm_sales_deals(id),
  stage_id uuid NOT NULL REFERENCES crm.crm_sales_stages(id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES configuration.users(id)
);

CREATE INDEX IF NOT EXISTS idx_crm_sales_stage_history_deal
  ON crm.crm_sales_deal_stage_history (deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_stage_history_stage
  ON crm.crm_sales_deal_stage_history (stage_id);

-- Backfill: posisi tahap saat ini untuk deal existing (Fase B-D belum
-- mencatat riwayat) — minimal deal terhitung di tahapnya sekarang.
INSERT INTO crm.crm_sales_deal_stage_history (deal_id, stage_id, entered_at)
SELECT d.id, d.stage_id, d.entered_stage_at
FROM crm.crm_sales_deals d
WHERE d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM crm.crm_sales_deal_stage_history h WHERE h.deal_id = d.id
  );

-- ============================================================
-- 2. Menu: Laporan Funnel
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('sales-funnel.reports', 'Laporan Funnel', '/dashboard/sales-funnel/reports',
        'chart-pie', 'sidebar', 40, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'sales-funnel', level = 2 WHERE code = 'sales-funnel.reports';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'sales-funnel.reports' AND parent.code = 'sales-funnel';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'sales')
  AND m.code = 'sales-funnel.reports'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
