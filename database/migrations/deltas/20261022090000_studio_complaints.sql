-- EPIC-067 T-067-B1 — Tiket keluhan pelanggan.
--   • studio.complaints: catatan resmi keluhan, dari WA inbox / front desk /
--     Member App, kategori Hyrox, prioritas, tautan ke member, coach, sesi, dan
--     percakapan WA. Kolom status, PIC, dan batas waktu disiapkan sekarang;
--     alur penyelesaiannya di T-067-B2.
--       status  received → in_progress → resolved → confirmed (dikonfirmasi member)
--               cancelled = tiket salah input / duplikat
--   • studio.complaint_events: riwayat (dibuat, ganti status, PIC, catatan).
--   • menu studio.complaints "Keluhan Pelanggan".

CREATE TABLE IF NOT EXISTS studio.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  code varchar(20) NOT NULL UNIQUE,
  source varchar(15) NOT NULL CHECK (source IN ('wa', 'front_desk', 'member_app')),
  category varchar(15) NOT NULL CHECK (category IN ('coach', 'class', 'facility', 'injury', 'billing', 'other')),
  priority varchar(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status varchar(15) NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'in_progress', 'resolved', 'confirmed', 'cancelled')),
  title varchar(120) NOT NULL,
  description text,
  customer_id uuid REFERENCES pos.pos_customers(id) ON DELETE SET NULL,
  contact_name varchar(120),
  contact_phone varchar(30),
  coach_id uuid REFERENCES studio.coaches(id) ON DELETE SET NULL,
  session_id uuid REFERENCES studio.class_sessions(id) ON DELETE SET NULL,
  wa_conversation_id uuid REFERENCES crm.wa_conversations(id) ON DELETE SET NULL,
  assignee_user_id uuid,
  respond_by timestamptz,
  resolve_by timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  confirmed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_complaints_branch_status ON studio.complaints (branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_complaints_coach ON studio.complaints (coach_id) WHERE coach_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_studio_complaints_customer ON studio.complaints (customer_id) WHERE customer_id IS NOT NULL;
-- Satu tiket aktif per percakapan WA (tombol "Buat tiket" tidak membuat duplikat).
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_complaints_open_wa ON studio.complaints (wa_conversation_id)
  WHERE wa_conversation_id IS NOT NULL AND status NOT IN ('confirmed', 'cancelled');

CREATE TABLE IF NOT EXISTS studio.complaint_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES studio.complaints(id) ON DELETE CASCADE,
  kind varchar(15) NOT NULL CHECK (kind IN ('created', 'status', 'assign', 'note', 'escalated')),
  from_status varchar(15),
  to_status varchar(15),
  body text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_complaint_events_complaint ON studio.complaint_events (complaint_id, created_at);

-- ── Menu ─────────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('studio.complaints', 'Keluhan Pelanggan', '/dashboard/studio/complaints', 'megaphone',
        'sidebar', 49, '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code = 'studio.complaints';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'studio.complaints' AND parent.code = 'studio';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi', 'program_director') AND m.code = 'studio.complaints'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
