-- EPIC-022 Fase F3: Realisasi bahan baku quotation. Keputusan owner:
-- tombol manual "Realisasi" menjelang acara; stok gudang venue (branch)
-- deal; MODIFIKASI owner 2026-07-22: bila stok tidak mencukupi, realisasi
-- BOLEH dilanjutkan tanpa memotong BOM dengan penanda status.
--
-- stock_deducted_at (Fase F1) = waktu realisasi (jangkar pembekuan
-- quotation); bom_status membedakan apakah stok benar-benar terpotong.

ALTER TABLE crm.crm_sales_quotations
  ADD COLUMN IF NOT EXISTS bom_status varchar(20)
    CHECK (bom_status IN ('terpotong', 'tidak-terpotong')),
  ADD COLUMN IF NOT EXISTS realized_by uuid REFERENCES configuration.users(id);

COMMENT ON COLUMN crm.crm_sales_quotations.bom_status IS
  'NULL = belum realisasi; terpotong = stok bahan baku dikurangi sesuai resep; tidak-terpotong = realisasi dipaksa lanjut tanpa potong stok (stok kurang / resep kosong)';
