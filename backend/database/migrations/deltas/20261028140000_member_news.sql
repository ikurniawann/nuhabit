-- Member news feed on site.articles, and the Gym → News Member menu.
--
--   1. site.articles gains what the member app needs:
--        audience         site (public site only, every row so far), members
--                         (member app only) or both
--        member_category  news, event, tips or promo: the member app filter;
--                         required when the member app shows the article
--        pinned           pinned articles lead the member feed
--        branch_ids       the branches whose members see it; empty = all
--      The public site keeps reading audience site and both, so its pages
--      do not change.
--   2. Menu gym.news (read, create, update, delete) for super_admin, admin
--      and marketing.
-- Idempotent.

ALTER TABLE site.articles
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'site',
  ADD COLUMN IF NOT EXISTS member_category text,
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS branch_ids uuid[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'articles_audience_check') THEN
    ALTER TABLE site.articles ADD CONSTRAINT articles_audience_check CHECK (audience IN ('site', 'members', 'both'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'articles_member_category_check') THEN
    ALTER TABLE site.articles ADD CONSTRAINT articles_member_category_check CHECK (
      (audience = 'site' OR member_category IS NOT NULL)
      AND (member_category IS NULL OR member_category IN ('news', 'event', 'tips', 'promo')));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS articles_member_feed_idx
  ON site.articles (pinned DESC, published_at DESC) WHERE status = 'published' AND audience <> 'site';

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym.news', 'News Member', '/dashboard/gym/news', 'megaphone', 'sidebar', 92,
        '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code = 'gym.news';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'gym.news' AND parent.code = 'gym';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'marketing')
   AND m.code = 'gym.news'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
