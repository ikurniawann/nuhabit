-- Pembersihan member TESTING di production (permintaan owner 2026-08-23):
-- 1) Nol-kan saldo ARK Coin: Budi Uji Reward, Ani Uji Pemula,
--    ilham kurniawan, Agus (match nama persis, case-insensitive).
-- 2) HAPUS member: Budi Uji Reward, Ani Uji Pemula.
--    Riwayat transaksi (orders/wallet/xp/dll) TIDAK dihapus — customer_id
--    di tabel riwayat dilepas (NULL) supaya laporan penjualan tetap utuh;
--    baris CRM yang menempel ke member (profil/badge/sesi portal) ikut
--    terhapus otomatis via FK CASCADE.
--
-- Jalankan: psql -d arkiv -f 2026-08-23-cleanup-member-testing.sql
-- Aman diulang (idempoten). Semua dalam satu transaksi.

BEGIN;

-- ── Tampilkan dulu siapa saja yang kena ──────────────────────────────
SELECT 'AKAN DI-NOL-KAN' AS aksi, id, name, phone, ark_coin_balance
FROM pos.pos_customers
WHERE lower(trim(name)) IN ('budi uji reward', 'ani uji pemula', 'ilham kurniawan', 'agus');

SELECT 'AKAN DIHAPUS' AS aksi, id, name, phone
FROM pos.pos_customers
WHERE lower(trim(name)) IN ('budi uji reward', 'ani uji pemula');

-- ── 1. Nol-kan saldo ARK ─────────────────────────────────────────────
UPDATE pos.pos_customers
SET ark_coin_balance = 0, updated_at = now()
WHERE lower(trim(name)) IN ('budi uji reward', 'ani uji pemula', 'ilham kurniawan', 'agus')
  AND ark_coin_balance <> 0;

-- ── 2. Hapus 2 member testing ────────────────────────────────────────
CREATE TEMP TABLE _hapus AS
SELECT id FROM pos.pos_customers
WHERE lower(trim(name)) IN ('budi uji reward', 'ani uji pemula');

-- Lepas referensi riwayat (FK NO ACTION) — riwayatnya sendiri dipertahankan.
UPDATE pos.pos_orders              SET customer_id = NULL WHERE customer_id IN (SELECT id FROM _hapus);
UPDATE pos.pos_wallet_transactions SET customer_id = NULL WHERE customer_id IN (SELECT id FROM _hapus);
UPDATE pos.pos_xp_transactions     SET customer_id = NULL WHERE customer_id IN (SELECT id FROM _hapus);
UPDATE pos.pos_order_splits        SET customer_id = NULL WHERE customer_id IN (SELECT id FROM _hapus);
UPDATE pos.pos_reservations        SET customer_id = NULL WHERE customer_id IN (SELECT id FROM _hapus);
UPDATE pos.pos_customer_vouchers   SET customer_id = NULL WHERE customer_id IN (SELECT id FROM _hapus);
UPDATE crm.crm_sales_leads         SET customer_id = NULL WHERE customer_id IN (SELECT id FROM _hapus);
UPDATE shop.orders                 SET customer_id = NULL WHERE customer_id IN (SELECT id FROM _hapus);
UPDATE ticketing.ticket_visits     SET customer_id = NULL WHERE customer_id IN (SELECT id FROM _hapus);

-- CASCADE otomatis: crm_member_profiles, crm_member_badges,
-- crm_member_entitlements, member_portal_sessions.
-- SET NULL otomatis: crm_xp_ledger, crm_redemptions, wa_*, crm_external_events.
DELETE FROM pos.pos_customers WHERE id IN (SELECT id FROM _hapus);

-- ── Bukti akhir ──────────────────────────────────────────────────────
SELECT 'SISA SETELAH CLEANUP' AS aksi, id, name, ark_coin_balance
FROM pos.pos_customers
WHERE lower(trim(name)) IN ('budi uji reward', 'ani uji pemula', 'ilham kurniawan', 'agus');

COMMIT;
