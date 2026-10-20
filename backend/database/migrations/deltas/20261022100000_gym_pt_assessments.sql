-- Personal training (PT) dan asesmen kebugaran.
--
--   1. gym.class_types.is_personal: jenis sesi PT. Kredit dari paket tanpa
--      daftar jenis kelas tidak bisa membayar jenis PT; paket PT dibatasi ke
--      jenis PT, jadi kredit PT juga tidak bisa dipakai kelas grup.
--   2. Ketersediaan coach: jendela mingguan (WIB) dan pengecualian per tanggal
--      (libur sebagian/seharian, atau jam tambahan).
--   3. gym.pt_appointments (satu slot coach, kapasitas 1-4) dan
--      gym.pt_participants (member di slot itu, status per member).
--   4. gym.fitness_assessments: metrik tubuh dan benchmark HYROX per member.
--   5. Seed jenis sesi PT dan paket PT.
--   6. Menu gym.pt (Personal Training) dan gym.assessments (Asesmen
--      Kebugaran) dengan aksi, di-grant ke role gym.
--
-- Idempotent: aman dijalankan ulang.

-- 1. Jenis sesi PT -------------------------------------------------------------
ALTER TABLE gym.class_types ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false;

-- 2. Ketersediaan coach --------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.coach_availability (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid NOT NULL REFERENCES gym.coaches (id) ON DELETE CASCADE,
  -- 1 = Senin … 7 = Minggu (ISO), jam WIB.
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_coach_availability_ordered CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_gym_coach_availability_coach ON gym.coach_availability (coach_id, weekday);

CREATE TABLE IF NOT EXISTS gym.coach_availability_exceptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid NOT NULL REFERENCES gym.coaches (id) ON DELETE CASCADE,
  date        date NOT NULL,
  -- off: coach tidak tersedia (tanpa jam = seharian); extra: jam tambahan.
  kind        text NOT NULL CHECK (kind IN ('off', 'extra')),
  start_time  time,
  end_time    time,
  note        text NOT NULL DEFAULT '',
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_coach_exception_times CHECK (
    (start_time IS NULL AND end_time IS NULL AND kind = 'off')
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);
CREATE INDEX IF NOT EXISTS idx_gym_coach_exceptions_coach_date ON gym.coach_availability_exceptions (coach_id, date);

-- 3. Janji PT -------------------------------------------------------------------
-- Kapasitas dan biaya kredit disalin dari jenis sesi saat dibuat.
CREATE TABLE IF NOT EXISTS gym.pt_appointments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id       uuid NOT NULL REFERENCES gym.coaches (id),
  class_type_id  uuid NOT NULL REFERENCES gym.class_types (id),
  branch_id      uuid REFERENCES configuration.branches (id) ON DELETE SET NULL,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  capacity       int NOT NULL CHECK (capacity BETWEEN 1 AND 4),
  credit_cost    int NOT NULL CHECK (credit_cost > 0),
  status         text NOT NULL DEFAULT 'requested'
                 CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled')),
  source         text NOT NULL DEFAULT 'member' CHECK (source IN ('member', 'staff')),
  notes          text NOT NULL DEFAULT '',
  cancel_reason  text,
  created_by     uuid,
  confirmed_at   timestamptz,
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_pt_appointments_time_ordered CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_gym_pt_appointments_coach_time ON gym.pt_appointments (coach_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_gym_pt_appointments_status_time ON gym.pt_appointments (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_gym_pt_appointments_class_type ON gym.pt_appointments (class_type_id);
CREATE INDEX IF NOT EXISTS idx_gym_pt_appointments_branch ON gym.pt_appointments (branch_id);

CREATE TABLE IF NOT EXISTS gym.pt_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL REFERENCES gym.pt_appointments (id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  status          text NOT NULL
                  CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled', 'no_show')),
  late_cancel     boolean NOT NULL DEFAULT false,
  -- Kredit yang sudah dipotong (selesai, batal terlambat, tidak hadir).
  credits_charged int NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_pt_participants_active
  ON gym.pt_participants (appointment_id, customer_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_gym_pt_participants_customer ON gym.pt_participants (customer_id, created_at DESC);

-- 4. Asesmen kebugaran ----------------------------------------------------------
-- Waktu benchmark dalam detik; NULL = tidak diukur.
CREATE TABLE IF NOT EXISTS gym.fitness_assessments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  coach_id             uuid REFERENCES gym.coaches (id) ON DELETE SET NULL,
  assessed_on          date NOT NULL,
  weight_kg            numeric(5,2) CHECK (weight_kg > 0),
  body_fat_pct         numeric(4,1) CHECK (body_fat_pct >= 0 AND body_fat_pct <= 100),
  muscle_mass_kg       numeric(5,2) CHECK (muscle_mass_kg > 0),
  resting_hr           int CHECK (resting_hr > 0),
  run_1km_sec          int CHECK (run_1km_sec > 0),
  ski_1km_sec          int CHECK (ski_1km_sec > 0),
  row_1km_sec          int CHECK (row_1km_sec > 0),
  wall_balls_max_reps  int CHECK (wall_balls_max_reps >= 0),
  sled_push_sec        int CHECK (sled_push_sec > 0),
  sled_pull_sec        int CHECK (sled_pull_sec > 0),
  burpee_broad_jump_sec int CHECK (burpee_broad_jump_sec > 0),
  notes                text NOT NULL DEFAULT '',
  goals                text NOT NULL DEFAULT '',
  created_by           uuid,
  created_by_name      text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_fitness_assessments_customer ON gym.fitness_assessments (customer_id, assessed_on DESC);
CREATE INDEX IF NOT EXISTS idx_gym_fitness_assessments_coach ON gym.fitness_assessments (coach_id);

-- 5. Seed jenis sesi dan paket PT -----------------------------------------------
INSERT INTO gym.class_types (name, description, default_duration_min, default_credit_cost, default_capacity, color, is_personal)
SELECT v.name, v.description, v.duration, v.cost, v.capacity, v.color, true
FROM (VALUES
  ('Personal Training', 'Sesi 1:1 bersama coach, program disusun untuk target race kamu.', 60, 1, 1, 'ink'),
  ('Small Group PT', 'Sesi PT dua sampai empat orang dengan satu coach.', 60, 1, 4, 'info')
) AS v(name, description, duration, cost, capacity, color)
WHERE NOT EXISTS (SELECT 1 FROM gym.class_types t WHERE lower(t.name) = lower(v.name));

UPDATE gym.class_types SET is_personal = true
 WHERE lower(name) IN ('personal training', 'small group pt') AND NOT is_personal;

INSERT INTO gym.credit_packages (name, description, credits, price_idr, validity_days, applicable_class_type_ids, sort_order)
SELECT v.name, v.description, v.credits, v.price_idr, v.validity_days,
       (SELECT array_agg(t.id ORDER BY t.name) FROM gym.class_types t WHERE t.is_personal), v.sort_order
FROM (VALUES
  ('PT 1 Sesi', 'Satu sesi personal training.', 1, 450000::numeric, 30, 60),
  ('PT 10 Sesi', 'Sepuluh sesi personal training, berlaku 120 hari.', 10, 4000000::numeric, 120, 61)
) AS v(name, description, credits, price_idr, validity_days, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM gym.credit_packages p WHERE p.name = v.name);

-- 6. Menu dan grant -------------------------------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym', 'Gym & Kelas', NULL, 'calendar', 'group', 3, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('gym.pt', 'Personal Training', '/dashboard/gym/pt', 'identification', 'sidebar', 40,
   '{"actions":["read","read_own","create","update","delete"]}'::jsonb),
  ('gym.assessments', 'Asesmen Kebugaran', '/dashboard/gym/assessments', 'clipboard-document-check', 'sidebar', 45,
   '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code IN ('gym.pt', 'gym.assessments');
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code IN ('gym.pt', 'gym.assessments')
   AND parent.code = 'gym';

-- Admin, marketing dan gym_manager: semua aksi menu.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'marketing', 'gym_manager')
   AND m.code IN ('gym.pt', 'gym.assessments')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- Coach: janji PT miliknya sendiri (lihat dan ubah), asesmen lihat dan catat.
-- Front desk: lihat semua janji PT dan booking langsung.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, g.actions
  FROM (VALUES
    ('gym_coach',      'gym.pt',          '["read_own","update"]'::jsonb),
    ('gym_coach',      'gym.assessments', '["read","create"]'::jsonb),
    ('gym_front_desk', 'gym.pt',          '["read","create"]'::jsonb)
  ) AS g(role_code, menu_code, actions)
  JOIN iam.roles r ON r.code = g.role_code
  JOIN iam.menus m ON m.code = g.menu_code AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
