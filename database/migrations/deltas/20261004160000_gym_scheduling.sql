-- Gym scheduling: coach, jenis kelas, sesi terjadwal, booking, dan log gate.
-- Port dari NüHabit (0003_catalog, 0005_scheduling, 0006_access).
-- Kredit TIDAK dipotong saat booking; pemotongan terjadi saat check-in
-- (gym.credit_ledger milik migrasi kredit). Idempotent.

CREATE SCHEMA IF NOT EXISTS gym;

-- 1. Coach ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.coaches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  bio            text NOT NULL DEFAULT '',
  specialization text NOT NULL DEFAULT '',
  photo_url      text,
  user_id        uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  branch_id      uuid REFERENCES configuration.branches(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_coaches_branch ON gym.coaches (branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_coaches_name ON gym.coaches (lower(name));

-- 2. Jenis kelas (template) -------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.class_types (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  description          text NOT NULL DEFAULT '',
  default_duration_min int  NOT NULL CHECK (default_duration_min > 0),
  default_credit_cost  int  NOT NULL CHECK (default_credit_cost > 0),
  default_capacity     int  NOT NULL CHECK (default_capacity > 0),
  color                text NOT NULL DEFAULT 'lime',
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_class_types_name ON gym.class_types (lower(name));

-- 3. Sesi kelas -------------------------------------------------------------
-- Kapasitas dan biaya kredit disalin dari jenis kelas saat dibuat: mengubah
-- template tidak boleh mengubah apa yang sudah disetujui member yang booking.
CREATE TABLE IF NOT EXISTS gym.class_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_type_id     uuid NOT NULL REFERENCES gym.class_types(id),
  coach_id          uuid REFERENCES gym.coaches(id) ON DELETE SET NULL,
  branch_id         uuid REFERENCES configuration.branches(id) ON DELETE SET NULL,
  area              text,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  capacity          int NOT NULL CHECK (capacity > 0),
  credit_cost       int NOT NULL CHECK (credit_cost > 0),
  booking_opens_at  timestamptz NOT NULL,
  booking_closes_at timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'full', 'completed', 'cancelled')),
  notes             text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_sessions_time_ordered CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_gym_sessions_time ON gym.class_sessions (starts_at);
CREATE INDEX IF NOT EXISTS idx_gym_sessions_branch_time ON gym.class_sessions (branch_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_gym_sessions_coach_time ON gym.class_sessions (coach_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_gym_sessions_type ON gym.class_sessions (class_type_id);
CREATE INDEX IF NOT EXISTS idx_gym_sessions_status_time ON gym.class_sessions (status, starts_at);

-- 4. Booking ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.bookings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           uuid NOT NULL REFERENCES gym.class_sessions(id) ON DELETE CASCADE,
  customer_id          uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  status               text NOT NULL
                       CHECK (status IN ('confirmed', 'waitlist', 'cancelled', 'checked_in', 'completed', 'no_show')),
  waitlist_position    int CHECK (waitlist_position > 0),
  source               text NOT NULL DEFAULT 'member' CHECK (source IN ('member', 'admin')),
  late_cancel          boolean NOT NULL DEFAULT false,
  promotion_offered_at timestamptz,
  checked_in_at        timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_bookings_position_only_on_waitlist
    CHECK (waitlist_position IS NULL OR status = 'waitlist')
);
-- ALREADY_BOOKED dijaga database: dua request bersamaan tidak bisa sama-sama
-- membuat booking aktif untuk member dan sesi yang sama.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_bookings_one_active
  ON gym.bookings (session_id, customer_id)
  WHERE status IN ('confirmed', 'waitlist', 'checked_in');
CREATE INDEX IF NOT EXISTS idx_gym_bookings_session ON gym.bookings (session_id, status);
CREATE INDEX IF NOT EXISTS idx_gym_bookings_customer ON gym.bookings (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_bookings_waitlist
  ON gym.bookings (session_id, waitlist_position, created_at) WHERE status = 'waitlist';
CREATE INDEX IF NOT EXISTS idx_gym_bookings_checkin
  ON gym.bookings (customer_id, status) WHERE status IN ('confirmed', 'checked_in');

-- 5. Log gate: setiap scan, termasuk yang ditolak ------------------------------
CREATE TABLE IF NOT EXISTS gym.access_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid REFERENCES pos.pos_customers(id) ON DELETE SET NULL,
  booking_id   uuid REFERENCES gym.bookings(id) ON DELETE SET NULL,
  branch_id    uuid,
  decision     text NOT NULL CHECK (decision IN ('allowed', 'denied')),
  reason       text CHECK (reason IN ('token_invalid', 'token_expired', 'token_consumed', 'member_not_active',
                                      'anti_passback', 'no_booking', 'insufficient_credits')),
  entry_kind   text CHECK (entry_kind IN ('booking', 're_entry')),
  credit_delta int NOT NULL DEFAULT 0,
  source       text NOT NULL DEFAULT 'gate' CHECK (source IN ('gate', 'pos', 'manual')),
  scanned_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_access_logs_created ON gym.access_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_access_logs_member
  ON gym.access_logs (customer_id, created_at DESC) WHERE decision = 'allowed';

-- 6. Seed: jenis kelas, coach, jadwal dua minggu mulai 2026-10-03 ----------------
INSERT INTO gym.class_types (name, description, default_duration_min, default_credit_cost, default_capacity, color)
SELECT v.name, v.description, v.duration, v.cost, v.capacity, v.color
FROM (VALUES
  ('HYROX Fundamentals', 'Kenali delapan station HYROX dan cara mengatur pace di tiap station.', 60, 1, 16, 'lime'),
  ('Engine Builder', 'Conditioning berat lari untuk membangun race pace.', 60, 1, 20, 'info'),
  ('Strength Circuit', 'Sled push, sled pull, carry, dan lunge untuk kekuatan race.', 75, 1, 14, 'warning'),
  ('Race Simulation', 'Simulasi penuh delapan station melawan waktu.', 90, 2, 12, 'danger'),
  ('Mobility & Recovery', 'Pemulihan pasca-latihan, range of motion, dan pencegahan cedera.', 45, 1, 18, 'success')
) AS v(name, description, duration, cost, capacity, color)
WHERE NOT EXISTS (SELECT 1 FROM gym.class_types t WHERE lower(t.name) = lower(v.name));

INSERT INTO gym.coaches (name, bio, specialization)
SELECT v.name, v.bio, v.specialization
FROM (VALUES
  ('Kevin Hartono', 'Spesialis engine dan race simulation. Menyusun sesi interval untuk pace HYROX.', 'Engine & simulation'),
  ('Maya Kusuma', 'Coach kekuatan dengan latar belakang kompetisi functional fitness.', 'Strength & conditioning'),
  ('Rizky Ramadhan', 'Pacing race day dan teknik station, dari wall ball sampai sandbag lunge.', 'HYROX race coach'),
  ('Tara Widjaja', 'Mobilitas, pemulihan, dan pencegahan cedera untuk atlet HYROX.', 'Mobility & recovery')
) AS v(name, bio, specialization)
WHERE NOT EXISTS (SELECT 1 FROM gym.coaches c WHERE lower(c.name) = lower(v.name));

-- Slot harian (WIB). dow: 1 = Senin … 7 = Minggu. Jendela booking: buka 7 hari
-- sebelum mulai, tutup saat kelas mulai (default aturan bisnis).
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
days AS (
  SELECT d::date AS day FROM generate_series(date '2026-10-03', date '2026-10-16', interval '1 day') d
),
planned AS (
  SELECT t.id AS class_type_id, c.id AS coach_id, s.area,
         ((d.day + s.hhmm::time) AT TIME ZONE 'Asia/Jakarta') AS starts_at,
         t.default_duration_min, t.default_capacity, t.default_credit_cost
    FROM days d
    JOIN slots s ON extract(isodow FROM d.day)::int = ANY (s.dows)
    JOIN gym.class_types t ON t.name = s.class_name
    JOIN gym.coaches c ON c.name = s.coach_name
)
INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, area, starts_at, ends_at, capacity, credit_cost,
                                booking_opens_at, booking_closes_at, status)
SELECT p.class_type_id, p.coach_id,
       (SELECT b.id FROM configuration.branches b WHERE b.is_active ORDER BY b.created_at LIMIT 1),
       p.area, p.starts_at, p.starts_at + make_interval(mins => p.default_duration_min),
       p.default_capacity, p.default_credit_cost,
       p.starts_at - interval '7 days', p.starts_at, 'published'
  FROM planned p
 WHERE NOT EXISTS (
   SELECT 1 FROM gym.class_sessions x WHERE x.class_type_id = p.class_type_id AND x.starts_at = p.starts_at
 );

-- Paket Race Prep Block (seed migrasi kredit) hanya berlaku untuk Race Simulation.
DO $$
BEGIN
  IF to_regclass('gym.credit_packages') IS NOT NULL THEN
    UPDATE gym.credit_packages p
       SET applicable_class_type_ids = ARRAY[t.id]
      FROM gym.class_types t
     WHERE p.name = 'Race Prep Block' AND p.applicable_class_type_ids IS NULL AND t.name = 'Race Simulation';
  END IF;
END $$;

-- 7. Menu dashboard: Gym & Kelas ------------------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym', 'Gym & Kelas', NULL, 'calendar', 'group', 3, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('gym.schedule', 'Jadwal Kelas', '/dashboard/gym/schedule', 'calendar', 'sidebar', 10, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('gym.sessions', 'Sesi & Absensi', '/dashboard/gym/sessions', 'clock', 'sidebar', 20, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('gym.bookings', 'Booking', '/dashboard/gym/bookings', 'ticket', 'sidebar', 30, '{"actions":["read","create","update"]}'::jsonb),
  ('gym.checkin', 'Check-in', '/dashboard/gym/checkin', 'clipboard-document-check', 'sidebar', 40, '{"actions":["read","create"]}'::jsonb),
  ('gym.class-types', 'Jenis Kelas', '/dashboard/gym/class-types', 'clipboard', 'sidebar', 50, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('gym.coaches', 'Coach', '/dashboard/gym/coaches', 'identification', 'sidebar', 60, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 1 WHERE code = 'gym' AND (module IS DISTINCT FROM 'gym');
UPDATE iam.menus SET module = 'gym', level = 2
 WHERE code IN ('gym.schedule', 'gym.sessions', 'gym.bookings', 'gym.checkin', 'gym.class-types', 'gym.coaches');
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code IN ('gym.schedule', 'gym.sessions', 'gym.bookings', 'gym.checkin', 'gym.class-types', 'gym.coaches')
   AND parent.code = 'gym';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'marketing')
   AND (m.code = 'gym' OR m.code IN ('gym.schedule', 'gym.sessions', 'gym.bookings', 'gym.checkin',
                                     'gym.class-types', 'gym.coaches'))
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
