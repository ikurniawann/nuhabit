-- Workstream C (kampanye & CRM): kampanye terjadwal + kanal in-app, badge
-- per metrik, ulasan member di aplikasi, dan partner loyalty eksternal.
-- Idempoten: aman dijalankan ulang.

-- 1. Kampanye: jadwal kirim, kanal (WA / in-app), status scheduled & failed --
ALTER TABLE crm.crm_campaigns
  ADD COLUMN IF NOT EXISTS scheduled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS channels       text[] NOT NULL DEFAULT ARRAY['wa']::text[],
  ADD COLUMN IF NOT EXISTS inapp_title    text,
  ADD COLUMN IF NOT EXISTS image_url      text,
  ADD COLUMN IF NOT EXISTS link_url       text,
  ADD COLUMN IF NOT EXISTS started_at     timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

ALTER TABLE crm.crm_campaigns DROP CONSTRAINT IF EXISTS crm_campaigns_status_check;
ALTER TABLE crm.crm_campaigns ADD CONSTRAINT crm_campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'sending', 'paused', 'done', 'cancelled', 'failed'));

ALTER TABLE crm.crm_campaigns DROP CONSTRAINT IF EXISTS crm_campaigns_channels_check;
ALTER TABLE crm.crm_campaigns ADD CONSTRAINT crm_campaigns_channels_check
  CHECK (cardinality(channels) > 0 AND channels <@ ARRAY['wa', 'in_app']::text[]);

ALTER TABLE crm.crm_campaigns DROP CONSTRAINT IF EXISTS crm_campaigns_schedule_check;
ALTER TABLE crm.crm_campaigns ADD CONSTRAINT crm_campaigns_schedule_check
  CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_crm_campaigns_due
  ON crm.crm_campaigns (scheduled_at) WHERE status = 'scheduled';

-- 2. Notifikasi in-app: gambar, tautan, asal kampanye, jejak buka/klik --------
-- (workstream A menambah image_url/link_url dengan nama yang sama)
ALTER TABLE crm.member_notifications
  ADD COLUMN IF NOT EXISTS image_url   text,
  ADD COLUMN IF NOT EXISTS link_url    text,
  ADD COLUMN IF NOT EXISTS campaign_id uuid,
  ADD COLUMN IF NOT EXISTS opened_at   timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_at  timestamptz;

ALTER TABLE crm.member_announcements
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS link_url  text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_notifications_campaign_id_fkey'
  ) THEN
    ALTER TABLE crm.member_notifications
      ADD CONSTRAINT member_notifications_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES crm.crm_campaigns(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Satu notifikasi per member per kampanye: start ulang tidak mengirim dobel.
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_notifications_campaign
  ON crm.member_notifications (campaign_id, customer_id) WHERE campaign_id IS NOT NULL;

-- 3. Badge per metrik + bonus XP + award/revoke manual ------------------------
ALTER TABLE crm.crm_badges
  ADD COLUMN IF NOT EXISTS metric    text NOT NULL DEFAULT 'lifetime_xp',
  ADD COLUMN IF NOT EXISTS threshold numeric(14,2),
  ADD COLUMN IF NOT EXISTS bonus_xp  integer NOT NULL DEFAULT 0;

ALTER TABLE crm.crm_badges DROP CONSTRAINT IF EXISTS crm_badges_metric_check;
ALTER TABLE crm.crm_badges ADD CONSTRAINT crm_badges_metric_check
  CHECK (metric IN ('lifetime_xp', 'visits', 'spend_idr', 'streak_weeks', 'manual'));
ALTER TABLE crm.crm_badges DROP CONSTRAINT IF EXISTS crm_badges_bonus_xp_check;
ALTER TABLE crm.crm_badges ADD CONSTRAINT crm_badges_bonus_xp_check
  CHECK (bonus_xp >= 0 AND bonus_xp <= 100000);
ALTER TABLE crm.crm_badges DROP CONSTRAINT IF EXISTS crm_badges_threshold_check;
ALTER TABLE crm.crm_badges ADD CONSTRAINT crm_badges_threshold_check
  CHECK (metric IN ('lifetime_xp', 'manual') OR (threshold IS NOT NULL AND threshold > 0));

ALTER TABLE crm.crm_member_badges
  ADD COLUMN IF NOT EXISTS source     text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS awarded_by uuid;
ALTER TABLE crm.crm_member_badges DROP CONSTRAINT IF EXISTS crm_member_badges_source_check;
ALTER TABLE crm.crm_member_badges ADD CONSTRAINT crm_member_badges_source_check
  CHECK (source IN ('auto', 'manual'));

-- Badge yang dicabut admin tidak boleh kembali lewat evaluasi otomatis.
CREATE TABLE IF NOT EXISTS crm.crm_member_badge_revocations (
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  badge_id    uuid NOT NULL REFERENCES crm.crm_badges(id) ON DELETE CASCADE,
  reason      text,
  revoked_by  uuid,
  revoked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, badge_id)
);

-- 4. Ulasan member atas order lunas ---------------------------------------
CREATE TABLE IF NOT EXISTS crm.member_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL UNIQUE REFERENCES pos.pos_orders(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  branch_id   uuid,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'replied', 'hidden')),
  reply       text,
  replied_at  timestamptz,
  replied_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_reviews_created ON crm.member_reviews (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_reviews_customer ON crm.member_reviews (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_reviews_branch ON crm.member_reviews (branch_id, status);

-- 5. Partner loyalty: secret penandatangan, XP per event, status unmatched ----
ALTER TABLE crm.crm_integration_partners
  ADD COLUMN IF NOT EXISTS signing_secret    text,
  ADD COLUMN IF NOT EXISTS secret_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS awards_xp         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS xp_per_event      integer NOT NULL DEFAULT 0;
ALTER TABLE crm.crm_integration_partners DROP CONSTRAINT IF EXISTS crm_integration_partners_xp_check;
ALTER TABLE crm.crm_integration_partners ADD CONSTRAINT crm_integration_partners_xp_check
  CHECK (xp_per_event >= 0 AND xp_per_event <= 1000);

ALTER TABLE crm.crm_external_events
  ADD COLUMN IF NOT EXISTS xp_awarded  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS matched_by  uuid;

ALTER TABLE crm.crm_external_events DROP CONSTRAINT IF EXISTS crm_external_events_status_check;
ALTER TABLE crm.crm_external_events ADD CONSTRAINT crm_external_events_status_check
  CHECK (processing_status IN ('pending', 'processed', 'unmatched', 'failed', 'ignored'));
ALTER TABLE crm.crm_external_events DROP CONSTRAINT IF EXISTS crm_external_events_source_channel_check;
ALTER TABLE crm.crm_external_events ADD CONSTRAINT crm_external_events_source_channel_check
  CHECK (source_channel IN ('photobooth', 'studio_game', 'other'));

-- 6. Menu dashboard: Ulasan Member (Customer Care) & Partner Loyalty ---------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('crm.members.member-reviews', 'Ulasan Member', '/dashboard/crm/member-reviews', 'star', 'sidebar', 35, '{"actions":["read","update"]}'::jsonb),
  ('crm.loyalty.partners', 'Partner Loyalty', '/dashboard/crm/partners', 'plug', 'sidebar', 30, '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm', level = 3
WHERE code IN ('crm.members.member-reviews', 'crm.loyalty.partners');
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.members.member-reviews' AND parent.code = 'crm.members';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.loyalty.partners' AND parent.code = 'crm.loyalty';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'marketing')
  AND m.code IN ('crm.members.member-reviews', 'crm.loyalty.partners')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- 7. Waktu percobaan kirim WA (sukses atau gagal) untuk deteksi gagal beruntun.
ALTER TABLE crm.crm_campaign_recipients ADD COLUMN IF NOT EXISTS attempted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_crm_campaign_recipients_attempts
  ON crm.crm_campaign_recipients (campaign_id, attempted_at DESC) WHERE attempted_at IS NOT NULL;
