-- Master metode bayar bisa TAMBAH BARU (owner 2026-08-16).
--
-- payment_method selama ini enum pos_payment_method (7 nilai tetap) —
-- metode kustom (mis. transfer-bank, EDC BCA, GoPay) mustahil tanpa DDL
-- per metode. Kolom dilonggarkan ke text; nilai lama tidak berubah,
-- master pos.payment_methods menjadi satu-satunya sumber kebenaran kode.
-- Enum-nya sendiri dibiarkan (mungkin dipakai objek lain) — hanya kolom
-- yang dilepas dari enum.

ALTER TABLE pos.pos_orders
  ALTER COLUMN payment_method TYPE text
  USING payment_method::text;

ALTER TABLE pos.pos_shift_transactions
  ALTER COLUMN payment_method TYPE text
  USING payment_method::text;

ALTER TABLE pos.pos_wallet_transactions
  ALTER COLUMN payment_method TYPE text
  USING payment_method::text;

-- Kode = slug pendek; pagar format supaya data kotor tidak masuk.
ALTER TABLE pos.pos_orders
  ADD CONSTRAINT pos_orders_payment_method_format
  CHECK (payment_method IS NULL OR payment_method ~ '^[a-z0-9_-]{2,40}$')
  NOT VALID;
