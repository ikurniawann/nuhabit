-- =============================================================================
-- EPIC-032 Fase B1 — promo di booking online tiket + jenis ledger 'diskon'
-- =============================================================================
-- Booking menyimpan SNAPSHOT potongan: `total` TETAP GROSS (Σ harga item —
-- semantik lama tak berubah), `discount_amount` potongan promo, yang harus
-- dibayar = total - discount_amount (invoice Xendit & cek silang webhook).
--
-- Ledger redeem tetap net-0 (asersi Σdebit = total gross dipertahankan):
--   debit tiket Σ = gross ; kredit = pembayaran (net, uang riil) + DISKON
--   (potongan) → Σkredit = gross. Jenis charge baru 'diskon' arah kredit.
--
-- Idempoten (IF NOT EXISTS + DO guard), atomik (runner BEGIN/COMMIT), target dev.
-- =============================================================================

-- 1) Snapshot promo di booking
ALTER TABLE ticketing.ticket_bookings
    ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS promo_code varchar(40);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ticket_bookings_discount_check'
    ) THEN
        ALTER TABLE ticketing.ticket_bookings
            ADD CONSTRAINT ticket_bookings_discount_check
            CHECK (discount_amount >= 0 AND discount_amount <= total);
    END IF;
END $$;

-- 2) Jenis charge 'diskon' (kredit) di ledger visit
ALTER TABLE ticketing.ticket_visit_charges
    DROP CONSTRAINT IF EXISTS chk_charge_direction;
ALTER TABLE ticketing.ticket_visit_charges
    ADD CONSTRAINT chk_charge_direction CHECK (
        (charge_type IN ('deposit', 'pembayaran', 'diskon') AND direction = 'kredit')
        OR charge_type = 'koreksi'
        OR (charge_type NOT IN ('deposit', 'pembayaran', 'diskon', 'koreksi')
            AND direction = 'debit')
    );
