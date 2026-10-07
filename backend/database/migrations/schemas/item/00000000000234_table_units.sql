-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: item.units
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:11.194Z
-- =============================================================================

-- Table: item.units
CREATE TABLE "item"."units" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "kode" character varying(10) NOT NULL,
    "nama" character varying(50) NOT NULL,
    "tipe" character varying(20) NOT NULL,
    "deskripsi" text,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid,
    "deleted_at" timestamp with time zone,
    "deleted_by" uuid
);

ALTER TABLE ONLY "item"."units"
    ADD CONSTRAINT "units_kode_key" UNIQUE (kode);

ALTER TABLE ONLY "item"."units"
    ADD CONSTRAINT "units_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "item"."units"
    ADD CONSTRAINT "units_tipe_check" CHECK (tipe::text = ANY (ARRAY['BESAR'::character varying, 'KECIL'::character varying, 'KONVERSI'::character varying]::text[]));

CREATE INDEX idx_units_not_deleted ON item.units USING btree (is_active, nama) WHERE (deleted_at IS NULL);
