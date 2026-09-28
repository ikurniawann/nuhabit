-- =============================================================================
-- Seeder: data demo ringkas utk self-order meja BCD (EPIC-048).
--
-- Isi: 4 kategori POS, 8 produk (satu per foto yang tersedia di
-- public/products/*.png) dengan varian, XP, station, dan 2 member demo.
-- Meja TIDAK disentuh (sudah ada 5-01…5-05 dgn qr_code). Idempotent:
-- produk upsert by sku, kategori/member by nama/nomor — aman dijalankan
-- berulang. Produk BCD-* lama yang tidak ada di daftar ini dihapus bila belum
-- pernah dipesan. Transaksi diatur oleh runner (run-sql-file.js /
-- psql --single-transaction).
--
-- Jalankan: npm run db:seed:bcdcoffee-self-order
--   (atau: docker exec -i wwwcoffee-db psql -U wwwcoffee -d wwwcoffee --single-transaction < file ini)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Kategori
-- ---------------------------------------------------------------------------
INSERT INTO pos.pos_categories (name, display_order, is_active)
SELECT v.name, v.display_order, true
FROM (VALUES
  ('Kopi', 10),
  ('Non-Kopi', 20),
  ('Makanan', 30),
  ('Dessert & Pastry', 40)
) AS v(name, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM pos.pos_categories c WHERE lower(c.name) = lower(v.name)
);

UPDATE pos.pos_categories c
SET display_order = v.display_order, is_active = true, updated_at = now()
FROM (VALUES
  ('Kopi', 10), ('Non-Kopi', 20), ('Makanan', 30), ('Dessert & Pastry', 40)
) AS v(name, display_order)
WHERE lower(c.name) = lower(v.name);

-- ---------------------------------------------------------------------------
-- Produk (upsert by sku) — foto dari public/products (dilayani publik, lihat
-- PUBLIC_AUTH_PREFIXES "/products/" di lib/auth/middleware.ts)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE seed_products (
  sku text PRIMARY KEY, name text, category text, description text,
  base_price numeric, cost_price numeric, xp_points int, station text,
  prep int, image_url text
) ON COMMIT DROP;

INSERT INTO seed_products VALUES
  -- Kopi
  ('BCD-KOPI-SUSU',     'Es Kopi Susu BCD',   'kopi',
     'Espresso house blend, susu segar, dan gula aren — signature BCD.',
     25000, 9000, 25, 'bar', 5, '/products/kopi-susu.png'),
  -- Non-Kopi
  ('BCD-ES-TEH',        'Es Teh',               'non-kopi',
     'Teh hitam seduh segar, disajikan dingin.',
     12000, 3000, 12, 'bar', 3, '/products/es-teh.png'),
  ('BCD-JUS-ALPUKAT',   'Jus Alpukat',          'non-kopi',
     'Alpukat segar diblender dengan susu dan sedikit coklat.',
     22000, 8000, 22, 'bar', 5, '/products/jus-alpukat.png'),
  -- Makanan
  ('BCD-NASI-GORENG',   'Nasi Goreng BCD',    'makanan',
     'Nasi goreng ala kafe dengan telur, ayam suwir, dan kerupuk.',
     30000, 12000, 30, 'kitchen', 12, '/products/nasi-goreng.png'),
  ('BCD-MIE-GORENG',    'Mie Goreng BCD',     'makanan',
     'Mie goreng dengan telur, sayur, dan bawang goreng.',
     28000, 11000, 28, 'kitchen', 12, '/products/mie-goreng.png'),
  ('BCD-AYAM-BAKAR',    'Ayam Bakar',           'makanan',
     'Ayam bakar bumbu kecap, nasi hangat, sambal, dan lalapan.',
     38000, 16000, 38, 'kitchen', 18, '/products/ayam-bakar.png'),
  ('BCD-KENTANG-GORENG','Kentang Goreng',       'makanan',
     'Kentang goreng renyah, cocok untuk teman ngopi.',
     20000, 7000, 20, 'kitchen', 8, '/products/kentang-goreng.png'),
  -- Dessert & Pastry
  ('BCD-ROTI-BAKAR',    'Roti Bakar',           'dessert & pastry',
     'Roti bakar tebal dengan pilihan isian coklat dan keju.',
     22000, 8000, 22, 'bakery', 8, '/products/roti-bakar.png');

INSERT INTO pos.pos_products (
  sku, name, description, category_id, base_price, cost_price,
  is_active, is_available, inventory_tracking, xp_points, image_url,
  prep_time_minutes, station, min_xp, product_kind, created_at, updated_at
)
SELECT s.sku, s.name, s.description, c.id, s.base_price, s.cost_price,
       true, true, false, s.xp_points, s.image_url,
       s.prep, s.station, NULL, 'regular', now(), now()
FROM seed_products s
JOIN pos.pos_categories c ON lower(c.name) = s.category
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category_id = EXCLUDED.category_id,
  base_price = EXCLUDED.base_price,
  cost_price = EXCLUDED.cost_price,
  is_active = true,
  is_available = true,
  xp_points = EXCLUDED.xp_points,
  image_url = EXCLUDED.image_url,
  prep_time_minutes = EXCLUDED.prep_time_minutes,
  station = EXCLUDED.station,
  min_xp = EXCLUDED.min_xp,
  updated_at = now();

-- Produk seed lama (BCD-*) yang tidak lagi ada di daftar & belum pernah dipesan → hapus.
DELETE FROM pos.pos_product_variants v
USING pos.pos_products p
WHERE v.product_id = p.id
  AND p.sku LIKE 'BCD-%'
  AND p.sku NOT IN (SELECT sku FROM seed_products)
  AND NOT EXISTS (SELECT 1 FROM pos.pos_order_items oi WHERE oi.product_id = p.id);

DELETE FROM pos.pos_products p
WHERE p.sku LIKE 'BCD-%'
  AND p.sku NOT IN (SELECT sku FROM seed_products)
  AND NOT EXISTS (SELECT 1 FROM pos.pos_order_items oi WHERE oi.product_id = p.id);

-- ---------------------------------------------------------------------------
-- Varian (reset & isi ulang utk produk seed)
-- ---------------------------------------------------------------------------
DELETE FROM pos.pos_product_variants
WHERE product_id IN (SELECT id FROM pos.pos_products WHERE sku IN (SELECT sku FROM seed_products));

WITH v(sku, group_name, name, price_adjustment, display_order) AS (VALUES
  ('BCD-KOPI-SUSU',      'Suhu',   'Ice',            0,    1),
  ('BCD-KOPI-SUSU',      'Suhu',   'Hot',            0,    2),
  ('BCD-KOPI-SUSU',      'Suhu',   'Ice — Oat Milk', 8000, 3),
  ('BCD-ES-TEH',         'Gula',   'Manis',          0,    1),
  ('BCD-ES-TEH',         'Gula',   'Less Sugar',     0,    2),
  ('BCD-ES-TEH',         'Gula',   'Tawar',          0,    3),
  ('BCD-JUS-ALPUKAT',    'Topping','Original',       0,    1),
  ('BCD-JUS-ALPUKAT',    'Topping','Extra Coklat',   3000, 2),
  ('BCD-NASI-GORENG',    'Porsi',  'Regular',        0,    1),
  ('BCD-NASI-GORENG',    'Porsi',  'Large',          8000, 2),
  ('BCD-MIE-GORENG',     'Level',  'Tidak Pedas',    0,    1),
  ('BCD-MIE-GORENG',     'Level',  'Pedas',          0,    2),
  ('BCD-AYAM-BAKAR',     'Bagian', 'Paha',           0,    1),
  ('BCD-AYAM-BAKAR',     'Bagian', 'Dada',           0,    2),
  ('BCD-KENTANG-GORENG', 'Rasa',   'Original',       0,    1),
  ('BCD-KENTANG-GORENG', 'Rasa',   'Cheese',         3000, 2),
  ('BCD-ROTI-BAKAR',     'Isian',  'Coklat Keju',    0,    1),
  ('BCD-ROTI-BAKAR',     'Isian',  'Coklat',         0,    2),
  ('BCD-ROTI-BAKAR',     'Isian',  'Keju',           0,    3)
)
INSERT INTO pos.pos_product_variants (product_id, group_name, name, price_adjustment, display_order, is_active)
SELECT p.id, v.group_name, v.name, v.price_adjustment, v.display_order, true
FROM v JOIN pos.pos_products p ON p.sku = v.sku;

-- ---------------------------------------------------------------------------
-- Member demo (utk uji ARK Coin; nomor harus terdaftar agar bisa login OTP)
-- ---------------------------------------------------------------------------
INSERT INTO pos.pos_customers (phone, name, membership_tier, member_type, total_xp, ark_coin_balance, is_active, notes)
SELECT m.phone, m.name, m.tier, 'registered', m.xp, m.ark, true, 'Seed demo self-order (EPIC-048)'
FROM (VALUES
  ('081200000001', 'Demo Member Bronze', 'bronze', 150,   100000),
  ('081200000002', 'Demo Member Gold',   'gold',   35000, 250000)
) AS m(phone, name, tier, xp, ark)
WHERE NOT EXISTS (
  SELECT 1 FROM pos.pos_customers c
  WHERE regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = m.phone
);

-- Ringkasan
SELECT 'kategori' AS entitas, count(*) AS jumlah FROM pos.pos_categories WHERE is_active
UNION ALL SELECT 'produk seed aktif', count(*) FROM pos.pos_products WHERE sku LIKE 'BCD-%' AND is_active AND is_available
UNION ALL SELECT 'produk berfoto lokal', count(*) FROM pos.pos_products WHERE sku LIKE 'BCD-%' AND image_url LIKE '/products/%'
UNION ALL SELECT 'varian seed', count(*) FROM pos.pos_product_variants v JOIN pos.pos_products p ON p.id = v.product_id WHERE p.sku LIKE 'BCD-%'
UNION ALL SELECT 'member demo', count(*) FROM pos.pos_customers WHERE phone IN ('081200000001', '081200000002');
