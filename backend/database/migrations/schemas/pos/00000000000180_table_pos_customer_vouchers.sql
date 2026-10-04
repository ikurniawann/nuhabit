-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_customer_vouchers
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:38.142Z
-- =============================================================================

-- Table: pos.pos_customer_vouchers
CREATE TABLE "pos"."pos_customer_vouchers" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "customer_id" uuid,
    "voucher_id" uuid,
    "code" character varying(50) NOT NULL,
    "status" character varying(20) DEFAULT 'available'::character varying,
    "redeemed_at" timestamp with time zone DEFAULT now(),
    "used_at" timestamp with time zone,
    "order_id" uuid,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_customer_vouchers"
    ADD CONSTRAINT "pos_customer_vouchers_pkey" PRIMARY KEY (id);
