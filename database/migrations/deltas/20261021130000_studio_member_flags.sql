-- EPIC-067 T-067-C1/C2 — Penanda member perhatian khusus.
--   • studio.member_flag_types: daftar jenis (bisa ditambah dari backoffice).
--       category general  pemula, VIP, pernah komplain — terlihat front desk,
--                         admin studio, dan coach
--       category medical  cedera, kondisi medis, hamil — DETAIL hanya untuk
--                         coach yang memegang sesi hari ini/mendatang dengan
--                         member tsb (termasuk pengganti) dan coach pembuatnya;
--                         backoffice hanya melihat jumlahnya (keputusan client
--                         no. 9). Pembatasan di query/API, bukan hanya UI.
--   • studio.member_flags: penanda per member — tingkat, catatan singkat, masa
--     berlaku opsional, dihapus = removed_at (riwayat tetap ada).
--   • menu studio.member-flags "Member Perhatian Khusus".

CREATE TABLE IF NOT EXISTS studio.member_flag_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE,
  label varchar(60) NOT NULL,
  category varchar(10) NOT NULL CHECK (category IN ('general', 'medical')),
  sort_order integer NOT NULL DEFAULT 100,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO studio.member_flag_types (code, label, category, sort_order, is_system) VALUES
  ('injury', 'Cedera', 'medical', 10, true),
  ('medical_condition', 'Kondisi medis', 'medical', 20, true),
  ('pregnant', 'Hamil', 'medical', 30, true),
  ('beginner', 'Pemula', 'general', 40, true),
  ('vip', 'VIP', 'general', 50, true),
  ('complained', 'Pernah komplain', 'general', 60, true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS studio.member_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  type_id uuid NOT NULL REFERENCES studio.member_flag_types(id),
  severity varchar(10) NOT NULL DEFAULT 'attention' CHECK (severity IN ('info', 'attention', 'critical')),
  note varchar(200),
  valid_until date,
  created_by uuid,
  created_by_coach_id uuid REFERENCES studio.coaches(id) ON DELETE SET NULL,
  removed_at timestamptz,
  removed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_member_flags_customer ON studio.member_flags (customer_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_member_flags_branch ON studio.member_flags (branch_id) WHERE removed_at IS NULL;

-- ── Menu ─────────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('studio.member-flags', 'Member Perhatian Khusus', '/dashboard/studio/member-flags', 'identification',
        'sidebar', 48, '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code = 'studio.member-flags';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'studio.member-flags' AND parent.code = 'studio';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi', 'program_director') AND m.code = 'studio.member-flags'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
