-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_order_splits
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:43.809Z
-- =============================================================================

-- Table: pos.pos_order_splits
CREATE TABLE "pos"."pos_order_splits" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "order_id" uuid NOT NULL,
    "split_index" integer NOT NULL,
    "label" text DEFAULT ''::text,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "amount_paid" numeric(12,2) DEFAULT 0 NOT NULL,
    "change_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "payment_method" text,
    "status" pos_split_status DEFAULT 'pending'::pos_split_status NOT NULL,
    "customer_id" uuid,
    "ark_coins_used" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "paid_at" timestamp with time zone
);

ALTER TABLE ONLY "pos"."pos_order_splits"
    ADD CONSTRAINT "pos_order_splits_order_id_split_index_key" UNIQUE (order_id, split_index);

ALTER TABLE ONLY "pos"."pos_order_splits"
    ADD CONSTRAINT "pos_order_splits_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "pos"."pos_order_splits"
    ADD CONSTRAINT "pos_order_splits_payment_method_check" CHECK (payment_method = ANY (ARRAY['cash'::text, 'qris'::text, 'debit'::text, 'credit'::text, 'ark_coin'::text]));

CREATE INDEX idx_pos_order_splits_order ON pos.pos_order_splits USING btree (order_id);

CREATE INDEX idx_pos_order_splits_status ON pos.pos_order_splits USING btree (status);
