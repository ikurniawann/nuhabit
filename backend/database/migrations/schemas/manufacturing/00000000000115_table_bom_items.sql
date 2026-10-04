-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: manufacturing.bom_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:51.060Z
-- =============================================================================

-- Table: manufacturing.bom_items
CREATE TABLE "manufacturing"."bom_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "product_id" uuid,
    "raw_material_id" uuid,
    "qty_required" numeric(12,4) NOT NULL,
    "satuan_id" uuid,
    "waste_factor" numeric(5,4) DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "manufacturing"."bom_items"
    ADD CONSTRAINT "bom_items_pkey" PRIMARY KEY (id);

CREATE INDEX idx_bom_material ON manufacturing.bom_items USING btree (raw_material_id);

CREATE INDEX idx_bom_product ON manufacturing.bom_items USING btree (product_id);
