-- =============================================================================
-- EPIC-058 — Job harian otomatis & pengingat WhatsApp member
--
-- Job "tutup hari" (auto): selesaikan sesi yang sudah lewat (no-show diakui,
-- revenue kelas/Personal Training diakui), kedaluwarsakan pass (breakage),
-- tutup pesanan paket online yang lewat waktu. Sekali per hari per venue setelah
-- jam tutup (default 23:00 WIB); server mati → dikejar pada tick berikutnya.
-- Unik (branch, job, tanggal) untuk trigger auto → aman bila ada >1 proses.
--
-- Pengingat WA (transaksional, terpisah dari wa_consent marketing): H-1 sesi,
-- naik dari waitlist, kredit hampir habis, paket hampir berakhir. Dedup per
-- dedup_key (klaim sebelum kirim) → restart server tidak mengirim ulang.
-- Default MATI (studio.settings job_reminders_enabled) sampai admin menyalakan.
-- =============================================================================

CREATE TABLE IF NOT EXISTS studio.job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  job_code varchar(40) NOT NULL CHECK (job_code IN ('daily_close', 'reminders')),
  run_date date NOT NULL,
  trigger varchar(10) NOT NULL CHECK (trigger IN ('auto', 'manual')),
  status varchar(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_job_runs_auto ON studio.job_runs(branch_id, job_code, run_date) WHERE trigger = 'auto' AND job_code = 'daily_close';
CREATE INDEX IF NOT EXISTS idx_studio_job_runs_recent ON studio.job_runs(branch_id, started_at DESC);

CREATE TABLE IF NOT EXISTS studio.member_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  kind varchar(30) NOT NULL CHECK (kind IN ('session_reminder', 'waitlist_promoted', 'pass_low', 'pass_expiring')),
  dedup_key varchar(160) NOT NULL UNIQUE,
  phone varchar(30),
  message text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_studio_member_notifications_recent ON studio.member_notifications(branch_id, created_at DESC);

-- Preferensi member di Member App (pengingat WA bisa dimatikan sendiri).
CREATE TABLE IF NOT EXISTS studio.member_prefs (
  customer_id uuid PRIMARY KEY REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  wa_reminders boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Menu: Otomasi & Pengingat ──────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('studio.automation', 'Otomasi & Pengingat', '/dashboard/studio/automation', 'clock', 'sidebar', 85,
        '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code = 'studio.automation';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'studio.automation' AND parent.code = 'studio';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi') AND m.code = 'studio.automation'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
