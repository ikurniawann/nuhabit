-- Gym athlete (tab Train di aplikasi member): aktivitas GPS dengan split dan
-- foto, follow, kudos, komentar, segment + effort, klub, gear, rute, pengaturan
-- atlet, dan tantangan berbasis km.
-- Port dari NüHabit (0009_training: activities..athlete_settings; 0007_engagement:
-- challenges + challenge_joins). Member = pos.pos_customers(id). Idempotent.

CREATE SCHEMA IF NOT EXISTS gym;

-- 1. Gear (dibuat lebih dulu karena aktivitas mereferensikannya) -----------------
CREATE TABLE IF NOT EXISTS gym.athlete_gear (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('SHOES', 'BIKE')),
  -- Akumulasi jarak aktivitas yang memakai gear ini.
  distance_m  numeric(12,2) NOT NULL DEFAULT 0 CHECK (distance_m >= 0),
  retired     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_athlete_gear_customer ON gym.athlete_gear (customer_id) WHERE NOT retired;

-- 2. Aktivitas ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.athlete_activities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  type                text NOT NULL CHECK (type IN ('RUN', 'RIDE', 'WALK', 'WORKOUT')),
  title               text NOT NULL,
  description         text NOT NULL DEFAULT '',
  started_at          timestamptz NOT NULL,
  elapsed_sec         int NOT NULL DEFAULT 0 CHECK (elapsed_sec >= 0),
  moving_sec          int NOT NULL DEFAULT 0 CHECK (moving_sec >= 0),
  distance_m          numeric(10,2) NOT NULL DEFAULT 0 CHECK (distance_m >= 0),
  avg_pace_sec_per_km int,
  elevation_gain_m    numeric(8,2) NOT NULL DEFAULT 0,
  -- Jejak GPS mentah [{t,lat,lng,ele?}]; selalu dibaca utuh, tidak dikueri isinya.
  points              jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Foto kecil (data URL) yang sudah diperkecil di klien.
  photos              jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility          text NOT NULL DEFAULT 'EVERYONE'
                      CHECK (visibility IN ('EVERYONE', 'FOLLOWERS', 'PRIVATE')),
  gear_id             uuid REFERENCES gym.athlete_gear(id) ON DELETE SET NULL,
  -- Asal aktivitas otomatis (mis. 'workout_session' + id sesi workout selesai).
  source_type         text,
  source_id           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_athlete_activities_customer ON gym.athlete_activities (customer_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_athlete_activities_feed ON gym.athlete_activities (started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_athlete_activities_source
  ON gym.athlete_activities (source_type, source_id) WHERE source_id IS NOT NULL;

-- 3. Graf sosial ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.athlete_follows (
  follower_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT gym_athlete_follows_no_self CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_gym_athlete_follows_followee ON gym.athlete_follows (followee_id);

CREATE TABLE IF NOT EXISTS gym.athlete_kudos (
  activity_id uuid NOT NULL REFERENCES gym.athlete_activities(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, customer_id)
);

CREATE TABLE IF NOT EXISTS gym.athlete_activity_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES gym.athlete_activities(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_athlete_comments_activity ON gym.athlete_activity_comments (activity_id, created_at);

-- 4. Segment + effort ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.athlete_segments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  type       text NOT NULL CHECK (type IN ('RUN', 'RIDE', 'WALK', 'WORKOUT')),
  distance_m numeric(10,2) NOT NULL CHECK (distance_m > 0),
  location   text NOT NULL DEFAULT '',
  -- Polyline segment; pencocokan memakai gerbang awal dan akhirnya.
  path       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gym.athlete_segment_efforts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id  uuid NOT NULL REFERENCES gym.athlete_segments(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES gym.athlete_activities(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  elapsed_sec int NOT NULL CHECK (elapsed_sec > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_athlete_efforts_segment ON gym.athlete_segment_efforts (segment_id, elapsed_sec);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_athlete_efforts_activity ON gym.athlete_segment_efforts (activity_id, segment_id);

-- 5. Klub ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.athlete_clubs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  location    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gym.athlete_club_members (
  club_id     uuid NOT NULL REFERENCES gym.athlete_clubs(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_gym_athlete_club_members_customer ON gym.athlete_club_members (customer_id);

-- 6. Rute tersimpan ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.athlete_routes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  name        text NOT NULL,
  points      jsonb NOT NULL,
  distance_m  numeric(10,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_athlete_routes_customer ON gym.athlete_routes (customer_id, created_at DESC);

-- 7. Pengaturan atlet ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.athlete_settings (
  customer_id       uuid PRIMARY KEY REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  units             text NOT NULL DEFAULT 'METRIC' CHECK (units IN ('METRIC', 'IMPERIAL')),
  booking_reminders boolean NOT NULL DEFAULT true,
  weekly_goal_km    numeric(6,2) CHECK (weekly_goal_km > 0),
  language          text NOT NULL DEFAULT 'ID' CHECK (language IN ('EN', 'ID')),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 8. Tantangan km (beda dari crm.challenges yang berbasis XP) ---------------------
CREATE TABLE IF NOT EXISTS gym.athlete_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- ANY menghitung semua tipe aktivitas.
  type        text NOT NULL DEFAULT 'ANY' CHECK (type IN ('ANY', 'RUN', 'RIDE', 'WALK', 'WORKOUT')),
  target_km   numeric(8,2) NOT NULL CHECK (target_km > 0),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_athlete_challenges_window CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_gym_athlete_challenges_window ON gym.athlete_challenges (starts_at, ends_at);

CREATE TABLE IF NOT EXISTS gym.athlete_challenge_joins (
  challenge_id uuid NOT NULL REFERENCES gym.athlete_challenges(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_gym_athlete_challenge_joins_customer ON gym.athlete_challenge_joins (customer_id);

-- 9. Seed demo -------------------------------------------------------------------
-- Hanya terisi bila member demo (081200000001..3) ada. ID deterministik
-- (md5 -> uuid) + ON CONFLICT DO NOTHING membuat seed aman diulang.
-- Jejak GPS: putaran lingkaran di sekitar Senopati, Jakarta Selatan.

-- Satu putaran: n titik, mulai sudut 0, t dalam ms, elevasi bergelombang +-3 m.
CREATE OR REPLACE FUNCTION pg_temp.athlete_loop(radius_m float8, n int, step_sec float8)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_agg(
           jsonb_build_object(
             't', round(i * step_sec * 1000),
             'lat', round((-6.2290 + radius_m * sin(a) / 111320.0)::numeric, 6),
             'lng', round((106.8080 + radius_m * cos(a) / (111320.0 * cos(radians(-6.2290))))::numeric, 6),
             'ele', round((12 + 3 * sin(3 * a))::numeric, 1)
           ) ORDER BY i)
    FROM generate_series(0, n - 1) AS i,
         LATERAL (SELECT 2 * pi() * i / (n - 1) AS a) angle
$$;

-- Busur pada putaran 800 m, dipakai sebagai path segment.
CREATE OR REPLACE FUNCTION pg_temp.athlete_arc(from_a float8, to_a float8)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_agg(
           jsonb_build_object(
             't', i * 60000,
             'lat', round((-6.2290 + 800 * sin(a) / 111320.0)::numeric, 6),
             'lng', round((106.8080 + 800 * cos(a) / (111320.0 * cos(radians(-6.2290))))::numeric, 6)
           ) ORDER BY i)
    FROM generate_series(0, 5) AS i,
         LATERAL (SELECT from_a + (to_a - from_a) * i / 5.0 AS a) angle
$$;

DROP TABLE IF EXISTS pg_temp.athlete_seed_members;
CREATE TEMP TABLE athlete_seed_members ON COMMIT DROP AS
SELECT c.id, v.key
  FROM (VALUES ('rina', '081200000001'), ('budi', '081200000002'), ('sari', '081200000003')) AS v(key, phone)
  JOIN pos.pos_customers c ON c.phone = v.phone;

INSERT INTO gym.athlete_gear (id, customer_id, name, kind)
SELECT md5('gym-athlete-seed:gear:' || g.key)::uuid, m.id, g.name, g.kind
  FROM (VALUES ('sari', 'Novablast 4', 'SHOES'), ('rina', 'Polygon Strattos', 'BIKE')) AS g(key, name, kind)
  JOIN athlete_seed_members m ON m.key = g.key
ON CONFLICT (id) DO NOTHING;

-- key, judul, tipe, radius, titik, detik per titik, hari lalu, menit offset, visibilitas, gear
INSERT INTO gym.athlete_activities
  (id, customer_id, type, title, description, started_at, elapsed_sec, moving_sec, distance_m,
   avg_pace_sec_per_km, elevation_gain_m, points, visibility, gear_id)
SELECT md5('gym-athlete-seed:act:' || s.code)::uuid,
       m.id, s.type, s.title, s.description,
       date_trunc('day', now()) - make_interval(days => s.days_ago) + make_interval(mins => s.minute_of_day),
       round((s.n - 1) * s.step_sec)::int,
       round((s.n - 1) * s.step_sec)::int,
       round((2 * pi() * s.radius_m)::numeric, 2),
       round((s.n - 1) * s.step_sec / (2 * pi() * s.radius_m / 1000))::int,
       18,
       pg_temp.athlete_loop(s.radius_m, s.n, s.step_sec),
       s.visibility,
       CASE WHEN s.code = 'sari-1' THEN md5('gym-athlete-seed:gear:sari')::uuid
            WHEN s.code = 'rina-2' THEN md5('gym-athlete-seed:gear:rina')::uuid END
  FROM (VALUES
    ('sari-1', 'sari', 'RUN',  'Morning Run',        'Putaran Senopati sebelum kelas.', 800,  160,  9.5, 1, 360,  'EVERYONE'),
    ('sari-2', 'sari', 'RUN',  'Evening Run',        '',                                800,  160, 10.0, 4, 1080, 'EVERYONE'),
    ('rina-1', 'rina', 'RUN',  'Senopati Loop',      'Lari bareng Sari.',               800,  160, 11.0, 1, 365,  'EVERYONE'),
    ('rina-2', 'rina', 'RIDE', 'Sunday Ride',        '',                                1500, 200,  7.0, 6, 360,  'EVERYONE'),
    ('rina-3', 'rina', 'RUN',  'Easy Run',           '',                                800,  160, 12.0, 15, 380, 'EVERYONE'),
    ('budi-1', 'budi', 'WALK', 'Lunch Walk',         '',                                350,  80,  21.0, 2, 720,  'FOLLOWERS'),
    ('budi-2', 'budi', 'RUN',  'Tempo Run',          'Tempo 5K.',                       800,  160, 10.5, 9, 370,  'EVERYONE')
  ) AS s(code, key, type, title, description, radius_m, n, step_sec, days_ago, minute_of_day, visibility)
  JOIN athlete_seed_members m ON m.key = s.key
ON CONFLICT (id) DO NOTHING;

-- Simulasi HYROX tanpa GPS (jarak = 8 x 1 km lari).
INSERT INTO gym.athlete_activities
  (id, customer_id, type, title, started_at, elapsed_sec, moving_sec, distance_m, visibility)
SELECT md5('gym-athlete-seed:act:budi-3')::uuid, m.id, 'WORKOUT', 'HYROX simulation',
       date_trunc('day', now()) - interval '3 days' + interval '7 hours', 5700, 5400, 8000, 'EVERYONE'
  FROM athlete_seed_members m WHERE m.key = 'budi'
ON CONFLICT (id) DO NOTHING;

-- Mileage gear = jumlah jarak aktivitas yang memakainya.
UPDATE gym.athlete_gear g
   SET distance_m = COALESCE((SELECT sum(a.distance_m) FROM gym.athlete_activities a WHERE a.gear_id = g.id), 0)
 WHERE g.id IN (md5('gym-athlete-seed:gear:sari')::uuid, md5('gym-athlete-seed:gear:rina')::uuid);

INSERT INTO gym.athlete_segments (id, name, type, distance_m, location, path)
SELECT md5('gym-athlete-seed:seg:' || s.code)::uuid, s.name, 'RUN',
       round((800 * (s.to_a - s.from_a))::numeric, 2), 'Senopati, Jakarta Selatan',
       pg_temp.athlete_arc(s.from_a, s.to_a)
  FROM (VALUES ('senopati', 'Senopati Straight', 0::float8, pi() / 2),
               ('gunawarman', 'Gunawarman Drag', pi(), 3 * pi() / 2)) AS s(code, name, from_a, to_a)
 WHERE EXISTS (SELECT 1 FROM athlete_seed_members)
ON CONFLICT (id) DO NOTHING;

-- Effort tiap lari demo: tiap busur = seperempat putaran.
INSERT INTO gym.athlete_segment_efforts (id, segment_id, activity_id, customer_id, elapsed_sec, created_at)
SELECT md5('gym-athlete-seed:effort:' || seg.id || ':' || a.id)::uuid, seg.id, a.id, a.customer_id,
       greatest(1, round(a.moving_sec / 4.0))::int, a.started_at
  FROM gym.athlete_activities a
  JOIN gym.athlete_segments seg
    ON seg.id IN (md5('gym-athlete-seed:seg:senopati')::uuid, md5('gym-athlete-seed:seg:gunawarman')::uuid)
 WHERE a.type = 'RUN'
   AND a.id IN (SELECT md5('gym-athlete-seed:act:' || c)::uuid
                  FROM unnest(ARRAY['sari-1', 'sari-2', 'rina-1', 'rina-3', 'budi-2']) AS c)
ON CONFLICT (activity_id, segment_id) DO NOTHING;

INSERT INTO gym.athlete_follows (follower_id, followee_id)
SELECT f.id, t.id
  FROM (VALUES ('sari', 'rina'), ('sari', 'budi'), ('rina', 'sari'), ('budi', 'rina')) AS p(follower, followee)
  JOIN athlete_seed_members f ON f.key = p.follower
  JOIN athlete_seed_members t ON t.key = p.followee
ON CONFLICT DO NOTHING;

INSERT INTO gym.athlete_kudos (activity_id, customer_id)
SELECT md5('gym-athlete-seed:act:' || k.act)::uuid, m.id
  FROM (VALUES ('sari-1', 'rina'), ('sari-1', 'budi'), ('rina-1', 'sari'), ('budi-3', 'rina')) AS k(act, key)
  JOIN athlete_seed_members m ON m.key = k.key
 WHERE EXISTS (SELECT 1 FROM gym.athlete_activities a WHERE a.id = md5('gym-athlete-seed:act:' || k.act)::uuid)
ON CONFLICT DO NOTHING;

INSERT INTO gym.athlete_activity_comments (id, activity_id, customer_id, text, created_at)
SELECT md5('gym-athlete-seed:comment:' || c.code)::uuid, md5('gym-athlete-seed:act:' || c.act)::uuid, m.id, c.text,
       now() - interval '20 hours'
  FROM (VALUES ('1', 'sari-1', 'rina', 'Pace-nya kencang! Sampai ketemu di kelas.'),
               ('2', 'rina-1', 'sari', 'Seru lari bareng pagi ini.')) AS c(code, act, key, text)
  JOIN athlete_seed_members m ON m.key = c.key
 WHERE EXISTS (SELECT 1 FROM gym.athlete_activities a WHERE a.id = md5('gym-athlete-seed:act:' || c.act)::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO gym.athlete_clubs (id, name, description, location)
SELECT md5('gym-athlete-seed:club:senopati')::uuid, 'NüHabit Run Club Senopati',
       'Lari bareng tiap Selasa & Kamis pagi dari studio Senopati.', 'Jakarta Selatan'
 WHERE EXISTS (SELECT 1 FROM athlete_seed_members)
ON CONFLICT (id) DO NOTHING;

INSERT INTO gym.athlete_club_members (club_id, customer_id)
SELECT md5('gym-athlete-seed:club:senopati')::uuid, m.id
  FROM athlete_seed_members m
 WHERE m.key IN ('rina', 'budi')
ON CONFLICT DO NOTHING;

INSERT INTO gym.athlete_challenges (id, name, description, type, target_km, starts_at, ends_at)
SELECT md5('gym-athlete-seed:challenge:100k')::uuid, '100K Bulan Ini',
       'Kumpulkan 100 km dari lari, sepeda, jalan, atau simulasi HYROX sebelum akhir bulan.', 'ANY', 100,
       date_trunc('month', now()), date_trunc('month', now()) + interval '1 month' - interval '1 second'
 WHERE EXISTS (SELECT 1 FROM athlete_seed_members)
ON CONFLICT (id) DO NOTHING;

INSERT INTO gym.athlete_challenge_joins (challenge_id, customer_id)
SELECT md5('gym-athlete-seed:challenge:100k')::uuid, m.id
  FROM athlete_seed_members m
 WHERE m.key IN ('rina', 'budi')
   AND EXISTS (SELECT 1 FROM gym.athlete_challenges WHERE id = md5('gym-athlete-seed:challenge:100k')::uuid)
ON CONFLICT DO NOTHING;
