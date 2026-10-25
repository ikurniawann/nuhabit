-- Gym automation: an on/off switch and settings per background job, and the
-- Gym → Otomasi & Pengingat menu.
--
--   1. platform.job_settings: one row per job name a staff member changed.
--      enabled = false makes the runner skip the job's ticks (a manual run
--      from the dashboard still runs it). config holds the job's settings,
--      such as {"graceMinutes": 30} for gym-scheduling.complete-past-sessions.
--      A job without a row is on with its built-in settings.
--   2. Menu gym.automation (read, update) for super_admin and admin.
-- Idempotent.

CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.job_settings (
  name        text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT true,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym.automation', 'Otomasi & Pengingat', '/dashboard/gym/automation', 'clock', 'sidebar', 98,
        '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code = 'gym.automation';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'gym.automation' AND parent.code = 'gym';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin')
   AND m.code = 'gym.automation'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
