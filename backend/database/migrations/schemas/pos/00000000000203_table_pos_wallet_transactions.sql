-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_wallet_transactions
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:52.273Z
-- =============================================================================

-- Table: pos.pos_wallet_transactions
CREATE TABLE "pos"."pos_wallet_transactions" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "customer_id" uuid,
    "type" character varying(20) NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "ark_coins" numeric(12,2) NOT NULL,
    "balance_before" numeric(12,2) NOT NULL,
    "balance_after" numeric(12,2) NOT NULL,
    "payment_method" pos_payment_method,
    "xendit_transaction_id" character varying(100),
    "order_id" uuid,
    "reference_id" character varying(100),
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_wallet_transactions"
    ADD CONSTRAINT "pos_wallet_transactions_pkey" PRIMARY KEY (id);

CREATE INDEX idx_pos_wallet_created ON pos.pos_wallet_transactions USING btree (created_at DESC);

CREATE INDEX idx_pos_wallet_customer ON pos.pos_wallet_transactions USING btree (customer_id);

COMMENT ON TABLE "pos"."pos_wallet_transactions" IS 'Ark Coin wallet transactions (topup, payment, redeem)';
