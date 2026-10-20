-- HYROX results with station splits, staff verification and leaderboards.
--
-- gym.hyrox_results holds one result per member per race (source 'race',
-- linked to the race calendar) or per completed full simulation (source
-- 'simulation', linked to gym.workout_sessions). run_sec and station_sec are
-- the 8 runs and the 8 stations in race order; an element is NULL when the
-- member did not enter it. total_sec is what leaderboards rank: the official
-- total when entered, otherwise the sum of the splits. splits_total_sec keeps
-- that sum next to the official total and total_mismatch flags a gap between
-- them. notified_prs lists the split keys a PR notification already went out
-- for, so an edit does not notify twice.
--
-- gym.member_races.result_sec stays as the race entry's total; existing
-- total-only results are copied here without splits.
--
-- gym.athlete_settings gains show_on_leaderboard: false hides the member from
-- every leaderboard.
CREATE TABLE IF NOT EXISTS gym.hyrox_results (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  source             text NOT NULL CHECK (source IN ('race', 'simulation')),
  race_event_id      uuid REFERENCES gym.race_events(id) ON DELETE CASCADE,
  member_race_id     uuid REFERENCES gym.member_races(id) ON DELETE SET NULL,
  workout_session_id uuid REFERENCES gym.workout_sessions(id) ON DELETE SET NULL,
  division           text NOT NULL CHECK (division IN (
                       'MEN_OPEN', 'MEN_PRO', 'WOMEN_OPEN', 'WOMEN_PRO',
                       'MEN_DOUBLES', 'WOMEN_DOUBLES', 'MIXED_DOUBLES',
                       'MEN_RELAY', 'WOMEN_RELAY', 'MIXED_RELAY')),
  age_group          text CHECK (age_group IN (
                       '16-24', '25-29', '30-34', '35-39', '40-44', '45-49',
                       '50-54', '55-59', '60-64', '65-69', '70+')),
  run_sec            int[] NOT NULL DEFAULT array_fill(NULL::int, ARRAY[8]),
  station_sec        int[] NOT NULL DEFAULT array_fill(NULL::int, ARRAY[8]),
  roxzone_sec        int CHECK (roxzone_sec >= 0),
  official_total_sec int CHECK (official_total_sec > 0),
  splits_total_sec   int CHECK (splits_total_sec > 0),
  total_sec          int NOT NULL CHECK (total_sec > 0),
  total_mismatch     boolean NOT NULL DEFAULT false,
  raced_at           timestamptz NOT NULL,
  notified_prs       text[] NOT NULL DEFAULT '{}',
  verified_at        timestamptz,
  verified_by        uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_hyrox_results_eight_splits CHECK (cardinality(run_sec) = 8 AND cardinality(station_sec) = 8),
  CONSTRAINT gym_hyrox_results_source_link CHECK (
    (source = 'race' AND race_event_id IS NOT NULL) OR (source = 'simulation' AND race_event_id IS NULL)),
  CONSTRAINT gym_hyrox_results_verified_pair CHECK ((verified_at IS NULL) = (verified_by IS NULL))
);
-- One result per member per race and one per simulation session.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_hyrox_results_race
  ON gym.hyrox_results (customer_id, race_event_id) WHERE source = 'race';
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_hyrox_results_session
  ON gym.hyrox_results (workout_session_id) WHERE workout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_hyrox_results_customer ON gym.hyrox_results (customer_id, raced_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_hyrox_results_event ON gym.hyrox_results (race_event_id);
CREATE INDEX IF NOT EXISTS idx_gym_hyrox_results_member_race ON gym.hyrox_results (member_race_id);
CREATE INDEX IF NOT EXISTS idx_gym_hyrox_results_division ON gym.hyrox_results (division, total_sec);

-- Existing total-only results: the race entry's total becomes the official
-- total, dated at the race start.
INSERT INTO gym.hyrox_results (customer_id, source, race_event_id, member_race_id, division,
                               official_total_sec, total_sec, raced_at, created_at, updated_at)
SELECT r.customer_id, 'race', r.race_event_id, r.id, r.division,
       r.result_sec, r.result_sec, e.starts_at, r.updated_at, r.updated_at
  FROM gym.member_races r JOIN gym.race_events e ON e.id = r.race_event_id
 WHERE r.status = 'raced' AND r.result_sec IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE gym.athlete_settings
  ADD COLUMN IF NOT EXISTS show_on_leaderboard boolean NOT NULL DEFAULT true;
