-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_shift_transactions
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:49.213Z
-- =============================================================================

-- Table: pos.pos_shift_transactions
CREATE TABLE "pos"."pos_shift_transactions" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "shift_id" uuid,
    "type" character varying(20) NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "payment_method" pos_payment_method,
    "order_id" uuid,
    "void_reason" text,
    "paid_out_reason" text,
    "created_by" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_shift_transactions"
    ADD CONSTRAINT "pos_shift_transactions_pkey" PRIMARY KEY (id);
