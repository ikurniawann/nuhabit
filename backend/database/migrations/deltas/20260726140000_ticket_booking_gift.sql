-- =============================================================================
-- EPIC-032 Fase D2 — Gifting: booking tiket sebagai hadiah
-- =============================================================================
-- Keputusan owner (26 Jul): kirim e-tiket ke WA PENERIMA, tanpa halaman
-- klaim. Pemesan tetap pembayar (bukti bayar ke WA pemesan); e-tiket (link
-- status ber-QR) dikirim ke penerima saat PAID. Loket melihat nama penerima.
-- Idempoten, target dev.

ALTER TABLE ticketing.ticket_bookings
    ADD COLUMN IF NOT EXISTS gift_recipient_name varchar(120),
    ADD COLUMN IF NOT EXISTS gift_recipient_phone varchar(25);

-- Hadiah valid = nama & WA penerima ADA berpasangan (dua-duanya atau tidak
-- sama sekali)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ticket_bookings_gift_check'
    ) THEN
        ALTER TABLE ticketing.ticket_bookings
            ADD CONSTRAINT ticket_bookings_gift_check
            CHECK (
                (gift_recipient_name IS NULL AND gift_recipient_phone IS NULL)
                OR (gift_recipient_name IS NOT NULL AND gift_recipient_phone IS NOT NULL)
            );
    END IF;
END $$;
