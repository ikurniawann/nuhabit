-- =============================================================================
-- Ticketing: allow the 'diskon' charge type on ticket_visit_charges
-- =============================================================================
-- 20260726130000_ticket_booking_promo added the 'diskon' ledger line (a
-- non-cash kredit that keeps a promo booking's visit at net 0) and widened
-- chk_charge_direction, but left the column CHECK on charge_type from Fase B
-- untouched. Every redeem of a booking with discount_amount > 0 therefore
-- failed with 23514 ("Data tidak memenuhi ketentuan"), in the TS route and
-- the Go port alike. Proven by TestRedeemPromoBookingWritesDiscountLine.
--
-- Idempotent: the constraint is dropped and re-created with the full list.
-- =============================================================================

ALTER TABLE ticketing.ticket_visit_charges
    DROP CONSTRAINT IF EXISTS ticket_visit_charges_charge_type_check;
ALTER TABLE ticketing.ticket_visit_charges
    ADD CONSTRAINT ticket_visit_charges_charge_type_check CHECK (
        charge_type IN ('tiket', 'fnb', 'denda', 'koreksi', 'refund-deposit',
                        'deposit', 'pembayaran', 'diskon')
    );
