-- EPIC-023 Fase C: F&B on Tab — metode pembayaran "NFC Tab" di kasir POS.
-- Order F&B tetap pos_orders biasa (stok/resep/KDS/laporan shift jalan
-- otomatis); pembayarannya memindahkan tagihan ke tab visit sebagai baris
-- charge `fnb` (referensi pos_order_id), bukan menerima uang.
-- Keputusan Fase C (opsi di sketsa epic): order single-payment menyimpan
-- metode di pos_orders.payment_method langsung (konsisten cash/qris/ark);
-- TIDAK menulis pos_split_payments — tautan ke tab lewat
-- ticket_visit_charges.pos_order_id.

-- 1. Nilai enum baru untuk metode pembayaran POS.
--    (PG ≥ 12: aman dalam transaksi selama nilai tak dipakai di file ini.)
ALTER TYPE public.pos_payment_method ADD VALUE IF NOT EXISTS 'nfc_tab';

-- 2. Baris pembalik (void) charge: reversal debit ditulis sebagai
--    `koreksi` ber-arah kredit → longgarkan CHECK arah supaya koreksi
--    boleh dua arah (koreksi menambah ATAU mengurangi tagihan).
ALTER TABLE ticketing.ticket_visit_charges
  DROP CONSTRAINT IF EXISTS chk_charge_direction;
ALTER TABLE ticketing.ticket_visit_charges
  ADD CONSTRAINT chk_charge_direction CHECK (
    (charge_type IN ('deposit', 'pembayaran') AND direction = 'kredit')
    OR charge_type = 'koreksi'
    OR (charge_type NOT IN ('deposit', 'pembayaran', 'koreksi')
        AND direction = 'debit')
  );

-- 3. Pertahanan lapis DB (hasil security review): satu order POS hanya
--    boleh punya satu charge fnb aktif — idempotensi tidak bergantung
--    aplikasi saja.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_visit_charges_fnb_order
  ON ticketing.ticket_visit_charges (pos_order_id)
  WHERE charge_type = 'fnb' AND voided_by_charge_id IS NULL;
