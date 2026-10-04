-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_tables
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:51.073Z
-- =============================================================================

-- Table: pos.pos_tables
CREATE TABLE "pos"."pos_tables" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "table_number" character varying(20) NOT NULL,
    "capacity" integer NOT NULL,
    "status" pos_table_status DEFAULT 'available'::pos_table_status,
    "qr_code" character varying(100),
    "current_order_id" uuid,
    "notes" text,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "name" text,
    "area" text
);

ALTER TABLE ONLY "pos"."pos_tables"
    ADD CONSTRAINT "pos_tables_qr_code_key" UNIQUE (qr_code);

ALTER TABLE ONLY "pos"."pos_tables"
    ADD CONSTRAINT "pos_tables_table_number_key" UNIQUE (table_number);

ALTER TABLE ONLY "pos"."pos_tables"
    ADD CONSTRAINT "pos_tables_pkey" PRIMARY KEY (id);

CREATE INDEX idx_pos_tables_status ON pos.pos_tables USING btree (status);
