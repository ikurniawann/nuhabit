-- Pengumuman Perusahaan (CMS HRD/super_admin → tampil di ESS karyawan).
--   1. hris.announcements — konten (teks kaya tersanitasi, cover, video
--      embed YouTube/Vimeo), status draft/published, jadwal & kedaluwarsa,
--      pin, tag multiple (text[]), target global/departemen.
--   2. hris.announcement_departments — target ke beberapa departemen.
--   3. hris.announcement_reads — pelacak baca per karyawan (badge belum dibaca).
--   4. Menu "Pengumuman Perusahaan" (ESS, di atas Area Karyawan) + CMS
--      "Pengumuman" (HRIS → Kepegawaian).

CREATE TABLE IF NOT EXISTS hris.announcements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  body_html      text NOT NULL DEFAULT '',
  cover_image_url text,
  video_provider text CHECK (video_provider IN ('youtube', 'vimeo')),
  video_id       text,
  tags           text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  is_pinned      boolean NOT NULL DEFAULT false,
  target_scope   text NOT NULL DEFAULT 'global' CHECK (target_scope IN ('global', 'department')),
  publish_at     timestamptz,
  expires_at     timestamptz,
  created_by     uuid REFERENCES hris.employees(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_expiry_after_publish
    CHECK (expires_at IS NULL OR publish_at IS NULL OR expires_at > publish_at)
);

CREATE INDEX IF NOT EXISTS announcements_feed_idx
  ON hris.announcements (status, is_pinned DESC, publish_at DESC);
CREATE INDEX IF NOT EXISTS announcements_tags_idx
  ON hris.announcements USING gin (tags);

DROP TRIGGER IF EXISTS update_announcements_updated_at ON hris.announcements;
CREATE TRIGGER update_announcements_updated_at
  BEFORE UPDATE ON hris.announcements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS hris.announcement_departments (
  announcement_id uuid NOT NULL REFERENCES hris.announcements(id) ON DELETE CASCADE,
  department_id   uuid NOT NULL REFERENCES hris.departments(id) ON DELETE CASCADE,
  PRIMARY KEY (announcement_id, department_id)
);

CREATE TABLE IF NOT EXISTS hris.announcement_reads (
  announcement_id uuid NOT NULL REFERENCES hris.announcements(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, employee_id)
);

-- ── Menu ESS: Pengumuman Perusahaan (item mandiri, di atas Area Karyawan) ──
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, module, level, permission_context)
VALUES ('ess.announcements', 'Pengumuman Perusahaan', '/dashboard/me/pengumuman',
        'megaphone', 'sidebar', 3, 'ess', 1, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, module = EXCLUDED.module,
  level = EXCLUDED.level, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

-- Item mandiri top-level (tanpa parent) → tampil utk SEMUA role (semua
-- karyawan; API menggate berdasarkan keterhubungan ke record karyawan).
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.deleted_at IS NULL AND m.code = 'ess.announcements'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- ── Menu CMS: HRIS → Kepegawaian → Pengumuman ──
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.kepegawaian.announcements', 'Pengumuman', '/dashboard/hris/pengumuman',
        'megaphone', 'sidebar', 60, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'hris', level = 3 WHERE code = 'hris.kepegawaian.announcements';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.kepegawaian.announcements' AND parent.code = 'hris.kepegawaian';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'hris.kepegawaian.announcements'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'hrd' AND m.code = 'hris.kepegawaian.announcements'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
