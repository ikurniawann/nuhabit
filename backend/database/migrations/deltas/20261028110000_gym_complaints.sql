-- =============================================================================
-- Gym complaint tickets (EPIC-067 B). A member complaint or piece of feedback
-- becomes a ticket from the CRM WhatsApp inbox, the front desk, the member
-- app or any staff screen. The gym-complaints module owns these tables.
--
--   status  received -> in_progress -> resolved -> confirmed (member confirms)
--                                              \-> reopened -> in_progress ...
--
-- Deadlines come from the SLA settings per priority, in the branch's time
-- zone. Overdue tickets escalate once per deadline by WhatsApp to the head
-- coach or ops contact of the branch and by a staff inbox alert, from the
-- "gym-complaints.escalate" job. Idempotent.
-- =============================================================================

-- 1. Categories: a configurable list, HYROX gym defaults -----------------------
CREATE TABLE IF NOT EXISTS gym.complaint_categories (
  code       text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  label      text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  sort_order int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO gym.complaint_categories (code, label, sort_order) VALUES
  ('coach', 'Coach', 10),
  ('kelas', 'Kelas', 20),
  ('fasilitas', 'Fasilitas', 30),
  ('kebersihan', 'Kebersihan', 40),
  ('booking_aplikasi', 'Booking / aplikasi', 50),
  ('pembayaran', 'Pembayaran', 60),
  ('lainnya', 'Lainnya', 90)
ON CONFLICT (code) DO NOTHING;

-- 2. Settings per branch; the row without a branch is the default -------------
--    sla: {"<priority>": {"respond_hours", "resolve_hours", "business_hours"}}.
--    business_hours counts only work_start..work_end in the branch zone.
CREATE TABLE IF NOT EXISTS gym.complaint_settings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id          uuid REFERENCES configuration.branches(id) ON DELETE CASCADE,
  sla                jsonb NOT NULL DEFAULT '{}'::jsonb,
  work_start         time NOT NULL DEFAULT '08:00',
  work_end           time NOT NULL DEFAULT '21:00',
  -- Head coach or ops: staff inbox alert, and WhatsApp to escalation_phone or
  -- the phone on that user's employee record.
  escalation_user_id uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  escalation_phone   text,
  updated_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT complaint_settings_window CHECK (work_end > work_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_complaint_settings_branch
  ON gym.complaint_settings (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
INSERT INTO gym.complaint_settings (branch_id)
SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM gym.complaint_settings WHERE branch_id IS NULL);

-- 3. Tickets --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.complaints (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 varchar(20) NOT NULL UNIQUE,
  source               text NOT NULL CHECK (source IN ('wa_inbox', 'front_desk', 'member_app', 'staff')),
  category             text NOT NULL REFERENCES gym.complaint_categories(code) ON UPDATE CASCADE,
  priority             text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status               text NOT NULL DEFAULT 'received'
                       CHECK (status IN ('received', 'in_progress', 'resolved', 'confirmed', 'reopened')),
  title                text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description          text,
  customer_id          uuid REFERENCES pos.pos_customers(id) ON DELETE SET NULL,
  contact_name         text,
  contact_phone        text,
  coach_id             uuid REFERENCES gym.coaches(id) ON DELETE SET NULL,
  session_id           uuid REFERENCES gym.class_sessions(id) ON DELETE SET NULL,
  branch_id            uuid REFERENCES configuration.branches(id) ON DELETE SET NULL,
  conversation_id      uuid REFERENCES crm.wa_conversations(id) ON DELETE SET NULL,
  owner_user_id        uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  -- The SLA clock starts at creation and again on each reopen.
  sla_started_at       timestamptz NOT NULL DEFAULT now(),
  respond_by           timestamptz NOT NULL,
  resolve_by           timestamptz NOT NULL,
  first_response_at    timestamptz,
  resolved_at          timestamptz,
  confirmed_at         timestamptz,
  reopen_count         int NOT NULL DEFAULT 0,
  -- Escalation claims: one WhatsApp per deadline, reset when the deadline moves.
  respond_escalated_at timestamptz,
  resolve_escalated_at timestamptz,
  created_by           uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_complaints_status ON gym.complaints (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_complaints_branch ON gym.complaints (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_complaints_customer ON gym.complaints (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_complaints_coach ON gym.complaints (coach_id, created_at DESC) WHERE coach_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_complaints_session ON gym.complaints (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_complaints_owner ON gym.complaints (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_complaints_created_by ON gym.complaints (created_by);
CREATE INDEX IF NOT EXISTS idx_gym_complaints_category ON gym.complaints (category);
CREATE INDEX IF NOT EXISTS idx_gym_complaints_open_deadlines ON gym.complaints (resolve_by)
  WHERE status IN ('received', 'in_progress', 'reopened');
-- One unconfirmed ticket per inbox conversation: "Jadikan tiket" twice opens the same one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_complaints_open_conversation ON gym.complaints (conversation_id)
  WHERE conversation_id IS NOT NULL AND status <> 'confirmed';

-- 4. History: status moves, owner changes, internal notes, member replies ---------
CREATE TABLE IF NOT EXISTS gym.complaint_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id      uuid NOT NULL REFERENCES gym.complaints(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('created', 'status', 'assign', 'note', 'reply', 'updated', 'escalated')),
  from_status       text,
  to_status         text,
  body              text,
  -- true: the member sees it in the member app (replies, status moves).
  is_public         boolean NOT NULL DEFAULT false,
  actor_user_id     uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  actor_customer_id uuid REFERENCES pos.pos_customers(id) ON DELETE SET NULL,
  -- clock_timestamp keeps several events of one transaction in order.
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_gym_complaint_events_complaint ON gym.complaint_events (complaint_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gym_complaint_events_actor_user ON gym.complaint_events (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_gym_complaint_events_actor_customer ON gym.complaint_events (actor_customer_id);

-- 5. Menu Gym -> Keluhan ------------------------------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym.complaints', 'Keluhan', '/dashboard/gym/complaints', 'megaphone', 'sidebar', 92,
        '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code = 'gym.complaints';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'gym.complaints' AND parent.code = 'gym';

-- Full access: managers, marketing and admins. The front desk reads, creates
-- and updates; delete also guards the SLA and escalation settings.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, g.actions
  FROM (VALUES
    ('super_admin',    '["read","create","update","delete"]'::jsonb),
    ('admin',          '["read","create","update","delete"]'::jsonb),
    ('gym_manager',    '["read","create","update","delete"]'::jsonb),
    ('marketing',      '["read","create","update","delete"]'::jsonb),
    ('gym_front_desk', '["read","create","update"]'::jsonb)
  ) AS g(role_code, actions)
  JOIN iam.roles r ON r.code = g.role_code
  JOIN iam.menus m ON m.code = 'gym.complaints' AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
