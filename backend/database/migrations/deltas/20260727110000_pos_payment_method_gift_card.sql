-- =============================================================================
-- EPIC-034 Fase C — metode pembayaran "Gift Card" di kasir POS.
-- =============================================================================
-- Keputusan owner #3 (26 Jul): ikut preseden "1 transaksi 1 metode" seperti
-- ark_coin — gift card menutup SELURUH total transaksi atau ditolak. Tidak ada
-- split cash/QRIS + gift_card di MVP.
--
-- Saldo dipotong server-side (SELECT ... FOR UPDATE + guard, lihat
-- src/lib/giftcard/giftcard-server.ts) dan ditulis ke giftcard.gift_card_ledger
-- sebagai baris `pakai` — pola debit atomik ARK Coin.
--
-- Nilai enum ditambah SENDIRIAN di file ini: PG ≥ 12 mengizinkan ADD VALUE di
-- dalam transaksi selama nilai barunya tidak DIPAKAI di file yang sama
-- (preseden 20260722080000_ticketing_fase_c.sql untuk 'nfc_tab').
-- =============================================================================

ALTER TYPE public.pos_payment_method ADD VALUE IF NOT EXISTS 'gift_card';
