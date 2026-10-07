-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_kds_orders
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:40.275Z
-- =============================================================================

-- Table: pos.pos_kds_orders
CREATE TABLE "pos"."pos_kds_orders" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "order_id" uuid,
    "item_id" uuid,
    "station_id" uuid,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "priority" integer DEFAULT 0,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "cooking_time_seconds" integer,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_kds_orders"
    ADD CONSTRAINT "pos_kds_orders_pkey" PRIMARY KEY (id);

CREATE INDEX idx_pos_kds_order ON pos.pos_kds_orders USING btree (order_id);

CREATE INDEX idx_pos_kds_station ON pos.pos_kds_orders USING btree (station_id);

CREATE INDEX idx_pos_kds_status ON pos.pos_kds_orders USING btree (status);

COMMENT ON TABLE "pos"."pos_kds_orders" IS 'Kitchen Display System order queue';
