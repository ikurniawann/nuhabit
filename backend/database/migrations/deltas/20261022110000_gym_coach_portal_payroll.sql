-- Coach portal and coach incentives in payroll.
--
--   1. Menu gym.my-classes (Kelas Saya): the classes the caller coaches,
--      linked through gym.coaches.user_id. read lists them with their roster
--      and the caller's incentive statements; update checks members in and
--      marks no-shows, only in the caller's own classes.
--   2. hris.payroll_additions: one-off taxable earnings for one employee in
--      one payroll period. Calculating a draft run adds them to the slip's
--      bonus, so they reach the gross and the payroll journal.
--   3. gym.coach_payouts.payroll_period: the payroll period (YYYY-MM) a paid
--      payout went into.
--
-- Idempotent.

-- 1. Menu ----------------------------------------------------------------------

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym.my-classes', 'Kelas Saya', '/dashboard/gym/my-classes', 'clipboard-document-check', 'sidebar', 2,
        '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code = 'gym.my-classes';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'gym.my-classes' AND parent.code = 'gym';

-- The coach, the manager and every role that already works the gym floor.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","update"]'::jsonb
  FROM iam.roles r
  JOIN iam.menus m ON m.code = 'gym.my-classes' AND m.deleted_at IS NULL
 WHERE r.code IN ('gym_coach', 'gym_manager', 'gym_front_desk', 'super_admin', 'admin', 'marketing')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- 2. Payroll additions -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS hris.payroll_additions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES hris.employees (id) ON DELETE CASCADE,
  period_month int  NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year  int  NOT NULL CHECK (period_year BETWEEN 2000 AND 2999),
  amount       numeric(15, 2) NOT NULL CHECK (amount > 0),
  label        text NOT NULL,
  -- What created the row, e.g. gym.coach_payout with the payout id; one row per source.
  source_type  text NOT NULL,
  source_id    uuid NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_additions_period
  ON hris.payroll_additions (period_year, period_month, employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_additions_employee ON hris.payroll_additions (employee_id);

-- 3. Payout period -------------------------------------------------------------

ALTER TABLE gym.coach_payouts ADD COLUMN IF NOT EXISTS payroll_period text
  CHECK (payroll_period IS NULL OR payroll_period ~ '^\d{4}-\d{2}$');
