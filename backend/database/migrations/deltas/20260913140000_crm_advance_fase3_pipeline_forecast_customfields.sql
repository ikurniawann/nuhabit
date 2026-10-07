-- EPIC-050 Fase 3: multi-pipeline + probability + deal team, target & forecast,
-- custom fields, versi quotation + pengingat kedaluwarsa.
-- Keputusan owner 2026-09-13 (default sementara): dua pipeline —
--   • Event & Booking Venue (6 tahap EPIC-022, probability 10/25/50/75/100/0)
--   • B2B Kopi & Katering (Prospek → Sampel/Penawaran → Nego → Kontrak → Menang / Kalah; 10/35/60/85/100/0)
-- Target: per salesperson per bulan dalam Rupiah (+ jumlah deal opsional).

-- ============================================================
-- 1. Pipelines
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),   -- NULL = semua company
  code varchar(40) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO crm.crm_pipelines (code, name, description, is_default, sort_order) VALUES
  ('event-venue', 'Event & Booking Venue', 'Gathering, field trip, ulang tahun, buyout venue', true, 10),
  ('b2b-kopi',    'B2B Kopi & Katering',   'Supply kopi/katering ke kantor, sekolah, instansi', false, 20)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE crm.crm_sales_stages
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES crm.crm_pipelines(id),
  ADD COLUMN IF NOT EXISTS probability int NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100);
-- tahap lama → pipeline default + probability
UPDATE crm.crm_sales_stages s SET pipeline_id = p.id
FROM crm.crm_pipelines p WHERE p.code = 'event-venue' AND s.pipeline_id IS NULL;
UPDATE crm.crm_sales_stages SET probability = CASE code
  WHEN 'prospek-baru' THEN 10 WHEN 'dihubungi' THEN 25 WHEN 'proposal' THEN 50
  WHEN 'nego-survey' THEN 75 WHEN 'menang' THEN 100 WHEN 'kalah' THEN 0 ELSE probability END
WHERE probability = 0 AND code IN ('prospek-baru', 'dihubungi', 'proposal', 'nego-survey', 'menang', 'kalah');
-- tahap pipeline B2B (kode unik global → prefix b2b-)
INSERT INTO crm.crm_sales_stages (code, name, sort_order, is_won, is_lost, stuck_threshold_days, probability, pipeline_id)
SELECT v.code, v.name, v.sort_order, v.is_won, v.is_lost, v.stuck, v.prob, p.id
FROM (VALUES
  ('b2b-prospek',   'Prospek',            10, false, false, 7,  10),
  ('b2b-sampel',    'Sampel / Penawaran', 20, false, false, 10, 35),
  ('b2b-nego',      'Nego',               30, false, false, 14, 60),
  ('b2b-kontrak',   'Kontrak',            40, false, false, 14, 85),
  ('b2b-menang',    'Menang',             50, true,  false, 0,  100),
  ('b2b-kalah',     'Kalah',              60, false, true,  0,  0)
) AS v(code, name, sort_order, is_won, is_lost, stuck, prob)
JOIN crm.crm_pipelines p ON p.code = 'b2b-kopi'
ON CONFLICT (code) DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_crm_sales_stages_pipeline ON crm.crm_sales_stages (pipeline_id, sort_order);

ALTER TABLE crm.crm_sales_deals
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES crm.crm_pipelines(id),
  ADD COLUMN IF NOT EXISTS forecast_category varchar(20) NOT NULL DEFAULT 'pipeline'
    CHECK (forecast_category IN ('pipeline', 'best_case', 'commit', 'closed_won', 'closed_lost'));
UPDATE crm.crm_sales_deals d SET pipeline_id = s.pipeline_id
FROM crm.crm_sales_stages s WHERE s.id = d.stage_id AND d.pipeline_id IS NULL;
UPDATE crm.crm_sales_deals d SET forecast_category = CASE
  WHEN s.is_won THEN 'closed_won' WHEN s.is_lost THEN 'closed_lost'
  WHEN s.probability >= 75 THEN 'commit' WHEN s.probability >= 50 THEN 'best_case' ELSE 'pipeline' END
FROM crm.crm_sales_stages s WHERE s.id = d.stage_id;
CREATE INDEX IF NOT EXISTS idx_crm_sales_deals_pipeline ON crm.crm_sales_deals (pipeline_id) WHERE deleted_at IS NULL;

-- Deal team (banyak orang per deal)
CREATE TABLE IF NOT EXISTS crm.crm_deal_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES crm.crm_sales_deals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES configuration.users(id),
  role varchar(30) NOT NULL DEFAULT 'support' CHECK (role IN ('owner', 'support', 'pre_sales', 'account_manager', 'finance')),
  split_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (split_percent BETWEEN 0 AND 100),
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, user_id)
);

-- ============================================================
-- 2. Target / kuota per salesperson per bulan
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_sales_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  user_id uuid NOT NULL REFERENCES configuration.users(id),
  period_month date NOT NULL,                 -- tanggal 1 bulan tsb
  target_value numeric(14,2) NOT NULL DEFAULT 0,
  target_deals int,
  pipeline_id uuid REFERENCES crm.crm_pipelines(id),   -- NULL = semua pipeline
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, period_month, pipeline_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_sales_targets_period ON crm.crm_sales_targets (company_id, period_month);

-- ============================================================
-- 3. Custom fields (registry; nilai di kolom `custom` jsonb tiap objek)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),   -- NULL = semua company
  object varchar(20) NOT NULL CHECK (object IN ('lead', 'deal', 'account', 'contact')),
  key varchar(40) NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label varchar(100) NOT NULL,
  field_type varchar(20) NOT NULL CHECK (field_type IN ('text', 'textarea', 'number', 'date', 'boolean', 'picklist', 'multipicklist', 'url', 'email', 'phone')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,   -- picklist: ["A","B"]
  is_required boolean NOT NULL DEFAULT false,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb, -- {min,max,min_length,max_length,pattern}
  help_text varchar(200),
  show_in_list boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_custom_fields_key
  ON crm.crm_custom_fields (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), object, key);
ALTER TABLE crm.crm_contacts ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- 4. Versi quotation + pengingat kedaluwarsa
-- ============================================================
ALTER TABLE crm.crm_sales_quotations
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_quotation_id uuid REFERENCES crm.crm_sales_quotations(id),
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS expiry_reminded_at timestamptz;
ALTER TABLE crm.crm_sales_quotations DROP CONSTRAINT IF EXISTS crm_sales_quotations_status_check;
ALTER TABLE crm.crm_sales_quotations ADD CONSTRAINT crm_sales_quotations_status_check
  CHECK (status IN ('draft', 'terkirim', 'diterima', 'ditolak', 'superseded'));
CREATE INDEX IF NOT EXISTS idx_crm_sales_quotations_expiry
  ON crm.crm_sales_quotations (valid_until) WHERE deleted_at IS NULL AND status IN ('draft', 'terkirim') AND expiry_reminded_at IS NULL;

-- ============================================================
-- 5. Menu: Forecast & Target (Sales), Custom Fields (Pengaturan CRM)
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('sales-funnel.forecast', 'Forecast & Target', '/dashboard/sales-funnel/forecast', 'chart-bar',
   'sidebar', 47, '{"actions":["read","update"]}'::jsonb),
  ('crm.settings.custom-fields', 'Custom Fields', '/dashboard/crm/settings/custom-fields', 'clipboard',
   'sidebar', 60, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'sales-funnel' WHERE code = 'sales-funnel.forecast';
UPDATE iam.menus SET module = 'crm' WHERE code = 'crm.settings.custom-fields';
UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent WHERE parent.code = 'sales-funnel' AND child.code = 'sales-funnel.forecast';
UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent WHERE parent.code = 'crm.settings' AND child.code = 'crm.settings.custom-fields';
WITH RECURSIVE tree AS (
  SELECT id, 1 AS lvl FROM iam.menus WHERE code = 'crm'
  UNION ALL
  SELECT m.id, t.lvl + 1 FROM iam.menus m JOIN tree t ON m.parent_id = t.id
)
UPDATE iam.menus m SET level = t.lvl, updated_at = now()
FROM tree t WHERE t.id = m.id AND m.level IS DISTINCT FROM t.lvl;

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code IN ('sales-funnel.forecast', 'crm.settings.custom-fields')
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'sales' AND m.code = 'sales-funnel.forecast'
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, updated_at = now();
