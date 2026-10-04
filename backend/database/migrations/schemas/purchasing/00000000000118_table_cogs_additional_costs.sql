-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.cogs_additional_costs
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:52.860Z
-- =============================================================================

-- Table: purchasing.cogs_additional_costs
CREATE TABLE "purchasing"."cogs_additional_costs" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "reference_type" character varying(50) NOT NULL,
    "reference_id" uuid NOT NULL,
    "tipe_biaya" character varying(50) NOT NULL,
    "deskripsi" text,
    "jumlah" numeric(15,2) NOT NULL,
    "currency" character varying(3) DEFAULT 'IDR'::character varying NOT NULL,
    "exchange_rate" numeric(15,6) DEFAULT 1,
    "jumlah_idr" numeric(15,2),
    "supplier_id" uuid,
    "tanggal_transaksi" date DEFAULT CURRENT_DATE NOT NULL,
    "catatan" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "purchasing"."cogs_additional_costs"
    ADD CONSTRAINT "cogs_additional_costs_pkey" PRIMARY KEY (id);

CREATE INDEX idx_cogs_reference ON purchasing.cogs_additional_costs USING btree (reference_type, reference_id);

CREATE INDEX idx_cogs_supplier ON purchasing.cogs_additional_costs USING btree (supplier_id);

CREATE INDEX idx_cogs_tanggal ON purchasing.cogs_additional_costs USING btree (tanggal_transaksi);

CREATE INDEX idx_cogs_tipe ON purchasing.cogs_additional_costs USING btree (tipe_biaya);
