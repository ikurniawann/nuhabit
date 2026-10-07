-- Dataroom (permintaan owner 2026-09-04): penyimpanan dokumen ala Google
-- Drive di dashboard — folder/subfolder, upload, drag & drop, klik kanan —
-- dengan link berbagi (publik / email tertentu), PIN opsional, masa aktif
-- dalam hari, dan watermark opsional untuk gambar & PDF.
--
-- File fisik disimpan di storage/private/dataroom/... (tidak pernah disajikan
-- tanpa auth). Kuota total 50 GB dihitung dari SUM(size_bytes) node file.

CREATE SCHEMA IF NOT EXISTS dataroom;

CREATE TABLE IF NOT EXISTS dataroom.nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL CHECK (kind IN ('folder', 'file')),
  name varchar(255) NOT NULL,
  mime varchar(150),
  size_bytes bigint NOT NULL DEFAULT 0,
  storage_path text,
  created_by uuid,
  created_by_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dataroom_nodes_parent
  ON dataroom.nodes(parent_id, kind, lower(name));

CREATE TABLE IF NOT EXISTS dataroom.shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token varchar(64) NOT NULL UNIQUE,
  node_id uuid NOT NULL REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  access_type varchar(10) NOT NULL CHECK (access_type IN ('public', 'email')),
  allowed_emails text[] NOT NULL DEFAULT '{}',
  pin_hash text,
  watermark boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  created_by uuid,
  created_by_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dataroom_shares_node ON dataroom.shares(node_id, created_at DESC);

-- Sesi penerima link (cookie httpOnly menyimpan session_token acak).
CREATE TABLE IF NOT EXISTS dataroom.share_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES dataroom.shares(id) ON DELETE CASCADE,
  session_token varchar(64) NOT NULL UNIQUE,
  email varchar(255),
  email_ok boolean NOT NULL DEFAULT false,
  pin_ok boolean NOT NULL DEFAULT false,
  ip varchar(64),
  user_agent varchar(255),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Kode verifikasi email 6 digit (hash), kedaluwarsa 10 menit.
CREATE TABLE IF NOT EXISTS dataroom.share_email_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES dataroom.shares(id) ON DELETE CASCADE,
  email varchar(255) NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dataroom_share_email_codes
  ON dataroom.share_email_codes(share_id, lower(email), created_at DESC);

CREATE TABLE IF NOT EXISTS dataroom.share_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES dataroom.shares(id) ON DELETE CASCADE,
  node_id uuid REFERENCES dataroom.nodes(id) ON DELETE SET NULL,
  action varchar(20) NOT NULL,
  file_name varchar(255),
  email varchar(255),
  ip varchar(64),
  user_agent varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dataroom_share_access_logs
  ON dataroom.share_access_logs(share_id, created_at DESC);

-- Menu top-level "Dataroom" (di antara CRM=80 dan Settings=90).
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, module, level, permission_context)
VALUES ('dataroom', 'Dataroom', '/dashboard/dataroom', 'folder', 'sidebar', 85, 'dataroom', 1,
        '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  module = EXCLUDED.module, level = 1, parent_id = NULL,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, '["read","create","update","delete"]'::jsonb, true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'direksi', 'admin') AND m.code = 'dataroom'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
