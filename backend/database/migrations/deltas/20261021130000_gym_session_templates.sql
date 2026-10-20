-- Template jadwal mingguan, jejak sesi hasil generate, sesi yang dipindah,
-- dan satu sesi per jenis kelas + cabang + jam mulai. Idempotent.

-- 1. Template jadwal mingguan ----------------------------------------------------
-- weekday: 1 = Senin … 7 = Minggu. start_time dibaca sebagai jam WIB.
CREATE TABLE IF NOT EXISTS gym.session_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_type_id uuid NOT NULL REFERENCES gym.class_types(id),
  coach_id      uuid REFERENCES gym.coaches(id) ON DELETE SET NULL,
  branch_id     uuid REFERENCES configuration.branches(id) ON DELETE SET NULL,
  area          text,
  weekday       smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time    time NOT NULL,
  duration_min  int NOT NULL CHECK (duration_min BETWEEN 15 AND 240),
  capacity      int NOT NULL CHECK (capacity > 0),
  credit_cost   int NOT NULL CHECK (credit_cost > 0),
  valid_from    date NOT NULL,
  valid_until   date,
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_session_templates_valid_range CHECK (valid_until IS NULL OR valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_gym_session_templates_class_type ON gym.session_templates (class_type_id);
CREATE INDEX IF NOT EXISTS idx_gym_session_templates_coach ON gym.session_templates (coach_id);
CREATE INDEX IF NOT EXISTS idx_gym_session_templates_branch ON gym.session_templates (branch_id);

-- 2. Kolom baru di sesi -------------------------------------------------------------
-- template_id + occurrence_date: sesi ini dibuat dari template untuk tanggal itu.
-- moved_at + original_starts_at: studio memindah jam; member yang booking
-- sebelum pemindahan boleh batal tanpa penalti (lihat WaiveLateCancelForMove).
-- legacy_duplicate: duplikat lama yang sudah punya booking, dikecualikan dari
-- indeks unik di bawah supaya migrasi tidak gagal.
ALTER TABLE gym.class_sessions
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES gym.session_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS occurrence_date date,
  ADD COLUMN IF NOT EXISTS moved_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_duplicate boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_gym_sessions_template
  ON gym.class_sessions (template_id, occurrence_date) WHERE template_id IS NOT NULL;

-- 3. Jejak generate: satu baris per template per tanggal, tetap ada setelah
-- sesinya dihapus atau dibatalkan, jadi generate tidak membuatnya lagi.
CREATE TABLE IF NOT EXISTS gym.session_template_occurrences (
  template_id     uuid NOT NULL REFERENCES gym.session_templates(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  session_id      uuid REFERENCES gym.class_sessions(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, occurrence_date)
);
CREATE INDEX IF NOT EXISTS idx_gym_session_template_occurrences_session
  ON gym.session_template_occurrences (session_id) WHERE session_id IS NOT NULL;

-- 4. Satu sesi aktif per jenis kelas + cabang + jam mulai ---------------------------
-- Duplikat lama tanpa booking dihapus (yang dipertahankan: booking terbanyak,
-- lalu yang paling awal dibuat). Duplikat yang punya booking ditandai
-- legacy_duplicate dan tidak ikut indeks.
WITH ranked AS (
  SELECT s.id,
         row_number() OVER (
           PARTITION BY s.class_type_id, COALESCE(s.branch_id, '00000000-0000-0000-0000-000000000000'::uuid), s.starts_at
           ORDER BY (SELECT count(*) FROM gym.bookings b WHERE b.session_id = s.id) DESC, s.created_at, s.id) AS rn
    FROM gym.class_sessions s
   WHERE s.status <> 'cancelled' AND NOT s.legacy_duplicate
)
DELETE FROM gym.class_sessions s
 USING ranked r
 WHERE s.id = r.id AND r.rn > 1
   AND NOT EXISTS (SELECT 1 FROM gym.bookings b WHERE b.session_id = s.id);

WITH ranked AS (
  SELECT s.id,
         row_number() OVER (
           PARTITION BY s.class_type_id, COALESCE(s.branch_id, '00000000-0000-0000-0000-000000000000'::uuid), s.starts_at
           ORDER BY (SELECT count(*) FROM gym.bookings b WHERE b.session_id = s.id) DESC, s.created_at, s.id) AS rn
    FROM gym.class_sessions s
   WHERE s.status <> 'cancelled' AND NOT s.legacy_duplicate
)
UPDATE gym.class_sessions s SET legacy_duplicate = true
  FROM ranked r
 WHERE s.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_sessions_slot
  ON gym.class_sessions (class_type_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), starts_at)
  WHERE status <> 'cancelled' AND NOT legacy_duplicate;

-- 5. Seed: template untuk jadwal demo ------------------------------------------------
-- Slot yang sama dengan seed 20261004160000_gym_scheduling, hanya untuk cabang
-- yang benar-benar mendapat sesi demo (2026-10-03 s.d. 2026-10-16). Berlaku
-- mulai 2026-10-17 supaya generate melanjutkan jadwal demo.
WITH slots(dows, hhmm, class_name, coach_name, area) AS (
  VALUES
    (ARRAY[1,2,3,4,5,6], '06:30', 'Engine Builder', 'Kevin Hartono', 'Main Floor'),
    (ARRAY[1,2,3,4,5], '07:30', 'HYROX Fundamentals', 'Rizky Ramadhan', 'Main Floor'),
    (ARRAY[1,3,5], '17:30', 'Strength Circuit', 'Maya Kusuma', 'Sled Lane'),
    (ARRAY[2,4], '17:30', 'Mobility & Recovery', 'Tara Widjaja', 'Studio B'),
    (ARRAY[1,2,3,4,5], '18:30', 'HYROX Fundamentals', 'Rizky Ramadhan', 'Main Floor'),
    (ARRAY[2,4], '19:30', 'Race Simulation', 'Kevin Hartono', 'Main Floor'),
    (ARRAY[1,3,5], '19:45', 'Mobility & Recovery', 'Tara Widjaja', 'Studio B'),
    (ARRAY[6], '08:00', 'Race Simulation', 'Kevin Hartono', 'Main Floor'),
    (ARRAY[6,7], '09:30', 'Strength Circuit', 'Maya Kusuma', 'Sled Lane'),
    (ARRAY[7], '08:00', 'Engine Builder', 'Rizky Ramadhan', 'Main Floor'),
    (ARRAY[7], '10:30', 'Mobility & Recovery', 'Tara Widjaja', 'Studio B')
),
planned AS (
  SELECT DISTINCT t.id AS class_type_id, c.id AS coach_id, demo.branch_id, sl.area, dow AS weekday,
         sl.hhmm::time AS start_time, t.default_duration_min, t.default_capacity, t.default_credit_cost
    FROM slots sl
   CROSS JOIN LATERAL unnest(sl.dows) AS dow
    JOIN gym.class_types t ON t.name = sl.class_name
    JOIN gym.coaches c ON c.name = sl.coach_name
    JOIN gym.class_sessions demo
      ON demo.class_type_id = t.id AND demo.coach_id = c.id AND demo.area = sl.area
     AND demo.branch_id IS NOT NULL AND demo.created_by IS NULL
     AND demo.starts_at >= timestamptz '2026-10-03 00:00:00+07' AND demo.starts_at < timestamptz '2026-10-17 00:00:00+07'
     AND extract(isodow FROM demo.starts_at AT TIME ZONE 'Asia/Jakarta')::int = dow
     AND (demo.starts_at AT TIME ZONE 'Asia/Jakarta')::time = sl.hhmm::time
)
INSERT INTO gym.session_templates (class_type_id, coach_id, branch_id, area, weekday, start_time, duration_min,
                                   capacity, credit_cost, valid_from)
SELECT p.class_type_id, p.coach_id, p.branch_id, p.area, p.weekday, p.start_time, p.default_duration_min,
       p.default_capacity, p.default_credit_cost, date '2026-10-17'
  FROM planned p
 WHERE NOT EXISTS (
   SELECT 1 FROM gym.session_templates x
    WHERE x.class_type_id = p.class_type_id AND x.branch_id = p.branch_id
      AND x.weekday = p.weekday AND x.start_time = p.start_time
 );

-- 6. Menu dashboard: Template Jadwal -------------------------------------------------
-- Kode di bawah gym.schedule supaya prefix IAM gymScheduling ikut mencakupnya.
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym.schedule.templates', 'Template Jadwal', '/dashboard/gym/schedule-templates', 'file-text', 'sidebar', 15,
        '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code = 'gym.schedule.templates';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'gym.schedule.templates' AND parent.code = 'gym';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'marketing')
   AND m.code = 'gym.schedule.templates'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
