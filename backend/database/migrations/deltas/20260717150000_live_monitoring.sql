-- EPIC-005 TG1: Live Monitoring rekrutmen — pantau kandidat yang sedang
-- mengerjakan psikotes on-cam / interview AI secara near-live + live chat.
--
-- 1. Frame webcam terbaru per sesi (UPSERT satu baris per sesi — kandidat
--    mengirim frame JPEG kecil tiap beberapa detik; HR polling frame ini
--    sbg "live cam" tanpa infrastruktur WebRTC).
-- 2. Pesan chat kandidat ↔ HRD per sesi (polling dua arah).
-- 3. Menu IAM hris.recruitment.live-monitoring + grant role.

-- ── 1. Frame live terbaru per sesi ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.live_monitor_frames (
  session_type text NOT NULL CHECK (session_type IN ('psikotes', 'interview')),
  session_id   uuid NOT NULL,
  -- JPEG base64 (tanpa prefix data URL), ~20-40 KB per frame 320x240
  frame_base64 text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_type, session_id)
);

-- ── 2. Live chat kandidat ↔ HRD ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.live_chat_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type text NOT NULL CHECK (session_type IN ('psikotes', 'interview')),
  session_id   uuid NOT NULL,
  sender       text NOT NULL CHECK (sender IN ('candidate', 'hr')),
  sender_name  text,
  message      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_chat_messages_session
  ON recruitment.live_chat_messages (session_type, session_id, created_at);

-- ── 3. Menu IAM ────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.recruitment.live-monitoring', 'Live Monitoring', '/dashboard/hris/live-monitoring',
        'video', 'sidebar', 26, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name          = EXCLUDED.menu_name,
  route_path         = EXCLUDED.route_path,
  icon               = EXCLUDED.icon,
  menu_type          = EXCLUDED.menu_type,
  order_number       = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active          = true,
  is_visible         = true,
  deleted_at         = NULL,
  updated_at         = now();

UPDATE iam.menus
SET module = 'hris', level = 3
WHERE code = 'hris.recruitment.live-monitoring';

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.recruitment.live-monitoring'
  AND parent.code = 'hris.recruitment';

-- super_admin & admin: semua action
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'hris.recruitment.live-monitoring'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

-- hrd: read (live monitoring khusus HRD & Super Admin/Admin)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code = 'hrd'
  AND m.code = 'hris.recruitment.live-monitoring'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
