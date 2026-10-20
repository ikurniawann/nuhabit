-- Gym Member and Laporan Gym (20261021160000) came after the gym staff roles
-- (20261021150000), so those roles do not have them yet.
--   gym_front_desk: look up, register and edit members at the desk.
--   gym_manager:    both menus with every action they offer.
-- The coach role gets neither. Re-running the file changes nothing.

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update"]'::jsonb
  FROM iam.roles r
  JOIN iam.menus m ON m.code = 'gym.members' AND m.deleted_at IS NULL
 WHERE r.code = 'gym_front_desk'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r
  JOIN iam.menus m ON m.code IN ('gym.members', 'gym.reports') AND m.is_active = true AND m.deleted_at IS NULL
 WHERE r.code = 'gym_manager'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
