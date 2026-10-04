-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: inventory.finished_goods_inventory
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:17.070Z
-- =============================================================================

-- Table: inventory.finished_goods_inventory
CREATE TABLE "inventory"."finished_goods_inventory" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "product_id" uuid NOT NULL,
    "qty_available" numeric(15,3) DEFAULT 0 NOT NULL,
    "unit_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "last_movement_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "inventory"."finished_goods_inventory"
    ADD CONSTRAINT "finished_goods_inventory_product_id_key" UNIQUE (product_id);

ALTER TABLE ONLY "inventory"."finished_goods_inventory"
    ADD CONSTRAINT "finished_goods_inventory_pkey" PRIMARY KEY (id);

CREATE INDEX idx_finished_goods_inventory_product ON inventory.finished_goods_inventory USING btree (product_id);
