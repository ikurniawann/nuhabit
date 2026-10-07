-- Gym training + insentif coach: pustaka latihan HYROX, substitusi, workout
-- hasil generator, sesi workout, kalender race, race member, skema insentif,
-- tarif per jenis kelas, dan payout coach bulanan.
-- Port dari NüHabit (0003_catalog, 0008_incentives, 0009_training, 0022_coach_rates).
-- Bergantung pada gym.coaches / gym.class_types (20261004160000). Idempotent.

CREATE SCHEMA IF NOT EXISTS gym;

-- 1. Pustaka latihan ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.exercises (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kode stabil untuk seed dan referensi lintas lingkungan (mis. 'ski_erg').
  code                text NOT NULL,
  name                text NOT NULL,
  description         text NOT NULL DEFAULT '',
  category            text NOT NULL
                      CHECK (category IN ('ERG', 'SLED', 'JUMP', 'CARRY', 'LUNGE', 'THROW', 'RUN', 'CONDITIONING')),
  -- Kode alat yang dibutuhkan. Kosong = tanpa alat.
  equipment           text[] NOT NULL DEFAULT '{}',
  -- 1..8 bila latihan ini stasiun race HYROX.
  hyrox_station_order int CHECK (hyrox_station_order BETWEEN 1 AND 8),
  difficulty          int NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 3),
  default_spec        jsonb NOT NULL DEFAULT '{"distanceM":null,"reps":null}'::jsonb,
  video_url           text,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_exercises_code ON gym.exercises (code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_exercises_station ON gym.exercises (hyrox_station_order)
  WHERE hyrox_station_order IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_exercises_category ON gym.exercises (category);

-- Pengganti saat alat tidak tersedia. volume_factor mengonversi jarak/repetisi.
CREATE TABLE IF NOT EXISTS gym.substitution_rules (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_exercise_id    uuid NOT NULL REFERENCES gym.exercises(id) ON DELETE CASCADE,
  alternative_exercise_id uuid NOT NULL REFERENCES gym.exercises(id) ON DELETE CASCADE,
  similarity              numeric(3,2) NOT NULL CHECK (similarity BETWEEN 0 AND 1),
  volume_factor           numeric(5,2) NOT NULL DEFAULT 1 CHECK (volume_factor > 0),
  conversion_note         text NOT NULL DEFAULT '',
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_substitution_not_self CHECK (original_exercise_id <> alternative_exercise_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_substitution_pair
  ON gym.substitution_rules (original_exercise_id, alternative_exercise_id);

-- 2. Workout hasil generator ----------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.workouts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  type                  text NOT NULL CHECK (type IN ('FULL_SIMULATION', 'COVERAGE', 'QUICK', 'PRACTICE')),
  division              text NOT NULL CHECK (division IN ('MEN_OPEN', 'MEN_PRO', 'WOMEN_OPEN', 'WOMEN_PRO')),
  blocks                jsonb NOT NULL,
  excluded_exercise_ids uuid[] NOT NULL DEFAULT '{}',
  available_equipment   text[],
  total_target_sec      int NOT NULL DEFAULT 0 CHECK (total_target_sec >= 0),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_workouts_customer ON gym.workouts (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gym.workout_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id      uuid NOT NULL REFERENCES gym.workouts(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'ready'
                  CHECK (status IN ('ready', 'started', 'paused', 'completed', 'partial')),
  current_block   int NOT NULL DEFAULT 1,
  started_at      timestamptz,
  ended_at        timestamptz,
  paused_at       timestamptz,
  block_results   jsonb NOT NULL DEFAULT '[]'::jsonb,
  pause_count     int NOT NULL DEFAULT 0 CHECK (pause_count >= 0),
  total_pause_sec int NOT NULL DEFAULT 0 CHECK (total_pause_sec >= 0),
  -- Jumlah durasi blok, diisi saat selesai (dasar prediksi race).
  active_sec      int NOT NULL DEFAULT 0 CHECK (active_sec >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_workout_sessions_customer ON gym.workout_sessions (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_workout_sessions_workout ON gym.workout_sessions (workout_id);

-- 3. Kalender race + race member ------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.race_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  country          text NOT NULL,
  region           text NOT NULL DEFAULT 'ASIA' CHECK (region IN ('ASIA', 'EUROPE', 'AMERICAS', 'OCEANIA')),
  city             text NOT NULL,
  venue            text NOT NULL DEFAULT '',
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  registration_url text NOT NULL DEFAULT '',
  image_url        text,
  status           text NOT NULL DEFAULT 'announced'
                   CHECK (status IN ('announced', 'registration_open', 'sold_out', 'upcoming',
                                     'ongoing', 'completed', 'cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_race_events_time_ordered CHECK (ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS idx_gym_race_events_time ON gym.race_events (starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_race_events_name_start ON gym.race_events (lower(name), starts_at);

CREATE TABLE IF NOT EXISTS gym.member_races (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  race_event_id uuid NOT NULL REFERENCES gym.race_events(id) ON DELETE CASCADE,
  division      text NOT NULL CHECK (division IN ('MEN_OPEN', 'MEN_PRO', 'WOMEN_OPEN', 'WOMEN_PRO')),
  goal_sec      int CHECK (goal_sec > 0),
  result_sec    int CHECK (result_sec > 0),
  status        text NOT NULL DEFAULT 'training' CHECK (status IN ('training', 'raced', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_member_races_result_when_raced CHECK (status <> 'raced' OR result_sec IS NOT NULL)
);
-- Satu entri hidup per member per race; entri batal dihidupkan lagi saat daftar ulang.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_member_races_live
  ON gym.member_races (customer_id, race_event_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_gym_member_races_customer ON gym.member_races (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_member_races_event ON gym.member_races (race_event_id);

-- 4. Skema insentif coach (IDR) -----------------------------------------------
CREATE TABLE IF NOT EXISTS gym.incentive_schemes (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                         text NOT NULL,
  -- NULL + is_default = skema organisasi; terisi = skema khusus coach itu.
  coach_id                     uuid REFERENCES gym.coaches(id) ON DELETE CASCADE,
  is_default                   boolean NOT NULL DEFAULT false,
  session_fee_idr              numeric(14,2) NOT NULL DEFAULT 0 CHECK (session_fee_idr >= 0),
  per_attendee_idr             numeric(14,2) NOT NULL DEFAULT 0 CHECK (per_attendee_idr >= 0),
  full_class_bonus_idr         numeric(14,2) NOT NULL DEFAULT 0 CHECK (full_class_bonus_idr >= 0),
  full_class_threshold_percent int NOT NULL DEFAULT 80 CHECK (full_class_threshold_percent BETWEEN 0 AND 100),
  no_show_penalty_idr          numeric(14,2) NOT NULL DEFAULT 0 CHECK (no_show_penalty_idr >= 0),
  is_active                    boolean NOT NULL DEFAULT true,
  updated_by                   uuid,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_incentive_default_xor_coach CHECK (is_default = (coach_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_incentive_schemes_coach
  ON gym.incentive_schemes (coach_id) WHERE coach_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_incentive_schemes_default
  ON gym.incentive_schemes (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS gym.incentive_scheme_rates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id        uuid NOT NULL REFERENCES gym.incentive_schemes(id) ON DELETE CASCADE,
  class_type_id    uuid NOT NULL REFERENCES gym.class_types(id) ON DELETE CASCADE,
  session_fee_idr  numeric(14,2) NOT NULL DEFAULT 0 CHECK (session_fee_idr >= 0),
  per_attendee_idr numeric(14,2) NOT NULL DEFAULT 0 CHECK (per_attendee_idr >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_incentive_rates ON gym.incentive_scheme_rates (scheme_id, class_type_id);

-- 5. Payout coach: membekukan statement satu bulan ------------------------------
-- Koreksi absensi setelahnya tidak mengubah payout; void lalu buat ulang.
CREATE TABLE IF NOT EXISTS gym.coach_payouts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id          uuid NOT NULL REFERENCES gym.coaches(id),
  -- Hari pertama bulan (WIB).
  period_month      date NOT NULL CHECK (extract(day FROM period_month) = 1),
  statement         jsonb NOT NULL,
  total_idr         numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_idr >= 0),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid', 'void')),
  created_by        uuid,
  approved_by       uuid,
  approved_at       timestamptz,
  paid_by           uuid,
  paid_at           timestamptz,
  payment_reference text,
  voided_by         uuid,
  voided_at         timestamptz,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_payouts_paid_has_reference CHECK (status <> 'paid' OR payment_reference IS NOT NULL),
  CONSTRAINT gym_payouts_void_has_note CHECK (status <> 'void' OR note IS NOT NULL)
);
-- Satu payout hidup per coach per bulan; yang void tidak menghalangi pengganti.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_coach_payouts_live
  ON gym.coach_payouts (coach_id, period_month) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS idx_gym_coach_payouts_period ON gym.coach_payouts (period_month DESC, status);

-- 6. Seed: 8 stasiun HYROX + Run + Air Bike -------------------------------------
INSERT INTO gym.exercises (code, name, description, category, equipment, hyrox_station_order, difficulty, default_spec, video_url)
SELECT v.code, v.name, v.description, v.category, v.equipment, v.station, v.difficulty, v.spec::jsonb, v.video
FROM (VALUES
  ('ski_erg', 'SkiErg', 'Tarikan dua tangan di SkiErg; dorong pinggul, bukan cuma lengan.', 'ERG', ARRAY['skierg'], 1, 2,
   '{"distanceM":1000,"reps":null}', 'https://www.youtube.com/results?search_query=hyrox+skierg+technique'),
  ('sled_push', 'Sled Push', 'Dorong sled 4 × 12,5 m; badan rendah, langkah pendek.', 'SLED', ARRAY['sled'], 2, 3,
   '{"distanceM":50,"reps":null}', 'https://www.youtube.com/results?search_query=hyrox+sled+push+technique'),
  ('sled_pull', 'Sled Pull', 'Tarik sled dengan tali 4 × 12,5 m; mundur sambil menarik.', 'SLED', ARRAY['sled'], 3, 3,
   '{"distanceM":50,"reps":null}', 'https://www.youtube.com/results?search_query=hyrox+sled+pull+technique'),
  ('burpee_broad_jump', 'Burpee Broad Jump', 'Burpee lalu lompat jauh dengan dua kaki, 80 m.', 'JUMP', ARRAY[]::text[], 4, 3,
   '{"distanceM":80,"reps":null}', 'https://www.youtube.com/results?search_query=hyrox+burpee+broad+jump'),
  ('rowing', 'Rowing', 'Rower 1000 m; kaki-pinggul-lengan, kembali dengan urutan terbalik.', 'ERG', ARRAY['rower'], 5, 2,
   '{"distanceM":1000,"reps":null}', 'https://www.youtube.com/results?search_query=hyrox+rowing+technique'),
  ('farmers_carry', 'Farmers Carry', 'Bawa dua kettlebell 200 m; bahu turun, langkah cepat.', 'CARRY', ARRAY['kettlebell'], 6, 2,
   '{"distanceM":200,"reps":null}', 'https://www.youtube.com/results?search_query=hyrox+farmers+carry'),
  ('sandbag_lunges', 'Sandbag Lunges', 'Lunge 100 m dengan sandbag di bahu; lutut belakang menyentuh lantai.', 'LUNGE', ARRAY['sandbag'], 7, 3,
   '{"distanceM":100,"reps":null}', 'https://www.youtube.com/results?search_query=hyrox+sandbag+lunges'),
  ('wall_balls', 'Wall Balls', 'Squat lalu lempar bola ke target; ritme napas tiap repetisi.', 'THROW', ARRAY['wall_ball'], 8, 3,
   '{"distanceM":null,"reps":100}', 'https://www.youtube.com/results?search_query=hyrox+wall+balls'),
  ('run', 'Run', 'Lari 1 km di antara stasiun; jaga pace yang sama tiap putaran.', 'RUN', ARRAY[]::text[], NULL, 1,
   '{"distanceM":1000,"reps":null}', NULL),
  ('air_bike', 'Air Bike', 'Conditioning seluruh badan; pengganti lari atau erg.', 'CONDITIONING', ARRAY['air_bike'], NULL, 2,
   '{"distanceM":null,"reps":null}', NULL)
) AS v(code, name, description, category, equipment, station, difficulty, spec, video)
WHERE NOT EXISTS (SELECT 1 FROM gym.exercises e WHERE e.code = v.code);

INSERT INTO gym.substitution_rules (original_exercise_id, alternative_exercise_id, similarity, volume_factor, conversion_note)
SELECT o.id, a.id, v.similarity, v.factor, v.note
FROM (VALUES
  ('ski_erg', 'rowing', 0.85, 1.00, 'Jarak sama. Biasanya 10-15 detik lebih lambat di rower.'),
  ('rowing', 'ski_erg', 0.85, 1.00, 'Jarak sama. Biasanya 10-15 detik lebih cepat di SkiErg.'),
  ('rowing', 'air_bike', 0.70, 0.50, 'Separuh jarak: 1000 m row kira-kira 500 m di air bike.'),
  ('ski_erg', 'air_bike', 0.65, 0.50, 'Separuh jarak. Beban tubuh atas tidak sebanding.'),
  ('sled_push', 'sled_pull', 0.75, 1.00, 'Jarak dan beban sama. Otot berbeda, waktu tidak sebanding.'),
  ('sled_pull', 'sled_push', 0.75, 1.00, 'Jarak dan beban sama.'),
  ('sled_push', 'sandbag_lunges', 0.55, 2.00, 'Dua kali jarak. Pengganti lemah; pakai hanya bila sled penuh.'),
  ('farmers_carry', 'sandbag_lunges', 0.60, 1.00, 'Jarak sama dengan sandbag. Latihan grip hilang.'),
  ('wall_balls', 'burpee_broad_jump', 0.60, 0.67, 'Dua pertiga repetisi. Beban napas mirip, kaki berbeda.'),
  ('burpee_broad_jump', 'wall_balls', 0.60, 1.50, 'Satu setengah kali repetisi.'),
  ('run', 'air_bike', 0.50, 3.00, 'Tiga kali jarak di air bike. Tidak sebanding dengan race.')
) AS v(original, alternative, similarity, factor, note)
JOIN gym.exercises o ON o.code = v.original
JOIN gym.exercises a ON a.code = v.alternative
ON CONFLICT (original_exercise_id, alternative_exercise_id) DO NOTHING;

-- 7. Seed: skema default + race mendatang ---------------------------------------
INSERT INTO gym.incentive_schemes (name, coach_id, is_default, session_fee_idr, per_attendee_idr,
                                   full_class_bonus_idr, full_class_threshold_percent, no_show_penalty_idr)
SELECT 'Skema default', NULL, true, 150000, 15000, 50000, 80, 0
WHERE NOT EXISTS (SELECT 1 FROM gym.incentive_schemes WHERE is_default);

INSERT INTO gym.race_events (name, country, region, city, venue, starts_at, ends_at, registration_url, status)
SELECT v.name, v.country, v.region, v.city, v.venue,
       (v.day + time '07:00') AT TIME ZONE 'Asia/Jakarta',
       (v.day + 1 + time '18:00') AT TIME ZONE 'Asia/Jakarta',
       'https://hyrox.com/find-my-race/', v.status
FROM (VALUES
  ('HYROX Jakarta', 'Indonesia', 'ASIA', 'Jakarta', 'JIExpo Kemayoran', date '2026-12-05', 'registration_open'),
  ('HYROX Singapore', 'Singapore', 'ASIA', 'Singapore', 'Singapore Expo', date '2027-02-20', 'announced')
) AS v(name, country, region, city, venue, day, status)
WHERE NOT EXISTS (SELECT 1 FROM gym.race_events r WHERE lower(r.name) = lower(v.name));

-- 8. Menu dashboard: Gym & Kelas → Stasiun, Race, Insentif ------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym', 'Gym & Kelas', NULL, 'calendar', 'group', 3, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('gym.exercises', 'Stasiun & Latihan', '/dashboard/gym/exercises', 'video', 'sidebar', 85, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('gym.races', 'Race HYROX', '/dashboard/gym/races', 'map', 'sidebar', 87, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('gym.incentives', 'Insentif Coach', '/dashboard/gym/incentives', 'money', 'sidebar', 90, '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 1 WHERE code = 'gym' AND (module IS DISTINCT FROM 'gym');
UPDATE iam.menus SET module = 'gym', level = 2 WHERE code IN ('gym.exercises', 'gym.races', 'gym.incentives');
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code IN ('gym.exercises', 'gym.races', 'gym.incentives') AND parent.code = 'gym';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'marketing')
   AND m.code IN ('gym', 'gym.exercises', 'gym.races', 'gym.incentives')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
