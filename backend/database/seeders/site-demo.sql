-- Demo data for the public site and the /apparel shop. Local demos only.
--
-- Seeds:
--   * configuration.branches: enriches Dago (fills empty profile fields) and
--     adds two public demo branches, Senopati (Jakarta) and Canggu (Bali),
--     under Dago's company (codes DEMO-SENOPATI, DEMO-CANGGU).
--   * gym: class types Station, Engine and Race Sim, the four demo coaches,
--     12 inactive "Demo Booker" customers, published sessions for the next
--     14 days (WIB) at every public branch, and confirmed demo bookings so
--     seats_left varies. Dates come from now(), so a re-run tops the
--     timetable up again.
--   * site.content: home (hero image, partners, reel, stories) and training
--     (class type details, phase items, stations, coaches, FAQ). Other keys
--     and staff-edited fields stay as they are.
--   * site.articles and site.events: 3 articles and 2 events, slugs demo-*.
--   * shop: default storefront free shipping and pickup, product images from
--     /site/demo/products/*.svg for the APL-* apparel products, featured and
--     new flags; existing sale prices stay and their end date moves forward.
--
-- Idempotent: rows are keyed by fixed UUIDs, demo-* slugs, codes and SKUs,
-- and the file runs in one transaction. Run from backend/:
--   node database/seeders/run-sql-file.js database/seeders/site-demo.sql
-- or with psql:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seeders/site-demo.sql

BEGIN;

-- 1. Branches ----------------------------------------------------------------

UPDATE configuration.branches SET
  is_public      = true,
  address        = COALESCE(NULLIF(address, ''), 'Jl. Ir. H. Juanda 100'),
  city           = COALESCE(NULLIF(city, ''), 'Bandung'),
  postcode       = COALESCE(NULLIF(postcode, ''), '40135'),
  lat            = COALESCE(lat, -6.885100),
  lng            = COALESCE(lng, 107.613400),
  phone          = COALESCE(NULLIF(phone, ''), '022-1234567'),
  email          = COALESCE(NULLIF(email, ''), 'dago@nuhabit.id'),
  instagram      = COALESCE(NULLIF(instagram, ''), '@nuhabit.dago'),
  directions     = COALESCE(NULLIF(directions, ''), 'On Jl. Ir. H. Juanda, 300 m north of the Dago intersection. Enter through the side gate next to the bike rack.'),
  hero_image_url = COALESCE(NULLIF(hero_image_url, ''), '/site/sample/training-session.webp'),
  benefits       = CASE WHEN benefits = '[]'::jsonb THEN '[
    {"title": "Full HYROX floor", "text": "Eight station lanes, a 40 m sled track and a rig for twelve athletes at once."},
    {"title": "Small classes", "text": "Twelve people per class, so the coach sees every rep."},
    {"title": "Open early", "text": "First class at 06:30 on weekdays, done before the Dago traffic starts."}
  ]'::jsonb ELSE benefits END,
  accordions     = CASE WHEN accordions = '{}'::jsonb THEN '{
    "facilities": ["SkiErgs, rowers and bike ergs", "Sled push and pull lane", "Lockers and hot showers"],
    "parking": ["Motorbike parking at the front", "Car parking on the side street after 18:00"],
    "team": ["Four HYROX coaches", "Front desk from 06:00 to 21:00"],
    "community": ["Saturday Race Sim", "Monthly community run on Jl. Dago"]
  }'::jsonb ELSE accordions END,
  extras         = CASE WHEN extras = '[]'::jsonb THEN '[
    {"name": "Body composition scan", "blurb": "Once a block, to track the change from week 1 to week 8."},
    {"name": "Sports massage", "blurb": "30 minutes after a Race Sim, booked at the front desk."}
  ]'::jsonb ELSE extras END,
  testimonials   = CASE WHEN testimonials = '[]'::jsonb THEN '[
    {"name": "Rina A.", "quote": "The 06:30 Engine class is the only meeting I never move.", "role": "Sample story"}
  ]'::jsonb ELSE testimonials END,
  updated_at     = now()
WHERE slug = 'dago' OR code = 'SULU-DAGO';

-- Demo branches sit under Dago's company; without Dago they use the oldest company.
INSERT INTO configuration.branches
  (id, company_id, name, code, slug, is_public, is_active, address, city, postcode, lat, lng,
   phone, email, instagram, directions, hero_image_url, benefits, accordions, extras, testimonials)
SELECT v.id::uuid, co.company_id, v.name, v.code, v.slug, true, true, v.address, v.city, v.postcode,
       v.lat, v.lng, v.phone, v.email, v.instagram, v.directions, v.hero, v.benefits::jsonb,
       v.accordions::jsonb, v.extras::jsonb, v.testimonials::jsonb
FROM (VALUES
  ('de000001-0000-4000-8000-000000000001', 'Senopati', 'DEMO-SENOPATI', 'senopati',
   'Jl. Senopati No. 45, Kebayoran Baru', 'Jakarta', '12190', -6.229700, 106.809000,
   '021-5550-1200', 'senopati@nuhabit.id', '@nuhabit.senopati',
   'Second floor above the coffee shop. Lift access from the lobby on Jl. Senopati.',
   '/member-assets/img/class-eng.jpg',
   '[{"title": "Two sled lanes", "text": "Side-by-side lanes for partner Race Sims."},
     {"title": "Lunch-hour classes", "text": "A 12:00 class every weekday for the SCBD crowd."},
     {"title": "Recovery room", "text": "Foam rollers, bands and a cold plunge after class."}]',
   '{"facilities": ["SkiErgs, rowers and assault bikes", "Two 25 m sled lanes", "Showers with towels"],
     "parking": ["Basement parking in the building", "Ojek drop-off at the lobby"],
     "team": ["Three HYROX coaches", "Front desk from 06:00 to 21:00"],
     "community": ["Friday after-work Race Sim", "Monthly run around GBK"]}',
   '[{"name": "Body composition scan", "blurb": "Once a block, booked at the front desk."}]',
   '[{"name": "Dimas P.", "quote": "Lunch-hour Station class, back at my desk by 13:15.", "role": "Sample story"}]'),
  ('de000001-0000-4000-8000-000000000002', 'Canggu', 'DEMO-CANGGU', 'canggu',
   'Jl. Pantai Batu Bolong No. 12', 'Bali', '80351', -8.647800, 115.138500,
   '0361-555-0120', 'canggu@nuhabit.id', '@nuhabit.canggu',
   'Five minutes from Batu Bolong beach. Look for the green gate opposite the surf shop.',
   '/member-assets/img/class-wod.jpg',
   '[{"title": "Open-air turf", "text": "A covered 40 m turf lane with a sea breeze."},
     {"title": "Drop-in friendly", "text": "Visitors can buy a 1-week holiday pass and train every day."},
     {"title": "Beach runs", "text": "Saturday Engine classes run on the sand."}]',
   '{"facilities": ["Covered turf lane", "Rowers and SkiErgs", "Outdoor showers"],
     "parking": ["Scooter parking inside the gate"],
     "team": ["Three HYROX coaches", "Front desk from 06:30 to 20:00"],
     "community": ["Saturday beach run", "Sunset mobility on Sundays"]}',
   '[{"name": "Holiday pass", "blurb": "Seven days of classes for visitors."}]',
   '[{"name": "Sarah L.", "quote": "I trained here on holiday and kept my race block going.", "role": "Sample story"}]')
) AS v(id, name, code, slug, address, city, postcode, lat, lng, phone, email, instagram, directions,
       hero, benefits, accordions, extras, testimonials)
CROSS JOIN LATERAL (
  SELECT COALESCE(
    (SELECT company_id FROM configuration.branches WHERE code = 'SULU-DAGO' ORDER BY created_at LIMIT 1),
    (SELECT id FROM configuration.companies ORDER BY created_at LIMIT 1)) AS company_id
) co
WHERE co.company_id IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, slug = EXCLUDED.slug, is_public = true, is_active = true,
  address = EXCLUDED.address, city = EXCLUDED.city, postcode = EXCLUDED.postcode,
  lat = EXCLUDED.lat, lng = EXCLUDED.lng, phone = EXCLUDED.phone, email = EXCLUDED.email,
  instagram = EXCLUDED.instagram, directions = EXCLUDED.directions,
  hero_image_url = EXCLUDED.hero_image_url, benefits = EXCLUDED.benefits,
  accordions = EXCLUDED.accordions, extras = EXCLUDED.extras,
  testimonials = EXCLUDED.testimonials, updated_at = now();

-- 2. Gym schedule ---------------------------------------------------------------

INSERT INTO gym.class_types (name, description, default_duration_min, default_credit_cost, default_capacity, color)
VALUES
  ('Station', 'Strength and technique on the eight HYROX stations.', 60, 1, 12, 'lime'),
  ('Engine', 'Running intervals and cardio machines for aerobic capacity.', 60, 1, 12, 'info'),
  ('Race Sim', 'A full HYROX race simulation against the clock.', 75, 2, 12, 'danger')
ON CONFLICT ((lower(name))) DO NOTHING;

INSERT INTO gym.coaches (name, bio, specialization)
VALUES
  ('Kevin Hartono', 'Builds the interval plans for Engine and Race Sim.', 'Engine & simulation'),
  ('Maya Kusuma', 'Strength coach with a functional fitness competition background.', 'Strength & conditioning'),
  ('Rizky Ramadhan', 'Race-day pacing and station technique.', 'HYROX race coach'),
  ('Tara Widjaja', 'Mobility, recovery and injury prevention.', 'Mobility & recovery')
ON CONFLICT ((lower(name))) DO NOTHING;

-- Inactive customers that only hold seats on demo sessions.
INSERT INTO pos.pos_customers (id, phone, name, notes, is_active)
SELECT ('de000002-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '+6200000000' || lpad(n::text, 2, '0'),
       'Demo Booker ' || lpad(n::text, 2, '0'),
       'site-demo seeder: holds seats on demo class sessions',
       false
FROM generate_series(1, 12) AS n
ON CONFLICT (id) DO NOTHING;

-- Weekdays 06:30, 12:00, 18:30; weekends 08:00 and 10:00. Coaches rotate so
-- no coach has two branches at once, and each slot runs that coach's class:
-- Kevin Engine, Maya Station, Rizky Race Sim, Tara Station or Engine.
-- A slot already taken at that branch and time is skipped.
WITH days AS (
  SELECT d::date AS day, (d::date - (now() AT TIME ZONE 'Asia/Jakarta')::date) AS n
  FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date,
                       (now() AT TIME ZONE 'Asia/Jakarta')::date + 13, interval '1 day') AS d
),
slots AS (
  SELECT d.day, d.n, u.hhmm, u.slot, extract(isodow FROM d.day) >= 6 AS weekend
  FROM days d
  CROSS JOIN LATERAL unnest(CASE WHEN extract(isodow FROM d.day) >= 6
                                 THEN ARRAY['08:00', '10:00']
                                 ELSE ARRAY['06:30', '12:00', '18:30'] END)
       WITH ORDINALITY AS u(hhmm, slot)
),
branches AS (
  SELECT id, (row_number() OVER (ORDER BY created_at, id) - 1)::int AS bi
  FROM configuration.branches
  WHERE is_public AND is_active AND slug IS NOT NULL
),
types AS (
  SELECT t.id, t.default_duration_min, t.default_credit_cost, v.ti
  FROM gym.class_types t
  JOIN (VALUES ('station', 0), ('engine', 1), ('race sim', 2)) AS v(name, ti) ON lower(t.name) = v.name
),
coaches AS (
  SELECT c.id, v.ci
  FROM gym.coaches c
  JOIN (VALUES ('kevin hartono', 0), ('maya kusuma', 1), ('rizky ramadhan', 2), ('tara widjaja', 3)) AS v(name, ci)
    ON lower(c.name) = v.name
),
planned AS (
  SELECT b.id AS branch_id,
         ((s.day + s.hhmm::time) AT TIME ZONE 'Asia/Jakarta') AS starts_at,
         CASE (s.n + s.slot + b.bi)::int % 4 WHEN 0 THEN 1 WHEN 1 THEN 0 WHEN 2 THEN 2 ELSE s.n::int % 2 END AS ti,
         (s.n + s.slot + b.bi)::int % 4 AS ci
  FROM slots s CROSS JOIN branches b
)
INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, area, starts_at, ends_at, capacity, credit_cost,
                                booking_opens_at, booking_closes_at, status, notes)
SELECT t.id, c.id, p.branch_id, 'Main Floor', p.starts_at,
       p.starts_at + make_interval(mins => t.default_duration_min), 12, t.default_credit_cost,
       p.starts_at - interval '7 days', p.starts_at, 'published', 'site-demo seeder'
FROM planned p
JOIN types t ON t.ti = p.ti
LEFT JOIN coaches c ON c.ci = p.ci
WHERE p.starts_at > now()
  AND NOT EXISTS (
    SELECT 1 FROM gym.class_sessions x
    WHERE x.branch_id = p.branch_id AND x.starts_at = p.starts_at AND x.status <> 'cancelled');

-- Earlier runs paired coaches and classes at random: give each upcoming demo
-- session its coach's class type.
UPDATE gym.class_sessions s
SET class_type_id = t.id,
    ends_at = s.starts_at + make_interval(mins => t.default_duration_min),
    credit_cost = t.default_credit_cost
FROM gym.coaches c, gym.class_types t
WHERE s.notes = 'site-demo seeder' AND s.starts_at > now()
  AND c.id = s.coach_id
  AND lower(t.name) = CASE lower(c.name)
        WHEN 'kevin hartono' THEN 'engine'
        WHEN 'maya kusuma' THEN 'station'
        WHEN 'rizky ramadhan' THEN 'race sim'
        ELSE CASE WHEN extract(day FROM s.starts_at AT TIME ZONE 'Asia/Jakarta')::int % 2 = 0 THEN 'station' ELSE 'engine' END
      END
  AND s.class_type_id IS DISTINCT FROM t.id;

-- Each upcoming demo session gets a stable booked count from its id (0 to 11 of 12).
WITH targets AS (
  SELECT s.id, (ARRAY[0, 3, 0, 7, 5, 0, 10, 2, 11, 0, 6, 4])[(abs(hashtext(s.id::text)::bigint) % 12 + 1)::int] AS booked
  FROM gym.class_sessions s
  WHERE s.notes = 'site-demo seeder' AND s.starts_at > now()
)
INSERT INTO gym.bookings (session_id, customer_id, status, source)
SELECT t.id, ('de000002-0000-4000-8000-0000000000' || lpad(k::text, 2, '0'))::uuid, 'confirmed', 'admin'
FROM targets t
CROSS JOIN LATERAL generate_series(1, t.booked) AS k
WHERE NOT EXISTS (
  SELECT 1 FROM gym.bookings b
  WHERE b.session_id = t.id
    AND b.customer_id = ('de000002-0000-4000-8000-0000000000' || lpad(k::text, 2, '0'))::uuid
    AND b.status IN ('confirmed', 'waitlist', 'checked_in'));

-- 3. Site content -----------------------------------------------------------------
-- Stored values overlay the Go defaults (domain.Merge), so hero, pillars and
-- mission keep their default text. Lists replace the default list whole.

INSERT INTO site.content (key, value) VALUES ('home', $json${
  "hero": {"image_url": "/member-assets/img/hero-login.jpg"},
  "partners": [
    {"name": "Concept2", "logo_url": ""},
    {"name": "Centr", "logo_url": ""},
    {"name": "Woodway", "logo_url": ""},
    {"name": "Wattbike", "logo_url": ""},
    {"name": "Rogue", "logo_url": ""}
  ],
  "reel": [
    {"image_url": "/site/sample/training-session.webp", "caption": "Sample photo: Thursday Station class on the sled lane"},
    {"image_url": "/member-assets/img/class-eng.jpg", "caption": "Sample photo: 500 m rower repeats in Engine"},
    {"image_url": "/member-assets/img/class-str.jpg", "caption": "Sample photo: pull-up strength work before the stations"},
    {"image_url": "/member-assets/img/class-wod.jpg", "caption": "Sample photo: stair runs between station sets"},
    {"image_url": "/site/sample/community-after-class.webp", "caption": "Sample photo: the 18:30 crew after class"},
    {"image_url": "/member-assets/img/class-mob.jpg", "caption": "Sample photo: the mobility block that closes the week"}
  ],
  "stories": [
    {"name": "Rina A.", "role": "Sample story",
     "quote": "I signed up for my first HYROX with six weeks to go. Race Sim taught me where to ease off so I still had legs for the wall balls.",
     "outcome": "Sub-90 first race", "image_url": "/member-assets/img/class-test.jpg"},
    {"name": "Dimas P.", "role": "Sample story",
     "quote": "I used to run alone and skip strength work. Two Station classes a week fixed my sled push, and my lower back stopped complaining.",
     "outcome": "Sled push 40 seconds faster", "image_url": "/member-assets/img/race-jakarta.jpg"},
    {"name": "Sarah L.", "role": "Sample story",
     "quote": "The 06:30 Engine class is the one appointment I never move. Twelve weeks in, my 5 km time dropped and I sleep better.",
     "outcome": "5 km from 31 to 26 minutes", "image_url": "/member-assets/img/race-singapore.jpg"}
  ]
}$json$::jsonb)
ON CONFLICT (key) DO UPDATE SET
  value = site.content.value || (EXCLUDED.value - 'hero')
          || jsonb_build_object('hero', COALESCE(site.content.value -> 'hero', '{}'::jsonb) || (EXCLUDED.value -> 'hero')),
  updated_at = now();

INSERT INTO site.content (key, value) VALUES ('training', $json${
  "class_types": [
    {"name": "Station", "slug": "station", "duration": "60 minutes", "level": "All levels",
     "text": "Strength and technique on the eight HYROX stations, with the load rising each phase.",
     "focus": ["Sled push and pull technique", "Wall ball and lunge mechanics", "Grip and posture for carries", "Load that rises each phase"],
     "image_url": "/member-assets/img/class-str.jpg"},
    {"name": "Engine", "slug": "engine", "duration": "60 minutes", "level": "All levels",
     "text": "Running intervals and cardio machines to build aerobic capacity.",
     "focus": ["Running intervals by pace zone", "SkiErg and rower repeats", "Heart rate zones", "A weekly pace check"],
     "image_url": "/member-assets/img/class-eng.jpg"},
    {"name": "Race Sim", "slug": "race-sim", "duration": "75 minutes", "level": "Intermediate, loads scaled",
     "text": "A full race simulation at the end of every block. Record your time and compare it with the last block.",
     "focus": ["All eight stations in race order", "Roxzone transitions", "Pacing plan per run", "A timed result on your record"],
     "image_url": "/member-assets/img/class-sim.jpg"}
  ],
  "block": {
    "title": "An 8-week block in 4 phases",
    "text": "Every block opens with a baseline test and closes with a race simulation.",
    "phases": [
      {"name": "Phase 1: Foundation", "weeks": "Weeks 1-2", "text": "Technique, mobility and the baseline test.",
       "items": ["Baseline 1 km run and station test", "Technique drills on all eight stations", "Mobility screen with a coach"]},
      {"name": "Phase 2: Build", "weeks": "Weeks 3-4", "text": "Volume goes up, station loads rise step by step.",
       "items": ["One extra interval set each week", "Station loads rise in small steps", "Longer Engine sessions"]},
      {"name": "Phase 3: Intensity", "weeks": "Weeks 5-6", "text": "Harder intervals, shorter rests.",
       "items": ["Intervals at race pace", "Shorter rests between stations", "Half-course simulations"]},
      {"name": "Phase 4: Peak", "weeks": "Weeks 7-8", "text": "Taper, race simulation and review.",
       "items": ["Lower volume, sharper sessions", "A full Race Sim against the clock", "A review of your numbers with a coach"]}
    ]
  },
  "stations": [
    {"name": "SkiErg", "slug": "skierg", "tips": ["Hinge at the hips, then pull the handles past your thighs", "Hold a steady split, 5 to 10 seconds slower than your 1 km test", "Breathe out on every pull"], "spec": "1000 m",
     "text": "Drive from the hips and pull with the lats. Starting too fast here costs you on every run after it.", "image_url": ""},
    {"name": "Sled Push", "slug": "sled-push", "tips": ["Arms locked, hips low, eyes on the floor ahead", "Short, fast steps on the balls of your feet", "Keep the sled moving: restarting a heavy sled costs more than a slow push"], "spec": "50 m, 152 kg men / 102 kg women (Open)",
     "text": "Four lengths of 12.5 m. Arms locked, low hips, short fast steps.", "image_url": ""},
    {"name": "Sled Pull", "slug": "sled-pull", "tips": ["Sit back in a half squat and pull hand over hand", "Walk back to reset only when the rope runs out", "Keep the rope in the lane so you skip a penalty"], "spec": "50 m, 103 kg men / 78 kg women (Open)",
     "text": "Hand over hand with a rope, staying behind the line. Sit back and use your legs.", "image_url": ""},
    {"name": "Burpee Broad Jumps", "slug": "burpee-broad-jumps", "tips": ["Chest and thighs touch the floor on every rep", "Land with both feet together, then step back down", "Pick a jump length you can repeat for 80 m"], "spec": "80 m",
     "text": "Chest to the floor, then jump forward with both feet. A steady rhythm beats big jumps.", "image_url": ""},
    {"name": "Rowing", "slug": "rowing", "tips": ["Legs, body, arms on the drive; arms, body, legs on the return", "Damper around 5 to 6 for most members", "A stroke rate of 26 to 30 keeps your legs fresh for the run"], "spec": "1000 m",
     "text": "Legs, body, arms. A damper around 5 to 6 and a stroke rate you can hold.", "image_url": "/member-assets/img/class-eng.jpg"},
    {"name": "Farmers Carry", "slug": "farmers-carry", "tips": ["Shoulders down and back, kettlebells close to your sides", "Quick steps with a straight torso", "Set the bells down before your grip fails, then pick them up straight away"], "spec": "200 m, 2 x 24 kg men / 2 x 16 kg women (Open)",
     "text": "Shoulders down, quick steps. Put the kettlebells down before your grip fails.", "image_url": ""},
    {"name": "Sandbag Lunges", "slug": "sandbag-lunges", "tips": ["Bag high on the shoulders, chest up", "Back knee touches the floor on every rep", "Even steps: alternate legs and keep a steady count"], "spec": "100 m, 20 kg men / 10 kg women (Open)",
     "text": "Bag on the shoulders, back knee touches the floor on every rep.", "image_url": ""},
    {"name": "Wall Balls", "slug": "wall-balls", "tips": ["Full squat below parallel on every rep", "Hit the target, then catch the ball into the next squat", "Plan your sets, such as 25 x 4, before you start"], "spec": "100 reps, 6 kg men / 4 kg women (Open)",
     "text": "Full squat, ball to the target. Break the 100 into sets before your legs decide for you.", "image_url": ""}
  ],
  "coaches": [
    {"name": "Kevin Hartono", "slug": "kevin-hartono", "quote": "Pace is a skill. We practise it every week.", "specialties": ["Running intervals", "Pacing plans", "Race Sim"], "certifications": ["HYROX Coach Level 1 (sample)", "Run coaching certificate (sample)"], "role": "Engine and Race Sim coach (sample)",
     "bio": "Writes the interval plans for Engine and Race Sim. Ran his first HYROX in Jakarta and has coached pacing since.",
     "image_url": "/member-assets/img/class-eng.jpg"},
    {"name": "Maya Kusuma", "slug": "maya-kusuma", "quote": "Technique first. The load follows.", "specialties": ["Sled push and pull", "Strength blocks", "Station technique"], "certifications": ["Strength and conditioning certificate (sample)", "Olympic lifting level 1 (sample)"], "role": "Strength coach (sample)",
     "bio": "Came from functional fitness competition. Runs the Station classes and the sled lane technique clinics.",
     "image_url": "/member-assets/img/class-wod.jpg"},
    {"name": "Rizky Ramadhan", "slug": "rizky-ramadhan", "quote": "Race day goes the way your last block went.", "specialties": ["Race-day pacing", "Roxzone transitions", "Wall balls"], "certifications": ["HYROX Coach Level 2 (sample)", "First aid and CPR (sample)"], "role": "HYROX race coach (sample)",
     "bio": "Plans race-day pacing with members and leads the Saturday Race Sim.",
     "image_url": "/member-assets/img/class-str.jpg"},
    {"name": "Tara Widjaja", "slug": "tara-widjaja", "quote": "Recovery is part of the program.", "specialties": ["Mobility", "Movement screens", "Recovery planning"], "certifications": ["Mobility coach certificate (sample)", "Yoga teacher 200h (sample)"], "role": "Mobility and recovery coach (sample)",
     "bio": "Leads mobility blocks and the Phase 1 movement screen. Keeps members training through a long block.",
     "image_url": "/member-assets/img/class-mob.jpg"}
  ],
  "faq": [
    {"question": "How does the trial work?",
     "answer": "Send the trial form with your branch and a class you would like to try. A coach confirms the slot on WhatsApp and meets you 10 minutes early to set your baseline."},
    {"question": "What is the difference between credits and a pass?",
     "answer": "Credits suit a flexible schedule: Station and Engine cost 1 credit, Race Sim costs 2, and credits expire 60 days after purchase. A pass covers your classes for a fixed period, such as 1, 4 or 8 weeks."},
    {"question": "I have never done HYROX. Can I join?",
     "answer": "Yes. Coaches scale every load and distance, and Phase 1 of each block is about technique. Most new members start with Station and Engine before their first Race Sim."},
    {"question": "What should I bring?",
     "answer": "Running shoes, a water bottle and a towel. Every branch has lockers and showers. Gloves are optional for the sled and the farmers carry."},
    {"question": "How do cancellations work?",
     "answer": "Cancel at least 4 hours before class and the credit goes back to your balance. A later cancellation or a no-show uses the credit, which keeps the waitlist fair."},
    {"question": "Do you help with HYROX races?",
     "answer": "Yes. We run a simulation day before the big Asian races, share pacing plans, and members often travel to the same event together."}
  ]
}$json$::jsonb)
ON CONFLICT (key) DO UPDATE SET value = site.content.value || EXCLUDED.value, updated_at = now();

-- 4. Articles and events ------------------------------------------------------------

INSERT INTO site.articles (id, slug, title, category, excerpt, cover_image_url, body_md, status, published_at)
VALUES
  ('de000003-0000-4000-8000-000000000001', 'demo-pace-your-first-hyrox', 'How to pace your first HYROX', 'training',
   'Eight 1 km runs and eight stations. Most first-timers lose their race on the second run, not the last station.',
   '/member-assets/img/class-sim.jpg',
   $md$Most first-time racers go out at their 5 km pace and pay for it by the sled push. HYROX is eight 1 km runs with a station after each one, and the clock does not stop in between.

Start the first run 20 to 30 seconds per kilometre slower than you think you need. The SkiErg comes straight after it, and a heart rate that is already high makes the sleds feel twice as heavy.

Treat the Roxzone as part of the race. Walk in with a plan for each station: how many wall balls per set, where you put the kettlebells down, which lane you take on the sled.

In our Race Sim classes you rehearse all of this at race order and race distance. Your time goes on your record, so the next block starts from a real number.$md$,
   'published', now() - interval '3 days'),
  ('de000003-0000-4000-8000-000000000002', 'demo-race-sim-day-recap', 'What 40 members learned at Race Sim day', 'events',
   'A full course, three heats and one lesson that kept coming up: the wall balls decide the finish.',
   '/member-assets/img/class-test.jpg',
   $md$Forty members ran the full course across three heats at Dago last month. Every athlete started with a 1 km run on the turf loop and finished with 100 wall balls.

The fastest heat finished in 1:12. The median time was 1:31, and half of the gap to the leaders came from the last two stations.

The coaches noticed the same pattern again and again. Athletes who broke their wall balls into sets of 10 from the first rep finished faster than those who went unbroken and stalled at 40.

The next simulation day is on the events page. Spots are limited to twelve athletes per heat.$md$,
   'published', now() - interval '8 days'),
  ('de000003-0000-4000-8000-000000000003', 'demo-your-first-two-weeks', 'Your first two weeks at NüHabit', 'news',
   'What happens in your first four classes, from the baseline test to your first Engine intervals.',
   '/member-assets/img/hero-login.jpg',
   $md$Your first class starts 10 minutes early. A coach walks you around the floor, sets up your member app and records a short baseline: a 1 km run and a light pass through four stations.

In the first week, take one Station class and one Engine class. Station teaches the technique behind the sleds, the carries and the wall balls. Engine shows you your running zones.

In the second week, add a third class if your legs allow it. Book through the member app; the timetable shows how many seats are left.

At the end of the 8-week block you run your first Race Sim. You do not need to be ready for it on day one. That is what the block is for.$md$,
   'published', now() - interval '14 days')
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, excerpt = EXCLUDED.excerpt,
  cover_image_url = EXCLUDED.cover_image_url, body_md = EXCLUDED.body_md,
  status = 'published', published_at = EXCLUDED.published_at, updated_at = now();

INSERT INTO site.events (id, slug, title, starts_at, ends_at, location_text, cover_image_url, body_md, form_slug, status)
SELECT v.id::uuid, v.slug, v.title, v.starts_at, v.starts_at + v.length, v.location, v.cover, v.body,
       (SELECT f.slug FROM crm.crm_forms f WHERE f.slug = v.form_slug), 'published'
FROM (VALUES
  ('de000004-0000-4000-8000-000000000001', 'demo-hyrox-simulation-day', 'HYROX Simulation Day',
   (((now() AT TIME ZONE 'Asia/Jakarta')::date + 10 + time '07:00') AT TIME ZONE 'Asia/Jakarta'), interval '5 hours',
   'NüHabit Dago, Jl. Ir. H. Juanda 100, Bandung', '/member-assets/img/race-jakarta.jpg',
   $md$A full HYROX course in race order: eight 1 km runs and eight stations, timed by our coaches.

Heats of twelve start every 90 minutes from 07:00. Open weights for every division, and coaches can scale loads for first-timers.

Bring running shoes and a water bottle. Results go on your member record.$md$,
   'race-sim-october'),
  ('de000004-0000-4000-8000-000000000002', 'demo-community-5k-run', 'Community 5K Run',
   (((now() AT TIME ZONE 'Asia/Jakarta')::date + 17 + time '06:00') AT TIME ZONE 'Asia/Jakarta'), interval '2 hours',
   'Starts at NüHabit Dago, route along Jl. Ir. H. Juanda, Bandung', '/member-assets/img/class-wod.jpg',
   $md$An easy 5 km run for members, friends and anyone curious about the gym. Three pace groups, each led by a coach.

We finish back at the gym with coffee and a short mobility session. No sign-up fee.$md$,
   NULL)
) AS v(id, slug, title, starts_at, length, location, cover, body, form_slug)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
  location_text = EXCLUDED.location_text, cover_image_url = EXCLUDED.cover_image_url,
  body_md = EXCLUDED.body_md, form_slug = EXCLUDED.form_slug, status = 'published', updated_at = now();

-- 5. Shop -----------------------------------------------------------------------------

INSERT INTO shop.storefront_settings (storefront_id, pickup_enabled, free_shipping_threshold)
SELECT id, true, 300000 FROM shop.storefronts WHERE is_default
ON CONFLICT (storefront_id) DO UPDATE SET
  pickup_enabled = true,
  free_shipping_threshold = COALESCE(shop.storefront_settings.free_shipping_threshold, 300000),
  updated_at = now();

CREATE TEMP TABLE demo_product_art (sku text PRIMARY KEY, url text NOT NULL) ON COMMIT DROP;
INSERT INTO demo_product_art (sku, url) VALUES
  ('APL-CEL-001', '/site/demo/products/chinos.svg'),
  ('APL-CEL-002', '/site/demo/products/joggers.svg'),
  ('APL-KAOS-001', '/site/demo/products/tee.svg'),
  ('APL-KAOS-002', '/site/demo/products/raglan.svg'),
  ('APL-KAOS-003', '/site/demo/products/polo.svg'),
  ('APL-KMJ-001', '/site/demo/products/shirt-oxford.svg'),
  ('APL-KMJ-002', '/site/demo/products/shirt-flannel.svg'),
  ('APL-SND-001', '/site/demo/products/flip-flops.svg'),
  ('APL-SND-002', '/site/demo/products/slides.svg'),
  ('APL-SPT-001', '/site/demo/products/sneaker-canvas.svg'),
  ('APL-SPT-002', '/site/demo/products/running-shoe.svg'),
  ('APL-SPT-003', '/site/demo/products/boots.svg');

-- A photo staff uploaded stays; only empty or earlier demo images change.
UPDATE pos.pos_products p SET image_url = a.url, updated_at = now()
FROM demo_product_art a
WHERE p.sku = a.sku AND (COALESCE(p.image_url, '') = '' OR p.image_url LIKE '/site/demo/%');

DELETE FROM pos.pos_product_images i
USING pos.pos_products p, demo_product_art a
WHERE i.product_id = p.id AND p.sku = a.sku AND i.url LIKE '/site/demo/%';

INSERT INTO pos.pos_product_images (product_id, url, display_order)
SELECT p.id, a.url, 0
FROM pos.pos_products p JOIN demo_product_art a ON a.sku = p.sku
WHERE NOT EXISTS (SELECT 1 FROM pos.pos_product_images i WHERE i.product_id = p.id);

INSERT INTO shop.product_settings (product_id, is_featured, is_new)
SELECT p.id, v.featured, v.is_new
FROM pos.pos_products p
JOIN (VALUES
  ('APL-CEL-001', true, false),
  ('APL-KMJ-002', true, false),
  ('APL-SPT-001', true, false),
  ('APL-KAOS-001', false, true),
  ('APL-KAOS-002', false, true)
) AS v(sku, featured, is_new) ON v.sku = p.sku
ON CONFLICT (product_id) DO UPDATE SET
  is_featured = shop.product_settings.is_featured OR EXCLUDED.is_featured,
  is_new = shop.product_settings.is_new OR EXCLUDED.is_new,
  updated_at = now();

-- Keep the sale prices on show: an end date within a week moves two weeks out.
UPDATE shop.product_settings s SET sale_until = now() + interval '14 days', updated_at = now()
FROM pos.pos_products p
WHERE s.product_id = p.id AND p.sku LIKE 'APL-%'
  AND s.sale_price_idr IS NOT NULL AND s.sale_until IS NOT NULL
  AND s.sale_until < now() + interval '7 days';

COMMIT;
