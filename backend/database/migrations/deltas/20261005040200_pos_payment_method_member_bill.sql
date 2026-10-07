-- =============================================================================
-- POS: allow 'member_bill' in the pos_payment_method enum
-- =============================================================================
-- Settling a member bill (lib/pos/member-bill-server.ts settleOpenOrders and
-- the Go port in internal/app/adapters_storedvalue.go) closes the member's
-- multi-stall checkouts with payment_method = 'member_bill'
-- (MEMBER_BILL_PAYMENT_METHOD). pos_orders.payment_method is text, but
-- pos_checkouts.payment_method is this enum, so the settlement failed with
-- 22P02 for any member whose open orders came from a multi-stall checkout.
-- Proven by TestMemberBillSettlesMultiStallCheckout (internal/app).
-- =============================================================================

ALTER TYPE public.pos_payment_method ADD VALUE IF NOT EXISTS 'member_bill';
