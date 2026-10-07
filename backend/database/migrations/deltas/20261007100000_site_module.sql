-- Public site: branch public profiles, the site schema (content, articles,
-- events) and the "Situs" IAM menus. Idempotent.

-- 1. Branch public profile -----------------------------------------------------

ALTER TABLE configuration.branches
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS postcode text,
  ADD COLUMN IF NOT EXISTS lat numeric(9, 6),
  ADD COLUMN IF NOT EXISTS lng numeric(9, 6),
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS directions text,
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accordions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS testimonials jsonb NOT NULL DEFAULT '[]'::jsonb;

-- slugify: lower-case ASCII letters and digits, hyphens between words.
CREATE OR REPLACE FUNCTION configuration.slugify(input text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both '-' FROM regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'))
$$;

-- A branch without a slug gets one from its name; a taken slug gets a
-- numeric suffix.
CREATE OR REPLACE FUNCTION configuration.branches_default_slug() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  base text;
  candidate text;
  n integer := 1;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;
  END IF;
  base := configuration.slugify(NEW.name);
  IF base = '' THEN
    base := 'cabang';
  END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM configuration.branches WHERE slug = candidate AND id <> NEW.id) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branches_default_slug ON configuration.branches;
CREATE TRIGGER trg_branches_default_slug
  BEFORE INSERT ON configuration.branches
  FOR EACH ROW EXECUTE FUNCTION configuration.branches_default_slug();

-- Backfill existing rows one at a time so the collision loop sees earlier
-- rows.
DO $$
DECLARE
  r record;
  base text;
  candidate text;
  n integer;
BEGIN
  FOR r IN SELECT id, name FROM configuration.branches WHERE slug IS NULL OR slug = '' ORDER BY created_at, id LOOP
    base := configuration.slugify(r.name);
    IF base = '' THEN
      base := 'cabang';
    END IF;
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM configuration.branches WHERE slug = candidate AND id <> r.id) LOOP
      n := n + 1;
      candidate := base || '-' || n;
    END LOOP;
    UPDATE configuration.branches SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS branches_slug_unique ON configuration.branches (slug);

-- 2. Site schema ----------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS site;

CREATE TABLE IF NOT EXISTS site.content (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS site.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'news'
    CHECK (category IN ('training', 'events', 'apparel', 'news')),
  excerpt text,
  cover_image_url text,
  body_md text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS articles_published_idx
  ON site.articles (published_at DESC) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS site.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location_text text,
  cover_image_url text,
  body_md text NOT NULL DEFAULT '',
  form_slug text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_published_idx
  ON site.events (starts_at) WHERE status = 'published';

-- 3. Menu IAM -------------------------------------------------------------------

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('site', 'Situs', NULL, 'document-text', 'group', 4, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('site.content', 'Konten', '/dashboard/site/content', 'document-text', 'sidebar', 10, '{"actions":["read","update"]}'::jsonb),
  ('site.articles', 'Artikel', '/dashboard/site/articles', 'file-text', 'sidebar', 20, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('site.events', 'Event', '/dashboard/site/events', 'calendar', 'sidebar', 30, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'site', level = 1 WHERE code = 'site';
UPDATE iam.menus SET module = 'site', level = 2 WHERE code IN ('site.content', 'site.articles', 'site.events');
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('site.content', 'site.articles', 'site.events') AND parent.code = 'site';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'marketing')
  AND m.code IN ('site', 'site.content', 'site.articles', 'site.events')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
