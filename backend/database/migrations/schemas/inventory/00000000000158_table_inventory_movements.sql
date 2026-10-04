-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: inventory.inventory_movements
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:24.987Z
-- =============================================================================

-- Table: inventory.inventory_movements
CREATE TABLE "inventory"."inventory_movements" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "inventory_id" uuid NOT NULL,
    "raw_material_id" uuid NOT NULL,
    "tipe" character varying(20) NOT NULL,
    "jumlah" numeric(15,3) NOT NULL,
    "qty_before" numeric(15,3) NOT NULL,
    "qty_after" numeric(15,3) NOT NULL,
    "unit_cost" numeric(15,2),
    "total_cost" numeric(15,2),
    "reference_type" character varying(50),
    "reference_id" uuid,
    "reference_number" character varying(100),
    "alasan" text,
    "catatan" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "return_id" uuid
);

ALTER TABLE ONLY "inventory"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "inventory"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_tipe_check" CHECK (tipe::text = ANY (ARRAY['in'::character varying, 'out'::character varying, 'adjustment'::character varying, 'transfer'::character varying, 'return'::character varying]::text[]));

CREATE INDEX idx_im_created_at ON inventory.inventory_movements USING btree (created_at DESC);

CREATE INDEX idx_im_inventory_id ON inventory.inventory_movements USING btree (inventory_id);

CREATE INDEX idx_im_raw_material ON inventory.inventory_movements USING btree (raw_material_id);

CREATE INDEX idx_im_reference ON inventory.inventory_movements USING btree (reference_type, reference_id);

CREATE INDEX idx_im_tipe ON inventory.inventory_movements USING btree (tipe);
