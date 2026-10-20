-- =============================================================================
-- Gym roles: front desk, coach and manager, with action-level menu grants
-- =============================================================================
-- The gym API now checks the granted action of each menu (read, create,
-- update, delete) instead of only the menu. This file:
--
--   1. adds the action read_own to gym.sessions: the sessions the caller
--      coaches (linked through gym.coaches.user_id), their roster and
--      no-shows;
--   2. adds delete to gym.incentives (deleting a scheme) and grants it to
--      every role that could already update incentives, so their access does
--      not change;
--   3. creates the roles gym_front_desk, gym_coach and gym_manager and grants
--      their menus. Like marketing, the three keep the employee area (ESS).
--
-- On gym.credits, create sells a package and update corrects the ledger
-- (adjust, reverse, refund), so front desk sells without correcting.
-- Idempotent.

-- 1 + 2. Menu actions ----------------------------------------------------------

UPDATE iam.menus
   SET permission_context = jsonb_set(COALESCE(permission_context, '{}'::jsonb), '{actions}',
                                      '["read","create","update","delete","read_own"]'::jsonb),
       updated_at = now()
 WHERE code = 'gym.sessions';

UPDATE iam.menus
   SET permission_context = jsonb_set(COALESCE(permission_context, '{}'::jsonb), '{actions}',
                                      '["read","create","update","delete"]'::jsonb),
       updated_at = now()
 WHERE code = 'gym.incentives';

UPDATE iam.role_menu_permissions rmp
   SET granted_actions = rmp.granted_actions || '["delete"]'::jsonb, updated_at = now()
  FROM iam.menus m
 WHERE m.id = rmp.menu_id AND m.code = 'gym.incentives'
   AND rmp.granted_actions ? 'update' AND NOT rmp.granted_actions ? 'delete';

-- 3. Roles ---------------------------------------------------------------------

INSERT INTO iam.roles (code, name, description, is_system, is_active)
VALUES
  ('gym_front_desk', 'Gym Front Desk', 'Check-in, booking kelas, jual paket kredit, lihat member', false, true),
  ('gym_coach', 'Gym Coach', 'Kelas sendiri dan roster-nya, check-in, tandai tidak hadir', false, true),
  ('gym_manager', 'Gym Manager', 'Seluruh menu gym termasuk aturan, refund, koreksi kredit dan insentif', false, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  is_active = true, deleted_at = NULL, updated_at = now();

-- Explicit grants per role; menus missing from the database are skipped.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, g.actions
  FROM (VALUES
    ('gym_front_desk', 'gym',          '["read"]'::jsonb),
    ('gym_front_desk', 'gym.checkin',  '["read","create"]'),
    ('gym_front_desk', 'gym.bookings', '["read","create","update"]'),
    ('gym_front_desk', 'gym.sessions', '["read"]'),
    ('gym_front_desk', 'gym.schedule', '["read"]'),
    ('gym_front_desk', 'gym.credits',  '["read","create"]'),
    ('gym_coach',      'gym',          '["read"]'),
    ('gym_coach',      'gym.sessions', '["read_own"]'),
    ('gym_coach',      'gym.checkin',  '["read","create"]')
  ) AS g(role_code, menu_code, actions)
  JOIN iam.roles r ON r.code = g.role_code
  JOIN iam.menus m ON m.code = g.menu_code AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- gym_manager: every gym menu with every action it offers.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code = 'gym_manager'
   AND (m.code = 'gym' OR m.code LIKE 'gym.%')
   AND m.is_active = true AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- Gym staff are employees: the employee area, as for marketing.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('gym_front_desk', 'gym_coach', 'gym_manager')
   AND (m.code = 'ess' OR m.code LIKE 'ess.%')
   AND m.is_active = true AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
