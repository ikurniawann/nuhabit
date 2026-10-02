-- =============================================================================
-- EPIC-055 — Studio: Personal Training (PT)
--
-- PT = sesi privat 1 coach 1 member. Dibooking per slot dari KETERSEDIAAN coach
-- (jam mingguan − jadwal kelas/PT yang sudah ada − cuti). Saat dibooking, sesi
-- PT dibuat di studio.class_sessions (program kind 'pt', kuota 1, tanpa
-- template) + booking yang mengunci 1 KREDIT PT — sehingga kalender, check-in,
-- beban coach, revenue (STUDIO_PASS_REDEEM_PT) & komisi memakai jalur yang sama
-- dengan kelas.
--
-- Paket "PT saja" (kategori 'pt') ditambahkan supaya PT bisa dijual per sesi /
-- paket PT tanpa kredit kelas, di samping paket Class + PT.
-- =============================================================================

-- ── Kategori paket "PT saja" ────────────────────────────────────────────────
ALTER TABLE studio.pass_products DROP CONSTRAINT IF EXISTS pass_products_category_check;
ALTER TABLE studio.pass_products ADD CONSTRAINT pass_products_category_check
  CHECK (category IN ('class', 'class_pt', 'class_pt_facility', 'pt'));

-- ── Program PT yang bisa dilatih tiap coach ─────────────────────────────────
CREATE TABLE IF NOT EXISTS studio.coach_programs (
  coach_id uuid NOT NULL REFERENCES studio.coaches(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES studio.programs(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coach_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_studio_coach_programs_program ON studio.coach_programs(program_id);

-- ── Jam ketersediaan PT mingguan ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS studio.coach_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  coach_id uuid NOT NULL REFERENCES studio.coaches(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_coach_availability_window CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_studio_coach_availability ON studio.coach_availability(coach_id, weekday, start_time);

-- ── Cuti / tidak tersedia per tanggal ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS studio.coach_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  coach_id uuid NOT NULL REFERENCES studio.coaches(id) ON DELETE CASCADE,
  date_from date NOT NULL,
  date_to date NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_coach_time_off_window CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS idx_studio_coach_time_off ON studio.coach_time_off(coach_id, date_from, date_to);

-- Sesi PT dibuat on-demand: tandai sumbernya untuk laporan & UI.
ALTER TABLE studio.class_sessions ADD COLUMN IF NOT EXISTS origin varchar(20) NOT NULL DEFAULT 'schedule';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'studio_class_sessions_origin_check') THEN
    ALTER TABLE studio.class_sessions ADD CONSTRAINT studio_class_sessions_origin_check
      CHECK (origin IN ('schedule', 'pt_booking'));
  END IF;
END $$;

-- ── Menu ────────────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('studio.pt', 'Personal Training', '/dashboard/studio/pt', 'user-plus', 'sidebar', 6,
   '{"actions":["read","create","update","delete"]}'::jsonb),
  ('studio.availability', 'Ketersediaan Coach', '/dashboard/studio/availability', 'clipboard', 'sidebar', 45,
   '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code IN ('studio.pt', 'studio.availability');
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code IN ('studio.pt', 'studio.availability') AND parent.code = 'studio';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi') AND m.code IN ('studio.pt', 'studio.availability')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
