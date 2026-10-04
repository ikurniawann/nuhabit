-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: item.raw_materials
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:03.868Z
-- =============================================================================

-- Table: item.raw_materials
CREATE TABLE "item"."raw_materials" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "kode" character varying(20) NOT NULL,
    "nama" character varying(100) NOT NULL,
    "kategori" character varying(30) NOT NULL,
    "deskripsi" text,
    "satuan_besar_id" uuid,
    "satuan_kecil_id" uuid,
    "konversi_factor" numeric(10,4) DEFAULT 1,
    "stok_minimum" numeric(12,4) DEFAULT 0,
    "stok_maximum" numeric(12,4) DEFAULT 0,
    "shelf_life_days" integer,
    "storage_condition" character varying(20),
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid,
    "deleted_at" timestamp with time zone,
    "deleted_by" uuid,
    "coa" text,
    "material_type" character varying(20) DEFAULT 'PURCHASED'::character varying NOT NULL,
    "source_product_id" uuid
);

ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_kode_key" UNIQUE (kode);

ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_coa_check" CHECK (coa = ANY (ARRAY['PRODUCTION'::text, 'RND'::text, 'ASSET'::text]));

ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_kategori_check" CHECK (kategori::text = ANY (ARRAY['BAHAN_PANGAN'::character varying, 'BAHAN_NON_PANGAN'::character varying, 'KEMASAN'::character varying, 'BAHAN_BAKAR'::character varying, 'LAINNYA'::character varying]::text[]));

ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_material_type_check" CHECK (material_type::text = ANY (ARRAY['PURCHASED'::character varying, 'WIP'::character varying]::text[]));

ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_storage_condition_check" CHECK (storage_condition::text = ANY (ARRAY['SUHU_RUANG'::character varying, 'DINGIN'::character varying, 'BEKU'::character varying, 'KHUSUS'::character varying]::text[]));

CREATE INDEX idx_raw_materials_deleted ON item.raw_materials USING btree (deleted_at) WHERE (deleted_at IS NULL);

CREATE INDEX idx_raw_materials_is_active ON item.raw_materials USING btree (is_active);

CREATE INDEX idx_raw_materials_kategori ON item.raw_materials USING btree (kategori);

CREATE INDEX idx_raw_materials_material_type ON item.raw_materials USING btree (material_type);

CREATE INDEX idx_raw_materials_not_deleted ON item.raw_materials USING btree (is_active, nama) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX idx_raw_materials_source_product ON item.raw_materials USING btree (source_product_id) WHERE (source_product_id IS NOT NULL);
