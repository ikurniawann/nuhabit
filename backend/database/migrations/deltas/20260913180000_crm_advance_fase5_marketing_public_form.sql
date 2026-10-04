-- EPIC-050 Fase 5 — Marketing & Form Publik
-- T-5.1 segmen dinamis + RFM, T-5.2 atribusi UTM, T-5.3 form publik /public.

-- ============================================================
-- 1. Segmen dinamis tersimpan
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),   -- NULL = global
  name varchar(120) NOT NULL,
  description varchar(500),
  source varchar(20) NOT NULL DEFAULT 'member',             -- member | lead | contact
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  -- Hasil pratinjau terakhir, supaya daftar segmen tidak menjalankan query berat.
  last_count int,
  last_counted_at timestamptz,
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_segments_company ON crm.crm_segments (company_id) WHERE deleted_at IS NULL;

-- Kampanye boleh memakai segmen tersimpan; kolom `segment` lama tetap dipakai
-- bila segment_id NULL, jadi kampanye yang sudah ada tidak berubah perilakunya.
ALTER TABLE crm.crm_campaigns ADD COLUMN IF NOT EXISTS segment_id uuid REFERENCES crm.crm_segments(id);

-- ============================================================
-- 2. Atribusi UTM pada lead
-- ============================================================
ALTER TABLE crm.crm_sales_leads ADD COLUMN IF NOT EXISTS utm_source varchar(100);
ALTER TABLE crm.crm_sales_leads ADD COLUMN IF NOT EXISTS utm_medium varchar(100);
ALTER TABLE crm.crm_sales_leads ADD COLUMN IF NOT EXISTS utm_campaign varchar(150);
ALTER TABLE crm.crm_sales_leads ADD COLUMN IF NOT EXISTS utm_content varchar(150);
ALTER TABLE crm.crm_sales_leads ADD COLUMN IF NOT EXISTS utm_term varchar(150);
ALTER TABLE crm.crm_sales_leads ADD COLUMN IF NOT EXISTS landing_page varchar(500);
ALTER TABLE crm.crm_sales_leads ADD COLUMN IF NOT EXISTS referrer varchar(500);
CREATE INDEX IF NOT EXISTS idx_crm_sales_leads_utm
  ON crm.crm_sales_leads (company_id, utm_source, utm_campaign) WHERE deleted_at IS NULL;

-- ============================================================
-- 3. Form publik (web-to-lead)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),
  branch_id uuid REFERENCES configuration.branches(id),
  slug varchar(50) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  title varchar(150) NOT NULL,
  description varchar(600),
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  submit_label varchar(40) NOT NULL DEFAULT 'Kirim',
  success_message varchar(500) NOT NULL DEFAULT 'Terima kasih! Tim kami akan menghubungi Anda.',
  redirect_url varchar(500),
  default_source varchar(30) NOT NULL DEFAULT 'website',
  -- Penerima notifikasi lead baru
  notify_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  notify_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  submission_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_forms_active ON crm.crm_forms (is_active) WHERE deleted_at IS NULL;

-- Catatan kiriman: dipakai untuk audit, anti-spam, dan atribusi.
-- Kiriman yang ditolak (bot/duplikat) tetap dicatat supaya bisa ditelusuri.
CREATE TABLE IF NOT EXISTS crm.crm_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES crm.crm_forms(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES crm.crm_sales_leads(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash varchar(64),
  user_agent varchar(300),
  status varchar(20) NOT NULL DEFAULT 'ok',   -- ok | rejected | duplicate
  reason varchar(200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_form_submissions_form ON crm.crm_form_submissions (form_id, created_at DESC);

-- Form bawaan untuk halaman /public. Kolom `fields` diisi oleh aplikasi saat
-- pertama kali halaman Form Publik dibuka bila masih kosong.
INSERT INTO crm.crm_forms (slug, name, title, description, default_source, fields)
VALUES (
  'kontak',
  'Permintaan Penawaran',
  'Hubungi BCD Coffee',
  'Isi formulir di bawah ini untuk permintaan penawaran acara, katering, atau kerja sama. Tim kami membalas pada jam kerja.',
  'website',
  '[]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 4. Menu sidebar — CRM → Marketing
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('crm.marketing.segments', 'Segmen', '/dashboard/crm/marketing/segments', 'users',
   'sidebar', 10, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('crm.marketing.forms', 'Form Publik', '/dashboard/crm/marketing/forms', 'document-text',
   'sidebar', 20, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('crm.marketing.attribution', 'Atribusi Sumber', '/dashboard/crm/marketing/attribution', 'chart-bar',
   'sidebar', 30, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm'
WHERE code IN ('crm.marketing.segments', 'crm.marketing.forms', 'crm.marketing.attribution');

UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'crm.marketing'
  AND child.code IN ('crm.marketing.segments', 'crm.marketing.forms', 'crm.marketing.attribution');

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
WHERE r.code IN ('super_admin', 'admin')
  AND m.code IN ('crm.marketing.segments', 'crm.marketing.forms', 'crm.marketing.attribution')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
