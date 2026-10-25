-- =============================================================================
-- Event calendar (MOM item 20): one calendar over CRM events, site events,
-- classes and PT, with conflict overrides, an event checklist and ICS feeds.
-- =============================================================================
-- 1. CRM and site events learn where they happen (branch, area), who hosts
--    (coach) and who organises (staff), and link to each other so one real
--    event is entered once.
-- 2. A one-off pass links rows with the same title and start time.
-- 3. events.conflict_overrides records who saved over a clash and why.
-- 4. events.tasks is the per-event checklist (venue, sponsor, promo,
--    equipment) with assignees and due dates.
-- 5. events.calendar_feeds holds the hashed tokens of ICS subscriptions.
-- 6. Menu events.calendar (read) for the roles that hold the CRM or site
--    events menus, plus gym_manager.
-- Idempotent.

CREATE SCHEMA IF NOT EXISTS events;

-- 1. Place, host, organiser and the cross link -------------------------------

ALTER TABLE crm.events
  ADD COLUMN IF NOT EXISTS branch_id         uuid REFERENCES configuration.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area              text,
  ADD COLUMN IF NOT EXISTS coach_id          uuid REFERENCES gym.coaches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organiser_user_id uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_event_id     uuid REFERENCES site.events(id) ON DELETE SET NULL;

ALTER TABLE site.events
  ADD COLUMN IF NOT EXISTS branch_id         uuid REFERENCES configuration.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area              text,
  ADD COLUMN IF NOT EXISTS coach_id          uuid REFERENCES gym.coaches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organiser_user_id uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crm_event_id      uuid REFERENCES crm.events(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_events_site_event ON crm.events (site_event_id) WHERE site_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_site_events_crm_event ON site.events (crm_event_id) WHERE crm_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_events_branch_time ON crm.events (branch_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_crm_events_coach_time ON crm.events (coach_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_site_events_branch_time ON site.events (branch_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_site_events_coach_time ON site.events (coach_id, starts_at);

-- 2. Link rows that describe the same event ---------------------------------

WITH pairs AS (
  SELECT c.id AS crm_id, s.id AS site_id,
         row_number() OVER (PARTITION BY c.id ORDER BY s.created_at) AS rc,
         row_number() OVER (PARTITION BY s.id ORDER BY c.created_at) AS rs
    FROM crm.events c
    JOIN site.events s ON lower(btrim(s.title)) = lower(btrim(c.title)) AND s.starts_at = c.starts_at
   WHERE c.site_event_id IS NULL AND s.crm_event_id IS NULL
), chosen AS (
  SELECT crm_id, site_id FROM pairs WHERE rc = 1 AND rs = 1
), linked_crm AS (
  UPDATE crm.events c SET site_event_id = ch.site_id, updated_at = now()
    FROM chosen ch WHERE c.id = ch.crm_id
  RETURNING c.id, c.site_event_id
)
UPDATE site.events s SET crm_event_id = l.id, updated_at = now()
  FROM linked_crm l WHERE s.id = l.site_event_id;

-- 3. Conflict overrides ------------------------------------------------------

CREATE TABLE IF NOT EXISTS events.conflict_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_event_id  uuid REFERENCES crm.events(id) ON DELETE CASCADE,
  site_event_id uuid REFERENCES site.events(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  reason        text NOT NULL,
  clashes       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_conflict_overrides_one_event
    CHECK ((crm_event_id IS NULL) <> (site_event_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_events_overrides_crm ON events.conflict_overrides (crm_event_id);
CREATE INDEX IF NOT EXISTS idx_events_overrides_site ON events.conflict_overrides (site_event_id);

-- 4. Checklist ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS events.tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_event_id     uuid REFERENCES crm.events(id) ON DELETE CASCADE,
  site_event_id    uuid REFERENCES site.events(id) ON DELETE CASCADE,
  kind             text NOT NULL DEFAULT 'other'
                   CHECK (kind IN ('venue', 'sponsor', 'promo', 'equipment', 'other')),
  title            text NOT NULL,
  assignee_user_id uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  due_at           timestamptz,
  done_at          timestamptz,
  created_by       uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_tasks_one_event CHECK ((crm_event_id IS NULL) <> (site_event_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_events_tasks_crm ON events.tasks (crm_event_id);
CREATE INDEX IF NOT EXISTS idx_events_tasks_site ON events.tasks (site_event_id);
CREATE INDEX IF NOT EXISTS idx_events_tasks_assignee ON events.tasks (assignee_user_id) WHERE done_at IS NULL;

-- 5. ICS feeds ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS events.calendar_feeds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  branch_id  uuid REFERENCES configuration.branches(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES configuration.users(id) ON DELETE CASCADE,
  label      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_events_feeds_user ON events.calendar_feeds (user_id);

-- 6. Menu ---------------------------------------------------------------------

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('events', 'Event', NULL, 'calendar', 'group', 85, '{"actions":["read"]}'::jsonb),
  ('events.calendar', 'Kalender Event', '/dashboard/events/calendar', 'calendar', 'sidebar', 10, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'events', level = 1, parent_id = NULL WHERE code = 'events';
UPDATE iam.menus child SET module = 'events', level = 2, parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'events.calendar' AND parent.code = 'events';

-- Roles that already manage CRM or site events see the calendar, as does
-- the gym manager.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read"]'::jsonb
  FROM iam.roles r
  CROSS JOIN iam.menus m
 WHERE m.code IN ('events', 'events.calendar')
   AND r.deleted_at IS NULL
   AND (r.code IN ('super_admin', 'admin', 'marketing', 'gym_manager')
        OR EXISTS (SELECT 1 FROM iam.role_menu_permissions x
                     JOIN iam.menus mm ON mm.id = x.menu_id
                    WHERE x.role_id = r.id AND x.is_active
                      AND mm.code IN ('crm.engagement.events', 'site.events')))
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
