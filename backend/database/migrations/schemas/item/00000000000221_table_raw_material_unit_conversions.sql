-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: item.raw_material_unit_conversions
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:03.278Z
-- =============================================================================

-- Table: item.raw_material_unit_conversions
CREATE TABLE "item"."raw_material_unit_conversions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "raw_material_id" uuid NOT NULL,
    "satuan_id" uuid NOT NULL,
    "qty_in_base_unit" numeric NOT NULL,
    "is_base" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_by" uuid,
    "updated_by" uuid
);

ALTER TABLE ONLY "item"."raw_material_unit_conversions"
    ADD CONSTRAINT "raw_material_unit_conversions_raw_material_id_satuan_id_key" UNIQUE (raw_material_id, satuan_id);

ALTER TABLE ONLY "item"."raw_material_unit_conversions"
    ADD CONSTRAINT "raw_material_unit_conversions_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "item"."raw_material_unit_conversions"
    ADD CONSTRAINT "raw_material_unit_conversions_qty_in_base_unit_check" CHECK (qty_in_base_unit > 0::numeric);

CREATE INDEX idx_raw_material_unit_conversions_material_id ON item.raw_material_unit_conversions USING btree (raw_material_id);

CREATE INDEX idx_raw_material_unit_conversions_satuan_id ON item.raw_material_unit_conversions USING btree (satuan_id);
