-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_split_payments
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:50.448Z
-- =============================================================================

-- Table: pos.pos_split_payments
CREATE TABLE "pos"."pos_split_payments" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "split_id" uuid NOT NULL,
    "order_id" uuid NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "change_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "payment_method" text NOT NULL,
    "reference_number" text,
    "cashier_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_split_payments"
    ADD CONSTRAINT "pos_split_payments_pkey" PRIMARY KEY (id);

CREATE INDEX idx_pos_split_payments_split ON pos.pos_split_payments USING btree (split_id);
