-- Engagement member (port dari NüHabit): notifikasi in-app + pengumuman,
-- QR check-in dinamis, booking event/kelas dengan waitlist, dan challenge
-- loyalty. Semua di schema crm, terhubung ke pos.pos_customers.

-- 1. Notifikasi in-app per member ---------------------------------------
CREATE TABLE IF NOT EXISTS crm.member_announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  body            text NOT NULL,
  kind            text NOT NULL DEFAULT 'announcement' CHECK (kind IN ('announcement', 'promo')),
  -- {tier_codes: string[], min_visits: int, inactive_days: int}; kosong = semua member
  audience        jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient_count integer NOT NULL DEFAULT 0,
  sent_at         timestamptz,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.member_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  type            text NOT NULL,
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',
  announcement_id uuid REFERENCES crm.member_announcements(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_member_notifications_customer
  ON crm.member_notifications (customer_id, created_at DESC);

-- 2. QR check-in: token acak berumur pendek, sekali pakai ------------------
CREATE TABLE IF NOT EXISTS crm.member_qr_tokens (
  token       text PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_member_qr_tokens_expiry ON crm.member_qr_tokens (expires_at);

-- Log setiap scan, termasuk yang ditolak: catatan apa yang terjadi di kasir.
CREATE TABLE IF NOT EXISTS crm.member_checkins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES pos.pos_customers(id) ON DELETE SET NULL,
  decision    text NOT NULL CHECK (decision IN ('accepted', 'denied')),
  reason      text CHECK (reason IN ('not_found', 'expired', 'consumed')),
  scanned_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_checkins_created ON crm.member_checkins (created_at DESC);

-- 3. Event & kelas ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text NOT NULL,
  description           text NOT NULL DEFAULT '',
  host_name             text,
  location              text,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  capacity              integer NOT NULL CHECK (capacity > 0),
  price_idr             numeric(12,2) NOT NULL DEFAULT 0 CHECK (price_idr >= 0),
  booking_closes_hours  integer NOT NULL DEFAULT 0 CHECK (booking_closes_hours >= 0),
  cancel_deadline_hours integer NOT NULL DEFAULT 2 CHECK (cancel_deadline_hours >= 0),
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_crm_events_starts ON crm.events (starts_at);

CREATE TABLE IF NOT EXISTS crm.event_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES crm.events(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  status            text NOT NULL CHECK (status IN ('confirmed', 'waitlist', 'cancelled', 'attended', 'no_show')),
  waitlist_position integer,
  late_cancel       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz
);
-- Satu booking aktif per member per event.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_bookings_active
  ON crm.event_bookings (event_id, customer_id)
  WHERE status IN ('confirmed', 'waitlist', 'attended');

-- 4. Challenge loyalty ------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.challenges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  metric         text NOT NULL CHECK (metric IN ('visits', 'spend')),
  target         numeric(14,2) NOT NULL CHECK (target > 0),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  reward_xp      integer NOT NULL DEFAULT 0 CHECK (reward_xp >= 0),
  reward_ark_idr numeric(12,2) NOT NULL DEFAULT 0 CHECK (reward_ark_idr >= 0),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS crm.challenge_joins (
  challenge_id uuid NOT NULL REFERENCES crm.challenges(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  rewarded_at  timestamptz,
  PRIMARY KEY (challenge_id, customer_id)
);

-- 5. Menu dashboard: CRM → Engagement ---------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('crm.engagement', 'Engagement', NULL, 'megaphone', 'group', 45, '{"actions":["read"]}'::jsonb),
  ('crm.engagement.announcements', 'Pengumuman Member', '/dashboard/crm/announcements', 'megaphone', 'sidebar', 10, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('crm.engagement.events', 'Event & Kelas', '/dashboard/crm/events', 'calendar', 'sidebar', 20, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('crm.engagement.challenges', 'Challenge', '/dashboard/crm/challenges', 'star', 'sidebar', 30, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('crm.engagement.checkins', 'Check-in Member', '/dashboard/crm/checkins', 'clipboard-document-check', 'sidebar', 40, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm', level = 2 WHERE code = 'crm.engagement';
UPDATE iam.menus SET module = 'crm', level = 3 WHERE code LIKE 'crm.engagement.%';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.engagement' AND parent.code = 'crm';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code LIKE 'crm.engagement.%' AND parent.code = 'crm.engagement';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'marketing')
  AND m.code LIKE 'crm.engagement%'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
