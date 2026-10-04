-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_cashier_shifts
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:36.906Z
-- =============================================================================

-- Table: pos.pos_cashier_shifts
CREATE TABLE "pos"."pos_cashier_shifts" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "cashier_id" uuid NOT NULL,
    "opened_at" timestamp with time zone DEFAULT now(),
    "closed_at" timestamp with time zone,
    "opening_balance" numeric(12,2) DEFAULT 0 NOT NULL,
    "expected_closing" numeric(12,2) DEFAULT 0,
    "actual_closing" numeric(12,2),
    "variance" numeric(12,2),
    "variance_reason" text,
    "status" character varying(20) DEFAULT 'open'::character varying,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_cashier_shifts"
    ADD CONSTRAINT "pos_cashier_shifts_pkey" PRIMARY KEY (id);

CREATE INDEX idx_pos_shifts_cashier ON pos.pos_cashier_shifts USING btree (cashier_id);

CREATE INDEX idx_pos_shifts_status ON pos.pos_cashier_shifts USING btree (status);

COMMENT ON TABLE "pos"."pos_cashier_shifts" IS 'Cashier shift management with opening/closing balance';
