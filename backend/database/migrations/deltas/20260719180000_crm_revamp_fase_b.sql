-- EPIC-011 Fase B: engine XP baru — XP = skor seumur hidup (append-only).
-- Konsep saldo XP (current_xp/spent_xp) dihapus: XP tidak pernah berkurang,
-- tier ditentukan murni dari lifetime XP. Ledger crm_xp_ledger tetap utuh
-- sebagai jejak audit historis.

-- ============================================================
-- 1. Hapus kolom saldo XP di profil member & pos_customers
-- ============================================================
ALTER TABLE crm.crm_member_profiles
  DROP CONSTRAINT IF EXISTS crm_member_profiles_current_xp_positive;
ALTER TABLE crm.crm_member_profiles
  DROP CONSTRAINT IF EXISTS crm_member_profiles_spent_xp_positive;
ALTER TABLE crm.crm_member_profiles
  DROP COLUMN IF EXISTS current_xp;
ALTER TABLE crm.crm_member_profiles
  DROP COLUMN IF EXISTS spent_xp;

ALTER TABLE pos.pos_customers
  DROP COLUMN IF EXISTS current_xp;

-- ============================================================
-- 2. Pensiunkan RPC order legacy
-- ============================================================
-- pos_create_order_transaction menulis current_xp dan memberi XP untuk SEMUA
-- metode pembayaran — bertentangan dengan aturan baru (XP hanya dari belanja
-- ARK Coin). Tidak lagi dipanggil aplikasi (checkout memakai route
-- /api/pos/orders); drop supaya tidak ada jalur XP liar.
DROP FUNCTION IF EXISTS public.pos_create_order_transaction(
  text, uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric,
  numeric, numeric, text, numeric, numeric, numeric, jsonb
);
