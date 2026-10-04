-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_shifts
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:49.837Z
-- =============================================================================

-- Table: pos.pos_shifts
CREATE TABLE "pos"."pos_shifts" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "shift_number" character varying(20) NOT NULL,
    "cashier_id" uuid NOT NULL,
    "branch_id" uuid,
    "opened_at" timestamp with time zone DEFAULT now(),
    "closed_at" timestamp with time zone,
    "opened_by" text,
    "closed_by" text,
    "opening_cash" numeric(12,2) DEFAULT 0 NOT NULL,
    "closing_cash" numeric(12,2) DEFAULT 0,
    "expected_cash" numeric(12,2) DEFAULT 0,
    "variance" numeric(12,2) GENERATED ALWAYS AS (closing_cash - expected_cash) STORED,
    "total_orders" integer DEFAULT 0,
    "total_sales" numeric(12,2) DEFAULT 0,
    "total_refunds" numeric(12,2) DEFAULT 0,
    "total_cash_sales" numeric(12,2) DEFAULT 0,
    "total_qris_sales" numeric(12,2) DEFAULT 0,
    "total_debit_sales" numeric(12,2) DEFAULT 0,
    "total_credit_sales" numeric(12,2) DEFAULT 0,
    "total_ark_coin_sales" numeric(12,2) DEFAULT 0,
    "notes" text,
    "status" character varying(20) DEFAULT 'active'::character varying,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_shifts"
    ADD CONSTRAINT "pos_shifts_shift_number_key" UNIQUE (shift_number);

ALTER TABLE ONLY "pos"."pos_shifts"
    ADD CONSTRAINT "pos_shifts_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "pos"."pos_shifts"
    ADD CONSTRAINT "pos_shifts_status_check" CHECK (status::text = ANY (ARRAY['active'::character varying, 'closed'::character varying, 'cancelled'::character varying]::text[]));
