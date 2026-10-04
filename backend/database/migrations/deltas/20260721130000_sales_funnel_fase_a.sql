-- EPIC-022 Fase A: fondasi Sales Funneling — leads B2B (corporate, sekolah,
-- komunitas, booking acara privat). Keputusan owner 2026-07-21:
--   • akses super_admin + role `sales` BARU (route-aware, bukan full access)
--   • scope per outlet → company_id + branch_id WAJIB (beda dari member
--     loyalty yang global by design per EPIC-011)
--   • 6 tahap pipeline default, konfigurable Super Admin
-- Tabel deals/activities/wa_templates dibuat sekarang (fondasi skema);
-- UI-nya menyusul Fase B/C.

-- ============================================================
-- 1. Master tahap pipeline (global, konfigurable Super Admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_sales_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_won boolean NOT NULL DEFAULT false,
  is_lost boolean NOT NULL DEFAULT false,
  -- deal diam di tahap ini > N hari → badge "macet" di kanban
  stuck_threshold_days int NOT NULL DEFAULT 7,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO crm.crm_sales_stages (code, name, sort_order, is_won, is_lost, stuck_threshold_days) VALUES
  ('prospek-baru',  'Prospek Baru',        10, false, false, 7),
  ('dihubungi',     'Dihubungi',           20, false, false, 7),
  ('proposal',      'Proposal/Penawaran',  30, false, false, 10),
  ('nego-survey',   'Nego/Survey Lokasi',  40, false, false, 14),
  ('menang',        'Menang (Booked)',     50, true,  false, 0),
  ('kalah',         'Kalah',               60, false, true,  0)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. Master alasan kalah (konfigurable)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_sales_lost_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO crm.crm_sales_lost_reasons (code, name, sort_order) VALUES
  ('harga',        'Harga',                10),
  ('kompetitor',   'Pilih Kompetitor',     20),
  ('jadwal',       'Jadwal Tidak Cocok',   30),
  ('batal-acara',  'Tidak Jadi Acara',     40),
  ('tidak-respon', 'Tidak Respon',         50),
  ('lainnya',      'Lainnya',              90)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. Leads — prospek B2B: instansi + PIC, scope per venue
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  org_name varchar(200) NOT NULL,
  org_type varchar(30) NOT NULL DEFAULT 'corporate'
    CHECK (org_type IN ('corporate', 'sekolah', 'komunitas', 'travel-agent',
                        'pemerintah', 'perorangan', 'lainnya')),
  pic_name varchar(150) NOT NULL,
  pic_title varchar(100),
  pic_phone varchar(30) NOT NULL,
  pic_email varchar(150),
  city varchar(100),
  source varchar(30) NOT NULL DEFAULT 'lainnya'
    CHECK (source IN ('wa', 'instagram', 'referral', 'google', 'pameran',
                      'canvassing', 'lainnya')),
  temperature varchar(10) NOT NULL DEFAULT 'hangat'
    CHECK (temperature IN ('panas', 'hangat', 'dingin')),
  status varchar(20) NOT NULL DEFAULT 'baru'
    CHECK (status IN ('baru', 'dihubungi', 'qualified', 'tidak-cocok')),
  notes text,
  owner_user_id uuid REFERENCES configuration.users(id),
  -- tautan opsional PIC → member loyalty (Fase D)
  customer_id uuid REFERENCES pos.pos_customers(id),
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dedup: satu no. WA PIC = satu lead aktif per company
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sales_leads_phone
  ON crm.crm_sales_leads (company_id, pic_phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_sales_leads_branch
  ON crm.crm_sales_leads (branch_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_leads_status
  ON crm.crm_sales_leads (status);
CREATE INDEX IF NOT EXISTS idx_crm_sales_leads_owner
  ON crm.crm_sales_leads (owner_user_id);

-- ============================================================
-- 4. Deals — satu deal = satu acara (dipakai UI Fase B)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_sales_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  lead_id uuid NOT NULL REFERENCES crm.crm_sales_leads(id),
  title varchar(200) NOT NULL,
  event_type varchar(30) NOT NULL DEFAULT 'lainnya'
    CHECK (event_type IN ('gathering', 'field-trip', 'ulang-tahun',
                          'buyout-venue', 'lainnya')),
  event_date date,
  is_event_date_fixed boolean NOT NULL DEFAULT false,
  pax_estimate int,
  stage_id uuid NOT NULL REFERENCES crm.crm_sales_stages(id),
  value_estimate numeric(14,2),
  value_final numeric(14,2),
  owner_user_id uuid REFERENCES configuration.users(id),
  lost_reason_id uuid REFERENCES crm.crm_sales_lost_reasons(id),
  entered_stage_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_sales_deals_stage
  ON crm.crm_sales_deals (stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_deals_branch
  ON crm.crm_sales_deals (branch_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_deals_lead
  ON crm.crm_sales_deals (lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_deals_event_date
  ON crm.crm_sales_deals (event_date);

-- ============================================================
-- 5. Aktivitas & follow-up (dipakai UI Fase C)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_sales_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  lead_id uuid REFERENCES crm.crm_sales_leads(id),
  deal_id uuid REFERENCES crm.crm_sales_deals(id),
  activity_type varchar(20) NOT NULL DEFAULT 'catatan'
    CHECK (activity_type IN ('telepon', 'wa', 'meeting', 'catatan')),
  notes text,
  due_at timestamptz,
  done_at timestamptz,
  owner_user_id uuid REFERENCES configuration.users(id),
  -- idempotensi pengingat WA: terkirim maksimal 1x per aktivitas
  reminder_sent_at timestamptz,
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lead_id IS NOT NULL OR deal_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_crm_sales_activities_due
  ON crm.crm_sales_activities (due_at) WHERE done_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_sales_activities_deal
  ON crm.crm_sales_activities (deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_activities_lead
  ON crm.crm_sales_activities (lead_id);

-- ============================================================
-- 6. Template pesan WA (dipakai UI Fase C)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_sales_wa_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),
  name varchar(100) NOT NULL,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. Role `sales` (baru) — akses route-aware, BUKAN full access
-- ============================================================
INSERT INTO iam.roles (code, name, description)
VALUES ('sales', 'Sales',
        'Tim sales B2B — akses modul Sales Funneling (leads, pipeline, follow-up) + area karyawan')
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active   = true,
  deleted_at  = NULL,
  updated_at  = now();

-- ============================================================
-- 8. Menu: grup "Sales Funneling" + item Leads
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('sales-funnel', 'Sales Funneling', NULL, 'chart-pie',
        'group', 82, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'sales-funnel', level = 1, parent_id = NULL
WHERE code = 'sales-funnel';

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('sales-funnel.leads', 'Leads', '/dashboard/sales-funnel/leads',
        'user-plus', 'sidebar', 10, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'sales-funnel', level = 2 WHERE code = 'sales-funnel.leads';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'sales-funnel.leads' AND parent.code = 'sales-funnel';

-- ============================================================
-- 9. Grant: super_admin + sales
-- ============================================================
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'sales')
  AND m.code IN ('sales-funnel', 'sales-funnel.leads')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
