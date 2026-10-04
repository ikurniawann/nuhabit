-- =============================================================================
-- EPIC-028 Fase D — Benefit member Season Pass (diskon POS)
-- =============================================================================
-- member_discount_percent per produk pass: pemegang pass aktif dapat diskon
-- ini di POS F&B/retail (di-scan di cashier). 0 = tanpa benefit diskon.
-- Idempoten.
-- =============================================================================

ALTER TABLE ticketing.ticket_pass_configs
    ADD COLUMN IF NOT EXISTS member_discount_percent numeric(5,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ticket_pass_configs_discount_check'
    ) THEN
        ALTER TABLE ticketing.ticket_pass_configs
            ADD CONSTRAINT ticket_pass_configs_discount_check
            CHECK (member_discount_percent >= 0 AND member_discount_percent <= 100);
    END IF;
END $$;
