-- Coach leave: Program Director, substitutes, blackout dates, discipline
-- and schedule change notices (EPIC-067 A-track).
--
--   1. Role gym_program_director and menu gym.coach-leave (Cuti & Pengganti
--      Coach). The Program Director decides coach leave, appoints
--      substitutes, cancels classes and manages blackouts and incidents.
--   2. gym.coach_leave_settings: one row. Backup approver, minimum notice per
--      leave type, how long a substitute has to answer, and the warning
--      letter (SP) and deduction rules.
--   3. hris.leaves: short notice flag, notice days at submission and the
--      blackout exception the coach asked for or the Program Director gave.
--      marriage and bereavement join the leave_type enum: the HRIS form
--      offers them but inserting them failed.
--   4. gym.coach_leave_covers: one row per (leave, affected class or PT
--      session). open -> requested -> accepted | declined, assigned by the
--      Program Director, cancelled (the session is called off), or void when
--      the leave is rejected or the session is no longer affected. applied_at
--      is set when the approved leave hands the session to the substitute.
--   5. original_coach_id on class sessions and PT appointments: the coach
--      scheduled before a substitute took over. coach_id stays the coach who
--      teaches (commission and KPI attribution).
--   6. Schedule change stamps on class sessions: coach_changed_at (bookings
--      made before it may cancel free inside the changeFreeCancelHours rule),
--      changed_at, change_kind and change_notice_late for the change report.
--   7. gym.coach_availability_exceptions.leave_id: the full-day time off an
--      approved leave creates; removing or cancelling the leave removes it.
--   8. gym.coach_leave_blackouts: date ranges without leave, per branch or
--      for every branch (branch_id NULL).
--   9. gym.coach_incidents and gym.coach_warnings: no-show, short notice
--      leave and late arrival, and the SP proposals they trigger.
--
-- Idempotent.

-- 1. Role and menu -------------------------------------------------------------

INSERT INTO iam.roles (code, name, description, is_system, is_active)
VALUES ('gym_program_director', 'Gym Program Director',
        'Memutus cuti coach, menunjuk pengganti, membatalkan kelas, mengatur blackout dan disiplin coach', false, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  is_active = true, deleted_at = NULL, updated_at = now();

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym.coach-leave', 'Cuti & Pengganti Coach', '/dashboard/gym/coach-leave', 'calendar', 'sidebar', 65,
        '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code = 'gym.coach-leave';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'gym.coach-leave' AND parent.code = 'gym';

-- HR reads the queue and the incidents; the managers work it.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, g.actions
  FROM (VALUES
    ('super_admin',          'gym.coach-leave', '["read","update"]'::jsonb),
    ('admin',                'gym.coach-leave', '["read","update"]'),
    ('gym_manager',          'gym.coach-leave', '["read","update"]'),
    ('hrd',                  'gym.coach-leave', '["read"]'),
    ('gym_program_director', 'gym',             '["read"]'),
    ('gym_program_director', 'gym.coach-leave', '["read","update"]'),
    ('gym_program_director', 'gym.schedule',    '["read"]'),
    ('gym_program_director', 'gym.sessions',    '["read"]'),
    ('gym_program_director', 'gym.coaches',     '["read"]'),
    ('gym_program_director', 'gym.pt',          '["read"]'),
    ('gym_program_director', 'gym.my-classes',  '["read","update"]')
  ) AS g(role_code, menu_code, actions)
  JOIN iam.roles r ON r.code = g.role_code
  JOIN iam.menus m ON m.code = g.menu_code AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- The Program Director is an employee: the employee area, as for gym staff.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code = 'gym_program_director'
   AND (m.code = 'ess' OR m.code LIKE 'ess.%')
   AND m.is_active = true AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- 2. Settings ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.coach_leave_settings (
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Decides when no Program Director is available (none, all on leave, or
  -- the requester themself).
  backup_approver_user_id   uuid REFERENCES configuration.users (id) ON DELETE SET NULL,
  -- Per leave type: {"annual": {"min_days": 7, "allow_short_notice": false, "blackout": true}, ...}.
  -- Missing types use the defaults in the gym-coach-leave domain.
  notice_rules              jsonb NOT NULL DEFAULT '{}'::jsonb,
  substitute_response_hours int NOT NULL DEFAULT 24 CHECK (substitute_response_hours BETWEEN 1 AND 72),
  -- An SP is proposed after warning_threshold active incidents within
  -- warning_window_days that no earlier SP counted.
  warning_threshold         int NOT NULL DEFAULT 3 CHECK (warning_threshold BETWEEN 1 AND 20),
  warning_window_days       int NOT NULL DEFAULT 90 CHECK (warning_window_days BETWEEN 7 AND 365),
  -- Commission deduction per incident kind, in percent, snapshotted on each incident.
  deduction_percent         jsonb NOT NULL DEFAULT '{"no_show": 15, "short_notice_leave": 5, "late": 5}'::jsonb,
  updated_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
INSERT INTO gym.coach_leave_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- 3. HRIS leave columns ----------------------------------------------------------

ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'marriage';
ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'bereavement';

ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS is_short_notice boolean NOT NULL DEFAULT false;
-- Start date minus the submission day in the coach's branch zone; negative
-- when submitted after the start. NULL for employees who coach no class.
ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS notice_days int;
ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS blackout_exception_requested boolean NOT NULL DEFAULT false;
ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS blackout_override_reason text;
ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS blackout_override_by uuid;
ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS blackout_override_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_leaves_short_notice ON hris.leaves (employee_id, start_date) WHERE is_short_notice;

-- 4. Covers --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.coach_leave_covers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_id            uuid NOT NULL REFERENCES hris.leaves (id) ON DELETE CASCADE,
  coach_id            uuid NOT NULL REFERENCES gym.coaches (id) ON DELETE CASCADE,
  session_id          uuid REFERENCES gym.class_sessions (id) ON DELETE CASCADE,
  pt_appointment_id   uuid REFERENCES gym.pt_appointments (id) ON DELETE CASCADE,
  substitute_coach_id uuid REFERENCES gym.coaches (id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'requested', 'accepted', 'declined', 'assigned', 'cancelled', 'void')),
  requested_at        timestamptz,
  respond_by          timestamptz,
  responded_at        timestamptz,
  decided_by          uuid,
  cancel_reason       text,
  note                text,
  applied_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_coach_leave_covers_one_target CHECK (num_nonnulls(session_id, pt_appointment_id) = 1),
  CONSTRAINT gym_coach_leave_covers_substitute CHECK (
    status NOT IN ('requested', 'accepted', 'assigned') OR substitute_coach_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_coach_leave_covers_session
  ON gym.coach_leave_covers (leave_id, session_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_coach_leave_covers_pt
  ON gym.coach_leave_covers (leave_id, pt_appointment_id) WHERE pt_appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_coach_leave_covers_substitute
  ON gym.coach_leave_covers (substitute_coach_id, status) WHERE substitute_coach_id IS NOT NULL;

-- 5. Original coach --------------------------------------------------------------

ALTER TABLE gym.class_sessions
  ADD COLUMN IF NOT EXISTS original_coach_id uuid REFERENCES gym.coaches (id) ON DELETE SET NULL;
ALTER TABLE gym.pt_appointments
  ADD COLUMN IF NOT EXISTS original_coach_id uuid REFERENCES gym.coaches (id) ON DELETE SET NULL;

-- 6. Schedule change stamps ------------------------------------------------------

ALTER TABLE gym.class_sessions ADD COLUMN IF NOT EXISTS coach_changed_at timestamptz;
ALTER TABLE gym.class_sessions ADD COLUMN IF NOT EXISTS changed_at timestamptz;
ALTER TABLE gym.class_sessions ADD COLUMN IF NOT EXISTS change_kind text
  CHECK (change_kind IN ('coach_changed', 'moved', 'cancelled'));
ALTER TABLE gym.class_sessions ADD COLUMN IF NOT EXISTS change_notice_late boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_gym_sessions_changed
  ON gym.class_sessions (changed_at DESC) WHERE changed_at IS NOT NULL;

-- 7. Time off from leave -----------------------------------------------------------

ALTER TABLE gym.coach_availability_exceptions
  ADD COLUMN IF NOT EXISTS leave_id uuid REFERENCES hris.leaves (id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_coach_exceptions_leave_day
  ON gym.coach_availability_exceptions (leave_id, date) WHERE leave_id IS NOT NULL;

-- 8. Blackouts -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.coach_leave_blackouts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id  uuid REFERENCES configuration.branches (id) ON DELETE CASCADE,
  date_from  date NOT NULL,
  date_to    date NOT NULL,
  reason     text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_coach_leave_blackouts_range CHECK (date_to >= date_from AND date_to - date_from < 31)
);
CREATE INDEX IF NOT EXISTS idx_gym_coach_leave_blackouts_dates ON gym.coach_leave_blackouts (date_to, date_from);

-- 9. Discipline ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.coach_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id          uuid NOT NULL REFERENCES gym.coaches (id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('no_show', 'short_notice_leave', 'late')),
  occurred_on       date NOT NULL,
  session_id        uuid REFERENCES gym.class_sessions (id) ON DELETE SET NULL,
  leave_id          uuid REFERENCES hris.leaves (id) ON DELETE CASCADE,
  minutes_late      int CHECK (minutes_late IS NULL OR minutes_late > 0),
  note              text NOT NULL DEFAULT '',
  -- The deduction rule when the incident was recorded; later rule changes
  -- leave it alone.
  deduction_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (deduction_percent BETWEEN 0 AND 100),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  void_reason       text,
  voided_by         uuid,
  voided_at         timestamptz,
  recorded_by       uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_coach_incidents_coach
  ON gym.coach_incidents (coach_id, occurred_on) WHERE status = 'active';
-- One short notice incident per leave.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_coach_incidents_leave
  ON gym.coach_incidents (leave_id) WHERE leave_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gym.coach_warnings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id      uuid NOT NULL REFERENCES gym.coaches (id) ON DELETE CASCADE,
  level         smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'issued', 'dismissed')),
  window_from   date NOT NULL,
  window_to     date NOT NULL,
  incident_ids  uuid[] NOT NULL,
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- At most one open proposal per coach.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_coach_warnings_proposed
  ON gym.coach_warnings (coach_id) WHERE status = 'proposed';
