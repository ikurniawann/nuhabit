-- Gym front desk: daftar member, profil 360, catatan staf, dan laporan gym.
--
--   1. gym.member_notes: catatan staf per member (penulis, isi, waktu).
--   2. Indeks untuk pencarian member dan query laporan (pembelian per
--      tanggal bayar/refund, pass aktif per tanggal berakhir, member baru).
--   3. Menu IAM gym.members (Member) dan gym.reports (Laporan Gym), di-grant
--      ke role yang sama dengan menu gym lain.
--
-- Idempotent: aman dijalankan ulang.

-- 1. Catatan staf --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.member_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  author_id    uuid NOT NULL,
  -- Nama penulis disimpan saat menulis supaya catatan tetap terbaca bila akun staf dihapus.
  author_name  text NOT NULL DEFAULT '',
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_member_notes_customer ON gym.member_notes (customer_id, created_at DESC);

-- 2. Indeks laporan ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_gym_credit_purchases_paid_at
  ON gym.credit_purchases (paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_credit_purchases_refunded_at
  ON gym.credit_purchases (refunded_at) WHERE refunded_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_member_passes_active_ends
  ON gym.member_passes (ends_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_pos_customers_created_at ON pos.pos_customers (created_at);
-- Cek email ganda saat staf mendaftarkan atau mengubah member.
CREATE INDEX IF NOT EXISTS idx_pos_customers_email_lower ON pos.pos_customers (lower(email));

-- Pencarian member memakai ILIKE '%teks%'. Indeks trigram dipakai bila
-- pg_trgm tersedia; tanpa hak membuat extension, pencarian tetap jalan.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm tidak tersedia (%), indeks trigram member dilewati', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pos_customers_name_trgm ON pos.pos_customers USING gin (name gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pos_customers_email_trgm ON pos.pos_customers USING gin (email gin_trgm_ops)';
  END IF;
END $$;

-- 3. Menu dashboard ------------------------------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym', 'Gym & Kelas', NULL, 'calendar', 'group', 3, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('gym.members', 'Member', '/dashboard/gym/members', 'users', 'sidebar', 5, '{"actions":["read","create","update"]}'::jsonb),
  ('gym.reports', 'Laporan Gym', '/dashboard/gym/reports', 'chart-bar', 'sidebar', 95, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 1 WHERE code = 'gym' AND (module IS DISTINCT FROM 'gym');
UPDATE iam.menus SET module = 'gym', level = 2 WHERE code IN ('gym.members', 'gym.reports');
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code IN ('gym.members', 'gym.reports')
   AND parent.code = 'gym';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'marketing')
   AND m.code IN ('gym', 'gym.members', 'gym.reports')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
