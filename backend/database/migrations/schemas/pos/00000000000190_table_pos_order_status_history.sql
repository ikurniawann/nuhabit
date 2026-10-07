-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_order_status_history
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:44.444Z
-- =============================================================================

-- Table: pos.pos_order_status_history
CREATE TABLE "pos"."pos_order_status_history" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "order_id" uuid,
    "from_status" pos_order_status,
    "to_status" pos_order_status NOT NULL,
    "changed_by" uuid NOT NULL,
    "changed_at" timestamp with time zone DEFAULT now(),
    "notes" text
);

ALTER TABLE ONLY "pos"."pos_order_status_history"
    ADD CONSTRAINT "pos_order_status_history_pkey" PRIMARY KEY (id);
