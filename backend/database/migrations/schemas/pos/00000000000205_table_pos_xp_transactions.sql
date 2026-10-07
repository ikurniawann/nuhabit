-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_xp_transactions
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:53.442Z
-- =============================================================================

-- Table: pos.pos_xp_transactions
CREATE TABLE "pos"."pos_xp_transactions" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "customer_id" uuid,
    "order_id" uuid,
    "xp_earned" integer DEFAULT 0,
    "xp_redeemed" integer DEFAULT 0,
    "balance_before" integer NOT NULL,
    "balance_after" integer NOT NULL,
    "description" character varying(200),
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_xp_transactions"
    ADD CONSTRAINT "pos_xp_transactions_pkey" PRIMARY KEY (id);

CREATE INDEX idx_pos_xp_customer ON pos.pos_xp_transactions USING btree (customer_id);
