-- =============================================================================
-- EPIC-034 Fase C (perbaikan review keamanan) — satu order = satu debit kartu.
-- =============================================================================
-- Temuan review (HIGH): `redeemGiftCardForPosOrder` mengunci baris KARTU
-- (FOR UPDATE), lalu memeriksa "order ini sudah pernah didebit?" lewat SELECT
-- biasa. Dua permintaan bersamaan untuk order yang SAMA tapi memakai KARTU
-- BERBEDA tidak pernah berebut lock yang sama, sehingga di READ COMMITTED
-- keduanya bisa lolos pemeriksaan dan mendebit dua kartu sekaligus untuk satu
-- tagihan — kartu kedua terkuras tanpa imbalan.
--
-- Lock aplikasi tidak cukup di sini (kunci beda baris), jadi invariannya
-- ditegakkan DATABASE: paling banyak satu baris `pakai` per order POS.
-- Percobaan kedua gagal dgn unique_violation (23505) dan dipetakan jadi 409
-- oleh pemanggil.
--
-- Idempoten (CREATE UNIQUE INDEX IF NOT EXISTS), dev.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS gift_card_ledger_one_debit_per_pos_order
  ON giftcard.gift_card_ledger (context_id)
  WHERE direction = 'pakai' AND context_type = 'pos_order';

COMMENT ON INDEX giftcard.gift_card_ledger_one_debit_per_pos_order IS
  'Satu order POS hanya boleh punya SATU baris debit gift card — menutup race '
  'dua kartu berbeda membayar order yang sama (EPIC-034 Fase C, review 27 Jul).';
