-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: item.products
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:57.100Z
-- =============================================================================

-- Table: item.products
CREATE TABLE "item"."products" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "kode" character varying(20) NOT NULL,
    "nama" character varying(100) NOT NULL,
    "deskripsi" text,
    "kategori" character varying(30),
    "satuan_id" uuid,
    "harga_jual" numeric(15,2) DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid,
    "deleted_at" timestamp with time zone,
    "deleted_by" uuid,
    "harga_modal" numeric DEFAULT 0 NOT NULL,
    "markup_persen" numeric DEFAULT 30 NOT NULL
);

ALTER TABLE ONLY "item"."products"
    ADD CONSTRAINT "products_kode_key" UNIQUE (kode);

ALTER TABLE ONLY "item"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY (id);

CREATE INDEX idx_products_not_deleted ON item.products USING btree (is_active, nama) WHERE (deleted_at IS NULL);
