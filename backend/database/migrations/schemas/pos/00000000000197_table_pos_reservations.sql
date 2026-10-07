-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_reservations
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:48.608Z
-- =============================================================================

-- Table: pos.pos_reservations
CREATE TABLE "pos"."pos_reservations" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "table_id" uuid,
    "customer_id" uuid,
    "customer_name" character varying(100),
    "customer_phone" character varying(20),
    "reservation_date" date NOT NULL,
    "time_slot" time without time zone NOT NULL,
    "duration_minutes" integer DEFAULT 120,
    "pax_count" integer NOT NULL,
    "special_requests" text,
    "deposit_amount" numeric(12,2) DEFAULT 0,
    "status" character varying(20) DEFAULT 'confirmed'::character varying,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_reservations"
    ADD CONSTRAINT "pos_reservations_pkey" PRIMARY KEY (id);
