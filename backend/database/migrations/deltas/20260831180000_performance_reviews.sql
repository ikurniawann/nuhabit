-- Performance Review kuartalan (permintaan owner 2026-08-31, Fase 1).
-- Rapor formal per kuartal: Hasil Kerja (rata-rata KPI bulanan, otomatis)
-- + Perilaku Kerja (Head Division menilai 1–5 per kompetensi) + Kontribusi
-- (opsional, nilai reviewer). Bobot 60/30/10; komponen kosong
-- didistribusikan ulang (pola mesin KPI). Tabel performance_reviews,
-- behavioral_review_items, behavioral_standards, score_scales, dan
-- performance_categories sudah ada sejak scaffold lama — delta ini
-- menambah siklus, menautkannya, dan mengisi data rujukan yang kosong.

-- 1. Siklus review (kuartalan)
CREATE TABLE IF NOT EXISTS performance.review_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL UNIQUE,
  period_year int NOT NULL CHECK (period_year BETWEEN 2020 AND 2100),
  period_quarter int NOT NULL CHECK (period_quarter BETWEEN 1 AND 4),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_year, period_quarter)
);

-- 2. Tautan review → siklus (satu review per karyawan per siklus)
ALTER TABLE performance.performance_reviews
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES performance.review_cycles(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_performance_reviews_cycle_employee
  ON performance.performance_reviews(cycle_id, employee_id)
  WHERE cycle_id IS NOT NULL;

-- 3. Data rujukan — hanya diisi bila masih kosong (tidak menimpa kustomisasi)
INSERT INTO performance.behavioral_standards
  (value_name, competency_name, standard_description,
   score_1_description, score_3_description, score_5_description, weight)
SELECT * FROM (VALUES
  ('Disiplin', 'Kedisiplinan & Kehadiran',
   'Hadir tepat waktu, mengikuti jadwal shift, patuh SOP.',
   'Sering terlambat / melanggar SOP', 'Umumnya disiplin, sesekali lalai', 'Selalu tepat waktu dan patuh SOP'),
  ('Inisiatif', 'Inisiatif & Tanggung Jawab',
   'Mengerjakan tugas tanpa menunggu perintah, menuntaskan sampai selesai.',
   'Pasif, harus selalu diarahkan', 'Bekerja baik dengan arahan normal', 'Proaktif, bisa diandalkan tanpa pengawasan'),
  ('Kerja Sama', 'Kerja Sama Tim',
   'Membantu rekan, komunikasi baik antar stall/departemen.',
   'Sulit bekerja sama', 'Kooperatif dalam tim', 'Perekat tim, membantu lintas departemen'),
  ('Pelayanan', 'Orientasi Pelayanan',
   'Ramah dan sigap terhadap tamu, menjaga standar pengalaman Sulu.',
   'Sering dikomplain tamu', 'Pelayanan standar, jarang dikomplain', 'Dipuji tamu, jadi contoh pelayanan'),
  ('Integritas', 'Integritas & Kejujuran',
   'Jujur menangani uang/stok, transparan dalam laporan.',
   'Pernah terbukti tidak jujur', 'Tidak ada catatan negatif', 'Sangat dipercaya memegang tanggung jawab sensitif')
) AS seed(value_name, competency_name, standard_description,
          score_1_description, score_3_description, score_5_description)
CROSS JOIN (SELECT 20.00::numeric AS weight) w
WHERE NOT EXISTS (SELECT 1 FROM performance.behavioral_standards);

INSERT INTO performance.score_scales (score, label, quality_description)
VALUES
  (1, 'Kurang Sekali', 'Jauh di bawah standar, perlu pembinaan serius'),
  (2, 'Kurang', 'Di bawah standar yang diharapkan'),
  (3, 'Cukup', 'Memenuhi standar'),
  (4, 'Baik', 'Di atas standar'),
  (5, 'Istimewa', 'Jauh melampaui standar, jadi teladan')
ON CONFLICT (score) DO NOTHING;

INSERT INTO performance.performance_categories (category_name, min_score, max_score, description)
VALUES
  ('Istimewa', 90, 100, 'Kandidat promosi / kenaikan istimewa'),
  ('Baik', 75, 89.99, 'Kinerja sehat, layak kenaikan normal'),
  ('Cukup', 60, 74.99, 'Perlu peningkatan pada beberapa area'),
  ('Perlu Pembinaan', 0, 59.99, 'Butuh rencana pembinaan (coaching plan)')
ON CONFLICT (category_name) DO NOTHING;

-- 4. Menu sidebar: HRIS → Kinerja → Performance Review (semua role;
--    halaman & API yang menyaring aksi per peran)
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.performance.review', 'Performance Review', '/dashboard/hris/performance',
        'chart-bar-square', 'sidebar', 67, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'hris', level = 3 WHERE code = 'hris.performance.review';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.performance.review' AND parent.code = 'hris.performance';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, m.permission_context->'actions'
FROM iam.roles r CROSS JOIN iam.menus m
WHERE m.code = 'hris.performance.review' AND r.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
