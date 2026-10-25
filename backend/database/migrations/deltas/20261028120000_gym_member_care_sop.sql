-- Member care and coach SOP.
--
--   1. gym.member_flag_types: the kinds of flag staff put on a member.
--      general (pemula, VIP, pernah komplain) is visible to every gym staff
--      screen; medical (cedera, kondisi medis, hamil, tinjau PAR-Q) shows its
--      detail only to the coaches of the member's sessions or PT today and
--      later, and to gym managers. The API filters medical rows in SQL.
--   2. gym.member_flags: flags per member with an optional expiry date and a
--      soft delete (removed_at). source parq marks the flag a PAR-Q answer
--      created; review_status records the coach or manager review.
--   3. gym.health_declarations: PAR-Q+ answers per member with the
--      questionnaire version; a declaration is current for 12 months.
--   4. gym.member_session_notes: what a coach notes about a member after a
--      class or PT session. carry_forward notes show on the member's next
--      sessions until a coach releases them.
--   5. gym.sop_documents, gym.sop_versions, gym.sop_acknowledgements and
--      gym.sop_reminders: coach SOPs with versions, read confirmations per
--      staff account and the reminder log the dedupe reads.
--   6. Menus gym.member-flags (Member Perhatian Khusus) and gym.sop (SOP
--      Coach) with their grants.
--
-- Idempotent.

-- 1. Flag types ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.member_flag_types (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  label               text NOT NULL,
  category            text NOT NULL CHECK (category IN ('general', 'medical')),
  color               text NOT NULL DEFAULT 'info'
                      CHECK (color IN ('lime', 'info', 'warning', 'danger', 'success', 'ink')),
  icon                text NOT NULL DEFAULT 'flag',
  -- New flags of this type expire after this many days; NULL = no expiry.
  default_expiry_days int CHECK (default_expiry_days BETWEEN 1 AND 3650),
  sort_order          int NOT NULL DEFAULT 100,
  -- System types (tinjau PAR-Q) cannot be switched off or recategorised.
  is_system           boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO gym.member_flag_types (code, label, category, color, icon, default_expiry_days, sort_order, is_system)
VALUES
  ('parq_review', 'Tinjau PAR-Q', 'medical', 'warning', 'clipboard', NULL, 5, true),
  ('injury', 'Cedera', 'medical', 'danger', 'bandage', 30, 10, false),
  ('medical_condition', 'Kondisi medis', 'medical', 'danger', 'heart', NULL, 20, false),
  ('pregnant', 'Hamil', 'medical', 'warning', 'baby', NULL, 30, false),
  ('beginner', 'Pemula', 'general', 'info', 'sprout', 30, 40, false),
  ('vip', 'VIP', 'general', 'lime', 'star', NULL, 50, false),
  ('complained', 'Pernah komplain', 'general', 'warning', 'message', 90, 60, false)
ON CONFLICT (code) DO NOTHING;

-- 3 before 2: flags reference the declaration that created them.
-- 3. PAR-Q declarations ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.health_declarations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  version       text NOT NULL,
  -- Question code to the yes (true) or no (false) answer.
  answers       jsonb NOT NULL,
  has_yes       boolean NOT NULL,
  details       text NOT NULL DEFAULT '',
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  CONSTRAINT gym_health_declarations_expiry CHECK (expires_at > submitted_at)
);
CREATE INDEX IF NOT EXISTS idx_gym_health_declarations_customer
  ON gym.health_declarations (customer_id, submitted_at DESC);

-- 2. Flags -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.member_flags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  type_id           uuid NOT NULL REFERENCES gym.member_flag_types (id),
  note              text NOT NULL DEFAULT '',
  -- Last day the flag shows (Jakarta date); NULL = until removed.
  expires_on        date,
  source            text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'coach', 'parq')),
  declaration_id    uuid REFERENCES gym.health_declarations (id) ON DELETE SET NULL,
  -- PAR-Q flags start pending; a coach or manager clears the member,
  -- restricts training or asks for a doctor's note.
  review_status     text CHECK (review_status IN ('pending', 'cleared', 'restricted', 'doctor_note')),
  review_note       text NOT NULL DEFAULT '',
  reviewed_at       timestamptz,
  reviewed_by       uuid,
  reviewed_by_name  text NOT NULL DEFAULT '',
  created_by        uuid,
  created_by_name   text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  removed_at        timestamptz,
  removed_by        uuid
);
CREATE INDEX IF NOT EXISTS idx_gym_member_flags_customer
  ON gym.member_flags (customer_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gym_member_flags_type ON gym.member_flags (type_id);
CREATE INDEX IF NOT EXISTS idx_gym_member_flags_declaration
  ON gym.member_flags (declaration_id) WHERE declaration_id IS NOT NULL;
-- One open PAR-Q flag per member: a new declaration updates it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_member_flags_parq
  ON gym.member_flags (customer_id) WHERE source = 'parq' AND removed_at IS NULL;

-- 4. Coach session notes ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.member_session_notes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  session_id         uuid REFERENCES gym.class_sessions (id) ON DELETE SET NULL,
  pt_appointment_id  uuid REFERENCES gym.pt_appointments (id) ON DELETE SET NULL,
  coach_id           uuid NOT NULL REFERENCES gym.coaches (id) ON DELETE CASCADE,
  body               text NOT NULL,
  carry_forward      boolean NOT NULL DEFAULT false,
  released_at        timestamptz,
  released_by        uuid,
  released_by_name   text NOT NULL DEFAULT '',
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  removed_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_gym_member_session_notes_customer
  ON gym.member_session_notes (customer_id, created_at DESC) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gym_member_session_notes_session
  ON gym.member_session_notes (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_member_session_notes_pt
  ON gym.member_session_notes (pt_appointment_id) WHERE pt_appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_member_session_notes_coach ON gym.member_session_notes (coach_id);

-- 5. SOP -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.sop_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  -- IAM role codes that must read it; empty = every active coach with a
  -- staff account.
  audience_roles     text[] NOT NULL DEFAULT '{}',
  -- Unread readers are reminded this many days after publishing and again
  -- every as many days; 0 = only manual reminders.
  remind_after_days  int NOT NULL DEFAULT 3 CHECK (remind_after_days BETWEEN 0 AND 60),
  is_active          boolean NOT NULL DEFAULT true,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- A published version never changes; a fix is a new version.
CREATE TABLE IF NOT EXISTS gym.sop_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id        uuid NOT NULL REFERENCES gym.sop_documents (id) ON DELETE CASCADE,
  version            int NOT NULL CHECK (version >= 1),
  title              text NOT NULL,
  -- Markdown.
  body               text NOT NULL DEFAULT '',
  -- Optional PDF under the private storage tree.
  attachment_path    text,
  attachment_name    text,
  change_note        text NOT NULL DEFAULT '',
  published_by       uuid,
  published_by_name  text NOT NULL DEFAULT '',
  published_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version),
  CONSTRAINT gym_sop_versions_content CHECK (body <> '' OR attachment_path IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS gym.sop_acknowledgements (
  version_id       uuid NOT NULL REFERENCES gym.sop_versions (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES configuration.users (id) ON DELETE CASCADE,
  acknowledged_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gym_sop_acknowledgements_user ON gym.sop_acknowledgements (user_id);

CREATE TABLE IF NOT EXISTS gym.sop_reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  uuid NOT NULL REFERENCES gym.sop_versions (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES configuration.users (id) ON DELETE CASCADE,
  source      text NOT NULL CHECK (source IN ('manual', 'job')),
  sent_by     uuid,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_sop_reminders_reader
  ON gym.sop_reminders (version_id, user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_sop_reminders_user ON gym.sop_reminders (user_id);

-- 6. Menus and grants ------------------------------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym', 'Gym & Kelas', NULL, 'calendar', 'group', 3, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('gym.member-flags', 'Member Perhatian Khusus', '/dashboard/gym/member-flags', 'identification', 'sidebar', 6,
   '{"actions":["read","create","update","delete","read_medical"]}'::jsonb),
  ('gym.sop', 'SOP Coach', '/dashboard/gym/sop', 'document-text', 'sidebar', 62,
   '{"actions":["read","read_own","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code IN ('gym.member-flags', 'gym.sop');
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code IN ('gym.member-flags', 'gym.sop')
   AND parent.code = 'gym';

-- read_medical is the manager grant: medical flag detail, PAR-Q answers and
-- coach notes of every member. Only super_admin and gym_manager hold it.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, g.actions
  FROM (VALUES
    ('super_admin',    'gym.member-flags', '["read","create","update","delete","read_medical"]'::jsonb),
    ('gym_manager',    'gym.member-flags', '["read","create","update","delete","read_medical"]'::jsonb),
    ('admin',          'gym.member-flags', '["read","create","update","delete"]'::jsonb),
    ('gym_front_desk', 'gym.member-flags', '["read","create"]'::jsonb),
    ('super_admin',    'gym.sop',          '["read","read_own","create","update","delete"]'::jsonb),
    ('gym_manager',    'gym.sop',          '["read","read_own","create","update","delete"]'::jsonb),
    ('admin',          'gym.sop',          '["read","read_own","create","update","delete"]'::jsonb),
    ('gym_coach',      'gym.sop',          '["read_own"]'::jsonb),
    ('gym_front_desk', 'gym.sop',          '["read_own"]'::jsonb)
  ) AS g(role_code, menu_code, actions)
  JOIN iam.roles r ON r.code = g.role_code
  JOIN iam.menus m ON m.code = g.menu_code AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
