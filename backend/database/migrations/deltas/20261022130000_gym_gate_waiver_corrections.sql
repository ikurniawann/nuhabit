-- =============================================================================
-- Gym gate: waiver at the desk, open gym, gate devices, corrections, waitlist re-queue
-- =============================================================================
-- 1. pos.pos_customers.waiver_accepted_by: the staff account that recorded
--    the waiver at the front desk; NULL when the member accepted it in the app.
-- 2. gym.bookings.correction_seq counts undone check-ins and no-shows, so a
--    charge after a correction gets a fresh idempotency key.
--    gym.bookings.offer_lapses counts waitlist offers that lapsed unanswered;
--    the second lapse removes the member from the waitlist.
-- 3. gym.gate_devices: turnstiles and door readers per branch. Only the
--    SHA-256 of the device key is stored; the key is shown once.
-- 4. gym.open_gym_hours: weekly open gym hours per branch (ISO weekday,
--    WIB wall clock). A branch without rows admits open gym all day.
-- 5. gym.access_logs: device_id, the reasons waiver_required and
--    open_gym_closed, the entry kind open_gym and the source device.
-- 6. IAM menu gym.gate-devices (Perangkat Gate).
--
-- The new rule keys (requireWaiver, checkinOpensMinBefore,
-- checkinClosesMinAfter, openGymEnabled, openGymCreditCost,
-- correctionWindowDays) take their defaults in code until staff save them.
--
-- Idempotent: safe to run again.
-- =============================================================================

-- 1. Waiver recorded by staff ---------------------------------------------------
ALTER TABLE pos.pos_customers ADD COLUMN IF NOT EXISTS waiver_accepted_by uuid;

-- 2. Booking counters -----------------------------------------------------------
ALTER TABLE gym.bookings ADD COLUMN IF NOT EXISTS correction_seq int NOT NULL DEFAULT 0;
ALTER TABLE gym.bookings ADD COLUMN IF NOT EXISTS offer_lapses int NOT NULL DEFAULT 0;

-- 3. Gate devices ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.gate_devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES configuration.branches (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  -- hex SHA-256 of the device key; the key itself is never stored.
  key_hash       text NOT NULL UNIQUE,
  -- first characters of the key, so staff can tell keys apart.
  key_prefix     text NOT NULL,
  relay_open_ms  int NOT NULL DEFAULT 3000 CHECK (relay_open_ms BETWEEN 500 AND 30000),
  active         boolean NOT NULL DEFAULT true,
  last_seen_at   timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  rotated_at     timestamptz,
  revoked_at     timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_gate_devices_branch ON gym.gate_devices (branch_id);

-- 4. Open gym hours -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.open_gym_hours (
  branch_id   uuid NOT NULL REFERENCES configuration.branches (id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  opens_at    time NOT NULL,
  closes_at   time NOT NULL,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, weekday),
  CHECK (closes_at > opens_at)
);

-- 5. Access log -----------------------------------------------------------------
ALTER TABLE gym.access_logs ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES gym.gate_devices (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gym_access_logs_device ON gym.access_logs (device_id) WHERE device_id IS NOT NULL;

ALTER TABLE gym.access_logs DROP CONSTRAINT IF EXISTS access_logs_reason_check;
ALTER TABLE gym.access_logs ADD CONSTRAINT access_logs_reason_check CHECK (reason IN (
  'token_invalid', 'token_expired', 'token_consumed', 'member_not_active', 'anti_passback', 'no_booking',
  'insufficient_credits', 'waiver_required', 'open_gym_closed'));

ALTER TABLE gym.access_logs DROP CONSTRAINT IF EXISTS access_logs_entry_kind_check;
ALTER TABLE gym.access_logs ADD CONSTRAINT access_logs_entry_kind_check CHECK (entry_kind IN ('booking', 're_entry', 'open_gym'));

ALTER TABLE gym.access_logs DROP CONSTRAINT IF EXISTS access_logs_source_check;
ALTER TABLE gym.access_logs ADD CONSTRAINT access_logs_source_check CHECK (source IN ('gate', 'pos', 'manual', 'device'));

-- 6. Menu -----------------------------------------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym.gate-devices', 'Perangkat Gate', '/dashboard/gym/gate-devices', 'plug', 'sidebar', 45,
        '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code = 'gym.gate-devices';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'gym.gate-devices' AND parent.code = 'gym';

-- Admins and the gym manager get every action; front desk may look at the list.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, CASE WHEN r.code = 'gym_front_desk' THEN '["read"]'::jsonb
                        ELSE m.permission_context->'actions' END
  FROM iam.roles r
  JOIN iam.menus m ON m.code = 'gym.gate-devices' AND m.deleted_at IS NULL
 WHERE r.code IN ('super_admin', 'admin', 'gym_manager', 'gym_front_desk')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
