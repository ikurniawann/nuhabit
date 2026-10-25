-- =============================================================================
-- Investor portal: read-only pages for investors, progress updates by the
-- directors and a daily email digest
-- =============================================================================
-- Investors follow revenue, performance and progress on their own instead of
-- asking the directors. This file:
--
--   1. creates schema investor with the progress updates the directors
--      write (investor.updates, investor.update_attachments) and the daily
--      digest setting per investor user (investor.digest_settings);
--   2. adds the menu group investor with four read-only pages and the
--      directors' editor menu investor.updates;
--   3. creates the role investor, granted read on the four pages only: no
--      employee area, no other module and no editor;
--   4. lets configuration.users.role hold 'investor' (the check constraint
--      still listed the original roles; it now matches AdminUserRoles);
--   5. grants the whole investor group to super_admin, admin and direksi.
--
-- Idempotent.

-- 1. Tables --------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS investor;

CREATE TABLE IF NOT EXISTS investor.updates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at    timestamptz,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_investor_updates_published ON investor.updates (status, published_at DESC);

CREATE TABLE IF NOT EXISTS investor.update_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id   uuid NOT NULL REFERENCES investor.updates (id) ON DELETE CASCADE,
  name        text NOT NULL,
  mime        text NOT NULL,
  size_bytes  bigint NOT NULL DEFAULT 0,
  -- Served by GET /api/files/investor-updates/..., staff session required.
  url         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_investor_update_attachments_update ON investor.update_attachments (update_id, created_at);

-- Kirim ringkasan harian: one row per investor user who asked for the mail.
CREATE TABLE IF NOT EXISTS investor.digest_settings (
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Menus ---------------------------------------------------------------------

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('investor', 'Investor', NULL, 'chart-pie', 'group', 4, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('investor.overview',    'Ringkasan',             '/dashboard/investor',             'chart-bar', 'sidebar', 10, '{"actions":["read"]}'::jsonb),
  ('investor.performance', 'Laporan Kinerja',       '/dashboard/investor/performance', 'chart',     'sidebar', 20, '{"actions":["read"]}'::jsonb),
  ('investor.progress',    'Progres',               '/dashboard/investor/progress',    'megaphone', 'sidebar', 30, '{"actions":["read"]}'::jsonb),
  ('investor.documents',   'Dokumen',               '/dashboard/investor/documents',   'file-text', 'sidebar', 40, '{"actions":["read"]}'::jsonb),
  ('investor.updates',     'Update untuk Investor', '/dashboard/investor/updates',     'paper-airplane', 'sidebar', 90, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'investor', level = 1 WHERE code = 'investor' AND module IS DISTINCT FROM 'investor';
UPDATE iam.menus SET module = 'investor', level = 2 WHERE code LIKE 'investor.%';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code LIKE 'investor.%' AND parent.code = 'investor'
   AND child.parent_id IS DISTINCT FROM parent.id;

-- 3. Role investor -------------------------------------------------------------

INSERT INTO iam.roles (code, name, description, is_system, is_active)
VALUES ('investor', 'Investor', 'Ringkasan, laporan kinerja, progres dan dokumen investor (hanya baca)', false, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  is_active = true, deleted_at = NULL, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read"]'::jsonb
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code = 'investor'
   AND m.code IN ('investor', 'investor.overview', 'investor.performance', 'investor.progress', 'investor.documents')
   AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- The editor stays with the directors: an earlier grant to investor is removed.
DELETE FROM iam.role_menu_permissions rmp
 USING iam.roles r, iam.menus m
 WHERE rmp.role_id = r.id AND rmp.menu_id = m.id
   AND r.code = 'investor' AND m.code = 'investor.updates';

-- 4. configuration.users.role --------------------------------------------------

ALTER TABLE configuration.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE configuration.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'super_admin', 'admin', 'hrd', 'hiring_manager', 'direksi', 'purchasing_admin',
  'purchasing_manager', 'purchasing_staff', 'finance_staff', 'warehouse_staff',
  'warehouse_admin', 'pos', 'pos_supervisor', 'qc_staff', 'employee', 'sales', 'marketing',
  'investor'
]));

-- 5. Directors -----------------------------------------------------------------

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'direksi')
   AND (m.code = 'investor' OR m.code LIKE 'investor.%')
   AND m.is_active = true AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
