-- =============================================================================
-- Ticketing — flag gate per ticket + COGS (HPP) per ticket
-- =============================================================================
-- (1) has_gate: tidak semua ticket punya gate fisik. Ticket ber-gate divalidasi
--     di gate/turnstile; ticket TANPA gate divalidasi penjaga keliling dengan
--     reader NFC (cek sudah booking/belum). Default true (perilaku existing).
-- (2) cogs: harga pokok (HPP) per ticket → laporan bisa hitung omzet kotor vs
--     bersih (laba kotor = pendapatan − COGS×qty).
-- Idempoten (IF NOT EXISTS + DO guard).
-- =============================================================================

ALTER TABLE ticketing.ticket_products
    ADD COLUMN IF NOT EXISTS has_gate boolean NOT NULL DEFAULT true;

ALTER TABLE ticketing.ticket_products
    ADD COLUMN IF NOT EXISTS cogs numeric(15,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ticket_products_cogs_check'
    ) THEN
        ALTER TABLE ticketing.ticket_products
            ADD CONSTRAINT ticket_products_cogs_check CHECK (cogs >= 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ticket_products_has_gate
    ON ticketing.ticket_products (has_gate) WHERE has_gate = false;
