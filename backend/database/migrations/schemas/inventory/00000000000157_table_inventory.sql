-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: inventory.inventory
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:24.405Z
-- =============================================================================

-- Table: inventory.inventory
CREATE TABLE "inventory"."inventory" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "raw_material_id" uuid NOT NULL,
    "qty_available" numeric(15,3) DEFAULT 0 NOT NULL,
    "qty_on_order" numeric(15,3) DEFAULT 0 NOT NULL,
    "qty_minimum" numeric(15,3) DEFAULT 0 NOT NULL,
    "qty_maximum" numeric(15,3),
    "unit_cost" numeric(15,2) DEFAULT 0,
    "lokasi_rak" character varying(100),
    "last_movement_at" timestamp with time zone,
    "catatan" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "inventory"."inventory"
    ADD CONSTRAINT "inventory_raw_material_id_key" UNIQUE (raw_material_id);

ALTER TABLE ONLY "inventory"."inventory"
    ADD CONSTRAINT "inventory_pkey" PRIMARY KEY (id);

CREATE INDEX idx_inventory_is_active ON inventory.inventory USING btree (is_active);

CREATE INDEX idx_inventory_low_stock ON inventory.inventory USING btree (qty_minimum, qty_available) WHERE (is_active = true);

CREATE INDEX idx_inventory_raw_material ON inventory.inventory USING btree (raw_material_id);
COMMENT ON COLUMN "inventory"."inventory"."qty_minimum" IS 'Minimum stock level before reorder alert (default: 1000 units)';
