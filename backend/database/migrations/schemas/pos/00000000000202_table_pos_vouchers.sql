-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_vouchers
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:51.678Z
-- =============================================================================

-- Table: pos.pos_vouchers
CREATE TABLE "pos"."pos_vouchers" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "code" character varying(50) NOT NULL,
    "type" character varying(20) NOT NULL,
    "value" numeric(12,2) NOT NULL,
    "min_purchase" numeric(12,2) DEFAULT 0,
    "max_discount" numeric(12,2),
    "valid_from" timestamp with time zone DEFAULT now(),
    "valid_to" timestamp with time zone,
    "usage_limit" integer,
    "usage_count" integer DEFAULT 0,
    "per_customer_limit" integer DEFAULT 1,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_vouchers"
    ADD CONSTRAINT "pos_vouchers_code_key" UNIQUE (code);

ALTER TABLE ONLY "pos"."pos_vouchers"
    ADD CONSTRAINT "pos_vouchers_pkey" PRIMARY KEY (id);
