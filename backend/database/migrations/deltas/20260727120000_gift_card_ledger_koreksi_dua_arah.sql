-- =============================================================================
-- EPIC-034 Fase C — baris `koreksi` gift card boleh dua arah.
-- =============================================================================
-- Fase A menulis CHECK (amount > 0) untuk SEMUA arah. Itu cukup selama ledger
-- hanya berisi isi/pakai, tapi Fase C butuh baris PEMBALIK:
--   1. kompensasi otomatis — debit sukses tapi langkah checkout berikutnya
--      gagal → saldo dikembalikan (amount positif, menambah);
--   2. koreksi manual admin ber-audit (keputusan owner 27 Jul) — bisa
--      menambah ATAU mengurangi saldo.
--
-- Tanpa tanda pada `amount`, baris koreksi jadi ambigu (naik atau turun?) dan
-- laporan liability tidak bisa dijumlahkan langsung. Preseden yang sama sudah
-- diambil di EPIC-023 untuk ticketing.ticket_visit_charges (20260722080000):
-- longgarkan CHECK supaya koreksi boleh dua arah, arah lain tetap positif.
--
-- Idempoten (DROP IF EXISTS + ADD), atomik (runner BEGIN/COMMIT), dev.
-- =============================================================================

ALTER TABLE giftcard.gift_card_ledger
  DROP CONSTRAINT IF EXISTS gift_card_ledger_amount_check;

ALTER TABLE giftcard.gift_card_ledger
  ADD CONSTRAINT gift_card_ledger_amount_check CHECK (
    (direction IN ('isi', 'pakai') AND amount > 0)
    OR (direction = 'koreksi' AND amount <> 0)
  );

COMMENT ON COLUMN giftcard.gift_card_ledger.amount IS
  'isi/pakai selalu positif (arah dibaca dari direction). koreksi BERTANDA: '
  'positif = saldo dikembalikan (kompensasi/refund), negatif = saldo ditarik '
  '(koreksi admin). balance_after tetap snapshot saldo sesudah baris ini.';
