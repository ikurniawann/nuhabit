-- Translate the public copy saved before the English defaults were added.
-- Every update matches the original text, so later staff edits survive.

UPDATE site.content
SET value = jsonb_set(value, '{hero,kicker}', to_jsonb('HYROX training gym'::text)), updated_at = now()
WHERE key = 'home' AND value #>> '{hero,kicker}' = 'HYROX training gym Indonesia';

UPDATE site.content
SET value = jsonb_set(value, '{hero,title}', to_jsonb('Training that makes you strong for life, not only for the gym.'::text)), updated_at = now()
WHERE key = 'home' AND value #>> '{hero,title}' = 'Latihan yang bikin kamu kuat buat hidup, bukan cuma buat gym.';

UPDATE site.content
SET value = jsonb_set(value, '{hero,subtitle}', to_jsonb('Small classes, certified coaches and a measurable 8-week program. Start with a free trial session at your nearest branch.'::text)), updated_at = now()
WHERE key = 'home' AND value #>> '{hero,subtitle}' = 'Kelas kecil, coach bersertifikat, dan program 8 minggu yang terukur. Mulai dengan sesi percobaan gratis di cabang terdekat.';

UPDATE site.content
SET value = jsonb_set(value, '{hero,cta_label}', to_jsonb('Start a Trial'::text)), updated_at = now()
WHERE key = 'home' AND value #>> '{hero,cta_label}' = 'Coba Gratis';

UPDATE site.content
SET value = jsonb_set(value, '{mission,quote}', to_jsonb('We believe small, consistent habits change bodies and lives. NüHabit exists so you have the place, the program and the people to keep them.'::text)), updated_at = now()
WHERE key = 'home' AND value #>> '{mission,quote}' = 'Kami percaya kebiasaan kecil yang konsisten mengubah tubuh dan hidup. NüHabit ada supaya kamu punya tempat, program, dan orang-orang untuk menjaganya.';

UPDATE site.content
SET value = jsonb_set(value, '{mission,author}', to_jsonb('The NüHabit team'::text)), updated_at = now()
WHERE key = 'home' AND value #>> '{mission,author}' = 'Tim NüHabit';

UPDATE site.content
SET value = jsonb_set(value, '{pillars,0,text}', to_jsonb($$The eight HYROX stations: SkiErg, sled push, sled pull, burpee broad jump, rowing, farmer's carry, sandbag lunge and wall balls. You learn the technique before the load goes up.$$::text)), updated_at = now()
WHERE key = 'home' AND value #>> '{pillars,0,text}' = $$Delapan stasiun HYROX: SkiErg, sled push, sled pull, burpee broad jump, rowing, farmer's carry, sandbag lunge, wall ball. Dilatih dengan teknik yang benar sebelum beban naik.$$;

UPDATE site.content
SET value = jsonb_set(value, '{pillars,1,text}', to_jsonb('Running and aerobic conditioning built step by step. You know your zones, your pace and your progress every week.'::text)), updated_at = now()
WHERE key = 'home' AND value #>> '{pillars,1,text}' = 'Lari dan kondisi aerobik dibangun bertahap. Kamu tahu zona, pace, dan progresmu setiap minggu.';

UPDATE site.content
SET value = jsonb_set(value, '{pillars,2,title}', to_jsonb('Community'::text)), updated_at = now()
WHERE key = 'home' AND value #>> '{pillars,2,title}' = 'Komunitas';

UPDATE site.content
SET value = jsonb_set(value, '{pillars,2,text}', to_jsonb('Race together, recover together, and classes that expect you to show up. A new habit is easier when you are not alone.'::text)), updated_at = now()
WHERE key = 'home' AND value #>> '{pillars,2,text}' = 'Race bareng, recovery bareng, dan kelas yang menunggu kamu datang. Kebiasaan baru lebih mudah kalau tidak sendirian.';

UPDATE configuration.branches
SET directions = 'Enter from Jl. Sulanjana and park in the basement.'
WHERE slug = 'sulu-bandung' AND directions = 'Masuk dari Jl. Sulanjana, parkir di basement.';

UPDATE configuration.branches
SET benefits = '[{"title":"Certified coaches","text":"Every coach is HYROX certified."},{"title":"Small classes","text":"No more than 12 people per class."}]'::jsonb
WHERE slug = 'sulu-bandung' AND benefits = '[{"title":"Coach bersertifikat","text":"Semua coach lulus sertifikasi HYROX."},{"title":"Kelas kecil","text":"Maksimal 12 orang per kelas."}]'::jsonb;

UPDATE configuration.branches
SET accordions = '{"facilities":["12-lane rig","25 m turf","Showers and lockers"],"parking":["Basement parking for 40 cars","Motorcycle parking at the front"],"team":["Head coach: Rani"],"community":["Saturday run club"]}'::jsonb
WHERE slug = 'sulu-bandung' AND accordions = '{"facilities":["Rig 12 lane","Turf 25 m","Shower & loker"],"parking":["Basement 40 mobil","Motor di depan"],"team":["Head coach: Rani"],"community":["Run club tiap Sabtu"]}'::jsonb;

UPDATE configuration.branches
SET extras = '[{"name":"Personal training","blurb":"One-to-one sessions with a coach."}]'::jsonb
WHERE slug = 'sulu-bandung' AND extras = '[{"name":"Personal training","blurb":"Sesi 1:1 dengan coach."}]'::jsonb;

UPDATE configuration.branches
SET testimonials = '[{"name":"Ayu","quote":"I finished my first race thanks to the 8-week program.","role":"Member since 2025"}]'::jsonb
WHERE slug = 'sulu-bandung' AND testimonials = '[{"name":"Ayu","quote":"Race pertama saya selesai berkat program 8 minggunya.","role":"Member 2025"}]'::jsonb;

UPDATE site.articles SET title = 'A new training block starts October 13'
WHERE slug = 'blok-baru-oktober' AND title = 'Blok baru dimulai 13 Oktober';
UPDATE site.articles SET excerpt = 'A baseline test in week one and a race simulation in week eight.'
WHERE slug = 'blok-baru-oktober' AND excerpt = 'Tes awal minggu pertama, race simulation di minggu ke-8.';
UPDATE site.articles SET body_md = '# A new training block

The baseline test takes place in **week one**.

- Station
- Engine

> Arrive 10 minutes early.'
WHERE slug = 'blok-baru-oktober' AND body_md = '# Blok baru

Tes awal dilakukan di **minggu pertama**.

- Station
- Engine

> Datang 10 menit lebih awal.';

UPDATE site.events SET title = 'October Race Simulation'
WHERE slug = 'race-sim-oktober' AND title = 'Race Simulation Oktober';
UPDATE site.events SET body_md = 'A full race simulation. Register with the form below.'
WHERE slug = 'race-sim-oktober' AND body_md = 'Simulasi race penuh. Daftar lewat formulir di bawah.';
UPDATE site.events SET form_slug = 'contact'
WHERE slug = 'race-sim-oktober' AND form_slug = 'kontak';
