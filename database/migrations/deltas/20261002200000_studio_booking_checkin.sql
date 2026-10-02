-- =============================================================================
-- EPIC-054 — Studio: Booking Kelas, Waitlist & Check-in
--
-- Aturan (keputusan owner 2026-10-02, bisa diubah di studio.settings):
--   • Kredit kelas DIKUNCI saat booking (ledger 'redeem' qty −1, amount 0,
--     recognized_at NULL) supaya kursi pasti.
--   • Cancel ≥ cancel_window_hours (12 jam) sebelum kelas → kredit kembali
--     (ledger 'unredeem' +1). Lewat batas → late_cancelled, kredit hangus.
--   • No-show → kredit hangus.
--   • Revenue & dasar komisi diakui saat kelas DISELESAIKAN: booking hadir /
--     no-show / late cancel → ledger redeem diisi amount (alokasi kumulatif) +
--     recognized_at, jurnal STUDIO_PASS_REDEEM_CLASS per sesi.
--   • Kelas penuh → waitlist (tanpa kunci kredit); naik otomatis saat ada
--     kursi kosong, kredit dikunci saat naik.
-- =============================================================================

ALTER TABLE studio.pass_credit_ledger ADD COLUMN IF NOT EXISTS recognized_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_studio_pass_ledger_recognized
  ON studio.pass_credit_ledger(branch_id, credit_type, recognized_at) WHERE recognized_at IS NOT NULL;

-- ── Pengaturan per venue ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS studio.settings (
  branch_id uuid NOT NULL,
  key varchar(60) NOT NULL,
  value jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, key)
);

-- ── Booking ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS studio.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES studio.class_sessions(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE RESTRICT,
  pass_id uuid REFERENCES studio.member_passes(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'waitlisted', 'cancelled', 'late_cancelled', 'attended', 'no_show')),
  source varchar(20) NOT NULL DEFAULT 'front_desk' CHECK (source IN ('front_desk', 'member_app', 'walk_in')),
  ledger_id uuid REFERENCES studio.pass_credit_ledger(id) ON DELETE SET NULL,
  booked_at timestamptz NOT NULL DEFAULT now(),
  waitlisted_at timestamptz,
  promoted_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  checked_in_at timestamptz,
  checked_in_by uuid,
  recognized_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Satu member hanya punya satu booking aktif per sesi.
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_bookings_active
  ON studio.bookings(session_id, customer_id) WHERE status IN ('booked', 'waitlisted', 'attended');
CREATE INDEX IF NOT EXISTS idx_studio_bookings_session ON studio.bookings(session_id, status);
CREATE INDEX IF NOT EXISTS idx_studio_bookings_customer ON studio.bookings(customer_id, status, booked_at);
CREATE INDEX IF NOT EXISTS idx_studio_bookings_pass ON studio.bookings(pass_id) WHERE pass_id IS NOT NULL;

-- Sesi selesai diproses (revenue diakui) → jejak waktu & jurnal.
ALTER TABLE studio.class_sessions ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE studio.class_sessions ADD COLUMN IF NOT EXISTS journal_entry_id uuid;

-- ── Menu ────────────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('studio.attendance', 'Check-in & Booking', '/dashboard/studio/attendance', 'check-circle', 'sidebar', 6,
   '{"actions":["read","create","update","delete"]}'::jsonb),
  ('studio.settings', 'Aturan Booking', '/dashboard/studio/settings', 'settings', 'sidebar', 90,
   '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code IN ('studio.attendance', 'studio.settings');
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('studio.attendance', 'studio.settings') AND parent.code = 'studio';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi') AND m.code IN ('studio.attendance', 'studio.settings')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
