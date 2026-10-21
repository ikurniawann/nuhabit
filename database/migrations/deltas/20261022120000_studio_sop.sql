-- EPIC-067 T-067-D1 — Dokumen SOP coach berversi + konfirmasi baca.
--   • studio.sop_documents: satu dokumen SOP (mis. "SOP Coach — Cuti, Ketidakhadiran & Keluhan").
--   • studio.sop_versions: setiap terbitan = versi baru (isi tidak diubah setelah terbit).
--     Versi terbaru dokumen aktif wajib dikonfirmasi ulang oleh setiap coach aktif.
--   • studio.sop_acknowledgements: "Saya sudah membaca dan setuju" per coach per versi.
--   • menu studio.sop "SOP Coach".

CREATE TABLE IF NOT EXISTS studio.sop_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  title varchar(150) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_sop_documents_branch ON studio.sop_documents (branch_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS studio.sop_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES studio.sop_documents(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  title varchar(150) NOT NULL,
  body text NOT NULL,
  change_note varchar(300),
  published_by uuid,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

CREATE TABLE IF NOT EXISTS studio.sop_acknowledgements (
  version_id uuid NOT NULL REFERENCES studio.sop_versions(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES studio.coaches(id) ON DELETE CASCADE,
  user_id uuid,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, coach_id)
);

-- ── Menu ─────────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('studio.sop', 'SOP Coach', '/dashboard/studio/sop', 'document-text',
        'sidebar', 46, '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code = 'studio.sop';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'studio.sop' AND parent.code = 'studio';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi', 'program_director') AND m.code = 'studio.sop'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
